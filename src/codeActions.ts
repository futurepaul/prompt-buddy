import * as vscode from 'vscode';
import { PromptBuddyEditor } from './promptBuddyEditor';

export class PromptBuddyCodeActionProvider implements vscode.CodeActionProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new PromptBuddyCodeActionProvider(context);
        const disposable = vscode.languages.registerCodeActionsProvider(
            { language: 'pbmd' },
            provider,
            {
                providedCodeActionKinds: [
                    vscode.CodeActionKind.QuickFix
                ]
            }
        );
        return disposable;
    }

    public async provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeAction[]> {
        const actions: vscode.CodeAction[] = [];

        // Get the text around the cursor
        const line = document.lineAt(range.start.line).text;
        const fullText = document.getText();

        // Check if we're inside a context tag
        const contextTagRegex = /<context>([\s\S]*?)<\/context>/g;
        let match;
        while ((match = contextTagRegex.exec(fullText)) !== null) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length);
            const tagRange = new vscode.Range(startPos, endPos);

            if (tagRange.contains(range)) {
                // Add "Add Files" action
                const addFilesAction = new vscode.CodeAction('Add Files to Context...', vscode.CodeActionKind.QuickFix);
                addFilesAction.command = {
                    command: 'prompt-buddy.addFiles',
                    title: 'Add Files to Context',
                    arguments: [document.uri, match[1].trim().split('\n').filter(line => line.trim())]
                };
                actions.push(addFilesAction);

                // Add "Copy Prompt" action
                const copyAction = new vscode.CodeAction('Copy as Prompt to Clipboard', vscode.CodeActionKind.QuickFix);
                copyAction.command = {
                    command: 'prompt-buddy.copyToClipboard',
                    title: 'Copy as Prompt to Clipboard'
                };
                actions.push(copyAction);

                break;
            }
        }

        return actions;
    }
} 