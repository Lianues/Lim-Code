/**
 * Diff 编辑器操作提供者
 * 
 * 在 diff 视图中提供 Accept/Reject 按钮（因为 CodeLens 在 diff 视图中不工作）
 * 支持单个 diff 块的接受/拒绝，每个块对应 AI 输出的 diff 索引
 */

import * as vscode from 'vscode';
import { t } from '../../i18n';
import { getDiffCodeLensProvider, type PendingDiffSession, type DiffBlockInfo } from './DiffCodeLensProvider';
import { getDiffManager } from './diffManager';

/**
 * Diff 编辑器操作提供者
 */
export class DiffEditorActionsProvider {
    private static instance: DiffEditorActionsProvider | null = null;
    
    /** 当前活跃的 diff 会话 ID（用于编辑器标题栏按钮） */
    private activeSessionId: string | null = null;
    
    /** 编辑器变化监听器 */
    private editorChangeDisposable: vscode.Disposable | null = null;
    
    private constructor() {
        // 监听活跃编辑器变化，更新 context
        this.editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
            this.updateActiveSession(editor);
        });
        
        // 初始化时检查当前编辑器
        this.updateActiveSession(vscode.window.activeTextEditor);
    }
    
    /**
     * 获取单例实例
     */
    public static getInstance(): DiffEditorActionsProvider {
        if (!DiffEditorActionsProvider.instance) {
            DiffEditorActionsProvider.instance = new DiffEditorActionsProvider();
        }
        return DiffEditorActionsProvider.instance;
    }
    
    /**
     * 更新当前活跃的 diff 会话
     */
    private updateActiveSession(editor: vscode.TextEditor | undefined): void {
        if (!editor) {
            this.setActiveSession(null);
            return;
        }
        
        const uri = editor.document.uri;
        let session: PendingDiffSession | undefined;
        
        // 检查是否是 diff 相关的文档
        if (uri.scheme === 'gemini-diff-original') {
            // 虚拟文档（左侧原始内容）
            const path = uri.path;
            const parts = path.split('/').filter(p => p.length > 0);
            const id = parts[0];
            session = getDiffCodeLensProvider().getSession(id);
        } else if (uri.scheme === 'file') {
            // 真实文件（右侧修改后内容）
            session = getDiffCodeLensProvider().getSessionByFilePath(uri.fsPath);
        }
        
        if (session && session.blocks.some(b => !b.confirmed && !b.rejected)) {
            this.setActiveSession(session.id);
        } else {
            this.setActiveSession(null);
        }
    }
    
    /**
     * 设置当前活跃会话并更新 context
     */
    private setActiveSession(sessionId: string | null): void {
        this.activeSessionId = sessionId;
        vscode.commands.executeCommand('setContext', 'limcode.hasPendingDiff', sessionId !== null);
    }
    
    /**
     * 获取当前活跃的会话 ID
     */
    public getActiveSessionId(): string | null {
        return this.activeSessionId;
    }
    
    /**
     * 刷新活跃会话状态
     */
    public refresh(): void {
        this.updateActiveSession(vscode.window.activeTextEditor);
    }
    
    /**
     * 接受所有 diff 块
     */
    public async acceptAll(): Promise<void> {
        const sessionId = this.activeSessionId;
        if (!sessionId) {
            vscode.window.showWarningMessage(t('tools.file.diffEditorActions.noActiveDiff'));
            return;
        }
        
        const diffManager = getDiffManager();
        await diffManager.acceptDiff(sessionId, true);
        this.setActiveSession(null);
    }
    
    /**
     * 拒绝所有 diff 块
     */
    public async rejectAll(): Promise<void> {
        const sessionId = this.activeSessionId;
        if (!sessionId) {
            vscode.window.showWarningMessage(t('tools.file.diffEditorActions.noActiveDiff'));
            return;
        }
        
        const diffManager = getDiffManager();
        await diffManager.rejectDiff(sessionId);
        this.setActiveSession(null);
    }
    
    /**
     * 显示 Quick Pick 选择要操作的 diff 块
     */
    public async showBlockPicker(action: 'accept' | 'reject'): Promise<void> {
        const sessionId = this.activeSessionId;
        if (!sessionId) {
            vscode.window.showWarningMessage(t('tools.file.diffEditorActions.noActiveDiff'));
            return;
        }
        
        const session = getDiffCodeLensProvider().getSession(sessionId);
        if (!session) {
            return;
        }
        
        // 过滤出未处理的块
        const pendingBlocks = session.blocks.filter(b => !b.confirmed && !b.rejected);
        if (pendingBlocks.length === 0) {
            vscode.window.showInformationMessage(t('tools.file.diffEditorActions.allBlocksProcessed'));
            return;
        }
        
        // 构建 Quick Pick 选项
        const items: vscode.QuickPickItem[] = pendingBlocks.map(block => ({
            label: `$(git-commit) ${t('tools.file.diffEditorActions.diffBlock', { index: block.index + 1 })}`,
            description: t('tools.file.diffEditorActions.lineRange', { start: block.startLine, end: block.endLine }),
            detail: this.getBlockPreview(session, block),
            picked: false
        }));
        
        // 添加 "全部" 选项
        items.unshift({
            label: action === 'accept' 
                ? `$(check-all) ${t('tools.file.diffEditorActions.acceptAllBlocks')}`
                : `$(close-all) ${t('tools.file.diffEditorActions.rejectAllBlocks')}`,
            description: t('tools.file.diffEditorActions.blocksCount', { count: pendingBlocks.length }),
            detail: '',
            picked: false
        });
        
        const title = action === 'accept'
            ? t('tools.file.diffEditorActions.selectBlockToAccept')
            : t('tools.file.diffEditorActions.selectBlockToReject');
        
        const selected = await vscode.window.showQuickPick(items, {
            title,
            placeHolder: t('tools.file.diffEditorActions.selectBlockPlaceholder'),
            canPickMany: true
        });
        
        if (!selected || selected.length === 0) {
            return;
        }
        
        const diffManager = getDiffManager();
        
        // 检查是否选择了 "全部"
        const allSelected = selected.some(s => s.label.includes('check-all') || s.label.includes('close-all'));
        
        if (allSelected) {
            if (action === 'accept') {
                await diffManager.acceptDiff(sessionId, true);
            } else {
                await diffManager.rejectDiff(sessionId);
            }
        } else {
            // 处理选中的单个块
            for (const item of selected) {
                // 从 label 中提取块索引
                const match = item.label.match(/\d+/);
                if (match) {
                    const blockIndex = parseInt(match[0], 10) - 1; // 转回 0-based
                    if (action === 'accept') {
                        await diffManager.confirmBlock(sessionId, blockIndex);
                    } else {
                        await diffManager.rejectBlock(sessionId, blockIndex);
                    }
                }
            }
        }
        
        this.refresh();
    }
    
    /**
     * 根据光标位置接受当前 diff 块
     */
    public async acceptCurrentBlock(): Promise<void> {
        await this.handleCurrentBlock('accept');
    }
    
    /**
     * 根据光标位置拒绝当前 diff 块
     */
    public async rejectCurrentBlock(): Promise<void> {
        await this.handleCurrentBlock('reject');
    }
    
    /**
     * 处理当前光标位置的 diff 块
     */
    private async handleCurrentBlock(action: 'accept' | 'reject'): Promise<void> {
        const sessionId = this.activeSessionId;
        if (!sessionId) {
            vscode.window.showWarningMessage(t('tools.file.diffEditorActions.noActiveDiff'));
            return;
        }
        
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        
        const session = getDiffCodeLensProvider().getSession(sessionId);
        if (!session) {
            return;
        }
        
        const cursorLine = editor.selection.active.line + 1; // 转为 1-based
        
        // 找到光标所在的 diff 块
        const block = session.blocks.find(b => 
            !b.confirmed && !b.rejected && 
            cursorLine >= b.startLine && cursorLine <= b.endLine
        );
        
        if (!block) {
            // 如果光标不在任何块内，显示 Quick Pick
            await this.showBlockPicker(action);
            return;
        }
        
        const diffManager = getDiffManager();
        if (action === 'accept') {
            await diffManager.confirmBlock(sessionId, block.index);
        } else {
            await diffManager.rejectBlock(sessionId, block.index);
        }
        
        this.refresh();
    }
    
    /**
     * 获取 diff 块的预览文本
     */
    private getBlockPreview(session: PendingDiffSession, block: DiffBlockInfo): string {
        try {
            const lines = session.newContent.split('\n');
            const startIdx = Math.max(0, block.startLine - 1);
            const endIdx = Math.min(lines.length, block.endLine);
            const previewLines = lines.slice(startIdx, Math.min(startIdx + 3, endIdx));
            let preview = previewLines.join(' ').trim();
            if (preview.length > 80) {
                preview = preview.substring(0, 77) + '...';
            }
            return preview;
        } catch {
            return '';
        }
    }
    
    /**
     * 跳转到下一个未处理的 diff 块
     */
    public async goToNextBlock(): Promise<void> {
        const sessionId = this.activeSessionId;
        if (!sessionId) {
            return;
        }
        
        const session = getDiffCodeLensProvider().getSession(sessionId);
        if (!session) {
            return;
        }
        
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        
        const cursorLine = editor.selection.active.line + 1;
        const pendingBlocks = session.blocks.filter(b => !b.confirmed && !b.rejected);
        
        // 找到下一个块
        const nextBlock = pendingBlocks.find(b => b.startLine > cursorLine) || pendingBlocks[0];
        
        if (nextBlock) {
            const position = new vscode.Position(nextBlock.startLine - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    }
    
    /**
     * 跳转到上一个未处理的 diff 块
     */
    public async goToPrevBlock(): Promise<void> {
        const sessionId = this.activeSessionId;
        if (!sessionId) {
            return;
        }
        
        const session = getDiffCodeLensProvider().getSession(sessionId);
        if (!session) {
            return;
        }
        
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        
        const cursorLine = editor.selection.active.line + 1;
        const pendingBlocks = session.blocks.filter(b => !b.confirmed && !b.rejected);
        
        // 找到上一个块
        const prevBlocks = pendingBlocks.filter(b => b.startLine < cursorLine);
        const prevBlock = prevBlocks[prevBlocks.length - 1] || pendingBlocks[pendingBlocks.length - 1];
        
        if (prevBlock) {
            const position = new vscode.Position(prevBlock.startLine - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    }
    
    /**
     * 销毁
     */
    public dispose(): void {
        if (this.editorChangeDisposable) {
            this.editorChangeDisposable.dispose();
        }
        this.setActiveSession(null);
        DiffEditorActionsProvider.instance = null;
    }
}

/**
 * 获取 DiffEditorActionsProvider 实例
 */
export function getDiffEditorActionsProvider(): DiffEditorActionsProvider {
    return DiffEditorActionsProvider.getInstance();
}
