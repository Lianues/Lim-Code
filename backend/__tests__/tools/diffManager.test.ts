import * as fs from 'fs';
import * as vscode from 'vscode';

jest.mock('fs', () => ({
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    existsSync: jest.fn(),
    unlinkSync: jest.fn()
}));

jest.mock('../../tools/file/DiffCodeLensProvider', () => ({
    getDiffCodeLensProvider: () => ({
        removeSession: jest.fn(),
        getSession: jest.fn(),
        getSessionByFilePath: jest.fn()
    })
}));

jest.mock('../../core/settingsContext', () => ({
    getGlobalSettingsManager: () => null
}));

jest.mock('../../tools/file/apply_diff', () => ({
    applyDiffToContent: jest.fn()
}));

jest.mock('../../tools/file/unifiedDiff', () => ({
    applyUnifiedDiffHunks: jest.fn()
}));

import { DiffManager, getDiffManager, type PendingDiff } from '../../tools/file/diffManager';

type MockTextDocument = {
    uri: { fsPath: string; scheme: string; path: string };
    isDirty: boolean;
    getText: () => string;
    setText: (next: string) => void;
    positionAt: (offset: number) => number;
    save: jest.Mock<Promise<boolean>, []>;
};

class MockWorkspaceEdit {
    public replacements: Array<{ uri: { fsPath: string }; text: string }> = [];

    public replace(uri: { fsPath: string }, _range: unknown, text: string): void {
        this.replacements.push({ uri, text });
    }
}

function resetDiffManagerSingleton(): void {
    const instance = (DiffManager as any).instance as { dispose?: () => void } | null;
    if (instance?.dispose) {
        instance.dispose();
    }
    (DiffManager as any).instance = null;
}

function getManager(): DiffManager {
    return getDiffManager();
}

