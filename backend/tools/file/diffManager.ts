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
import { applyDiffToContent } from './apply_diff';

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
    
    /** 文档关闭事件监听器 */
    private closeListeners: Map<string, vscode.Disposable> = new Map();
    
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
     * 创建待审阅的 diff
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
        
        // 注册原始内容到提供者
        this.contentProvider.setContent(id, originalContent);
        
        // 如果有块信息，注册到 CodeLens 提供者
        if (blocks) {
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
        
        // 显示 diff 视图
        await this.showDiffView(pendingDiff);
        
        // 如果开启自动保存，设置定时器
        const currentSettings = this.getSettings();
        if (currentSettings.autoSave) {
            this.scheduleAutoSave(id);
        }
        
        // 通知状态变化
        this.notifyStatusChange();
        
        return pendingDiff;
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
        if (diff && diff.rawDiffs) {
            let tempContent = diff.originalContent;
            const session = provider.getSession(sessionId);
            if (session) {
                // 重新计算并更新所有块的行号
                for (let i = 0; i < diff.rawDiffs.length; i++) {
                    const blockInfo = session.blocks.find(b => b.index === i);
                    if (blockInfo && !blockInfo.rejected) {
                        const searchLines = diff.rawDiffs[i].search.split('\n').length;
                        const replaceLines = diff.rawDiffs[i].replace.split('\n').length;
                        
                        const result = applyDiffToContent(tempContent, diff.rawDiffs[i].search, diff.rawDiffs[i].replace, diff.rawDiffs[i].start_line);
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
        if (diff.rawDiffs) {
            const provider = getDiffCodeLensProvider();
            const session = provider.getSession(id);
            if (session) {
                const rejectedBlocks = session.blocks.filter(b => b.rejected);

                if (rejectedBlocks.length > 0) {
                    // 有被拒绝的块，重新计算内容
                    finalContent = diff.originalContent;
                    for (let i = 0; i < diff.rawDiffs.length; i++) {
                        const blockInfo = session.blocks.find(b => b.index === i);
                        // 只有没被明确拒绝的块才应用
                        if (blockInfo && !blockInfo.rejected) {
                            const result = applyDiffToContent(
                                finalContent,
                                diff.rawDiffs[i].search,
                                diff.rawDiffs[i].replace,
                                diff.rawDiffs[i].start_line
                            );
                            if (result.success) {
                                finalContent = result.result;
                            }
                        }
                    }
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
        
        // 1. 打开并修改目标文件（不保存）
        const document = await vscode.workspace.openTextDocument(fileUri);
        const editor = await vscode.window.showTextDocument(document, {
            preview: false,
            preserveFocus: false
        });
        
        // 应用修改
        const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
        );
        
        await editor.edit((editBuilder) => {
            editBuilder.replace(fullRange, diff.newContent);
        });
        
        // 2. 创建原始内容的虚拟 URI
        const originalUri = vscode.Uri.parse(`gemini-diff-original:${diff.id}/${path.basename(diff.filePath)}`);
        
        // 4. 打开 diff 视图
        const title = t('tools.file.diffManager.diffTitle', { filePath: diff.filePath });
        await vscode.commands.executeCommand('vscode.diff', originalUri, fileUri, title, {
            preview: false
        });
        
        // 5. 监听文档保存事件
        const saveListener = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
            if (savedDoc.uri.fsPath === diff.absolutePath) {
                // 检查用户是否修改了内容（保存时的最终内容）
                const savedContent = savedDoc.getText();

                // 以“系统建议将保存的内容”为基准（考虑 CodeLens 拒绝块等）
                const baseSuggestedContent = this.computeFinalSuggestedContent(diff.id, diff);

                if (savedContent !== baseSuggestedContent && savedContent !== diff.originalContent) {
                    // 仅保留摘要，不在工具响应里发送完整文件内容
                    diff.userEditedContent = computeUserEditedNewLinesSummary(baseSuggestedContent, savedContent);
                }

                diff.status = 'accepted';
                saveListener.dispose();
                this.cleanup(diff.id);
                this.notifyStatusChange();
                this.notifySaveComplete(diff);

                // 非自动保存模式下，用户手动保存后自动关闭 diff 标签页
                const currentSettings = this.getSettings();
                if (!currentSettings.autoSave) {
                    await this.closeDiffTab(diff.absolutePath);
                }
            }
        });
        
        // 6. 监听文档关闭事件
        const closeListener = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
            if (closedDoc.uri.fsPath === diff.absolutePath && diff.status === 'pending') {
                try {
                    const currentContent = fs.readFileSync(diff.absolutePath, 'utf8');
                    if (currentContent !== diff.newContent) {
                        diff.status = 'rejected';
                        this.cleanup(diff.id);
                        this.notifyStatusChange();
                    }
                } catch (e) {
                    // 忽略错误
                }
                closeListener.dispose();
                saveListener.dispose();
            }
        });
        
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
            await this.acceptDiff(id, true, true);
            this.autoSaveTimers.delete(id);
        }, currentSettings.autoSaveDelay);
        
        this.autoSaveTimers.set(id, timer);
    }
    
    /**
     * 接受 diff（保存修改）
     * @param id diff ID
     * @param closeTab 是否关闭标签页
     * @param isAutoSave 是否为自动保存（自动保存时强制使用 AI 内容；手动接受时尽量保留用户编辑）
     */
    public async acceptDiff(id: string, closeTab: boolean = false, isAutoSave: boolean = false): Promise<boolean> {
        const diff = this.pendingDiffs.get(id);
        if (!diff || diff.status !== 'pending') {
            return false;
        }
        
        try {
            // 移除监听器（避免重复处理）
            const saveListener = this.saveListeners.get(id);
            if (saveListener) {
                saveListener.dispose();
                this.saveListeners.delete(id);
            }
            const closeListener = this.closeListeners.get(id);
            if (closeListener) {
                closeListener.dispose();
                this.closeListeners.delete(id);
            }

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
                    await vscode.workspace.applyEdit(edit);
                }
                contentToSave = finalContent;
            } else {
                // currentContent != original => 认为用户已经在 AI 建议上做了调整（包含手动编辑/拒绝部分块）
                if (currentContent !== finalContent) {
                    diff.userEditedContent = computeUserEditedNewLinesSummary(finalContent, currentContent);
                }
                contentToSave = currentContent;
            }
            
            // 保存文档
            const saved = await doc.save();
            
            if (!saved) {
                // 如果 VSCode API 保存失败，尝试直接写入文件
                fs.writeFileSync(diff.absolutePath, contentToSave, 'utf8');
            }
            
            diff.status = 'accepted';
            this.cleanup(id);
            
            // 移除 CodeLens 会话
            getDiffCodeLensProvider().removeSession(id);

            this.notifyStatusChange();
            this.notifySaveComplete(diff);
            
            vscode.window.setStatusBarMessage(`$(check) ${t('tools.file.diffManager.savedShort', { filePath: diff.filePath })}`, 3000);
            
            if (closeTab) {
                await this.closeDiffTab(diff.absolutePath);
            }
            
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(t('tools.file.diffManager.saveFailed', { error: error instanceof Error ? error.message : String(error) }));
            return false;
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
        if (!diff || diff.status !== 'pending') {
            return false;
        }
        
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
                await vscode.workspace.applyEdit(edit);
                
                // 如果文件曾经被保存过（脏了），这里我们不强制保存，因为用户拒绝了 AI 的修改。
                // 但如果文件在 AI 修改前就是干净的，AI 修改让它变脏了，我们现在恢复了原始内容，它应该变回干净（或者通过 undo）。
            } else {
                // 如果文档没打开，直接写回原始文件内容确保万无一失
                fs.writeFileSync(diff.absolutePath, diff.originalContent, 'utf8');
            }

            // 2. 关闭 diff 标签页
            await this.closeDiffTab(diff.absolutePath);

            // 3. 移除监听器
            const saveListener = this.saveListeners.get(id);
            if (saveListener) {
                saveListener.dispose();
                this.saveListeners.delete(id);
            }
            const closeListener = this.closeListeners.get(id);
            if (closeListener) {
                closeListener.dispose();
                this.closeListeners.delete(id);
            }

            diff.status = 'rejected';
            this.cleanup(id);
            
            // 4. 移除 CodeLens 会话
            getDiffCodeLensProvider().removeSession(id);

            this.notifyStatusChange();
            
            return true;
        } catch (error) {
            console.error('Failed to reject diff:', error);
            return false;
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

            // 4. 移除 CodeLens 会话（避免残留）
            try {
                getDiffCodeLensProvider().removeSession(id);
            } catch (err) {
                console.warn(`[DiffManager] Failed to remove CodeLens session ${id}:`, err);
            }

            // 5. 清理临时资源
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
        
        for (const listener of this.closeListeners.values()) {
            listener.dispose();
        }
        this.closeListeners.clear();
        
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