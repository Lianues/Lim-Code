/**
 * Diff 管理器 - 管理待审阅的文件修改
 * 
 * 功能：
 * - 管理待处理的 diff 修改
 * - 显示 VS Code diff 视图
 * - 支持自动保存和手动审阅模式
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getGlobalSettingsManager } from '../../core/settingsContext';
import { t } from '../../i18n';

import { getDiffCodeLensProvider } from './DiffCodeLensProvider';
import {
    applyDiffToContent,
    applyStructuredDiffHunksBestEffort,
    type StructuredDiffHunk
} from './apply_diff';
import { applyUnifiedDiffHunks, type UnifiedDiffHunk } from './unifiedDiff';

/**
 * 待处理的 Diff 修改
 */
export interface PendingDiff {
    /** 唯一 ID */
    id: string;
    /** 文件路径（相对路径） */
    filePath: string;
    /** 文件绝对路径 */
    absolutePath: string;
    /** 原始内容 */
    originalContent: string;
    /** 修改后的内容（AI 建议的内容） */
    newContent: string;
    /**
     * 用户新增/替换行摘要（仅当用户修改了 AI 建议时存在）。
     *
     * 格式（每行一条记录，多行用 `\n` 分隔；空行内容为空字符串）：
     * - 新增：`+ | newLine | 内容`  （newLine 为用户最终保存内容中的 1-based 行号）
     * - 替换：`~ | newLine | 内容`  （newLine 为用户最终保存内容中的 1-based 行号）
     * - 删除：`- | baseLine | 内容` （baseLine 为系统建议保存内容中的 1-based 行号）
     */
    userEditedContent?: string;
    /** 创建时间 */
    timestamp: number;
    /** 状态 */
    status: 'pending' | 'accepted' | 'rejected';
    /** 关联的 diff 块（用于 CodeLens） */
    blocks?: Array<{
        index: number;
        startLine: number;
        endLine: number;
    }>;
    /** 原始 diffs 列表 */
    rawDiffs?: any[];
    /** 关联的工具 ID */
    toolId?: string;
    /** diff 警戒值警告信息（当删除行数超过阈值时设置） */
    diffGuardWarning?: string;
    /** 删除行占比（0-100，用于前端显示） */
    diffGuardDeletePercent?: number;
    /**
     * 自动保存失败原因。
     * 为什么新增：autoSave=true 表示工具应自动收敛；如果保存失败仍保持 pending，流式提前执行会一直等待。
     * 怎么改：在后端自动保存失败后记录错误并终结 diff，工具结果可据此返回明确失败状态。
     * 目的：避免自动确认模式下出现必须用户中止的悬挂状态。
     */
    autoSaveError?: string;
}

/**
 * Diff 设置
 */
export interface DiffSettings {
    /** 是否自动保存 */
    autoSave: boolean;
    /** 自动保存延迟（毫秒） */
    autoSaveDelay: number;
}

/**
 * 状态变化监听器
 */
type StatusChangeListener = (pending: PendingDiff[], allProcessed: boolean) => void;

/**
 * Diff 保存监听器（当 diff 被实际保存到磁盘时调用）
 */
type DiffSaveListener = (diff: PendingDiff) => void;

/**
 * Diff 结算等待结果。
 *
 * 为什么要新增：多个文件编辑工具都在等待 pending diff 结束，但 apply_diff 只靠状态监听，
 * 在用户中断清掉自动保存定时器且没有后续状态事件时可能一直等待。
 * 怎么改：把“正常结束、abort 取消、用户新请求中断”抽象成 DiffManager 级别的通用结果。
 * 目的：所有 diff-review 工具共享同一套生命周期等待语义，避免某个工具独自遗漏中断路径。
 */
export type DiffResolutionReason = 'none' | 'abort' | 'user';

/**
 * 用户中断标记
 */
let userInterruptFlag = false;

/**
 * Diff 管理器
 */
type DiffOp = {
    type: 'equal' | 'insert' | 'delete';
    line: string;
};

function isLegacySearchReplaceDiff(d: any): d is { search: string; replace: string; start_line?: number } {
    return !!d && typeof d === 'object' && typeof d.search === 'string' && typeof d.replace === 'string';
}

function isUnifiedDiffHunk(d: any): d is UnifiedDiffHunk {
    return (
        !!d &&
        typeof d === 'object' &&
        typeof d.oldStart === 'number' &&
        typeof d.newStart === 'number' &&
        Array.isArray(d.lines)
    );
}

function isStructuredDiffHunk(d: any): d is StructuredDiffHunk {
    // 为什么要识别结构化 hunk：apply_diff 新格式存入 rawDiffs 后，块级接受/拒绝需要按同一套 oldContent/newContent 规则重放。
    // 怎么改：用字段形态区分，不新增工具类型或配置分支，避免前后端出现第三套并行协议。
    // 目的：让 DiffManager 在用户拒绝某个块后仍能准确重算最终文件内容。
    return (
        !!d &&
        typeof d === 'object' &&
        typeof d.oldContent === 'string' &&
        typeof d.newContent === 'string'
    );
}

function splitLines(text: string): string[] {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    // 如果文本以换行结尾，split 会产生最后一个空行，这里去掉，避免行号计算偏差
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
}

/**
 * Myers 差分（按行），返回操作序列
 */
function myersDiffLines(a: string[], b: string[]): DiffOp[] {
    const n = a.length;
    const m = b.length;
    const max = n + m;

    // v[k] = x
    let v = new Map<number, number>();
    v.set(1, 0);
    const trace: Array<Map<number, number>> = [];

    for (let d = 0; d <= max; d++) {
        trace.push(new Map(v));

        const vNext = new Map<number, number>();
        for (let k = -d; k <= d; k += 2) {
            const vKMinus = v.get(k - 1) ?? 0;
            const vKPlus = v.get(k + 1) ?? 0;

            let x: number;
            if (k === -d || (k !== d && vKMinus < vKPlus)) {
                x = vKPlus; // down
            } else {
                x = vKMinus + 1; // right
            }
            let y = x - k;

            while (x < n && y < m && a[x] === b[y]) {
                x++;
                y++;
            }

            vNext.set(k, x);

            if (x >= n && y >= m) {
                // backtrack
                const ops: DiffOp[] = [];
                let bx = n;
                let by = m;

                for (let bd = d; bd >= 0; bd--) {
                    const vv = trace[bd];
                    const kk = bx - by;

                    const vvKMinus2 = vv.get(kk - 1) ?? 0;
                    const vvKPlus2 = vv.get(kk + 1) ?? 0;

                    let prevK: number;
                    if (kk === -bd || (kk !== bd && vvKMinus2 < vvKPlus2)) {
                        prevK = kk + 1;
                    } else {
                        prevK = kk - 1;
                    }

                    const prevX = vv.get(prevK) ?? 0;
                    const prevY = prevX - prevK;

                    while (bx > prevX && by > prevY) {
                        ops.push({ type: 'equal', line: a[bx - 1] });
                        bx--;
                        by--;
                    }

                    if (bd === 0) {
                        break;
                    }

                    if (bx === prevX) {
                        // insert
                        ops.push({ type: 'insert', line: b[by - 1] });
                        by--;
                    } else {
                        // delete
                        ops.push({ type: 'delete', line: a[bx - 1] });
                        bx--;
                    }
                }

                ops.reverse();
                return ops;
            }
        }

        v = vNext;
    }

    // fallback
    return [];
}

