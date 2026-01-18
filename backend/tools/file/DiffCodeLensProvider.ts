/**
 * Diff CodeLens 提供者 - 在 diff 视图中显示确认/拒绝按钮
 */

import * as vscode from 'vscode';
import { t } from '../../i18n';

/**
 * 单个 Diff 块信息
 */
export interface DiffBlockInfo {
    /** diff 块索引 */
    index: number;
    /** 起始行号（1-based） */
    startLine: number;
    /** 结束行号（1-based） */
    endLine: number;
    /** 是否已确认 */
    confirmed?: boolean;
    /** 是否已拒绝 */
    rejected?: boolean;
}

/**
 * Pending Diff 会话信息
 */
export interface PendingDiffSession {
    /** 会话 ID（与 PendingDiff.id 对应） */
    id: string;
    /** 文件路径 */
    filePath: string;
    /** 文件绝对路径 */
    absolutePath: string;
    /** diff 块列表 */
    blocks: DiffBlockInfo[];
    /** 原始内容 */
    originalContent: string;
    /** 新内容 */
    newContent: string;
    /** 自动确认倒计时（毫秒） */
    autoConfirmDelay?: number;
    /** 创建时间 */
    timestamp: number;
}

/**
 * Diff CodeLens 提供者
 */
export class DiffCodeLensProvider implements vscode.CodeLensProvider {
    private static instance: DiffCodeLensProvider | null = null;
    
    /** 当前活跃的 diff 会话 */
    private activeSessions: Map<string, PendingDiffSession> = new Map();
    
    /** 文件路径到会话 ID 的映射 */
    private fileToSession: Map<string, string> = new Map();
    
    /** CodeLens 变化事件 */
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    
    /** 确认回调 */
    private confirmCallback?: (sessionId: string, blockIndex?: number) => Promise<void>;
    
    /** 拒绝回调 */
    private rejectCallback?: (sessionId: string, blockIndex?: number) => Promise<void>;
    
    private constructor() {}
    
    /**
     * 获取单例实例
     */
    public static getInstance(): DiffCodeLensProvider {
        if (!DiffCodeLensProvider.instance) {
            DiffCodeLensProvider.instance = new DiffCodeLensProvider();
       }
        return DiffCodeLensProvider.instance;
    }
    
    /**
     * 设置确认回调
     */
    public setConfirmCallback(callback: (sessionId: string, blockIndex?: number) => Promise<void>): void {
        this.confirmCallback = callback;
    }
    
    /**
     * 设置拒绝回调
     */
    public setRejectCallback(callback: (sessionId: string, blockIndex?: number) => Promise<void>): void {
        this.rejectCallback = callback;
    }
    
    /**
     * 添加 diff 会话
     */
    public addSession(session: PendingDiffSession): void {
        this.activeSessions.set(session.id, session);
        this.fileToSession.set(session.absolutePath, session.id);
        this._onDidChangeCodeLenses.fire();
    }
    
