// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { PromptBuddyEditor } from './promptBuddyEditor';
import { PromptBuddyCodeActionProvider } from './codeActions';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('PromptBuddy is now active!');

	// Create status bar item
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBarItem.text = "🐶 Prompt Buddy";
	statusBarItem.command = 'prompt-buddy.showActions';
	context.subscriptions.push(statusBarItem);

	// Show/hide status bar based on active editor
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor?.document.uri.fsPath.endsWith('.pbmd')) {
				statusBarItem.show();
			} else {
				statusBarItem.hide();
			}
		})
	);

	// Show status bar if we're already in a .pbmd file
	if (vscode.window.activeTextEditor?.document.uri.fsPath.endsWith('.pbmd')) {
		statusBarItem.show();
	}

	// Register command to show actions menu
	context.subscriptions.push(
		vscode.commands.registerCommand('prompt-buddy.showActions', async () => {
			const actions = [
				{
					label: "$(add) Add Files to Context",
					description: "Add files to the current context block or create a new one",
					command: 'prompt-buddy.addFiles'
				},
				{
					label: "$(copy) Copy as Prompt",
					description: "Copy the processed prompt to clipboard",
					command: 'prompt-buddy.copyToClipboard'
				}
			];

			const selected = await vscode.window.showQuickPick(actions, {
				placeHolder: 'Select a Prompt Buddy action'
			});

			if (selected) {
				vscode.commands.executeCommand(selected.command);
			}
		})
	);

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
		vscode.commands.registerCommand('prompt-buddy.addFiles', async (documentUri?: vscode.Uri, currentFiles: string[] = []) => {
			// Get the active editor if not provided
			if (!documentUri) {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor || !activeEditor.document.uri.fsPath.endsWith('.pbmd')) {
					vscode.window.showErrorMessage('Please open a .pbmd file first');
					return;
				}
				documentUri = activeEditor.document.uri;
			}

			// Check if we're in a context block and get its files
			const document = await vscode.workspace.openTextDocument(documentUri);
			const text = document.getText();
			const contextTagRegex = /<context>([\s\S]*?)<\/context>/g;
			const activeEditor = vscode.window.activeTextEditor;
			const cursorPosition = activeEditor?.selection.active;
			
			let currentContextFiles: string[] = [];
			let match;
			while ((match = contextTagRegex.exec(text)) !== null) {
				const startPos = document.positionAt(match.index);
				const endPos = document.positionAt(match.index + match[0].length);

				if (cursorPosition && 
					cursorPosition.isAfterOrEqual(startPos) && 
					cursorPosition.isBeforeOrEqual(endPos)) {
					currentContextFiles = match[1].trim().split('\n').filter(line => line.trim());
					break;
				}
			}

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
					picked: currentContextFiles.includes(relativePath),
					mtime: stat.mtime
				};
			}));

			// Sort by modification time (most recent first)
			const items = itemsWithStats.sort((a, b) => b.mtime - a.mtime);

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: currentContextFiles.length > 0 ? 
					'Modify files in current context block' : 
					'Select files for new context block',
				matchOnDescription: true,
				canPickMany: true
			});

			if (selected !== undefined && selected.length === 0) {
				return;
			}

			const selectedPaths = selected?.map(item => item.label);
			
			if (selectedPaths) {
				// Get the document and check for existing context tags
				const contextTagRegex = /<context>([\s\S]*?)<\/context>/g;
				const edit = new vscode.WorkspaceEdit();
				let contextToUpdate: { match: RegExpExecArray, startPos: vscode.Position, endPos: vscode.Position } | undefined;

				// Find if cursor is inside any context block
				let match;
				while ((match = contextTagRegex.exec(text)) !== null) {
					const startPos = document.positionAt(match.index);
					const endPos = document.positionAt(match.index + match[0].length);

					if (cursorPosition && 
						cursorPosition.isAfterOrEqual(startPos) && 
						cursorPosition.isBeforeOrEqual(endPos)) {
						contextToUpdate = { match, startPos, endPos };
						break;
					}
				}

				if (contextToUpdate) {
					// Update existing context tag that cursor is inside
					const startPos = document.positionAt(contextToUpdate.match.index + '<context>'.length);
					const endPos = document.positionAt(contextToUpdate.match.index + contextToUpdate.match[0].length - '</context>'.length);

					// Get current files from the context tag
					const existingFiles = contextToUpdate.match[1].trim().split('\n').filter(line => line.trim());
					const allFiles = [...new Set([...existingFiles, ...selectedPaths])];
					edit.replace(documentUri, new vscode.Range(startPos, endPos), '\n' + allFiles.join('\n') + '\n');
				} else {
					// Create new context tag at cursor position or end of file
					const insertPosition = cursorPosition || document.positionAt(document.getText().length);
					const newContextBlock = '\n<context>\n' + selectedPaths.join('\n') + '\n</context>\n';
					edit.insert(documentUri, insertPosition, newContextBlock);
				}

				await vscode.workspace.applyEdit(edit);
			}
		})
	);
}

// This method is called when your extension is deactivated
export function deactivate() {}
