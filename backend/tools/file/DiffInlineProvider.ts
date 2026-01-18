/**
 * Diff 内联操作提供者
 * 
 * 在 diff 视图中提供内联的 Accept/Reject 操作：
 * 1. 使用装饰器高亮 diff 块
 * 2. 使用 Hover 提供者显示可点击的 Accept/Reject 链接
 * 3. 使用 Code Actions 提供灯泡操作（自定义来源）
 */

import * as vscode from 'vscode';
import { t } from '../../i18n';
import { getDiffCodeLensProvider, type PendingDiffSession } from './DiffCodeLensProvider';

/**
 * Diff 内联提供者 - 结合装饰器、Hover 和 Code Actions
 */
export class DiffInlineProvider implements vscode.HoverProvider, vscode.CodeActionProvider {
    private static instance: DiffInlineProvider | null = null;
    
    /** 装饰器类型 - 待处理的 diff 块边框 */
    private pendingBlockDecorationType: vscode.TextEditorDecorationType;
    
    /** 装饰器类型 - 块索引标记 */
    private blockIndexDecorationType: vscode.TextEditorDecorationType;
    
    /** 编辑器变化监听器 */
    private editorChangeDisposable: vscode.Disposable | null = null;
    
    /** 文档变化监听器 */
    private documentChangeDisposable: vscode.Disposable | null = null;
    
    /** 当前装饰的编辑器 */
    private decoratedEditors: Set<string> = new Set();
    
    /** 自定义 CodeActionKind - 使用 Refactor 类型，会显示在灯泡的 "重构..." 分类下 */
    public static readonly diffActionKind = vscode.CodeActionKind.Refactor.append('limcode');
    
    public static readonly providedCodeActionKinds = [
        DiffInlineProvider.diffActionKind
    ];
    
    private constructor() {
        // 创建装饰器类型 - 待处理块的背景高亮
        this.pendingBlockDecorationType = vscode.window.createTextEditorDecorationType({
            isWholeLine: true,
            backgroundColor: 'rgba(0, 255, 0, 0.04)',
            overviewRulerColor: 'rgba(0, 255, 0, 0.20)',
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        
        // 创建装饰器类型 - 块索引标记（行末显示）
        this.blockIndexDecorationType = vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 2em',
                color: new vscode.ThemeColor('editorCodeLens.foreground')
            }
        });
        
