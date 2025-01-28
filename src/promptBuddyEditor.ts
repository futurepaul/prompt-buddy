import * as vscode from 'vscode';
import { getNonce } from './util';
import { Uri, ThemeIcon } from 'vscode';

/**
 * Provider for prompt buddy editors.
 * 
 * Prompt buddy editors are used for `.prompt` files, which are markdown files with special XML tags
 * that can be filled in with content. The editor provides a nice interface for editing these
 * template sections while preserving the markdown structure.
 * 
 * This provider demonstrates:
 * - Setting up a webview-based editor for .prompt files
 * - Rendering markdown with editable sections
 * - Synchronizing changes between the text document and the custom editor
 */
export class PromptBuddyEditor implements vscode.CustomTextEditorProvider {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		console.log('Registering PromptBuddy editor...');
		const provider = new PromptBuddyEditor(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(PromptBuddyEditor.viewType, provider);
		console.log('PromptBuddy editor registered');
		return providerRegistration;
	}

	private static readonly viewType = 'promptBuddy.prompt';

	// Track versions per document URI
	private documentVersions = new Map<string, number>();

	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	/**
	 * Read .gitignore and convert patterns to VS Code glob pattern
	 */
	private async getGitIgnoreExcludePattern(workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
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
	 * Called when our custom editor is opened.
	 */
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		// Initialize version for this document
		const docUri = document.uri.toString();
		if (!this.documentVersions.has(docUri)) {
			this.documentVersions.set(docUri, 0);
		}

		// Use arrow function to preserve 'this' context
		const updateWebview = () => {
			const version = (this.documentVersions.get(docUri) || 0) + 1;
			this.documentVersions.set(docUri, version);
			webviewPanel.webview.postMessage({
				type: 'update',
				text: document.getText(),
				version: version
			});
		};

		// Hook up event handlers for synchronization
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				updateWebview();
			}
		});

		// Handle visibility changes
		webviewPanel.onDidChangeViewState(e => {
			if (e.webviewPanel.visible) {
				// Update content when tab becomes visible
				updateWebview();
			}
		});

		// Clean up when editor is closed
		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
			this.documentVersions.delete(docUri);
		});

		// Handle messages from the webview
		webviewPanel.webview.onDidReceiveMessage(async e => {
			switch (e.type) {
				case 'updateSection':
					this.updateSection(document, e.tag, e.content);
					return;
				case 'showFilePicker':
					const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
					if (!workspaceFolder) {
						vscode.window.showErrorMessage('No workspace folder found');
						return;
					}

					// Get the current files from the message
					const currentFiles = e.currentFiles || [];

					// Get exclude pattern from .gitignore
					const excludePattern = await this.getGitIgnoreExcludePattern(workspaceFolder);
					
					// Create a pattern that includes all files but excludes gitignored patterns
					const pattern = new vscode.RelativePattern(workspaceFolder, '**/*');
					const uris = await vscode.workspace.findFiles(pattern, excludePattern);

					// Get file stats and create items with modification time
					const itemsWithStats = await Promise.all(uris.map(async uri => {
						const stat = await vscode.workspace.fs.stat(uri);
						const relativePath = vscode.workspace.asRelativePath(uri, false);
						const fileName = uri.path.split('/').pop() || '';
						return {
							label: relativePath,
							description: fileName !== relativePath ? `$(file) ${fileName}` : undefined,
							picked: currentFiles.includes(relativePath),
							mtime: stat.mtime
						};
					}));

					// Sort by modification time (most recent first)
					const items = itemsWithStats.sort((a, b) => b.mtime - a.mtime);

					const selected = await vscode.window.showQuickPick(items, {
						placeHolder: 'Search for a file',
						matchOnDescription: true,
						canPickMany: true
					});

					if (selected !== undefined && selected.length === 0) {
						return;
					}

					const selectedPaths = selected?.map(item => item.label);
					
					if (selectedPaths) {
						webviewPanel.webview.postMessage({
							type: 'fileSelected',
							paths: selectedPaths
						});
					}
					return;
				case 'prepareForCopy':
					const processedText = await this.processForCopy(document.getText());
					webviewPanel.webview.postMessage({
						type: 'copyProcessed',
						text: processedText
					});
					return;
			}
		});

	updateWebview();
	}

	/**
	 * Get the static html used for the editor webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'promptBuddy.js'));

		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'reset.css'));

		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'vscode.css'));

		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'promptBuddy.css'));

		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet" />
				<link href="${styleVSCodeUri}" rel="stylesheet" />
				<link href="${styleMainUri}" rel="stylesheet" />

				<title>Prompt Buddy</title>
			</head>
			<body>
				<div class="prompt-editor">
					<div class="content"></div>
				</div>
				
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	/**
	 * Update a specific XML section in the document
	 */
	private updateSection(document: vscode.TextDocument, tag: string, content: string) {
		const text = document.getText();
		const startTag = `<${tag}>`;
		const endTag = `</${tag}>`;
		
		const startIndex = text.indexOf(startTag);
		const endIndex = text.indexOf(endTag);
		
		if (startIndex === -1 || endIndex === -1) {
			return;
		}

		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			document.uri,
			new vscode.Range(
				document.positionAt(startIndex + startTag.length),
				document.positionAt(endIndex)
			),
			// Add newlines around the content
			'\n' + content.trim() + '\n'
		);

		return vscode.workspace.applyEdit(edit);
	}

	private async getFileIcon(filePath: string): Promise<{ iconPath?: { light: Uri, dark: Uri } }> {
		// Get the icon for the file
		const uri = vscode.Uri.file(filePath);
		
		// Get file type icon
		const fileIcon = await vscode.workspace.fs.stat(uri).then(
			() => {
				// If file exists, try to get its icon
				return new ThemeIcon('file');
			},
			() => new ThemeIcon('file') // Default icon if file doesn't exist
		);

		// For now, just return undefined since we can't easily get VS Code's file icons
		return { iconPath: undefined };
	}

	/**
	 * Process the text for copying to clipboard
	 */
	public async processForCopy(text: string): Promise<string> {
		// First parse the document into segments
		const segments = [];
		let currentIndex = 0;
		
		const tagRegex = /<(pb-context|pb-note)>([\s\S]*?)<\/\1>/g;
		let match;

		while ((match = tagRegex.exec(text)) !== null) {
			// Add text before the tag if there is any
			if (match.index > currentIndex) {
				segments.push({
					type: 'text',
					content: text.substring(currentIndex, match.index)
				});
			}

			segments.push({
				type: 'section',
				tag: match[1],
				content: match[2].trim()
			});

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
			} else if (segment.tag === 'pb-context') {
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
						// Format the file content with path and code block
						return `${path}\n\`\`\`\n${content.toString().trim()}\n\`\`\``;
					} catch (err) {
						console.error(`Failed to read file: ${path}`, err);
						// Show error message to user
						vscode.window.showErrorMessage(`Failed to read file: ${path}`);
						return `[Failed to read: ${path}]`;
					}
				}));
				return contents.join('\n\n');
			} else if (segment.tag === 'pb-note') {
				// For notes, just return the content
				return segment.content.trim();
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