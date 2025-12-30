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
    /** 用户编辑后的最终内容（仅当用户修改了 AI 建议时存在） */
    userEditedContent?: string;
    /** 创建时间 */
    timestamp: number;
    /** 状态 */
    status: 'pending' | 'accepted' | 'rejected';
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
 * 手动保存监听器（当用户通过 CTRL+S 保存时调用，前端应复用保存按钮的逻辑）
 */
type ManualSaveListener = (diff: PendingDiff) => void;

/**
 * 用户中断标记
 */
let userInterruptFlag = false;

/**
 * Diff 管理器
 */
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

    /** 手动保存监听器（当用户通过 CTRL+S 保存时调用） */
    private manualSaveListeners: Set<ManualSaveListener> = new Set();

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
     * 添加手动保存监听器
     */
    public addManualSaveListener(listener: ManualSaveListener): void {
        this.manualSaveListeners.add(listener);
    }

    /**
     * 移除手动保存监听器
     */
    public removeManualSaveListener(listener: ManualSaveListener): void {
        this.manualSaveListeners.delete(listener);
    }

    /**
     * 通知手动保存（用户通过 CTRL+S 保存）
     * 前端收到通知后应调用 acceptDiff 走完整流程
     */
    private notifyManualSave(diff: PendingDiff): void {
        for (const listener of this.manualSaveListeners) {
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
        newContent: string
    ): Promise<PendingDiff> {
        const id = `diff-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const pendingDiff: PendingDiff = {
            id,
            filePath,
            absolutePath,
            originalContent,
            newContent,
            timestamp: Date.now(),
            status: 'pending'
        };
        
        this.pendingDiffs.set(id, pendingDiff);
        
        // 注册原始内容到提供者
        this.contentProvider.setContent(id, originalContent);
        
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
        
        // 3. 设置为内联模式
        const config = vscode.workspace.getConfiguration('diffEditor');
        await config.update('renderSideBySide', false, vscode.ConfigurationTarget.Global);
        
        // 4. 打开 diff 视图
        const title = t('tools.file.diffManager.diffTitle', { filePath: diff.filePath });
        await vscode.commands.executeCommand('vscode.diff', originalUri, fileUri, title, {
            preview: false
        });
        
        // 5. 监听文档保存事件（用户手动 CTRL+S）
        // 当用户手动保存时，调用 acceptDiff 完成后端状态更新，然后通知前端更新 UI
        const saveListener = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
            if (savedDoc.uri.fsPath === diff.absolutePath && diff.status === 'pending') {
                // 调用 acceptDiff 完成后端处理（移除监听器、更新状态、清理资源）
                // isAutoSave = false 保留用户编辑，closeTab = true 关闭标签页
                await this.acceptDiff(diff.id, true, false);

                // 通知前端更新 UI 状态（前端直接调用 markDiffAsAccepted，无需再调 API）
                this.notifyManualSave(diff);
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
            // 自动保存模式：传递 isAutoSave = true，使用 AI 建议的内容
            await this.acceptDiff(id, true, true);
            this.autoSaveTimers.delete(id);
        }, currentSettings.autoSaveDelay);

        this.autoSaveTimers.set(id, timer);
    }
    
    /**
     * 接受 diff（保存修改）
     * @param id diff ID
     * @param closeTab 是否关闭标签页
     * @param isAutoSave 是否为自动保存（自动保存时使用 AI 内容，手动保存时保留用户修改）
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

            const uri = vscode.Uri.file(diff.absolutePath);
            let doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath);

            // 如果文档未打开，先打开它
            if (!doc) {
                doc = await vscode.workspace.openTextDocument(uri);
            }

            const currentContent = doc.getText();

            // 判断是否需要覆盖用户修改
            if (isAutoSave) {
                // 自动保存模式：强制使用 AI 建议的内容
                if (currentContent !== diff.newContent) {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        doc.positionAt(0),
                        doc.positionAt(currentContent.length)
                    );
                    edit.replace(uri, fullRange, diff.newContent);
                    await vscode.workspace.applyEdit(edit);
                }
            } else {
                // 手动保存模式：保留用户的修改，记录用户编辑的内容
                // 使用标准化比较，忽略换行符差异（CRLF vs LF）
                const normalizedCurrent = currentContent.replace(/\r\n/g, '\n');
                const normalizedNew = diff.newContent.replace(/\r\n/g, '\n');
                const normalizedOriginal = diff.originalContent.replace(/\r\n/g, '\n');

                if (normalizedCurrent !== normalizedNew && normalizedCurrent !== normalizedOriginal) {
                    // 用户确实修改了内容，记录下来
                    diff.userEditedContent = currentContent;
                }
                // 不覆盖，直接使用当前编辑器中的内容
            }

            // 保存文档
            const saved = await doc.save();

            if (!saved) {
                // 如果 VSCode API 保存失败，尝试直接写入文件
                const contentToSave = isAutoSave ? diff.newContent : (diff.userEditedContent || diff.newContent);
                fs.writeFileSync(diff.absolutePath, contentToSave, 'utf8');
            }

            diff.status = 'accepted';
            this.cleanup(id);
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
     * 拒绝 diff（放弃修改，还原文件并关闭标签页）
     */
    public async rejectDiff(id: string): Promise<boolean> {
        const diff = this.pendingDiffs.get(id);
        if (!diff || diff.status !== 'pending') {
            return false;
        }

        try {
            // 重要：先将状态设置为 'rejected'，防止后续 doc.save() 触发的 onDidSaveTextDocument 事件
            // 错误地认为这是用户手动保存并调用 acceptDiff + notifyManualSave，导致重复发送请求
            diff.status = 'rejected';

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

            // 尝试还原文件到原始状态
            const uri = vscode.Uri.file(diff.absolutePath);
            let doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === diff.absolutePath);

            if (doc) {
                // 文档已打开，恢复到原始内容
                const currentContent = doc.getText();
                if (currentContent !== diff.originalContent) {
                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(
                        doc.positionAt(0),
                        doc.positionAt(currentContent.length)
                    );
                    edit.replace(uri, fullRange, diff.originalContent);
                    await vscode.workspace.applyEdit(edit);

                    // 保存还原后的文件（状态已为 rejected，不会触发 saveListener）
                    await doc.save();
                }
            } else {
                // 文档未打开，直接写入原始内容到磁盘
                const currentContent = fs.readFileSync(diff.absolutePath, 'utf8');
                if (currentContent !== diff.originalContent) {
                    fs.writeFileSync(diff.absolutePath, diff.originalContent, 'utf8');
                }
            }

            // 关闭 diff 标签页
            await this.closeDiffTab(diff.absolutePath);

            // 状态已在函数开头设置
            this.cleanup(id);
            this.notifyStatusChange();
            
            vscode.window.showInformationMessage(t('tools.file.diffManager.rejected', { filePath: diff.filePath }));
            
            return true;
        } catch (error) {
            // 即使还原失败，也标记为已拒绝
            diff.status = 'rejected';
            this.cleanup(id);
            this.notifyStatusChange();
            
            vscode.window.showErrorMessage(t('tools.file.diffManager.rejectFailed', { error: error instanceof Error ? error.message : String(error) }));
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
     * 用于用户发送新消息时清理未确认的 diff
     */
    public async cancelAllPending(): Promise<{ cancelled: PendingDiff[] }> {
        const cancelled: PendingDiff[] = [];
        
        for (const [id, diff] of this.pendingDiffs.entries()) {
            if (diff.status === 'pending') {
                diff.status = 'rejected';
                cancelled.push({ ...diff });
                this.cleanup(id);
                
                // 尝试恢复文件到原始状态
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
                } catch {
                    // 忽略恢复错误
                }
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
        const id = uri.path.split('/')[0];
        return this.contents.get(id) || '';
    }
}

/**
 * 获取 DiffManager 实例
 */
export function getDiffManager(): DiffManager {
    return DiffManager.getInstance();
}