function createDocument(options?: {
    filePath?: string;
    initialContent?: string;
    saveReturns?: boolean;
}): MockTextDocument {
    const filePath = options?.filePath ?? 'C:/tmp/file.ts';
    let text = options?.initialContent ?? 'original';
    let dirty = false;

    const doc: MockTextDocument = {
        uri: { fsPath: filePath, scheme: 'file', path: filePath },
        get isDirty() {
            return dirty;
        },
        set isDirty(value: boolean) {
            dirty = value;
        },
        getText: () => text,
        setText: (next: string) => {
            text = next;
            dirty = true;
        },
        positionAt: (offset: number) => offset,
        save: jest.fn(async () => {
            if (options?.saveReturns === false) {
                return false;
            }
            dirty = false;
            return true;
        })
    };

    (vscode.workspace as any).textDocuments = [doc];
    (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(doc);
    return doc;
}

function createPendingDiff(manager: DiffManager, overrides?: Partial<PendingDiff>): PendingDiff {
    const diff: PendingDiff = {
        id: overrides?.id ?? 'diff-1',
        filePath: overrides?.filePath ?? 'src/file.ts',
        absolutePath: overrides?.absolutePath ?? 'C:/tmp/file.ts',
        originalContent: overrides?.originalContent ?? 'original',
        newContent: overrides?.newContent ?? 'accepted',
        timestamp: overrides?.timestamp ?? Date.now(),
        status: overrides?.status ?? 'pending',
        blocks: overrides?.blocks,
        rawDiffs: overrides?.rawDiffs,
        toolId: overrides?.toolId,
        userEditedContent: overrides?.userEditedContent,
        diffGuardWarning: overrides?.diffGuardWarning,
        diffGuardDeletePercent: overrides?.diffGuardDeletePercent,
        autoSaveError: overrides?.autoSaveError
    };

    ((manager as any).pendingDiffs as Map<string, PendingDiff>).set(diff.id, diff);
    return diff;
}

function attachListenerDisposables(manager: DiffManager, id: string) {
    const saveDisposable = { dispose: jest.fn() };
    const closeDisposable = { dispose: jest.fn() };

    ((manager as any).saveListeners as Map<string, { dispose: () => void }>).set(id, saveDisposable);
    ((manager as any).closeListeners as Map<string, { dispose: () => void }>).set(id, closeDisposable);

    return { saveDisposable, closeDisposable };
}

describe('DiffManager lifecycle closure', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        resetDiffManagerSingleton();

        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        (vscode as any).EventEmitter = class {
            public event = jest.fn();
            public fire = jest.fn();
            public dispose = jest.fn();
        };
        (vscode as any).WorkspaceEdit = MockWorkspaceEdit;
        (vscode as any).Range = jest.fn().mockImplementation((start: unknown, end: unknown) => ({ start, end }));
        (vscode as any).TabInputTextDiff = class {};
        (vscode as any).TextEdit = {
            replace: jest.fn((range: unknown, newText: string) => ({ range, newText }))
        };
        (vscode.Uri as any).parse = (value: string) => ({ fsPath: value, scheme: 'file', path: value });
        (vscode.Uri as any).file = (value: string) => ({ fsPath: value, scheme: 'file', path: value });
        (vscode as any).TextDocumentSaveReason = { Manual: 1, AfterDelay: 2, FocusOut: 3 };

        (vscode.workspace as any).textDocuments = [];
        (vscode.workspace as any).registerTextDocumentContentProvider = jest.fn(() => ({ dispose: jest.fn() }));
        (vscode.workspace as any).openTextDocument = jest.fn();
        (vscode.workspace as any).applyEdit = jest.fn(async (edit: MockWorkspaceEdit) => {
            const doc = ((vscode.workspace as any).textDocuments as MockTextDocument[])[0];
            const replacement = edit.replacements[0];
            if (doc && replacement && replacement.uri.fsPath === doc.uri.fsPath) {
                doc.setText(replacement.text);
            }
            return true;
        });
        (vscode.workspace as any).onDidSaveTextDocument = jest.fn(() => ({ dispose: jest.fn() }));
        (vscode.workspace as any).onWillSaveTextDocument = jest.fn(() => ({ dispose: jest.fn() }));
        (vscode.workspace as any).onDidCloseTextDocument = jest.fn(() => ({ dispose: jest.fn() }));

        (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);
        (vscode as any).window = {
            showTextDocument: jest.fn(async () => ({})),
            setStatusBarMessage: jest.fn(),
            showErrorMessage: jest.fn(),
            tabGroups: {
                all: [],
                close: jest.fn(async () => undefined)
            }
        };

        (fs.readFileSync as jest.Mock).mockReturnValue('original');
        (fs.writeFileSync as jest.Mock).mockImplementation(() => undefined);
        (fs.existsSync as jest.Mock).mockReturnValue(false);
        (fs.unlinkSync as jest.Mock).mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        resetDiffManagerSingleton();
    });

    it('acceptDiff finalizes accepted state and disposes listeners only after persistence succeeds', async () => {
        const manager = getManager();
        createDocument({ initialContent: 'original', saveReturns: true });
        const diff = createPendingDiff(manager, {
            originalContent: 'original',
            newContent: 'accepted'
        });
        const listeners = attachListenerDisposables(manager, diff.id);

        let statusChanges = 0;
        let saveCompleted = 0;
        manager.addStatusListener(() => {
            statusChanges += 1;
        });
        manager.addSaveCompleteListener(() => {
            saveCompleted += 1;
        });

        const accepted = await manager.acceptDiff(diff.id, false, false);

        expect(accepted).toBe(true);
        expect(diff.status).toBe('accepted');
        expect(statusChanges).toBe(1);
        expect(saveCompleted).toBe(1);
        expect(listeners.saveDisposable.dispose).toHaveBeenCalledTimes(1);
        expect(listeners.closeDisposable.dispose).toHaveBeenCalledTimes(1);
        expect((manager as any).saveListeners.has(diff.id)).toBe(false);
        expect((manager as any).closeListeners.has(diff.id)).toBe(false);
        expect(manager.isDiffActionInProgress(diff.id)).toBe(false);
    });

    it('serializes concurrent diff accept actions across different sessions', async () => {
        const manager = getManager();
        const docA = createDocument({ filePath: 'C:/tmp/a.ts', initialContent: 'original-a', saveReturns: true });
        const docB = createDocument({ filePath: 'C:/tmp/b.ts', initialContent: 'original-b', saveReturns: true });
        (vscode.workspace as any).textDocuments = [docA, docB];
        (vscode.workspace as any).applyEdit = jest.fn(async (edit: MockWorkspaceEdit) => {
            const replacement = edit.replacements[0];
            const doc = ((vscode.workspace as any).textDocuments as MockTextDocument[])
                .find(d => d.uri.fsPath === replacement?.uri.fsPath);
            if (doc && replacement) {
                doc.setText(replacement.text);
            }
            return true;
        });

        const diffA = createPendingDiff(manager, {
            id: 'diff-a',
            filePath: 'src/a.ts',
            absolutePath: 'C:/tmp/a.ts',
            originalContent: 'original-a',
            newContent: 'accepted-a'
        });
        const diffB = createPendingDiff(manager, {
            id: 'diff-b',
            filePath: 'src/b.ts',
            absolutePath: 'C:/tmp/b.ts',
            originalContent: 'original-b',
            newContent: 'accepted-b'
        });
        attachListenerDisposables(manager, diffA.id);
        attachListenerDisposables(manager, diffB.id);

        let releaseFirstSave!: (value: boolean) => void;
        const actionOrder: string[] = [];
        docA.save = jest.fn(async () => {
            actionOrder.push('save-a-start');
            return new Promise<boolean>((resolve) => {
                releaseFirstSave = (value) => {
                    actionOrder.push('save-a-end');
                    resolve(value);
                };
            });
        });
        docB.save = jest.fn(async () => {
            actionOrder.push('save-b');
            return true;
        });

        (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
            if (filePath === 'C:/tmp/a.ts') return 'original-a';
            if (filePath === 'C:/tmp/b.ts') return 'original-b';
            return 'original';
        });

        const acceptA = manager.acceptDiff(diffA.id, false, false);
        const acceptB = manager.acceptDiff(diffB.id, false, false);
        for (let i = 0; i < 10 && actionOrder.length === 0; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // 这个测试锁定 DiffManager 的全局串行队列。
        // 为什么要测两个不同 session：旧逻辑只按 diff id 防重入，两个文件的 accept 可同时操作 VS Code 文档、标签页和状态监听，固定 20ms 延迟无法保证顺序。
        // 怎么测：第一个保存被手动挂起；第二个 accept 已经发起但必须保持 pending，直到第一个保存释放后才能进入。
        // 目的：确保前端按钮、自动保存和 CodeLens 等入口共享确定的 diff 动作顺序。
        expect(manager.isDiffActionInProgress(diffA.id)).toBe(true);
        expect(manager.isDiffActionInProgress(diffB.id)).toBe(false);
        expect(diffB.status).toBe('pending');
        expect(actionOrder).toEqual(['save-a-start']);

        releaseFirstSave(true);
        await expect(acceptA).resolves.toBe(true);
        await expect(acceptB).resolves.toBe(true);

        expect(diffA.status).toBe('accepted');
        expect(diffB.status).toBe('accepted');
        expect(actionOrder).toEqual(['save-a-start', 'save-a-end', 'save-b']);
    });


    it('acceptDiff keeps the diff pending and preserves listeners when persistence fails', async () => {
        const manager = getManager();
        createDocument({ initialContent: 'original', saveReturns: false });
        const diff = createPendingDiff(manager, {
            originalContent: 'original',
            newContent: 'accepted'
        });
        const listeners = attachListenerDisposables(manager, diff.id);

        (fs.writeFileSync as jest.Mock).mockImplementation(() => {
            throw new Error('disk write failed');
        });

        let statusChanges = 0;
        let saveCompleted = 0;
        manager.addStatusListener(() => {
            statusChanges += 1;
        });
        manager.addSaveCompleteListener(() => {
            saveCompleted += 1;
        });

        const accepted = await manager.acceptDiff(diff.id, false, false);

        expect(accepted).toBe(false);
        expect(diff.status).toBe('pending');
        expect(statusChanges).toBe(0);
        expect(saveCompleted).toBe(0);
        expect(listeners.saveDisposable.dispose).not.toHaveBeenCalled();
        expect(listeners.closeDisposable.dispose).not.toHaveBeenCalled();
        expect((manager as any).saveListeners.get(diff.id)).toBe(listeners.saveDisposable);
        expect((manager as any).closeListeners.get(diff.id)).toBe(listeners.closeDisposable);
        expect(manager.isDiffActionInProgress(diff.id)).toBe(false);
        expect((vscode.window as any).showErrorMessage).toHaveBeenCalled();
    });

    it('rejectDiff finalizes rejected state and disposes listeners on success', async () => {
        const manager = getManager();
        const doc = createDocument({ initialContent: 'accepted', saveReturns: true });
        const diff = createPendingDiff(manager, {
            originalContent: 'original',
            newContent: 'accepted'
        });
        const listeners = attachListenerDisposables(manager, diff.id);

        let statusChanges = 0;
        manager.addStatusListener(() => {
            statusChanges += 1;
        });

        const rejected = await manager.rejectDiff(diff.id);

        expect(rejected).toBe(true);
        expect(diff.status).toBe('rejected');
        expect(doc.getText()).toBe('original');
        expect(statusChanges).toBe(1);
        expect(listeners.saveDisposable.dispose).toHaveBeenCalledTimes(1);
        expect(listeners.closeDisposable.dispose).toHaveBeenCalledTimes(1);
        expect((manager as any).saveListeners.has(diff.id)).toBe(false);
        expect((manager as any).closeListeners.has(diff.id)).toBe(false);
        expect(manager.isDiffActionInProgress(diff.id)).toBe(false);
    });

    it('createPendingDiff keeps the diff pending when opening the diff view fails', async () => {
        const manager = getManager();
        const statusListener = jest.fn();
        manager.addStatusListener(statusListener);

        jest.spyOn(manager as any, 'showDiffView').mockRejectedValue(new Error('open diff failed'));

        const pendingDiff = await manager.createPendingDiff(
            'src/file.ts',
            'C:/tmp/file.ts',
            'original',
            'accepted',
            undefined,
            undefined,
            'tool-1'
        );

        expect(pendingDiff.status).toBe('pending');
        expect(manager.getDiff(pendingDiff.id)?.status).toBe('pending');
        expect(statusListener).toHaveBeenCalledTimes(1);
        expect(console.warn).toHaveBeenCalled();
    });

    it('auto-save failure rejects the diff to unblock waiting tool execution', async () => {
        jest.useFakeTimers();

        const manager = getManager();
        createDocument({ initialContent: 'original', saveReturns: false });
        const diff = createPendingDiff(manager, {
            originalContent: 'original',
            newContent: 'accepted'
        });
        const listeners = attachListenerDisposables(manager, diff.id);

        (fs.writeFileSync as jest.Mock).mockImplementation(() => {
            throw new Error('auto-save disk write failed');
        });

        let statusChanges = 0;
        manager.addStatusListener(() => {
            statusChanges += 1;
        });

        manager.updateSettings({ autoSave: true, autoSaveDelay: 5 });
        (manager as any).scheduleAutoSave(diff.id);

        await jest.advanceTimersByTimeAsync(10);
        await Promise.resolve();

        // autoSave=true 是自动确认承诺，失败也必须收敛。
        // 为什么不允许保持 pending：apply_diff/write_file 等 handler 正在等待 diff 状态结束，pending 会让流式提前执行一直卡住。
        // 怎么验证：自动保存失败后应标记 rejected、释放监听器、清掉计时器并触发状态变更。
        // 目的：防止“自动确认失败但工具 Promise 永不结束”的回归。
        expect(diff.status).toBe('rejected');
        expect(diff.autoSaveError).toContain('auto-save disk write failed');
        expect((manager as any).autoSaveTimers.has(diff.id)).toBe(false);
        expect(listeners.saveDisposable.dispose).toHaveBeenCalled();
        expect(listeners.closeDisposable.dispose).toHaveBeenCalled();
        expect((manager as any).saveListeners.has(diff.id)).toBe(false);
        expect((manager as any).closeListeners.has(diff.id)).toBe(false);
        expect(manager.isDiffActionInProgress(diff.id)).toBe(false);
        expect(statusChanges).toBeGreaterThan(0);
        expect((vscode.window as any).showErrorMessage).toHaveBeenCalled();
    });

    it('waitForDiffResolution resolves on user interrupt even when no status event is emitted', async () => {
        jest.useFakeTimers();

        const manager = getManager();
        createDocument({ initialContent: 'accepted', saveReturns: true });
        const diff = createPendingDiff(manager, {
            originalContent: 'original',
            newContent: 'accepted'
        });

        try {
            const waitPromise = manager.waitForDiffResolution(diff.id);

            // 为什么这个测试不主动调用 notifyStatusChange：真实卡住路径里 markUserInterrupt 只清理自动保存定时器，
            // 不保证立刻产生 diff 状态事件；旧 apply_diff 只靠 listener 就会一直等待。
            // 怎么验证：只设置用户中断标记，然后推进轮询时间，确认统一等待方法自行收敛。
            // 目的：锁住“用户新请求中断 pending diff 时工具 Promise 必须释放”的回归场景。
            manager.markUserInterrupt();
            await jest.advanceTimersByTimeAsync(100);

            await expect(waitPromise).resolves.toBe('user');
        } finally {
            manager.resetUserInterrupt();
        }
    });

    it('non-manual save keeps the diff pending and restores the draft in manual mode', async () => {
        const manager = getManager();
        const doc = createDocument({ initialContent: 'original', saveReturns: true });
        const diff = createPendingDiff(manager, {
            originalContent: 'original',
            newContent: 'accepted'
        });

        let willSaveHandler: ((event: any) => void) | undefined;
        let didSaveHandler: ((savedDoc: any) => Promise<void>) | undefined;

        (vscode.workspace as any).onWillSaveTextDocument = jest.fn((listener: (event: any) => void) => {
            willSaveHandler = listener;
            return { dispose: jest.fn() };
        });
        (vscode.workspace as any).onDidSaveTextDocument = jest.fn((listener: (savedDoc: any) => Promise<void>) => {
            didSaveHandler = listener;
            return { dispose: jest.fn() };
        });

        (vscode.window as any).showTextDocument = jest.fn(async () => ({
            edit: async (callback: (editBuilder: { replace: (range: unknown, text: string) => void }) => void) => {
                callback({
                    replace: (_range: unknown, text: string) => {
                        doc.setText(text);
                    }
                });
                return true;
            }
        }));

        let statusChanges = 0;
        manager.addStatusListener(() => {
            statusChanges += 1;
        });

        await (manager as any).showDiffView(diff);

        expect(doc.getText()).toBe('accepted');
        expect(diff.status).toBe('pending');
        expect(typeof willSaveHandler).toBe('function');
        expect(typeof didSaveHandler).toBe('function');

        let pendingWillSaveEdits: Promise<Array<{ newText: string }>> | undefined;
        willSaveHandler?.({
            document: doc,
            reason: (vscode as any).TextDocumentSaveReason.FocusOut,
            waitUntil: (thenable: Promise<Array<{ newText: string }>>) => {
                pendingWillSaveEdits = Promise.resolve(thenable);
            }
        });

        const willSaveEdits = await pendingWillSaveEdits;
        expect(willSaveEdits).toEqual([
            expect.objectContaining({ newText: 'original' })
        ]);

        doc.setText('original');
        doc.isDirty = false;
        await didSaveHandler?.(doc);

        expect(diff.status).toBe('pending');
        expect(statusChanges).toBe(0);
        expect(doc.getText()).toBe('accepted');
        expect(doc.isDirty).toBe(true);
        expect((manager as any).saveListeners.has(diff.id)).toBe(true);
        expect((manager as any).willSaveListeners.has(diff.id)).toBe(true);
    });
});