        // 监听编辑器变化
        this.editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.updateDecorations(editor);
            }
        });
        
        // 监听文档变化
        this.documentChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document === event.document) {
                this.updateDecorations(editor);
            }
        });
        
        // 初始化时更新当前编辑器
        if (vscode.window.activeTextEditor) {
            this.updateDecorations(vscode.window.activeTextEditor);
        }
    }
    
    /**
     * 获取单例实例
     */
    public static getInstance(): DiffInlineProvider {
        if (!DiffInlineProvider.instance) {
            DiffInlineProvider.instance = new DiffInlineProvider();
        }
        return DiffInlineProvider.instance;
    }
    
    /**
     * 更新装饰器
     */
    public updateDecorations(editor: vscode.TextEditor): void {
        const session = this.getSessionForEditor(editor);
        
        if (!session) {
            // 清除装饰
            editor.setDecorations(this.pendingBlockDecorationType, []);
            editor.setDecorations(this.blockIndexDecorationType, []);
            this.decoratedEditors.delete(editor.document.uri.toString());
            return;
        }
        
        const pendingDecorations: vscode.DecorationOptions[] = [];
        const indexDecorations: vscode.DecorationOptions[] = [];
        
        for (const block of session.blocks) {
            // 跳过已处理的块
            if (block.confirmed || block.rejected) {
                continue;
            }
            
            const startLine = Math.max(0, block.startLine - 1);
            const endLine = Math.min(editor.document.lineCount - 1, block.endLine - 1);
            
            // 整个块的范围
            const blockRange = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);
            
            // 添加块边框装饰
            pendingDecorations.push({ range: blockRange });
            
            // 在块的最后一行末尾添加操作提示
            const lastLine = editor.document.lineAt(endLine);
            const lastLineEndPos = lastLine.text.length;
            const lastLineRange = new vscode.Range(endLine, lastLineEndPos, endLine, lastLineEndPos);
            indexDecorations.push({
                range: lastLineRange,
                renderOptions: {
                    after: {
                        contentText: `  ← Diff #${block.index + 1} (${t('tools.file.diffInline.hoverOrLightbulb')})`,
                        color: new vscode.ThemeColor('editorCodeLens.foreground'),
                        fontStyle: 'italic',
                        margin: '0 0 0 1em'
                    }
                }
            });
        }
        
        editor.setDecorations(this.pendingBlockDecorationType, pendingDecorations);
        editor.setDecorations(this.blockIndexDecorationType, indexDecorations);
        this.decoratedEditors.add(editor.document.uri.toString());
    }
    
    /**
     * 刷新所有可见编辑器的装饰
     */
    public refreshAllDecorations(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            this.updateDecorations(editor);
        }
    }
    
    /**
     * 获取编辑器对应的 diff 会话
     */
    private getSessionForEditor(editor: vscode.TextEditor): PendingDiffSession | undefined {
        const uri = editor.document.uri;
        
        if (uri.scheme === 'gemini-diff-original') {
            const path = uri.path;
            const parts = path.split('/').filter(p => p.length > 0);
            const id = parts[0];
            return getDiffCodeLensProvider().getSession(id);
        } else if (uri.scheme === 'file') {
            return getDiffCodeLensProvider().getSessionByFilePath(uri.fsPath);
        }
        
        return undefined;
    }
    
    /**
     * 提供 Hover 内容 - 显示可点击的 Accept/Reject 链接
     */
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) {
            return undefined;
        }
        
        const session = this.getSessionForEditor(editor);
        if (!session) {
            return undefined;
        }
        
        const cursorLine = position.line + 1; // 转为 1-based
        
        // 找到光标所在的 diff 块
        const block = session.blocks.find(b => 
            !b.confirmed && !b.rejected && 
            cursorLine >= b.startLine && cursorLine <= b.endLine
        );
        
        if (!block) {
            return undefined;
        }
        
        // 创建 Markdown 内容，包含可点击的命令链接
        const contents = new vscode.MarkdownString();
        contents.isTrusted = true;
        contents.supportHtml = true;
        
        // 标题
        contents.appendMarkdown(`**Diff #${block.index + 1}**    _行 ${block.startLine}-${block.endLine}_\n\n`);
        
        // 单个块操作
        const acceptBlockArgs = encodeURIComponent(JSON.stringify([session.id, block.index]));
        const rejectBlockArgs = encodeURIComponent(JSON.stringify([session.id, block.index]));
        
        contents.appendMarkdown(`[✅ ${t('tools.file.diffInline.acceptBlock', { index: block.index + 1 })}](command:limcode.diff.confirmBlock?${acceptBlockArgs})`);
        contents.appendMarkdown(`   |   `);
        contents.appendMarkdown(`[❌ ${t('tools.file.diffInline.rejectBlock', { index: block.index + 1 })}](command:limcode.diff._rejectBlockFromCodeLens?${rejectBlockArgs})`);
        
        // 返回 Hover，范围是整个块
        const startLine = Math.max(0, block.startLine - 1);
        const endLine = Math.min(document.lineCount - 1, block.endLine - 1);
        const hoverRange = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
        
        return new vscode.Hover(contents, hoverRange);
    }
    
    /**
     * 提供 Code Actions - 灯泡操作（自定义来源 "LimCode Diff"）
     */
    public provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range | vscode.Selection,
        _context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) {
            return undefined;
        }
        
        const session = this.getSessionForEditor(editor);
        if (!session) {
            return undefined;
        }
        
        const cursorLine = range.start.line + 1; // 转为 1-based
        
        // 找到光标所在的 diff 块
        const block = session.blocks.find(b => 
            !b.confirmed && !b.rejected && 
            cursorLine >= b.startLine && cursorLine <= b.endLine
        );
        
        if (!block) {
            return undefined;
        }
        
        const actions: vscode.CodeAction[] = [];
        
        // 接受当前块
        const acceptAction = new vscode.CodeAction(
            `✅ ${t('tools.file.diffInline.acceptBlock', { index: block.index + 1 })}`,
            DiffInlineProvider.diffActionKind
        );
        acceptAction.command = {
            title: 'Accept Block',
            command: 'limcode.diff.confirmBlock',
            arguments: [session.id, block.index]
        };
        acceptAction.isPreferred = true;
        actions.push(acceptAction);
        
        // 拒绝当前块
        const rejectAction = new vscode.CodeAction(
            `❌ ${t('tools.file.diffInline.rejectBlock', { index: block.index + 1 })}`,
            DiffInlineProvider.diffActionKind
        );
        rejectAction.command = {
            title: 'Reject Block',
            command: 'limcode.diff._rejectBlockFromCodeLens',
            arguments: [session.id, block.index]
        };
        actions.push(rejectAction);
        
        return actions;
    }
    
    /**
     * 销毁
     */
    public dispose(): void {
        if (this.editorChangeDisposable) {
            this.editorChangeDisposable.dispose();
        }
        if (this.documentChangeDisposable) {
            this.documentChangeDisposable.dispose();
        }
        this.pendingBlockDecorationType.dispose();
        this.blockIndexDecorationType.dispose();
        this.decoratedEditors.clear();
        DiffInlineProvider.instance = null;
    }
}

/**
 * 获取 DiffInlineProvider 实例
 */
export function getDiffInlineProvider(): DiffInlineProvider {
    return DiffInlineProvider.getInstance();
}
