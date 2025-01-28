// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { PromptBuddyEditor } from './promptBuddyEditor';
import { PromptBuddyCodeActionProvider } from './codeActions';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('PromptBuddy is now active!');

	// Register our code action provider
	const codeActionRegistration = PromptBuddyCodeActionProvider.register(context);
	console.log('PromptBuddy code actions registered:', codeActionRegistration !== undefined);

	// Register command to copy processed prompt to clipboard
	context.subscriptions.push(
		vscode.commands.registerCommand('prompt-buddy.copyToClipboard', async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.uri.fsPath.endsWith('.pbmd')) {
				const editor = new PromptBuddyEditor(context);
				const processedText = await editor.processForCopy(activeEditor.document.getText());
				await vscode.env.clipboard.writeText(processedText);
				vscode.window.showInformationMessage('Prompt copied to clipboard!');
			}
		})
	);

	// Register command to add files to context
	context.subscriptions.push(
		vscode.commands.registerCommand('prompt-buddy.addFiles', async (documentUri: vscode.Uri, currentFiles: string[]) => {
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			// Get exclude pattern from .gitignore
			const editor = new PromptBuddyEditor(context);
			const excludePattern = await editor.getGitIgnoreExcludePattern(workspaceFolder);
			
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
				// Get the document and update the context section
				const document = await vscode.workspace.openTextDocument(documentUri);
				const text = document.getText();
				const contextTagRegex = /<context>([\s\S]*?)<\/context>/g;
				const match = contextTagRegex.exec(text);

				if (match) {
					const edit = new vscode.WorkspaceEdit();
					const startPos = document.positionAt(match.index + '<context>'.length);
					const endPos = document.positionAt(match.index + match[0].length - '</context>'.length);

					// Combine existing files with new ones, removing duplicates
					const allFiles = [...new Set([...currentFiles, ...selectedPaths])];
					edit.replace(documentUri, new vscode.Range(startPos, endPos), '\n' + allFiles.join('\n') + '\n');
					await vscode.workspace.applyEdit(edit);
				}
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
