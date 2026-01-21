/**
 * SelectionContextProvider
 *
 * Provide:
 * - Hover link over selected text to add it as a prompt context "snippet" chip
 * - Code action (lightbulb) entry for the current selection
 */

import * as vscode from 'vscode';
import { t } from '../../i18n';

export interface SelectionContextCommandArgs {
  uri: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export class SelectionContextProvider implements vscode.HoverProvider, vscode.CodeActionProvider {
  private static instance: SelectionContextProvider | null = null;

  // Put it under refactor to match existing LimCode diff actions.
  public static readonly actionKind = vscode.CodeActionKind.Refactor.append('limcode.context');
  public static readonly providedCodeActionKinds = [SelectionContextProvider.actionKind];

  public static getInstance(): SelectionContextProvider {
    if (!SelectionContextProvider.instance) {
      SelectionContextProvider.instance = new SelectionContextProvider();
    }
    return SelectionContextProvider.instance;
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return undefined;

    // Only show when hovering inside a non-empty selection.
    const hit = editor.selections.find(sel => !sel.isEmpty && sel.contains(position));
    if (!hit) return undefined;

    const contents = new vscode.MarkdownString();
    contents.isTrusted = true;

    const args: SelectionContextCommandArgs = {
      uri: document.uri.toString(),
      selection: {
        start: { line: hit.start.line, character: hit.start.character },
        end: { line: hit.end.line, character: hit.end.character }
      }
    };
    const encodedArgs = encodeURIComponent(JSON.stringify([args]));

    contents.appendMarkdown(`[${t('tools.file.selectionContext.hoverAddToInput')}](command:limcode.context.addSelectionToInput?${encodedArgs})`);

    return new vscode.Hover(contents, hit);
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    _context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return undefined;

    if (range.isEmpty) return undefined;

    const args: SelectionContextCommandArgs = {
      uri: document.uri.toString(),
      selection: {
        start: { line: range.start.line, character: range.start.character },
        end: { line: range.end.line, character: range.end.character }
      }
    };

    const action = new vscode.CodeAction(
      t('tools.file.selectionContext.codeActionAddToInput'),
      SelectionContextProvider.actionKind
    );

    action.command = {
      title: t('tools.file.selectionContext.codeActionAddToInput'),
      command: 'limcode.context.addSelectionToInput',
      arguments: [args]
    };

    action.isPreferred = true;

    return [action];
  }
}

export function getSelectionContextProvider(): SelectionContextProvider {
  return SelectionContextProvider.getInstance();
}