function computeUserEditedNewLinesSummary(baseContent: string, userContent: string): string {
    const a = splitLines(baseContent);
    const b = splitLines(userContent);
    const ops = myersDiffLines(a, b);

    let baseLine = 1;
    let newLine = 1;

    // replace 的判定：在上一次 equal 之后是否出现过 delete。
    // - delete 后紧跟 insert => 视为 replace（~）
    // - 只有 insert => insert（+）
    let hadDeleteSinceLastEqual = false;

    const result: string[] = [];

    for (const op of ops) {
        if (op.type === 'equal') {
            hadDeleteSinceLastEqual = false;
            baseLine++;
            newLine++;
            continue;
        }

        if (op.type === 'delete') {
            // 删除行：行号使用 baseSuggestedContent（系统建议保存内容）的行号
            result.push(`- | ${baseLine} | ${op.line}`);
            hadDeleteSinceLastEqual = true;
            baseLine++;
            continue;
        }

        // insert（包含新增行，以及 replace 的新行）
        const opType = hadDeleteSinceLastEqual ? '~' : '+';
        // 新增/替换行：行号使用 userContent（用户最终保存内容）的行号
        result.push(`${opType} | ${newLine} | ${op.line}`);
        newLine++;
    }

    return result.join('\n');
}

export class DiffManager {
    private static instance: DiffManager | null = null;
    
    /** 待处理的 diff 列表 */
    private pendingDiffs: Map<string, PendingDiff> = new Map();
    
    /** 虚拟文档内容提供者 */
    private contentProvider: OriginalContentProvider;
    
    /** 内容提供者注册 */
    private providerDisposable: vscode.Disposable | null = null;
    
    /** 设置 */
    private settings: DiffSettings = {
        autoSave: false,
        autoSaveDelay: 3000
    };
    
    /** 自动保存定时器 */
    private autoSaveTimers: Map<string, NodeJS.Timeout> = new Map();
    
    /** 状态变化监听器 */
    private statusListeners: Set<StatusChangeListener> = new Set();
    
    /** Diff 保存监听器（当文件被实际保存时调用） */
    private saveCompleteListeners: Set<DiffSaveListener> = new Set();
    
    /** 文档保存事件监听器 */
    private saveListeners: Map<string, vscode.Disposable> = new Map();

    /** 文档即将保存事件监听器 */
    private willSaveListeners: Map<string, vscode.Disposable> = new Map();
    
    /** 文档关闭事件监听器 */
    private closeListeners: Map<string, vscode.Disposable> = new Map();

    /** 被非手动保存打断后，需要在保存完成后恢复的草稿内容 */
    private suppressedNonManualSaveDrafts: Map<string, string> = new Map();

    /** 正在执行接受动作的 diff */
    private acceptingDiffIds: Set<string> = new Set();

    /** 正在执行拒绝动作的 diff */
    private rejectingDiffIds: Set<string> = new Set();
    
    private constructor() {
        this.contentProvider = new OriginalContentProvider();
        this.providerDisposable = vscode.workspace.registerTextDocumentContentProvider(
            'gemini-diff-original',
            this.contentProvider
        );
    }
    
    /**
     * 获取单例实例
     */
    public static getInstance(): DiffManager {
        if (!DiffManager.instance) {
            DiffManager.instance = new DiffManager();
        }
        return DiffManager.instance;
    }
    
    /**
     * 更新设置
     */
    public updateSettings(settings: Partial<DiffSettings>): void {
        this.settings = { ...this.settings, ...settings };
    }
    
    /**
     * 获取当前设置
     * 优先从全局设置管理器读取，否则使用本地设置
     */
    public getSettings(): DiffSettings {
        const settingsManager = getGlobalSettingsManager();
        if (settingsManager) {
            const config = settingsManager.getApplyDiffConfig();
            return {
                autoSave: config.autoSave,
                autoSaveDelay: config.autoSaveDelay
            };
        }
        return { ...this.settings };
    }

    /**
     * 刷新自动保存定时器（用于运行时设置变更）
     *
     * 说明：
     * - 当用户在 diff 已经处于 pending 状态后，才开启/关闭“启用自动应用”或调整延迟时，
     *   需要通过此方法让当前已存在的 pending diff 立即按最新配置生效。
     *
     * 行为：
     * - autoSave = false：取消所有已调度的自动保存
     * - autoSave = true：为所有 pending diff 调度/重置自动保存（使用最新的 autoSaveDelay）
     */
    public refreshAutoSaveTimers(): void {
        const currentSettings = this.getSettings();

        // 关闭自动保存：清理全部定时器
        if (!currentSettings.autoSave) {
            for (const timer of this.autoSaveTimers.values()) {
                clearTimeout(timer);
            }
            this.autoSaveTimers.clear();
            return;
        }

        // 开启自动保存：为所有 pending diff 调度/重置定时器
        for (const diff of this.getPendingDiffs()) {
            this.scheduleAutoSave(diff.id);
        }
    }
    
    /**
     * 添加状态变化监听器
     */
    public addStatusListener(listener: StatusChangeListener): void {
        this.statusListeners.add(listener);
    }
    
    /**
     * 移除状态变化监听器
     */
    public removeStatusListener(listener: StatusChangeListener): void {
        this.statusListeners.delete(listener);
    }
    
    /**
     * 通知状态变化
     */
    private notifyStatusChange(): void {
        const pending = this.getPendingDiffs();
        const allProcessed = this.areAllProcessed();
        for (const listener of this.statusListeners) {
            listener(pending, allProcessed);
        }
    }
    
    /**
     * 添加 diff 保存完成监听器
     */
    public addSaveCompleteListener(listener: DiffSaveListener): void {
        this.saveCompleteListeners.add(listener);
    }
    
    /**
     * 移除 diff 保存完成监听器
     */
    public removeSaveCompleteListener(listener: DiffSaveListener): void {
        this.saveCompleteListeners.delete(listener);
    }
    
    /**
     * 通知 diff 保存完成
     */
    private notifySaveComplete(diff: PendingDiff): void {
        for (const listener of this.saveCompleteListeners) {
            listener(diff);
        }
    }

    /**
     * 某个 diff 是否正处于内部接受/拒绝动作处理中
     */
    public isDiffActionInProgress(id: string): boolean {
        return this.acceptingDiffIds.has(id) || this.rejectingDiffIds.has(id);
    }

