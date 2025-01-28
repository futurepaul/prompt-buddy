// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { PromptBuddyEditor } from './promptBuddyEditor';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('PromptBuddy is now active!');
	
	// Register our custom editor provider
	const registration = PromptBuddyEditor.register(context);
	console.log('PromptBuddy editor registered:', registration !== undefined);
	
	// Auto-open preview when a prompt file is opened (if enabled in settings)
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(async (document) => {
			if (document.uri.fsPath.endsWith('.pbmd')) {
				const config = vscode.workspace.getConfiguration('promptBuddy', document.uri);
				if (config.get('autoOpenPreview', true)) {
					await vscode.commands.executeCommand('vscode.openWith', document.uri, 'promptBuddy.prompt', vscode.ViewColumn.Beside);
				}
			}
		})
	);

	// Register command to open preview
	context.subscriptions.push(
		vscode.commands.registerCommand('prompt-buddy.openPreview', async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor) {
				const uri = activeEditor.document.uri;
				// Open the custom editor to the side
				await vscode.commands.executeCommand('vscode.openWith', uri, 'promptBuddy.prompt', vscode.ViewColumn.Beside);
			}
		})
	);

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
}

// This method is called when your extension is deactivated
export function deactivate() {}
