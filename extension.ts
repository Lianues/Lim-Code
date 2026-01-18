/**
 * LimCode VSCode Extension 入口
 */

import * as vscode from 'vscode';
import { ChatViewProvider } from './webview/ChatViewProvider';
import { getDiffCodeLensProvider } from './backend/tools/file/DiffCodeLensProvider';
import { getDiffEditorActionsProvider } from './backend/tools/file/DiffEditorActionsProvider';
import { getDiffInlineProvider, DiffInlineProvider } from './backend/tools/file/DiffInlineProvider';

// 保存 ChatViewProvider 实例以便在停用时清理
let chatViewProvider: ChatViewProvider | undefined;

// DiffCodeLensProvider 注册
let diffCodeLensDisposable: vscode.Disposable | undefined;

// DiffInlineProvider 注册
let diffInlineDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('LimCode extension is now active!');

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
    
    // 注册 CodeLens 提供者
    diffCodeLensDisposable = vscode.languages.registerCodeLensProvider(
        [
            { scheme: 'file' },
            { scheme: 'gemini-diff-original' }
        ],
        diffCodeLensProvider
    );
    context.subscriptions.push(diffCodeLensDisposable);
    
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
    
    // 注册 diff 确认命令（CodeLens 和 Code Actions 使用）
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