    /**
     * 释放 diff 相关监听器
     */
    private disposeDiffListeners(id: string): void {
        const saveListener = this.saveListeners.get(id);
        if (saveListener) {
            saveListener.dispose();
            this.saveListeners.delete(id);
        }

        const willSaveListener = this.willSaveListeners.get(id);
        if (willSaveListener) {
            willSaveListener.dispose();
            this.willSaveListeners.delete(id);
        }

        const closeListener = this.closeListeners.get(id);
        if (closeListener) {
            closeListener.dispose();
            this.closeListeners.delete(id);
        }

        this.suppressedNonManualSaveDrafts.delete(id);
    }

    private async restorePendingDraftAfterNonManualSave(diff: PendingDiff, draftContent: string): Promise<void> {
        const fileUri = vscode.Uri.file(diff.absolutePath);
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath)
            || await vscode.workspace.openTextDocument(fileUri);

        const currentContent = doc.getText();
        if (currentContent === draftContent) {
            return;
        }

        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(currentContent.length)
        );
        edit.replace(fileUri, fullRange, draftContent);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            throw new Error(`Failed to restore pending diff draft for ${diff.filePath}`);
        }
    }

    private finalizeAcceptedDiff(diff: PendingDiff): void {
        if (diff.status !== 'pending') {
            return;
        }
        this.disposeDiffListeners(diff.id);
        diff.status = 'accepted';
        this.cleanup(diff.id);
        this.notifyStatusChange();
        this.notifySaveComplete(diff);
    }

    private finalizeRejectedDiff(diff: PendingDiff): void {
        if (diff.status !== 'pending') {
            return;
        }
        this.disposeDiffListeners(diff.id);
        diff.status = 'rejected';
        this.cleanup(diff.id);
        this.notifyStatusChange();
    }
    
    /**
     * 创建待审阅的 diff
     */
    private getFullApplyDiffConfig() {
        const settingsManager = getGlobalSettingsManager();
        if (settingsManager) {
            return settingsManager.getApplyDiffConfig();
        }
        return null;
    }
    
    /**
     * 检查 diff 警戒值
     * 计算删除行数占原始文件总行数的百分比
     */
    private checkDiffGuard(originalContent: string, newContent: string): { warning?: string; deletePercent: number } {
        const config = this.getFullApplyDiffConfig();
        if (!config || !config.diffGuardEnabled) {
            return { deletePercent: 0 };
        }
        
        // 使用统一的按行切分（处理 CRLF/尾部换行），避免行数统计偏差
        const originalLines = splitLines(originalContent);
        const newLines = splitLines(newContent);
        const totalOriginalLines = originalLines.length;
        
        if (totalOriginalLines === 0) {
            return { deletePercent: 0 };
        }
        
        // 计算“真实删除行数”（而非净行数变化）：
        // - 例如 3 行被删除，同时插入 1 行，净减少 2 行；
        //   但删除行数应记为 3 行。
        // 这里基于 Myers diff 统计 delete 操作数量。
        const ops = myersDiffLines(originalLines, newLines);
        let deletedLineCount = ops.filter(op => op.type === 'delete').length;

        // 极端兜底：如果差分异常返回空，退化为净行数变化（至少保证有值）
        if (ops.length === 0 && originalLines.length !== newLines.length) {
            deletedLineCount = Math.max(0, totalOriginalLines - newLines.length);
        }

        const deletePercent = Math.round((deletedLineCount / totalOriginalLines) * 100);
        
        if (deletePercent >= config.diffGuardThreshold) {
            const warning = t('tools.file.diffManager.diffGuardWarning', {
                deletePercent: String(deletePercent),
                threshold: String(config.diffGuardThreshold),
                deletedLines: String(deletedLineCount),
                totalLines: String(totalOriginalLines)
            });
            return { warning, deletePercent };
        }
        
        return { deletePercent };
    }
    
    /**
     * 创建待审阅的 diff（原始方法）
     */
    public async createPendingDiff(
        filePath: string,
        absolutePath: string,
        originalContent: string,
        newContent: string,
        blocks?: Array<{ index: number; startLine: number; endLine: number }>,
        rawDiffs?: any[],
        toolId?: string
    ): Promise<PendingDiff> {
        const id = `diff-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const pendingDiff: PendingDiff = {
            id,
            filePath,
            absolutePath,
            originalContent,
            newContent,
            timestamp: Date.now(),
            status: 'pending',
            blocks,
            rawDiffs,
            toolId
        };
        
        this.pendingDiffs.set(id, pendingDiff);
        
        // 检查 diff 警戒值
        const guardResult = this.checkDiffGuard(originalContent, newContent);
        if (guardResult.warning) {
            pendingDiff.diffGuardWarning = guardResult.warning;
        }
        pendingDiff.diffGuardDeletePercent = guardResult.deletePercent;
        
        // 获取完整配置以决定是否跳过 diff 视图
        const fullConfig = this.getFullApplyDiffConfig();
        const shouldSkipDiffView = fullConfig?.autoSave && fullConfig?.autoApplyWithoutDiffView;
        
        // 注册原始内容到提供者（仅在需要显示 diff 视图时）
        if (!shouldSkipDiffView) {
            this.contentProvider.setContent(id, originalContent);
        }
        
        // 如果有块信息且不跳过 diff 视图，注册到 CodeLens 提供者
        if (blocks && !shouldSkipDiffView) {
            const provider = getDiffCodeLensProvider();
            provider.addSession({
                id,
                filePath,
                absolutePath,
                blocks: blocks.map(b => ({ ...b, confirmed: false, rejected: false })),
                originalContent,
                newContent,
                timestamp: Date.now()
            });
            
            // 设置回调
            provider.setConfirmCallback(async (sessionId, blockIndex) => {
                if (blockIndex === undefined) {
                    await this.acceptDiff(sessionId, true);
                } else {
                    await this.confirmBlock(sessionId, blockIndex);
                }
            });
            
            provider.setRejectCallback(async (sessionId, blockIndex) => {
                if (blockIndex === undefined) {
                    await this.rejectDiff(sessionId);
                } else {
                    await this.rejectBlock(sessionId, blockIndex);
                }
            });
        }
        
        // 根据配置决定是否显示 diff 视图
        if (shouldSkipDiffView) {
            // 跳过 diff 视图：直接写入文件并保存
            await this.directApplyAndSave(pendingDiff);
        } else {
            // 显示 diff 视图
            try {
                await this.showDiffView(pendingDiff);
            } catch (error) {
                console.warn(
                    `[DiffManager] Failed to open diff view for ${filePath}; keeping pending diff available for manual apply/reject.`,
                    error
                );
            }
        }
        
        // 如果开启自动保存且 diff 仍处于 pending 状态，设置定时器
        if (pendingDiff.status === 'pending') {
            const currentSettings = this.getSettings();
            if (currentSettings.autoSave) {
                this.scheduleAutoSave(id);
            }
        }
        
        // 通知状态变化
        this.notifyStatusChange();
        
        return pendingDiff;
    }

    /**
     * 直接应用修改并保存（不打开 diff 视图）
     * 用于 autoApplyWithoutDiffView 模式
     */
    private async directApplyAndSave(diff: PendingDiff): Promise<void> {
        try {
            // 直接写入文件到磁盘
            fs.writeFileSync(diff.absolutePath, diff.newContent, 'utf8');
            
            // 如果文档已在编辑器中打开，则刷新它
            const uri = vscode.Uri.file(diff.absolutePath);
            const openDoc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath);
            if (openDoc) {
                // revert 让 VSCode 从磁盘重新加载
                try {
                    // 先 focus 到该文档，然后 revert
                    await vscode.window.showTextDocument(openDoc, { preview: false, preserveFocus: true });
                    await vscode.commands.executeCommand('workbench.action.files.revert');
                } catch {
                    // ignore
                }
            }
            
            // 标记为已接受
            diff.status = 'accepted';
            this.cleanup(diff.id);
            
            this.notifyStatusChange();
            this.notifySaveComplete(diff);
            
            vscode.window.setStatusBarMessage(
                `$(check) ${t('tools.file.diffManager.savedShort', { filePath: diff.filePath })}`,
                3000
            );
        } catch (error) {
            console.error('[DiffManager] directApplyAndSave failed:', error);
            // 回退到显示 diff 视图
            await this.showDiffView(diff);
        }
    }

    /**
     * 确认单个块
     */
    public async confirmBlock(sessionId: string, blockIndex: number): Promise<void> {
        const provider = getDiffCodeLensProvider();
        provider.updateBlockStatus(sessionId, blockIndex, true);
        
        // 如果所有块都处理完了，自动结束整个 diff
        if (provider.isSessionComplete(sessionId)) {
            const session = provider.getSession(sessionId);
            // 理论上 confirmBlock 一定会有 confirmed，因此不太可能 allRejected，但这里仍做保护
            const allRejected = !!session && session.blocks.length > 0 && session.blocks.every(b => b.rejected);
            if (allRejected) {
                await this.rejectDiff(sessionId);
            } else {
                await this.acceptDiff(sessionId, true);
            }
        }
    }

    /**
     * 拒绝单个块
     */
    public async rejectBlock(sessionId: string, blockIndex: number): Promise<void> {
        const provider = getDiffCodeLensProvider();
        provider.updateBlockStatus(sessionId, blockIndex, false);
        
        // 实时更新编辑器内容，移除被拒绝的块
        const diff = this.pendingDiffs.get(sessionId);
        if (diff && diff.rawDiffs && diff.rawDiffs.length > 0) {
            let tempContent = diff.originalContent;
            const session = provider.getSession(sessionId);
            if (session) {
                // 本次需要应用的块（未被拒绝）
                const applyIndices = new Set<number>();
                for (let i = 0; i < diff.rawDiffs.length; i++) {
                    const blockInfo = session.blocks.find(b => b.index === i);
                    if (blockInfo && !blockInfo.rejected) {
                        applyIndices.add(i);
                    }
                }

                const first = diff.rawDiffs[0];

                if (isStructuredDiffHunk(first)) {
                    // 为什么结构化 hunk 要优先处理：它和 legacy search/replace 字段名不同，但同样需要支持块级拒绝后的内容重算。
                    // 怎么改：复用 apply_diff 导出的结构化应用函数，并传入未拒绝块索引集合。
                    // 目的：避免拒绝某个 hunk 后用旧 start_line 逻辑误算后续重复内容。
                    try {
                        const hunks = diff.rawDiffs as StructuredDiffHunk[];
                        const r = applyStructuredDiffHunksBestEffort(tempContent, hunks, { applyIndices });
                        tempContent = r.newContent;

                        for (const h of r.blocks) {
                            const blockInfo = session.blocks.find(b => b.index === h.index);
                            if (blockInfo) {
                                blockInfo.startLine = h.startLine;
                                blockInfo.endLine = h.endLine;
                            }
                        }
                    } catch (e) {
                        console.warn('[DiffManager] Failed to recompute structured diff content after rejecting a block:', e);
                    }
                } else if (isUnifiedDiffHunk(first)) {
                    // unified diff hunks：重新从 originalContent 计算“仅包含未拒绝块”的最终内容
                    try {
                        const hunks = diff.rawDiffs as UnifiedDiffHunk[];
                        const r = applyUnifiedDiffHunks(tempContent, hunks, { applyIndices });
                        tempContent = r.newContent;

                        // 更新各块在当前内容中的范围
                        for (const h of r.appliedHunks) {
                            const blockInfo = session.blocks.find(b => b.index === h.index);
                            if (blockInfo) {
                                blockInfo.startLine = h.startLine;
                                blockInfo.endLine = h.endLine;
                            }
                        }
                    } catch (e) {
                        console.warn('[DiffManager] Failed to recompute unified diff content after rejecting a block:', e);
                    }
                } else {
                    // legacy search/replace diffs（向后兼容）
                    for (let i = 0; i < diff.rawDiffs.length; i++) {
                        const blockInfo = session.blocks.find(b => b.index === i);
                        const d = diff.rawDiffs[i];
                        if (!blockInfo || blockInfo.rejected || !isLegacySearchReplaceDiff(d)) {
                            continue;
                        }

                        const replaceLines = d.replace.split('\n').length;

                        const result = applyDiffToContent(tempContent, d.search, d.replace, d.start_line);
                        if (result.success && result.matchedLine !== undefined) {
                            tempContent = result.result;

                            // 更新此块在当前内容中的范围
                            blockInfo.startLine = result.matchedLine;
                            blockInfo.endLine = result.matchedLine + replaceLines - 1;
                        }
                    }
                }

                // 更新编辑器
                const uri = vscode.Uri.file(diff.absolutePath);
                const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath);
                if (doc) {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        doc.positionAt(0),
                        doc.positionAt(doc.getText().length)
                    );
                    edit.replace(uri, fullRange, tempContent);
                    await vscode.workspace.applyEdit(edit);
                }
            }
        }

        // 如果所有块都处理完了，自动结束
        if (provider.isSessionComplete(sessionId)) {
            const session = provider.getSession(sessionId);
            const allRejected = !!session && session.blocks.length > 0 && session.blocks.every(b => b.rejected);

            // 全部块都被拒绝：视为用户明确拒绝本次 diff（不保存任何更改）
            if (allRejected) {
                await this.rejectDiff(sessionId);
            } else {
                // 部分接受/部分拒绝：保存“剩余接受的块”
                await this.acceptDiff(sessionId, true);
            }
        }
    }
    
    private computeFinalSuggestedContent(id: string, diff: PendingDiff): string {
        // 计算最终内容（仅包含已确认的块）
        let finalContent = diff.newContent;

        if (!diff.rawDiffs || diff.rawDiffs.length === 0) {
            return finalContent;
        }

        const provider = getDiffCodeLensProvider();
        const session = provider.getSession(id);
        if (!session) {
            return finalContent;
        }

        const rejectedBlocks = session.blocks.filter(b => b.rejected);
        if (rejectedBlocks.length === 0) {
            return finalContent;
        }

        // 有被拒绝的块，重新计算内容
        finalContent = diff.originalContent;

        // 需要应用的块（未被拒绝）
        const applyIndices = new Set<number>();
        for (let i = 0; i < diff.rawDiffs.length; i++) {
            const blockInfo = session.blocks.find(b => b.index === i);
            if (blockInfo && !blockInfo.rejected) {
                applyIndices.add(i);
            }
        }

        const first = diff.rawDiffs[0];

        if (isStructuredDiffHunk(first)) {
            // 为什么 finalContent 也要支持结构化 hunk：保存前会根据用户拒绝的块重新计算最终建议内容。
            // 怎么改：复用同一个结构化应用函数，只应用未拒绝的 hunk 索引。
            // 目的：确保编辑器实时内容和最终落盘内容使用完全一致的重放规则。
            try {
                const hunks = diff.rawDiffs as StructuredDiffHunk[];
                const r = applyStructuredDiffHunksBestEffort(finalContent, hunks, { applyIndices });
                finalContent = r.newContent;
            } catch (e) {
                console.warn('[DiffManager] Failed to recompute final suggested content for structured diff:', e);
            }
        } else if (isUnifiedDiffHunk(first)) {
            // unified diff hunks
            try {
                const hunks = diff.rawDiffs as UnifiedDiffHunk[];
                const r = applyUnifiedDiffHunks(finalContent, hunks, { applyIndices });
                finalContent = r.newContent;
            } catch (e) {
                console.warn('[DiffManager] Failed to recompute final suggested content for unified diff:', e);
            }
        } else {
            // legacy search/replace diffs
            for (let i = 0; i < diff.rawDiffs.length; i++) {
                const blockInfo = session.blocks.find(b => b.index === i);
                const d = diff.rawDiffs[i];
                if (!blockInfo || blockInfo.rejected || !isLegacySearchReplaceDiff(d)) {
                    continue;
                }

                const result = applyDiffToContent(finalContent, d.search, d.replace, d.start_line);
                if (result.success) {
                    finalContent = result.result;
                }
            }
        }

        return finalContent;
    }

    /**
     * 显示内联 diff 视图
     */
    private async showDiffView(diff: PendingDiff): Promise<void> {
        const fileUri = vscode.Uri.file(diff.absolutePath);

        const isPending = () => diff.status === 'pending';

        const restoreToOriginalBestEffort = async (): Promise<void> => {
            try {
                const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath);
                const targetDoc = doc || (await vscode.workspace.openTextDocument(fileUri));
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                    targetDoc.positionAt(0),
                    targetDoc.positionAt(targetDoc.getText().length)
                );
                edit.replace(fileUri, fullRange, diff.originalContent);
                await vscode.workspace.applyEdit(edit);
            } catch {
                // ignore
            }
        };

        // 如果在进入 showDiffView 之前就已被处理（例如 cancelAllPending 先一步发生），直接短路
        if (!isPending()) {
            return;
        }
        
        // 1. 打开并修改目标文件（不保存）
        const document = await vscode.workspace.openTextDocument(fileUri);
        if (!isPending()) {
            return;
        }
        const editor = await vscode.window.showTextDocument(document, {
            preview: false,
            preserveFocus: false
        });
        if (!isPending()) {
            return;
        }
        
        // 应用修改
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        
        await editor.edit((editBuilder) => {
            editBuilder.replace(fullRange, diff.newContent);
        });

        // 若在 apply edit 过程中被取消/拒绝，立即恢复原始内容并退出，避免留下脏文档
        if (!isPending()) {
            await restoreToOriginalBestEffort();
            try {
                await this.closeDiffTab(diff.absolutePath);
            } catch {
                // ignore
            }
            return;
        }
        
        // 2. 创建原始内容的虚拟 URI
        const originalUri = vscode.Uri.parse(`gemini-diff-original:${diff.id}/${path.basename(diff.filePath)}`);
        
        // 4. 打开 diff 视图
        const title = t('tools.file.diffManager.diffTitle', { filePath: diff.filePath });
        if (!isPending()) {
            await restoreToOriginalBestEffort();
            return;
        }
        await vscode.commands.executeCommand('vscode.diff', originalUri, fileUri, title, {
            preview: false
        });

        // 若在打开 diff 视图期间被取消/拒绝，关闭 diff 并恢复原始内容，避免 UI 残留
        if (!isPending()) {
            try {
                await this.closeDiffTab(diff.absolutePath);
            } catch {
                // ignore
            }
            await restoreToOriginalBestEffort();
            return;
        }
        
        // 5. 监听文档即将保存事件
        const willSaveListener = vscode.workspace.onWillSaveTextDocument((event) => {
            if (event.document.uri.fsPath !== diff.absolutePath || diff.status !== 'pending') {
                return;
            }

            if (this.isDiffActionInProgress(diff.id)) {
                return;
            }

            const currentSettings = this.getSettings();
            if (currentSettings.autoSave || event.reason === vscode.TextDocumentSaveReason.Manual) {
                return;
            }

            const currentDraftContent = event.document.getText();
            this.suppressedNonManualSaveDrafts.set(diff.id, currentDraftContent);

            const fullRange = new vscode.Range(
                event.document.positionAt(0),
                event.document.positionAt(currentDraftContent.length)
            );

            event.waitUntil(Promise.resolve([
                vscode.TextEdit.replace(fullRange, diff.originalContent)
            ]));
        });

        // 6. 监听文档保存事件
        const saveListener = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
            if (savedDoc.uri.fsPath !== diff.absolutePath || diff.status !== 'pending') {
                return;
            }

            if (this.isDiffActionInProgress(diff.id)) {
                return;
            }

            const suppressedDraft = this.suppressedNonManualSaveDrafts.get(diff.id);
            if (suppressedDraft !== undefined) {
                this.suppressedNonManualSaveDrafts.delete(diff.id);
                try {
                    await this.restorePendingDraftAfterNonManualSave(diff, suppressedDraft);
                } catch (error) {
                    console.warn(
                        `[DiffManager] Failed to restore pending diff draft after non-manual save for ${diff.filePath}:`,
                        error
                    );
                }
                return;
            }

            // 检查用户是否修改了内容（保存时的最终内容）
            const savedContent = savedDoc.getText();

            if (savedContent === diff.originalContent) {
                this.finalizeRejectedDiff(diff);

                const currentSettings = this.getSettings();
                if (!currentSettings.autoSave) {
                    await this.closeDiffTab(diff.absolutePath);
                }
                return;
            }

            // 以“系统建议将保存的内容”为基准（考虑 CodeLens 拒绝块等）
            const baseSuggestedContent = this.computeFinalSuggestedContent(diff.id, diff);

            if (savedContent !== baseSuggestedContent && savedContent !== diff.originalContent) {
                // 仅保留摘要，不在工具响应里发送完整文件内容
                diff.userEditedContent = computeUserEditedNewLinesSummary(baseSuggestedContent, savedContent);
            }

            this.finalizeAcceptedDiff(diff);

            // 非自动保存模式下，用户手动保存后自动关闭 diff 标签页
            const currentSettings = this.getSettings();
            if (!currentSettings.autoSave) {
                await this.closeDiffTab(diff.absolutePath);
            }
        });
        
        // 7. 监听文档关闭事件
        const closeListener = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
            if (closedDoc.uri.fsPath !== diff.absolutePath || diff.status !== 'pending') {
                return;
            }

            if (this.isDiffActionInProgress(diff.id)) {
                return;
            }

            try {
                const currentContent = fs.readFileSync(diff.absolutePath, 'utf8');
                if (currentContent !== diff.newContent) {
                    this.finalizeRejectedDiff(diff);
                }
            } catch (e) {
                // 忽略错误
            }
        });

        // 若在注册监听器期间被取消/拒绝，立即释放监听器并恢复内容，避免残留订阅造成后续错乱
        if (!isPending()) {
            try {
                willSaveListener.dispose();
            } catch {
                // ignore
            }
            try {
                saveListener.dispose();
            } catch {
                // ignore
            }
            try {
                closeListener.dispose();
            } catch {
                // ignore
            }
            try {
                await this.closeDiffTab(diff.absolutePath);
            } catch {
                // ignore
            }
            await restoreToOriginalBestEffort();
            return;
        }
        
        this.willSaveListeners.set(diff.id, willSaveListener);
        this.saveListeners.set(diff.id, saveListener);
        this.closeListeners.set(diff.id, closeListener);
    }
    
    /**
     * 设置自动保存定时器
     */
    private scheduleAutoSave(id: string): void {
        const existingTimer = this.autoSaveTimers.get(id);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }
        
        const currentSettings = this.getSettings();
        const timer = setTimeout(async () => {
            // 自动保存：强制使用 AI 建议的内容（避免覆盖用户可能正在进行的手动修改）
            const accepted = await this.acceptDiff(id, true, true);
            if (!accepted) {
                // 自动保存模式必须收敛。
                // 为什么不能继续 pending：工具 handler 正在等待该 diff 结束；pending 会让流式提前执行的 Promise 永远不 resolve。
                // 怎么改：保存失败后走拒绝路径恢复原始内容并触发状态变更；若拒绝也失败，则强制标记 rejected。
                // 目的：让自动确认失败以明确错误结束，而不是卡住到用户中止。
                await this.finalizeAutoSaveFailure(id, 'Auto-save failed while accepting diff. The diff was rejected to unblock tool execution.');
            }
            this.autoSaveTimers.delete(id);
        }, currentSettings.autoSaveDelay);
        
        this.autoSaveTimers.set(id, timer);
    }

    private async finalizeAutoSaveFailure(id: string, message: string): Promise<void> {
        const diff = this.pendingDiffs.get(id);
        if (!diff || diff.status !== 'pending') {
            return;
        }

        // 保留 acceptDiff 捕获到的底层保存错误。
        // 为什么不能直接覆盖：自动保存失败后用户和日志需要看到真实异常，例如磁盘写入失败、VS Code 保存失败等。
        // 怎么改：如果 acceptDiff 已经写入 autoSaveError，就只补充兜底语义；否则使用传入的通用错误。
        // 目的：既保证自动确认失败会收敛，也保留可诊断的根因信息。
        diff.autoSaveError = diff.autoSaveError
            ? `${message} ${diff.autoSaveError}`
            : message;

        const rejected = await this.rejectDiff(id);
        if (rejected) {
            return;
        }

        // 如果 rejectDiff 也失败，仍然必须释放等待中的工具 Promise。
        // 此兜底只改变状态并清理监听器；不再尝试保存或恢复，避免在错误路径中重复触发 VS Code 编辑器竞态。
        diff.status = 'rejected';
        this.disposeDiffListeners(id);
        this.cleanup(id);
        this.notifyStatusChange();
    }
    
    /**
     * 接受 diff（保存修改）
     * @param id diff ID
     * @param closeTab 是否关闭标签页
     * @param isAutoSave 是否为自动保存（自动保存时强制使用 AI 内容；手动接受时尽量保留用户编辑）
     */
    public async acceptDiff(id: string, closeTab: boolean = false, isAutoSave: boolean = false): Promise<boolean> {
        const diff = this.pendingDiffs.get(id);
        if (!diff || diff.status !== 'pending' || this.isDiffActionInProgress(id)) {
            return false;
        }

        this.acceptingDiffIds.add(id);
        
        try {
            const finalContent = this.computeFinalSuggestedContent(id, diff);
            
            const uri = vscode.Uri.file(diff.absolutePath);
            let doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath);
            
            // 如果文档未打开，先打开它
            if (!doc) {
                doc = await vscode.workspace.openTextDocument(uri);
            }
            
            const currentContent = doc.getText();

            // 自动保存：强制保存 AI 计算出来的 finalContent。
            // 手动接受：如果用户在编辑器中改过内容，则保留当前内容，不覆盖。
            let contentToSave = finalContent;

            if (isAutoSave || currentContent === diff.originalContent) {
                // 覆盖到 finalContent（自动保存 / 文档仍是原始内容时）
                if (currentContent !== finalContent) {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        doc.positionAt(0),
                        doc.positionAt(currentContent.length)
                    );
                    edit.replace(uri, fullRange, finalContent);
                    const applied = await vscode.workspace.applyEdit(edit);
                    if (!applied) {
                        throw new Error(`Failed to stage accepted diff content for ${diff.filePath}`);
                    }
                }
                contentToSave = finalContent;
            } else {
                // currentContent != original => 认为用户已经在 AI 建议上做了调整（包含手动编辑/拒绝部分块）
                if (currentContent !== finalContent) {
                    diff.userEditedContent = computeUserEditedNewLinesSummary(finalContent, currentContent);
                }
                contentToSave = currentContent;
            }
            
            const normalizeToLF = (text: string): string => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

            const revertOpenDocumentToDisk = async (): Promise<void> => {
                try {
                    // 关键：使用 revert 丢弃脏状态并从磁盘重新加载，避免 VSCode “文件内容较新”保存冲突提示
                    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
                    await vscode.commands.executeCommand('workbench.action.files.revert');
                } catch {
                    // ignore
                }
            };

            // 读取磁盘内容，用于判断是否需要绕过 doc.save（doc.save 在磁盘变更时会触发 VSCode 冲突提示）
            let diskContent: string | undefined;
            try {
                diskContent = fs.readFileSync(diff.absolutePath, 'utf8');
            } catch {
                diskContent = undefined;
            }

            const saveNormalized = normalizeToLF(contentToSave);
            const diskNormalized = diskContent !== undefined ? normalizeToLF(diskContent) : undefined;
            const originalNormalized = normalizeToLF(diff.originalContent);

            // 1) 若磁盘内容已经等于要保存的内容：无需保存，直接 revert 清理 dirty（避免冲突提示）
            if (diskNormalized !== undefined && diskNormalized === saveNormalized) {
                if (doc.isDirty) {
                    await revertOpenDocumentToDisk();
                }
            }
            // 2) 若磁盘内容已不同于 diff 创建时的 originalContent：说明中途被外部写入/回滚，绕过 doc.save 强制写入后再 revert
            else if (diskNormalized !== undefined && diskNormalized !== originalNormalized) {
                fs.writeFileSync(diff.absolutePath, contentToSave, 'utf8');
                await revertOpenDocumentToDisk();
            }
            // 3) 磁盘仍为 originalContent：走 doc.save 快路径（保留 VSCode 的编码/换行等保存策略）
            else {
                let saved = false;
                try {
                    saved = await doc.save();
                } catch {
                    saved = false;
                }

                if (!saved) {
                    // 如果 VSCode API 保存失败，尝试直接写入文件
                    fs.writeFileSync(diff.absolutePath, contentToSave, 'utf8');
                    await revertOpenDocumentToDisk();
                }
            }
            
            this.finalizeAcceptedDiff(diff);
            
            try {
                vscode.window.setStatusBarMessage(`$(check) ${t('tools.file.diffManager.savedShort', { filePath: diff.filePath })}`, 3000);
            } catch (error) {
                console.warn(`[DiffManager] Failed to show accepted status for ${diff.filePath}:`, error);
            }
            
            if (closeTab) {
                try {
                    await this.closeDiffTab(diff.absolutePath);
                } catch (error) {
                    console.warn(`[DiffManager] Failed to close diff tab for ${diff.filePath}:`, error);
                }
            }
            
            return true;
        } catch (error) {
            const message = t('tools.file.diffManager.saveFailed', { error: error instanceof Error ? error.message : String(error) });
            if (diff) {
                diff.autoSaveError = message;
            }
            vscode.window.showErrorMessage(message);
            return false;
        } finally {
            this.acceptingDiffIds.delete(id);
        }
    }
    
    /**
     * 关闭指定文件的 diff 标签页
     */
    private async closeDiffTab(filePath: string): Promise<void> {
        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                if (tab.input instanceof vscode.TabInputTextDiff) {
                    const diffInput = tab.input as vscode.TabInputTextDiff;
                    if (diffInput.modified.fsPath === filePath) {
                        await vscode.window.tabGroups.close(tab);
                        return;
                    }
                }
            }
        }
    }
    
    /**
     * 拒绝 diff（放弃修改）
     */
    public async rejectDiff(id: string): Promise<boolean> {
        const diff = this.pendingDiffs.get(id);
        if (!diff || diff.status !== 'pending' || this.isDiffActionInProgress(id)) {
            return false;
        }

        this.rejectingDiffIds.add(id);
        
        try {
            // 1. 恢复文件内容
            const uri = vscode.Uri.file(diff.absolutePath);
            const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath);
            
            if (doc) {
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                    doc.positionAt(0),
                    doc.positionAt(doc.getText().length)
                );
                edit.replace(uri, fullRange, diff.originalContent);
                const applied = await vscode.workspace.applyEdit(edit);
                if (!applied) {
                    throw new Error(`Failed to restore original content for ${diff.filePath}`);
                }
                
                // 如果文件曾经被保存过（脏了），这里我们不强制保存，因为用户拒绝了 AI 的修改。
                // 但如果文件在 AI 修改前就是干净的，AI 修改让它变脏了，我们现在恢复了原始内容，它应该变回干净（或者通过 undo）。
            } else {
                // 如果文档没打开，直接写回原始文件内容确保万无一失
                fs.writeFileSync(diff.absolutePath, diff.originalContent, 'utf8');
            }

            this.finalizeRejectedDiff(diff);

            try {
                await this.closeDiffTab(diff.absolutePath);
            } catch (error) {
                console.warn(`[DiffManager] Failed to close rejected diff tab for ${diff.filePath}:`, error);
            }
            
            return true;
        } catch (error) {
            console.error('Failed to reject diff:', error);
            return false;
        } finally {
            this.rejectingDiffIds.delete(id);
        }
    }
    
    /**
     * 接受所有待处理的 diff
     */
    public async acceptAll(): Promise<number> {
        let count = 0;
        for (const [id, diff] of this.pendingDiffs.entries()) {
            if (diff.status === 'pending') {
                const success = await this.acceptDiff(id);
                if (success) {
                    count++;
                }
            }
        }
        return count;
    }
    
    /**
     * 拒绝所有待处理的 diff
     */
    public async rejectAll(): Promise<number> {
        let count = 0;
        for (const [id, diff] of this.pendingDiffs.entries()) {
            if (diff.status === 'pending') {
                const success = await this.rejectDiff(id);
                if (success) {
                    count++;
                }
            }
        }
        return count;
    }
    
    /**
     * 清理资源
     */
    private cleanup(id: string): void {
        const timer = this.autoSaveTimers.get(id);
        if (timer) {
            clearTimeout(timer);
            this.autoSaveTimers.delete(id);
        }
        
        this.contentProvider.removeContent(id);

        // 移除 CodeLens 会话（会自动触发相关 UI 刷新）
        try {
            getDiffCodeLensProvider().removeSession(id);
        } catch (err) {
            console.warn(`[DiffManager] Failed to remove CodeLens session ${id}:`, err);
        }
        
        const tempDir = path.join(require('os').tmpdir(), 'gemini-diff');
        const diff = this.pendingDiffs.get(id);
        if (diff) {
            const tempFilePath = path.join(tempDir, `${id}-${path.basename(diff.filePath)}`);
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }
    }
    
    /**
     * 获取所有待处理的 diff
     */
    public getPendingDiffs(): PendingDiff[] {
        return Array.from(this.pendingDiffs.values()).filter(d => d.status === 'pending');
    }

    /**
     * 检查是否所有 diff 都已处理
     */
    public areAllProcessed(): boolean {
        return this.getPendingDiffs().length === 0;
    }
    
    /**
     * 等待所有 diff 被处理
     */
    public waitForAllProcessed(): Promise<void> {
        return new Promise((resolve) => {
            if (this.areAllProcessed()) {
                resolve();
                return;
            }
            
            const listener: StatusChangeListener = (_pending, allProcessed) => {
                if (allProcessed) {
                    this.removeStatusListener(listener);
                    resolve();
                }
            };
            
            this.addStatusListener(listener);
        });
    }

    /**
     * 等待指定 pending diff 结算。
     *
     * 为什么要集中到 DiffManager：状态监听、轮询、用户中断、AbortSignal 原本分散在各工具里，
     * apply_diff 遗漏轮询用户中断后，会在自动保存定时器被 markUserInterrupt 清掉时永久等待。
     * 怎么改：监听状态变化负责快速响应；100ms 轮询负责兜底捕获用户中断和漏掉的状态事件；
     * abort/user 中断都会主动 reject 当前 diff，并清理 listener、timer 和 abort handler。
     * 目的：让所有 diff-review 工具拥有同一个收敛协议，避免“文件已处理但工具 Promise 仍悬挂”。
     */
    public waitForDiffResolution(id: string, abortSignal?: AbortSignal): Promise<DiffResolutionReason> {
        return new Promise<DiffResolutionReason>((resolve) => {
            let resolved = false;
            let pollTimer: ReturnType<typeof setTimeout> | undefined;
            let abortHandler: (() => void) | undefined;
            let statusListener: StatusChangeListener | undefined;

            const clearPollTimer = () => {
                if (pollTimer) {
                    clearTimeout(pollTimer);
                    pollTimer = undefined;
                }
            };

            const finish = (reason: DiffResolutionReason) => {
                if (resolved) return;
                resolved = true;
                clearPollTimer();

                if (statusListener) {
                    this.removeStatusListener(statusListener);
                    statusListener = undefined;
                }

                if (abortHandler && abortSignal) {
                    try {
                        abortSignal.removeEventListener('abort', abortHandler);
                    } catch {
                        // ignore
                    }
                }

                resolve(reason);
            };

            const rejectAndFinish = (reason: Exclude<DiffResolutionReason, 'none'>) => {
                this.rejectDiff(id).catch(() => {});
                finish(reason);
            };

            const scheduleNextCheck = () => {
                if (resolved || pollTimer) return;
                pollTimer = setTimeout(() => {
                    pollTimer = undefined;
                    checkStatus();
                }, 100);
            };

            const checkStatus = () => {
                if (resolved) return;

                if (this.isUserInterrupted()) {
                    rejectAndFinish('user');
                    return;
                }

                const diff = this.getDiff(id);
                if (!diff || diff.status !== 'pending') {
                    finish('none');
                    return;
                }

                scheduleNextCheck();
            };

            abortHandler = () => {
                rejectAndFinish('abort');
            };

            if (abortSignal) {
                if (abortSignal.aborted) {
                    abortHandler();
                    return;
                }
                abortSignal.addEventListener('abort', abortHandler, { once: true } as any);
            }

            statusListener = () => {
                checkStatus();
            };
            this.addStatusListener(statusListener);

            // createPendingDiff 可能在 autoApplyWithoutDiffView 或外部取消路径中已完成，
            // 所以注册监听后立刻检查一次，避免错过返回前发生的状态变化。
            checkStatus();
        });
    }
    
    /**
     * 标记用户中断（用户发送了新消息）
     * 这会让所有等待中的工具立即返回
     */
    public markUserInterrupt(): void {
        userInterruptFlag = true;
        // 取消所有自动保存定时器
        for (const timer of this.autoSaveTimers.values()) {
            clearTimeout(timer);
        }
        this.autoSaveTimers.clear();
    }
    
    /**
     * 重置用户中断标记
     */
    public resetUserInterrupt(): void {
        userInterruptFlag = false;
    }
    
    /**
     * 检查是否被用户中断
     */
    public isUserInterrupted(): boolean {
        return userInterruptFlag;
    }
    
    /**
     * 取消所有待处理的 diff（标记为已取消）
     * 用于用户发送新消息或删除消息时清理未确认的 diff
     */
    public async cancelAllPending(): Promise<{ cancelled: PendingDiff[] }> {
        const cancelled: PendingDiff[] = [];

        const pendingIds = Array.from(this.pendingDiffs.entries())
            .filter(([, d]) => d.status === 'pending')
            .map(([id]) => id);

        for (const id of pendingIds) {
            const diff = this.pendingDiffs.get(id);
            if (!diff || diff.status !== 'pending') {
                continue;
            }

            // 1. 标记为拒绝（从 pending 列表中移除）
            diff.status = 'rejected';
            cancelled.push({ ...diff });

            // 2. 关闭 diff 编辑器标签页
            try {
                await this.closeDiffTab(diff.absolutePath);
            } catch (err) {
                console.warn(`[DiffManager] Failed to close diff tab for ${diff.absolutePath}:`, err);
            }

            // 3. 移除监听器
            const saveListener = this.saveListeners.get(id);
            if (saveListener) {
                try {
                    saveListener.dispose();
                } catch {
                    // ignore
                }
                this.saveListeners.delete(id);
            }
            const closeListener = this.closeListeners.get(id);
            if (closeListener) {
                try {
                    closeListener.dispose();
                } catch {
                    // ignore
                }
                this.closeListeners.delete(id);
            }

            // 4. 清理资源（会自动移除 CodeLens 会话并通知状态变化）
            try {
                this.cleanup(id);
            } catch (err) {
                console.warn(`[DiffManager] Failed to cleanup diff ${id}:`, err);
            }

            // 6. 尝试恢复文件到原始状态
            try {
                const uri = vscode.Uri.file(diff.absolutePath);
                const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath);
                if (doc && doc.isDirty) {
                    // 恢复到原始内容
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        doc.positionAt(0),
                        doc.positionAt(doc.getText().length)
                    );
                    edit.replace(uri, fullRange, diff.originalContent);
                    await vscode.workspace.applyEdit(edit);
                }
            } catch (err) {
                console.warn(`[DiffManager] Failed to restore file for cancelled diff ${id}:`, err);
            }
        }

        if (cancelled.length > 0) {
            this.notifyStatusChange();
        }

        return { cancelled };
    }
    
    /**
     * 获取指定 ID 的 diff
     */
    public getDiff(id: string): PendingDiff | undefined {
        return this.pendingDiffs.get(id);
    }
    
    /**
     * 销毁管理器
     */
    public dispose(): void {
        for (const timer of this.autoSaveTimers.values()) {
            clearTimeout(timer);
        }
        this.autoSaveTimers.clear();
        
        for (const listener of this.saveListeners.values()) {
            listener.dispose();
        }
        this.saveListeners.clear();

        for (const listener of this.willSaveListeners.values()) {
            listener.dispose();
        }
        this.willSaveListeners.clear();
        
        for (const listener of this.closeListeners.values()) {
            listener.dispose();
        }
        this.closeListeners.clear();

        this.suppressedNonManualSaveDrafts.clear();
        
        if (this.providerDisposable) {
            this.providerDisposable.dispose();
        }
        
        DiffManager.instance = null;
    }
}

/**
 * 原始内容提供者 - 用于 diff 视图显示原始文件内容
 */
class OriginalContentProvider implements vscode.TextDocumentContentProvider {
    private contents: Map<string, string> = new Map();
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    
    public onDidChange = this.onDidChangeEmitter.event;
    
    public setContent(id: string, content: string): void {
        this.contents.set(id, content);
    }
    
    public removeContent(id: string): void {
        this.contents.delete(id);
    }
    
    public provideTextDocumentContent(uri: vscode.Uri): string {
        const path = uri.path;
        const parts = path.split('/').filter(p => p.length > 0);
        const id = parts[0];
        return this.contents.get(id) || '';
    }
}

/**
 * 获取 DiffManager 实例
 */
export function getDiffManager(): DiffManager {
    return DiffManager.getInstance();
}