    /**
     * 移除 diff 会话
     */
    public removeSession(sessionId: string): void {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            this.fileToSession.delete(session.absolutePath);
            this.activeSessions.delete(sessionId);
            this._onDidChangeCodeLenses.fire();
        }
    }
    
    /**
     * 获取会话
     */
    public getSession(sessionId: string): PendingDiffSession | undefined {
        return this.activeSessions.get(sessionId);
    }
    
    /**
     * 根据文件路径获取会话
     */
    public getSessionByFilePath(absolutePath: string): PendingDiffSession | undefined {
        const sessionId = this.fileToSession.get(absolutePath);
        return sessionId ? this.activeSessions.get(sessionId) : undefined;
    }
    
    /**
     * 更新 diff 块状态
     */
    public updateBlockStatus(sessionId: string, blockIndex: number, confirmed: boolean): void {
        const session = this.activeSessions.get(sessionId);
        if (session && session.blocks[blockIndex]) {
            if (confirmed) {
                session.blocks[blockIndex].confirmed = true;
                session.blocks[blockIndex].rejected = false;
            } else {
                session.blocks[blockIndex].confirmed = false;
                session.blocks[blockIndex].rejected = true;
            }
            this._onDidChangeCodeLenses.fire();
        }
    }
    
    /**
     * 检查会话是否所有块都已处理
     */
    public isSessionComplete(sessionId: string): boolean {
        const session = this.activeSessions.get(sessionId);
        if (!session) return true;
        return session.blocks.every(block => block.confirmed || block.rejected);
    }
    
    /**
     * 获取会话中已确认的块
     */
    public getConfirmedBlocks(sessionId: string): number[] {
        const session = this.activeSessions.get(sessionId);
        if (!session) return [];
        return session.blocks
            .filter(block => block.confirmed)
            .map(block => block.index);
    }
    
    /**
     * 确认 diff 块
     */
    public async confirmBlock(sessionId: string, blockIndex?: number): Promise<void> {
        if (this.confirmCallback) {
            await this.confirmCallback(sessionId, blockIndex);
        }
    }
    
    /**
     * 拒绝 diff 块
     */
    public async rejectBlock(sessionId: string, blockIndex?: number): Promise<void> {
        if (this.rejectCallback) {
            await this.rejectCallback(sessionId, blockIndex);
        }
    }
    
    /**
     * 提供 CodeLens
     */
    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.CodeLens[] {
        let session: PendingDiffSession | undefined;
        
        if (document.uri.scheme === 'gemini-diff-original') {
            // 从虚拟 URI 中提取 session ID
            // Uri 格式可能是 gemini-diff-original:id/file 或 gemini-diff-original:/id/file
            const path = document.uri.path;
            const parts = path.split('/').filter(p => p.length > 0);
            const id = parts[0];
            session = this.activeSessions.get(id);
        } else if (document.uri.scheme === 'file') {
            session = this.getSessionByFilePath(document.uri.fsPath);
            
            // 如果通过 fsPath 找不到，尝试通过不区分大小写的路径匹配
            if (!session) {
                const targetPath = document.uri.fsPath.toLowerCase();
                for (const s of this.activeSessions.values()) {
                    if (s.absolutePath.toLowerCase() === targetPath) {
                        session = s;
                        break;
                    }
                }
            }
        }

        if (!session) {
            return [];
        }
        
        const codeLenses: vscode.CodeLens[] = [];
        
        // 在文件顶部添加 "全部接受" 和 "全部拒绝" 按钮
        if (session.blocks.some(b => !b.confirmed && !b.rejected)) {
            const topRange = new vscode.Range(0, 0, 0, 0);
            
            codeLenses.push(new vscode.CodeLens(topRange, {
                title: `$(check-all) ${t('tools.file.diffCodeLens.acceptAll')}`,
                command: 'limcode.diff.confirmBlock',
                arguments: [session.id]
            }));
            
            codeLenses.push(new vscode.CodeLens(topRange, {
                title: `$(clear-all) ${t('tools.file.diffCodeLens.rejectAll')}`,
                command: 'limcode.diff._rejectBlockFromCodeLens',
                arguments: [session.id]
            }));
        }
        
        for (const block of session.blocks) {
            // 跳过已处理的块
            if (block.confirmed || block.rejected) {
                continue;
            }
            
            const lineIndex = Math.max(0, block.startLine - 1);
            
            // 确保行号在文档范围内
            if (lineIndex >= document.lineCount) {
                continue;
            }

            const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
            
            // Diff 块标题
            const titleLens = new vscode.CodeLens(range, {
                title: `Diff #${block.index + 1}`,
                command: ''
            });
            
            // 接受按钮
            const confirmLens = new vscode.CodeLens(range, {
                title: `$(check) ${t('tools.file.diffCodeLens.accept')}`,
                command: 'limcode.diff.confirmBlock',
                arguments: [session.id, block.index]
            });
            
            // 拒绝按钮
            const rejectLens = new vscode.CodeLens(range, {
                title: `$(x) ${t('tools.file.diffCodeLens.reject')}`,
                command: 'limcode.diff._rejectBlockFromCodeLens',
                arguments: [session.id, block.index]
            });
            
            codeLenses.push(titleLens, confirmLens, rejectLens);
        }
        
        return codeLenses;
    }
    
    /**
     * 清理所有会话
     */
    public dispose(): void {
        this.activeSessions.clear();
        this.fileToSession.clear();
        this._onDidChangeCodeLenses.dispose();
        DiffCodeLensProvider.instance = null;
    }
}

/**
 * 获取 DiffCodeLensProvider 实例
 */
export function getDiffCodeLensProvider(): DiffCodeLensProvider {
    return DiffCodeLensProvider.getInstance();
}
