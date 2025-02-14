import * as vscode from 'vscode';
import { exec } from 'child_process';

// Define segment types
type TextSegment = {
	type: 'text';
	content: string;
};

type ContextSegment = {
	type: 'context';
	content: string;
};

type DiffSegment = {
	type: 'diff';
	branch: string | undefined;
};

type Segment = TextSegment | ContextSegment | DiffSegment;

/**
 * Handles file processing for Prompt Buddy.
 * Provides functionality to process prompt files and handle file context.
 */
export class PromptBuddyEditor {
	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	/**
	 * Read .gitignore and convert patterns to VS Code glob pattern
	 */
	public async getGitIgnoreExcludePattern(workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
		try {
			const gitignorePath = vscode.Uri.joinPath(workspaceFolder.uri, '.gitignore');
			const gitignoreContent = await vscode.workspace.fs.readFile(gitignorePath);
			const patterns = gitignoreContent.toString()
				.split('\n')
				.map(line => line.trim())
				// Filter out comments and empty lines
				.filter(line => line && !line.startsWith('#'))
				// Convert patterns to VS Code glob format
				.map(pattern => {
					// Remove leading slash if present (make pattern match anywhere)
					pattern = pattern.replace(/^\//, '');
					// Add leading and trailing wildcards if not present
					if (!pattern.startsWith('**/')) {
						pattern = `**/${pattern}`;
					}
					if (!pattern.endsWith('/**') && !pattern.includes('.')) {
						pattern = `${pattern}/**`;
					}
					return pattern;
				});

			// Always include some standard patterns
			patterns.push('**/.git/**');
			
			// Join all patterns with commas
			return `{${patterns.join(',')}}`;
		} catch (error) {
			// If .gitignore doesn't exist or can't be read, return default patterns
			return '{**/.git/**,**/node_modules/**,**/dist/**,**/build/**,**/.DS_Store,**/coverage/**}';
		}
	}

	/**
	 * Process the text for copying to clipboard
	 */
	public async processForCopy(text: string): Promise<string> {
		// First parse the document into segments
		const segments: Segment[] = [];
		let currentIndex = 0;
		
		// Handle both context tags and diff tags
		const tagRegex = /(<context>[\s\S]*?<\/context>)|(<diff(?:\s+branch="([^"]*)")?\s*\/>)/g;
		let match;

		while ((match = tagRegex.exec(text)) !== null) {
			// Add text before the tag if there is any
			if (match.index > currentIndex) {
				segments.push({
					type: 'text',
					content: text.substring(currentIndex, match.index)
				});
			}

			if (match[1]) { // Context tag
				segments.push({
					type: 'context',
					content: match[1].slice('<context>'.length, -'</context>'.length)
				});
			} else if (match[2]) { // Diff tag
				segments.push({
					type: 'diff',
					branch: match[3] // Will be undefined for <diff /> without branch attribute
				});
			}

			currentIndex = match.index + match[0].length;
		}

		// Add any remaining text
		if (currentIndex < text.length) {
			segments.push({
				type: 'text',
				content: text.substring(currentIndex)
			});
		}

		// Now process each segment
		const processedSegments = await Promise.all(segments.map(async segment => {
			if (segment.type === 'text') {
				return segment.content.trim();
			} else if (segment.type === 'context') {
				// Get file contents for each path
				const paths = segment.content.trim().split('\n');
				const contents = await Promise.all(paths.map(async path => {
					try {
						const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
						if (!workspaceFolder) {
							throw new Error('No workspace folder found');
						}

						const uri = vscode.Uri.joinPath(workspaceFolder.uri, path);
						const content = await vscode.workspace.fs.readFile(uri);
						
						// Get the document's language ID from VS Code
						const document = await vscode.workspace.openTextDocument(uri);
						const languageId = document.languageId;
						// Format the file content with path and code block, using the language ID
						return `${path}\n\`\`\`${languageId}\n${content.toString().trim()}\n\`\`\``;
					} catch (err) {
						console.error(`Failed to read file: ${path}`, err);
						// Show error message to user
						vscode.window.showErrorMessage(`Failed to read file: ${path}`);
						return `[Failed to read: ${path}]`;
					}
				}));
				return contents.join('\n\n');
			} else if (segment.type === 'diff') {
				try {
					const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
					if (!workspaceFolder) {
						throw new Error('No workspace folder found');
					}

					// Run git diff command
					const command = segment.branch ? 
						`cd "${workspaceFolder.uri.fsPath}" && git diff ${segment.branch}` : 
						`cd "${workspaceFolder.uri.fsPath}" && git diff`;
					
					const diffOutput = await new Promise<string>((resolve, reject) => {
						exec(command, (error: any, stdout: string, stderr: string) => {
							if (error && error.code !== 1) { // git diff returns 1 if there are changes
								reject(error);
								return;
							}
							resolve(stdout);
						});
					});

					if (!diffOutput.trim()) {
						return '[No changes]';
					}

					return `\`\`\`diff\n${diffOutput.trim()}\n\`\`\``;
				} catch (err) {
					console.error('Failed to get diff:', err);
					vscode.window.showErrorMessage('Failed to get git diff');
					return '[Failed to get diff]';
				}
			}
			return '';
		}));

		// Filter out empty segments and join with single newlines
		return processedSegments
			.filter(segment => segment.length > 0)
			.join('\n\n')
			.replace(/\n{3,}/g, '\n\n'); // Replace 3 or more newlines with 2
	}
}