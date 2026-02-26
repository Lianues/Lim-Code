/**
 * LimCode VSCode Extension 入口
 */

import * as vscode from 'vscode';
import { ChatViewProvider } from './webview/ChatViewProvider';
import { t, setDetectedLanguage, setLanguage as setBackendLanguage } from './backend/i18n';
import { Logger } from './backend/core/logger';
import { getDiffCodeLensProvider } from './backend/tools/file/DiffCodeLensProvider';
import { getDiffEditorActionsProvider } from './backend/tools/file/DiffEditorActionsProvider';
import { getDiffInlineProvider, DiffInlineProvider } from './backend/tools/file/DiffInlineProvider';
import { getDiffManager } from './backend/tools/file/diffManager';
import { getSelectionContextProvider, SelectionContextProvider, type SelectionContextCommandArgs } from './backend/tools/file/SelectionContextProvider';

// 保存 ChatViewProvider 实例以便在停用时清理
let chatViewProvider: ChatViewProvider | undefined;

// DiffCodeLensProvider 注册
let diffCodeLensDisposable: vscode.Disposable | undefined;

// DiffInlineProvider 注册
let diffInlineDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('LimCode extension is now active!');

    // 初始化日志系统：创建 OutputChannel 让日志同时输出到 VS Code 输出面板
    const outputChannel = vscode.window.createOutputChannel('LimCode');
    context.subscriptions.push(outputChannel);
    Logger.setOutputChannel((line) => outputChannel.appendLine(line));
    // Logger.setLevel(LogLevel.DEBUG); // 取消注释以启用 DEBUG 级别日志

    // Allow i18n to follow VS Code display language until settings load.
    setDetectedLanguage(vscode.env.language);
    setBackendLanguage('auto');

    // 注册聊天视图提供者
    chatViewProvider = new ChatViewProvider(context);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'limcode.chatView',
            chatViewProvider,
            {
                // 保持 webview 状态，切换视图时不销毁
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // 注册命令：打开聊天面板
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.openChat', () => {
            vscode.commands.executeCommand('limcode.chatView.focus');
        })
    );

    // 注册命令：新建对话
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.newChat', () => {
            chatViewProvider.sendCommand('newChat');
        })
    );

    // 注册命令：显示历史
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.showHistory', () => {
            chatViewProvider.sendCommand('showHistory');
        })
    );

    // 注册命令：显示设置
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.showSettings', () => {
            chatViewProvider.sendCommand('showSettings');
        })
    );

    // 注册 DiffCodeLensProvider
    const diffCodeLensProvider = getDiffCodeLensProvider();
    
    // 监听 DiffManager 状态变化，刷新相关 UI（CodeLens、内联高亮、标题栏按钮）
    getDiffManager().addStatusListener(() => {
        getDiffEditorActionsProvider().refresh();
        getDiffInlineProvider().refreshAllDecorations();
    });
    
    // 注册 CodeLens 提供者
    diffCodeLensDisposable = vscode.languages.registerCodeLensProvider(
        [
            { scheme: 'file' },
            { scheme: 'gemini-diff-original' }
        ],
        diffCodeLensProvider
    );
    context.subscriptions.push(diffCodeLensDisposable);
    
    // ========== Selection Context (Hover + Code Actions) ==========
    const selectionContextProvider = getSelectionContextProvider();

    // Hover: selected text -> "Add to LimCode input"
    const selectionHoverDisposable = vscode.languages.registerHoverProvider(
        [{ scheme: 'file' }],
        selectionContextProvider
    );
    context.subscriptions.push(selectionHoverDisposable);

    // Lightbulb: add selection as context snippet
    const selectionCodeActionDisposable = vscode.languages.registerCodeActionsProvider(
        [{ scheme: 'file' }],
        selectionContextProvider,
        {
            providedCodeActionKinds: SelectionContextProvider.providedCodeActionKinds
        }
    );
    context.subscriptions.push(selectionCodeActionDisposable);

    // Command used by hover/code actions
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.context.addSelectionToInput', async (args?: SelectionContextCommandArgs) => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showInformationMessage(t('tools.file.selectionContext.noActiveEditor'));
                    return;
                }

                let targetUri = editor.document.uri;
                let selection = editor.selection;

                if (args?.uri) {
                    targetUri = vscode.Uri.parse(args.uri);
                    selection = new vscode.Selection(
                        new vscode.Position(args.selection.start.line, args.selection.start.character),
                        new vscode.Position(args.selection.end.line, args.selection.end.character)
                    );
                }

                const doc = (targetUri.toString() === editor.document.uri.toString())
                    ? editor.document
                    : await vscode.workspace.openTextDocument(targetUri);

                if (selection.isEmpty) {
                    vscode.window.showInformationMessage(t('tools.file.selectionContext.noSelection'));
                    return;
                }

                // Expand to whole lines. Adjust end line when selection ends at column 0.
                let startLine = selection.start.line;
                let endLine = selection.end.line;
                if (selection.end.character === 0 && selection.end.line > selection.start.line) {
                    endLine = Math.max(selection.start.line, selection.end.line - 1);
                }

                startLine = Math.max(0, Math.min(startLine, doc.lineCount - 1));
                endLine = Math.max(0, Math.min(endLine, doc.lineCount - 1));
                if (endLine < startLine) {
                    const tmp = startLine;
                    startLine = endLine;
                    endLine = tmp;
                }

                const endChar = doc.lineAt(endLine).text.length;
                const lineRange = new vscode.Range(startLine, 0, endLine, endChar);
                const content = doc.getText(lineRange);

                const lines = content.split(/\r?\n/);
                const width = String(endLine + 1).length;
                const numbered = lines
                    .map((line, i) => `${String(startLine + 1 + i).padStart(width, ' ')} | ${line}`)
                    .join('\n');

                const relativePath = vscode.workspace.asRelativePath(targetUri, false);
                const title = `${relativePath}[L${startLine + 1}-${endLine + 1}]`;

                const contextItem = {
                    id: `snippet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    type: 'snippet' as const,
                    title,
                    content: numbered,
                    filePath: relativePath,
                    language: doc.languageId,
                    enabled: true,
                    addedAt: Date.now()
                };

                // Ensure chat view is visible, then send to webview.
                await vscode.commands.executeCommand('limcode.openChat');
                chatViewProvider?.sendCommand('input.addContext', { contextItem });
            } catch (err: any) {
                console.error('Failed to add selection context:', err);
                vscode.window.showErrorMessage(t('tools.file.selectionContext.failedToAddSelection', { error: err?.message || String(err) }));
            }
        })
    );

    // ========== Diff Inline Provider (Hover + Code Actions) ==========
    const diffInlineProvider = getDiffInlineProvider();

    // 注册 Hover 提供者（悬停显示可点击的 Accept/Reject 链接）
    diffInlineDisposable = vscode.languages.registerHoverProvider(
        [
            { scheme: 'file' },
            { scheme: 'gemini-diff-original' }
        ],
        diffInlineProvider
    );
    context.subscriptions.push(diffInlineDisposable);

    // 注册 Code Action 提供者（灯泡操作，自定义来源 "LimCode Diff"）
    const diffCodeActionDisposable = vscode.languages.registerCodeActionsProvider(
        [
            { scheme: 'file' },
            { scheme: 'gemini-diff-original' }
        ],
        diffInlineProvider,
        {
            providedCodeActionKinds: DiffInlineProvider.providedCodeActionKinds
        }
    );
    context.subscriptions.push(diffCodeActionDisposable);

    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.confirmBlock', async (sessionId: string, blockIndex?: number) => {
            await diffCodeLensProvider.confirmBlock(sessionId, blockIndex);
            // 刷新编辑器操作提供者状态
            getDiffEditorActionsProvider().refresh();
            // 刷新内联装饰器
            diffInlineProvider.refreshAllDecorations();
        })
    );
    
    // 注册 diff 拒绝命令（CodeLens 和 Code Actions 使用）
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff._rejectBlockFromCodeLens', async (sessionId: string, blockIndex?: number) => {
            await diffCodeLensProvider.rejectBlock(sessionId, blockIndex);
            // 刷新编辑器操作提供者状态
            getDiffEditorActionsProvider().refresh();
            // 刷新内联装饰器
            diffInlineProvider.refreshAllDecorations();
        })
    );
    
    // ========== Diff Editor Actions ==========
    const diffEditorActionsProvider = getDiffEditorActionsProvider();
    
    // 注册命令：接受所有修改
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.acceptAll', async () => {
            await diffEditorActionsProvider.acceptAll();
            diffInlineProvider.refreshAllDecorations();
        })
    );
    
    // 注册命令：拒绝所有修改
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.rejectAll', async () => {
            await diffEditorActionsProvider.rejectAll();
            diffInlineProvider.refreshAllDecorations();
        })
    );
    
    // 注册命令：选择并接受 diff 块
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.acceptBlock', async () => {
            await diffEditorActionsProvider.showBlockPicker('accept');
            diffInlineProvider.refreshAllDecorations();
        })
    );
    
    // 注册命令：选择并拒绝 diff 块
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.rejectBlock', async () => {
            await diffEditorActionsProvider.showBlockPicker('reject');
            diffInlineProvider.refreshAllDecorations();
        })
    );
    
    // 注册命令：接受当前光标位置的 diff 块
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.acceptCurrentBlock', async () => {
            await diffEditorActionsProvider.acceptCurrentBlock();
            diffInlineProvider.refreshAllDecorations();
        })
    );
    
    // 注册命令：拒绝当前光标位置的 diff 块
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.rejectCurrentBlock', async () => {
            await diffEditorActionsProvider.rejectCurrentBlock();
            diffInlineProvider.refreshAllDecorations();
        })
    );
    
    // 注册命令：跳转到下一个 diff 块
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.nextBlock', async () => {
            await diffEditorActionsProvider.goToNextBlock();
        })
    );
    
    // 注册命令：跳转到上一个 diff 块
    context.subscriptions.push(
        vscode.commands.registerCommand('limcode.diff.prevBlock', async () => {
            await diffEditorActionsProvider.goToPrevBlock();
        })
    );

    console.log('LimCode extension activated successfully!');
}

export function deactivate() {
    console.log('LimCode extension deactivating...');
    
    // 清理 DiffCodeLensProvider
    if (diffCodeLensDisposable) {
        diffCodeLensDisposable.dispose();
        diffCodeLensDisposable = undefined;
    }
    
    // 清理 DiffInlineProvider
    if (diffInlineDisposable) {
        diffInlineDisposable.dispose();
        diffInlineDisposable = undefined;
    }
    getDiffInlineProvider().dispose();
    
    // 清理 DiffEditorActionsProvider
    getDiffEditorActionsProvider().dispose();
    
    // 清理 ChatViewProvider 资源（取消所有流式请求、断开 MCP 连接等）
    if (chatViewProvider) {
        chatViewProvider.dispose();
        chatViewProvider = undefined;
    }
    
    console.log('LimCode extension deactivated');
}
