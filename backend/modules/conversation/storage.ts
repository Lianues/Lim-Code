/**
 * LimCode - 存储适配器接口
 * 
 * 存储格式说明:
 * - 对话历史: 完整的 Gemini Content[] 格式
 * - 文件命名: {conversationId}.json
 * - 元数据: 单独存储在 {conversationId}.meta.json
 * 
 * 这样设计的优势:
 * 1. 历史文件可直接用于 Gemini API
 * 2. 完整保留所有 Gemini 特性(函数调用、思考签名等)
 * 3. 元数据与历史分离,便于管理
 */

import { ConversationHistory, ConversationMetadata, HistorySnapshot, Content } from './types';

export type StorageReadErrorCode = 'not_found' | 'parse_error' | 'io_error';

export interface StorageReadResult<T> {
    value: T | null;
    errorCode?: StorageReadErrorCode;
    errorMessage?: string;
}

export interface StorageHistoryPage {
    total: number;
    startIndex: number;
    messages: ConversationHistory;
    format: 'paged' | 'legacy';
}

export interface ConversationStorageIntegrity {
    historyExists: boolean;
    metadataExists: boolean;
    historyReadable: boolean;
    metadataReadable: boolean;
    historyErrorCode?: StorageReadErrorCode;
    metadataErrorCode?: StorageReadErrorCode;
    historyErrorMessage?: string;
    metadataErrorMessage?: string;
}

export interface ConversationStorageLocation {
    /**
     * 文件管理器应该 reveal 的 URI。
     *
     * 修改原因：历史页按钮需要打开真实存储位置，但不同存储格式可能是 legacy 单文件或 segmented 目录。
     * 修改方式：由存储适配器返回已解析好的 revealUri，而不是让 webview handler 猜路径。
     * 修改目的：路径规则保持单一来源，后续存储格式升级时只改适配器。
     */
    revealUri: any;
    /** 展示给前端或日志的人类可读路径 */
    displayPath: string;
    /** 是否定位到了该 conversation 的具体文件或目录 */
    exists: boolean;
    /** 文件缺失或使用兜底目录时的提示 */
    warning?: string;
}

/**
 * 存储适配器接口
 * 
 * 职责:
 * - ConversationManager 负责内存中的状态管理
 * - StorageAdapter 负责持久化(保存到文件、数据库等)
 */
export interface IStorageAdapter {
    /**
     * 保存对话历史(Gemini 格式)
     * @param conversationId 对话 ID
     * @param history 对话历史(Gemini Content[])
     */
    saveHistory(conversationId: string, history: ConversationHistory): Promise<void>;
    
    /**
     * 加载对话历史
     * @param conversationId 对话 ID
     * @returns Gemini 格式的历史记录
     */
    loadHistory(conversationId: string): Promise<ConversationHistory | null>;
    loadHistoryWithStatus(conversationId: string): Promise<StorageReadResult<ConversationHistory>>;
    loadHistoryPage(conversationId: string, options?: { beforeIndex?: number; offset?: number; limit?: number }): Promise<StorageReadResult<StorageHistoryPage>>;
    
    /**
     * 删除对话历史
     * @param conversationId 对话 ID
     */
    deleteHistory(conversationId: string): Promise<void>;
    
    /**
     * 列出所有对话 ID
     */
    listConversations(): Promise<string[]>;
    
    /**
     * 保存对话元数据
     * @param metadata 元数据
     */
    saveMetadata(metadata: ConversationMetadata): Promise<void>;
    
    /**
     * 加载对话元数据
     * @param conversationId 对话 ID
     */
    loadMetadata(conversationId: string): Promise<ConversationMetadata | null>;
    loadMetadataWithStatus(conversationId: string): Promise<StorageReadResult<ConversationMetadata>>;
    getConversationIntegrity(conversationId: string): Promise<ConversationStorageIntegrity>;

    /**
     * 获取对话在本地文件系统中的可定位位置。
     *
     * 修改原因：历史 UI 需要“在文件管理器中显示”对话记录，但 handler 不应该复制存储路径规则。
     * 修改方式：文件系统适配器实现该可选窄接口；非文件系统存储可不实现。
     * 修改目的：保持存储布局的单一来源，并让按钮在 legacy/segmented 两种格式下都可用。
     */
    getConversationStorageLocation?(conversationId: string): Promise<ConversationStorageLocation | null>;
    
    /**
     * 保存快照
     * @param snapshot 快照数据
     */
    saveSnapshot(snapshot: HistorySnapshot): Promise<void>;
    
    /**
     * 加载快照
     * @param snapshotId 快照 ID
     */
    loadSnapshot(snapshotId: string): Promise<HistorySnapshot | null>;
    
    /**
     * 删除快照
     * @param snapshotId 快照 ID
     */
    deleteSnapshot(snapshotId: string): Promise<void>;
    
    /**
     * 列出对话的所有快照
     * @param conversationId 对话 ID
     */
    listSnapshots(conversationId: string): Promise<string[]>;
}

/**
 * 内存存储适配器（用于测试或临时存储）
 */
export class MemoryStorageAdapter implements IStorageAdapter {
    private histories: Map<string, ConversationHistory> = new Map();
    private metadata: Map<string, ConversationMetadata> = new Map();
    private snapshots: Map<string, HistorySnapshot> = new Map();

    async saveHistory(conversationId: string, history: ConversationHistory): Promise<void> {
        // 深拷贝以避免引用问题
        this.histories.set(conversationId, JSON.parse(JSON.stringify(history)));
    }

    async loadHistory(conversationId: string): Promise<ConversationHistory | null> {
        const history = this.histories.get(conversationId);
        return history ? JSON.parse(JSON.stringify(history)) : null;
    }

    async loadHistoryWithStatus(conversationId: string): Promise<StorageReadResult<ConversationHistory>> {
        const value = await this.loadHistory(conversationId);
        if (!value) {
            return { value: null, errorCode: 'not_found' };
        }
        return { value };
    }

    async loadHistoryPage(
        conversationId: string,
        options: { beforeIndex?: number; offset?: number; limit?: number } = {}
    ): Promise<StorageReadResult<StorageHistoryPage>> {
        const historyResult = await this.loadHistoryWithStatus(conversationId);
        if (!historyResult.value) {
            return { value: null, errorCode: historyResult.errorCode, errorMessage: historyResult.errorMessage };
        }

        const history = historyResult.value;
        const total = history.length;
        const limit = Math.max(1, Math.min(options.limit ?? 120, 1000));
        let startIndex = 0;
        let endExclusive = total;
        if (typeof options.beforeIndex === 'number' && Number.isFinite(options.beforeIndex)) {
            endExclusive = Math.max(0, Math.min(total, Math.floor(options.beforeIndex)));
            startIndex = Math.max(0, endExclusive - limit);
        } else if (typeof options.offset === 'number' && Number.isFinite(options.offset)) {
            startIndex = Math.max(0, Math.min(total, Math.floor(options.offset)));
            endExclusive = Math.max(startIndex, Math.min(total, startIndex + limit));
        } else { startIndex = Math.max(0, total - limit); }
        return { value: { total, startIndex, messages: JSON.parse(JSON.stringify(history.slice(startIndex, endExclusive))), format: 'legacy' } };
    }

    async deleteHistory(conversationId: string): Promise<void> {
        this.histories.delete(conversationId);
        this.metadata.delete(conversationId);
    }

    async listConversations(): Promise<string[]> {
        return Array.from(this.histories.keys());
    }

    async saveMetadata(metadata: ConversationMetadata): Promise<void> {
        this.metadata.set(metadata.id, JSON.parse(JSON.stringify(metadata)));
    }

    async loadMetadata(conversationId: string): Promise<ConversationMetadata | null> {
        const meta = this.metadata.get(conversationId);
        return meta ? JSON.parse(JSON.stringify(meta)) : null;
    }

    async loadMetadataWithStatus(conversationId: string): Promise<StorageReadResult<ConversationMetadata>> {
        const value = await this.loadMetadata(conversationId);
        if (!value) {
            return { value: null, errorCode: 'not_found' };
        }
        return { value };
    }

    async getConversationIntegrity(conversationId: string): Promise<ConversationStorageIntegrity> {
        const historyExists = this.histories.has(conversationId);
        const metadataExists = this.metadata.has(conversationId);
        return {
            historyExists,
            metadataExists,
            historyReadable: historyExists,
            metadataReadable: metadataExists,
            historyErrorCode: historyExists ? undefined : 'not_found',
            metadataErrorCode: metadataExists ? undefined : 'not_found',
        };
    }

    async saveSnapshot(snapshot: HistorySnapshot): Promise<void> {
        this.snapshots.set(snapshot.id, JSON.parse(JSON.stringify(snapshot)));
    }

    async loadSnapshot(snapshotId: string): Promise<HistorySnapshot | null> {
        const snapshot = this.snapshots.get(snapshotId);
        return snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
    }

    async deleteSnapshot(snapshotId: string): Promise<void> {
        this.snapshots.delete(snapshotId);
    }

    async listSnapshots(conversationId: string): Promise<string[]> {
        const snapshots = Array.from(this.snapshots.values());
        return snapshots
            .filter(s => s.conversationId === conversationId)
            .map(s => s.id);
    }

    /**
     * 清空所有数据
     */
    clear(): void {
        this.histories.clear();
        this.metadata.clear();
        this.snapshots.clear();
    }
}

/**
 * VS Code ExtensionContext 存储适配器
 * 使用 VS Code 的 globalState 或 workspaceState
 */
export class VSCodeStorageAdapter implements IStorageAdapter {
    constructor(
        private context: any // vscode.ExtensionContext
    ) {}

    async saveHistory(conversationId: string, history: ConversationHistory): Promise<void> {
        const key = `limcode.history.${conversationId}`;
        await this.context.globalState.update(key, history);
        
        // 更新元数据的 updatedAt
        const metaKey = `limcode.meta.${conversationId}`;
        const meta = this.context.globalState.get(metaKey) as ConversationMetadata | undefined;
        if (meta) {
            meta.updatedAt = Date.now();
            await this.context.globalState.update(metaKey, meta);
        }
    }

    async loadHistory(conversationId: string): Promise<ConversationHistory | null> {
        const key = `limcode.history.${conversationId}`;
        return (this.context.globalState.get(key) as ConversationHistory | undefined) || null;
    }

    async loadHistoryWithStatus(conversationId: string): Promise<StorageReadResult<ConversationHistory>> {
        const value = await this.loadHistory(conversationId);
        if (!value) {
            return { value: null, errorCode: 'not_found' };
        }
        return { value };
    }

    async loadHistoryPage(
        conversationId: string,
        options: { beforeIndex?: number; offset?: number; limit?: number } = {}
    ): Promise<StorageReadResult<StorageHistoryPage>> {
        const historyResult = await this.loadHistoryWithStatus(conversationId);
        if (!historyResult.value) {
            return { value: null, errorCode: historyResult.errorCode, errorMessage: historyResult.errorMessage };
        }

        const history = historyResult.value;
        const total = history.length;
        const limit = Math.max(1, Math.min(options.limit ?? 120, 1000));
        let startIndex = 0;
        let endExclusive = total;
        if (typeof options.beforeIndex === 'number' && Number.isFinite(options.beforeIndex)) {
            endExclusive = Math.max(0, Math.min(total, Math.floor(options.beforeIndex)));
            startIndex = Math.max(0, endExclusive - limit);
        } else if (typeof options.offset === 'number' && Number.isFinite(options.offset)) {
            startIndex = Math.max(0, Math.min(total, Math.floor(options.offset)));
            endExclusive = Math.max(startIndex, Math.min(total, startIndex + limit));
        } else { startIndex = Math.max(0, total - limit); }
        return { value: { total, startIndex, messages: JSON.parse(JSON.stringify(history.slice(startIndex, endExclusive))), format: 'legacy' } };
    }

    async deleteHistory(conversationId: string): Promise<void> {
        const historyKey = `limcode.history.${conversationId}`;
        const metaKey = `limcode.meta.${conversationId}`;
        await this.context.globalState.update(historyKey, undefined);
        await this.context.globalState.update(metaKey, undefined);
    }

    async listConversations(): Promise<string[]> {
        const keys = this.context.globalState.keys();
        return keys
            .filter((k: string) => k.startsWith('limcode.history.'))
            .map((k: string) => k.replace('limcode.history.', ''));
    }

    async saveMetadata(metadata: ConversationMetadata): Promise<void> {
        const key = `limcode.meta.${metadata.id}`;
        await this.context.globalState.update(key, metadata);
    }

    async loadMetadata(conversationId: string): Promise<ConversationMetadata | null> {
        const key = `limcode.meta.${conversationId}`;
        return (this.context.globalState.get(key) as ConversationMetadata | undefined) || null;
    }

    async loadMetadataWithStatus(conversationId: string): Promise<StorageReadResult<ConversationMetadata>> {
        const value = await this.loadMetadata(conversationId);
        if (!value) {
            return { value: null, errorCode: 'not_found' };
        }
        return { value };
    }

    async getConversationIntegrity(conversationId: string): Promise<ConversationStorageIntegrity> {
        const history = await this.loadHistoryWithStatus(conversationId);
        const metadata = await this.loadMetadataWithStatus(conversationId);
        const historyExists = history.value !== null || history.errorCode !== 'not_found';
        const metadataExists = metadata.value !== null || metadata.errorCode !== 'not_found';
        return {
            historyExists,
            metadataExists,
            historyReadable: history.value !== null,
            metadataReadable: metadata.value !== null,
            historyErrorCode: history.errorCode,
            metadataErrorCode: metadata.errorCode,
            historyErrorMessage: history.errorMessage,
            metadataErrorMessage: metadata.errorMessage,
        };
    }

    async saveSnapshot(snapshot: HistorySnapshot): Promise<void> {
        const key = `limcode.snapshot.${snapshot.id}`;
        await this.context.globalState.update(key, snapshot);
    }

    async loadSnapshot(snapshotId: string): Promise<HistorySnapshot | null> {
        const key = `limcode.snapshot.${snapshotId}`;
        return (this.context.globalState.get(key) as HistorySnapshot | undefined) || null;
    }

    async deleteSnapshot(snapshotId: string): Promise<void> {
        const key = `limcode.snapshot.${snapshotId}`;
        await this.context.globalState.update(key, undefined);
    }

    async listSnapshots(conversationId: string): Promise<string[]> {
        const keys = this.context.globalState.keys();
        const snapshotKeys = keys.filter((k: string) => k.startsWith('limcode.snapshot.'));
        
        const snapshots: string[] = [];
        for (const key of snapshotKeys) {
            const snapshot = this.context.globalState.get(key) as HistorySnapshot | undefined;
            if (snapshot && snapshot.conversationId === conversationId) {
                snapshots.push(snapshot.id);
            }
        }
        return snapshots;
    }
}

interface FileHistorySegmentIndexEntry {
    file: string;
    startIndex: number;
    endIndex: number;
    count: number;
}

interface FileHistoryIndex {
    version: 1;
    segmentSize: number;
    totalMessages: number;
    segments: FileHistorySegmentIndexEntry[];
}

/**
 * 文件系统存储适配器（使用 VS Code workspace.fs API）
 * 
 * 文件结构:
 * - {baseDir}/conversations/{conversationId}.json        # 旧版对话历史(Gemini 格式，向后兼容)
 * - {baseDir}/conversations/{conversationId}.meta.json   # 对话元数据
 * - {baseDir}/conversations/{conversationId}/history.index.json
 * - {baseDir}/conversations/{conversationId}/history/*.ndjson
 * - {baseDir}/snapshots/{snapshotId}.json                # 快照
 */
export class FileSystemStorageAdapter implements IStorageAdapter {
    private static readonly HISTORY_SEGMENT_SIZE = 200;

    constructor(
        private vscode: any, // VS Code API
        private baseDir: string // 存储目录的 URI
    ) {}

    private getLegacyHistoryPath(conversationId: string): any {
        return this.vscode.Uri.joinPath(
            this.vscode.Uri.parse(this.baseDir),
            'conversations',
            `${conversationId}.json`
        );
    }

    private getConversationDir(conversationId: string): any {
        return this.vscode.Uri.joinPath(
            this.vscode.Uri.parse(this.baseDir),
            'conversations',
            conversationId
        );
    }

    private getHistoryDir(conversationId: string): any {
        return this.vscode.Uri.joinPath(this.getConversationDir(conversationId), 'history');
    }

    private getHistoryIndexPath(conversationId: string): any {
        return this.vscode.Uri.joinPath(this.getConversationDir(conversationId), 'history.index.json');
    }

    private getMetadataPath(conversationId: string): any {
        return this.vscode.Uri.joinPath(
            this.vscode.Uri.parse(this.baseDir),
            'conversations',
            `${conversationId}.meta.json`
        );
    }

    private getSnapshotPath(snapshotId: string): any {
        return this.vscode.Uri.joinPath(
            this.vscode.Uri.parse(this.baseDir),
            'snapshots',
            `${snapshotId}.json`
        );
    }

    private getConversationsRootDir(): any {
        // 修改原因：reveal 兜底需要打开 conversations 根目录，而不是在 handler 中拼接存储路径。
        // 修改方式：把 root URI 构造留在 FileSystemStorageAdapter 内部复用 baseDir 和 VS Code Uri API。
        // 修改目的：所有 conversation 存储路径规则集中在存储适配器里维护。
        return this.vscode.Uri.joinPath(
            this.vscode.Uri.parse(this.baseDir),
            'conversations'
        );
    }

    private isNotFoundError(error: any): boolean {
        const code = String(error?.code || '');
        if (code === 'FileNotFound' || code === 'EntryNotFound' || code === 'ENOENT') {
            return true;
        }
        const name = String(error?.name || '');
        if (name.includes('EntryNotFound')) {
            return true;
        }
        const message = String(error?.message || '').toLowerCase();
        return (
            message.includes('entrynotfound') ||
            message.includes('enoent') ||
            message.includes('file not found')
        );
    }

    private async exists(uri: any): Promise<boolean> {
        try { await this.vscode.workspace.fs.stat(uri); return true; }
        catch { return false; }
    }

    async getConversationStorageLocation(conversationId: string): Promise<ConversationStorageLocation> {
        // 修改原因：历史页“在文件管理器中显示”需要优先定位真实存在的对话存储文件。
        // 修改方式：按当前存储格式优先级选择 segmented history.index.json，其次 legacy history，再其次 metadata；全部缺失时回退到 conversations 根目录。
        // 修改目的：支持新旧存储格式，同时在文件缺失时给用户明确反馈而不是静默无效。
        const historyIndexUri = this.getHistoryIndexPath(conversationId);
        const legacyHistoryUri = this.getLegacyHistoryPath(conversationId);
        const metadataUri = this.getMetadataPath(conversationId);
        const conversationDir = this.getConversationDir(conversationId);
        const conversationsRoot = this.getConversationsRootDir();

        if (await this.exists(historyIndexUri)) {
            return { revealUri: historyIndexUri, displayPath: historyIndexUri.fsPath || historyIndexUri.toString(), exists: true };
        }
        if (await this.exists(legacyHistoryUri)) {
            return { revealUri: legacyHistoryUri, displayPath: legacyHistoryUri.fsPath || legacyHistoryUri.toString(), exists: true };
        }
        if (await this.exists(metadataUri)) {
            return { revealUri: metadataUri, displayPath: metadataUri.fsPath || metadataUri.toString(), exists: true };
        }
        if (await this.exists(conversationDir)) {
            return {
                revealUri: conversationDir,
                displayPath: conversationDir.fsPath || conversationDir.toString(),
                exists: false,
                warning: `Conversation storage files are missing for ${conversationId}; opened the conversation directory instead.`
            };
        }
        return {
            revealUri: conversationsRoot,
            displayPath: conversationsRoot.fsPath || conversationsRoot.toString(),
            exists: false,
            warning: `Conversation storage files are missing for ${conversationId}; opened the conversations directory instead.`
        };
    }

    private async readJsonFile<T>(uri: any): Promise<StorageReadResult<T>> {
        try {
            const content = await this.vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf8');
            try {
                return { value: JSON.parse(text) as T };
            } catch (parseError: any) {
                return {
                    value: null,
                    errorCode: 'parse_error',
                    errorMessage: parseError?.message || 'Failed to parse JSON',
                };
            }
        } catch (error: any) {
            if (this.isNotFoundError(error)) {
                return {
                    value: null,
                    errorCode: 'not_found',
                    errorMessage: error?.message,
                };
            }
            return {
                value: null,
                errorCode: 'io_error',
                errorMessage: error?.message || String(error),
            };
        }
    }

    private buildPageRange(total: number, options: { beforeIndex?: number; offset?: number; limit?: number }) {
        const limit = Math.max(1, Math.min(options.limit ?? 120, 1000));
        let startIndex = 0;
        let endExclusive = total;

        if (typeof options.beforeIndex === 'number' && Number.isFinite(options.beforeIndex)) {
            endExclusive = Math.max(0, Math.min(total, Math.floor(options.beforeIndex)));
            startIndex = Math.max(0, endExclusive - limit);
        } else if (typeof options.offset === 'number' && Number.isFinite(options.offset)) {
            startIndex = Math.max(0, Math.min(total, Math.floor(options.offset)));
            endExclusive = Math.max(startIndex, Math.min(total, startIndex + limit));
        } else {
            startIndex = Math.max(0, total - limit);
            endExclusive = total;
        }

        return { startIndex, endExclusive };
    }

    private async readHistorySegment(uri: any): Promise<StorageReadResult<ConversationHistory>> {
        try {
            const content = await this.vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString('utf8');
            if (!text.trim()) {
                return { value: [] };
            }

            const messages: ConversationHistory = [];
            for (const rawLine of text.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line) continue;
                try {
                    messages.push(JSON.parse(line) as Content);
                } catch (parseError: any) {
                    return {
                        value: null,
                        errorCode: 'parse_error',
                        errorMessage: parseError?.message || 'Failed to parse history segment',
                    };
                }
            }

            return { value: messages };
        } catch (error: any) {
            if (this.isNotFoundError(error)) {
                return {
                    value: null,
                    errorCode: 'not_found',
                    errorMessage: error?.message,
                };
            }
            return {
                value: null,
                errorCode: 'io_error',
                errorMessage: error?.message || String(error),
            };
        }
    }

    private async readHistoryIndex(conversationId: string): Promise<StorageReadResult<FileHistoryIndex>> {
        return await this.readJsonFile<FileHistoryIndex>(this.getHistoryIndexPath(conversationId));
    }

    private async writeSegmentedHistory(conversationId: string, history: ConversationHistory): Promise<void> {
        const conversationDir = this.getConversationDir(conversationId);
        const historyDir = this.getHistoryDir(conversationId);
        const historyIndexPath = this.getHistoryIndexPath(conversationId);

        await this.vscode.workspace.fs.createDirectory(conversationDir);
        try {
            await this.vscode.workspace.fs.delete(historyDir, { recursive: true, useTrash: false });
        } catch {
            // ignore
        }
        await this.vscode.workspace.fs.createDirectory(historyDir);

        const segments: FileHistorySegmentIndexEntry[] = [];
        for (let startIndex = 0; startIndex < history.length; startIndex += FileSystemStorageAdapter.HISTORY_SEGMENT_SIZE) {
            const endExclusive = Math.min(history.length, startIndex + FileSystemStorageAdapter.HISTORY_SEGMENT_SIZE);
            const chunk = history.slice(startIndex, endExclusive);
            const file = `${String(segments.length).padStart(6, '0')}.ndjson`;
            const uri = this.vscode.Uri.joinPath(historyDir, file);
            const content = chunk.map(item => JSON.stringify(item)).join('\n');
            await this.vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
            segments.push({ file, startIndex, endIndex: endExclusive - 1, count: chunk.length });
        }

        const index: FileHistoryIndex = {
            version: 1,
            segmentSize: FileSystemStorageAdapter.HISTORY_SEGMENT_SIZE,
            totalMessages: history.length,
            segments,
        };

        await this.vscode.workspace.fs.writeFile(historyIndexPath, Buffer.from(JSON.stringify(index, null, 2), 'utf8'));

        try {
            await this.vscode.workspace.fs.delete(this.getLegacyHistoryPath(conversationId), { useTrash: false });
        } catch {
            // ignore
        }
    }

    private async loadSegmentedHistory(conversationId: string): Promise<StorageReadResult<ConversationHistory>> {
        const indexResult = await this.readHistoryIndex(conversationId);
        if (!indexResult.value) {
            return { value: null, errorCode: indexResult.errorCode, errorMessage: indexResult.errorMessage };
        }

        const historyDir = this.getHistoryDir(conversationId);
        const history: ConversationHistory = [];
        for (const segment of indexResult.value.segments) {
            const segmentResult = await this.readHistorySegment(this.vscode.Uri.joinPath(historyDir, segment.file));
            if (!segmentResult.value) {
                return { value: null, errorCode: segmentResult.errorCode, errorMessage: segmentResult.errorMessage };
            }
            history.push(...segmentResult.value);
        }

        return { value: history };
    }

    private async loadSegmentedHistoryPage(
        conversationId: string,
        options: { beforeIndex?: number; offset?: number; limit?: number } = {}
    ): Promise<StorageReadResult<StorageHistoryPage>> {
        const indexResult = await this.readHistoryIndex(conversationId);
        if (!indexResult.value) {
            return { value: null, errorCode: indexResult.errorCode, errorMessage: indexResult.errorMessage };
        }

        const index = indexResult.value;
        const { startIndex, endExclusive } = this.buildPageRange(index.totalMessages, options);
        const historyDir = this.getHistoryDir(conversationId);
        const messages: ConversationHistory = [];

        for (const segment of index.segments) {
            if (segment.endIndex < startIndex || segment.startIndex >= endExclusive) continue;
            const segmentResult = await this.readHistorySegment(this.vscode.Uri.joinPath(historyDir, segment.file));
            if (!segmentResult.value) {
                return { value: null, errorCode: segmentResult.errorCode, errorMessage: segmentResult.errorMessage };
            }

            const localStart = Math.max(0, startIndex - segment.startIndex);
            const localEndExclusive = Math.min(segment.count, endExclusive - segment.startIndex);
            messages.push(...segmentResult.value.slice(localStart, localEndExclusive));
        }

        return {
            value: {
                total: index.totalMessages,
                startIndex,
                messages,
                format: 'paged'
            }
        };
    }

    async migrateLegacyConversationsToSegmented(progressCallback?: (status: { current: number; total: number; conversationId?: string }) => void): Promise<{
        migrated: number;
        skipped: number;
        failed: Array<{ conversationId: string; error: string }>;
    }> {
        const conversationIds = await this.listConversations();
        const failed: Array<{ conversationId: string; error: string }> = [];
        let migrated = 0;
        let skipped = 0;

        const resolvedLegacyIds: string[] = [];
        for (const id of conversationIds) {
            if (await this.exists(this.getLegacyHistoryPath(id))) {
                resolvedLegacyIds.push(id);
            }
        }

        const total = resolvedLegacyIds.length;
        for (let i = 0; i < resolvedLegacyIds.length; i++) {
            const conversationId = resolvedLegacyIds[i];
            progressCallback?.({ current: i + 1, total, conversationId });
            try {
                if (await this.exists(this.getHistoryIndexPath(conversationId))) {
                    await this.vscode.workspace.fs.delete(this.getLegacyHistoryPath(conversationId), { useTrash: false });
                    skipped++;
                    continue;
                }
                const historyResult = await this.readJsonFile<ConversationHistory>(this.getLegacyHistoryPath(conversationId));
                if (!historyResult.value) throw new Error(historyResult.errorMessage || historyResult.errorCode || 'Failed to read legacy history');
                await this.writeSegmentedHistory(conversationId, historyResult.value);
                migrated++;
            } catch (error: any) {
                failed.push({ conversationId, error: error?.message || String(error) });
            }
        }

        return { migrated, skipped, failed };
    }


    async saveHistory(conversationId: string, history: ConversationHistory): Promise<void> {
        await this.writeSegmentedHistory(conversationId, history);
        
        // 更新元数据的 updatedAt
        try {
            const meta = await this.loadMetadata(conversationId);
            if (meta) {
                meta.updatedAt = Date.now();
                await this.saveMetadata(meta);
            }
        } catch {
            // 忽略元数据更新失败
        }
    }

    async loadHistory(conversationId: string): Promise<ConversationHistory | null> {
        const result = await this.loadHistoryWithStatus(conversationId);
        return result.value;
    }

    async loadHistoryWithStatus(conversationId: string): Promise<StorageReadResult<ConversationHistory>> {
        if (await this.exists(this.getHistoryIndexPath(conversationId))) {
            return await this.loadSegmentedHistory(conversationId);
        }

        return await this.readJsonFile<ConversationHistory>(this.getLegacyHistoryPath(conversationId));
    }

    async loadHistoryPage(
        conversationId: string,
        options: { beforeIndex?: number; offset?: number; limit?: number } = {}
    ): Promise<StorageReadResult<StorageHistoryPage>> {
        if (await this.exists(this.getHistoryIndexPath(conversationId))) {
            return await this.loadSegmentedHistoryPage(conversationId, options);
        }

        const historyResult = await this.loadHistoryWithStatus(conversationId);
        if (!historyResult.value) {
            return { value: null, errorCode: historyResult.errorCode, errorMessage: historyResult.errorMessage };
        }

        const history = historyResult.value;
        const { startIndex, endExclusive } = this.buildPageRange(history.length, options);
        return {
            value: {
                total: history.length,
                startIndex,
                messages: history.slice(startIndex, endExclusive),
                format: 'legacy'
            }
        };
    }

    async deleteHistory(conversationId: string): Promise<void> {
        const historyUri = this.getLegacyHistoryPath(conversationId);
        const metaUri = this.getMetadataPath(conversationId);
        const conversationDir = this.getConversationDir(conversationId);
        try {
            await this.vscode.workspace.fs.delete(historyUri, { useTrash: false });
        } catch {
            // ignore
        }
        try {
            await this.vscode.workspace.fs.delete(conversationDir, { recursive: true, useTrash: false });
        } catch {
            // ignore
        }
        try {
            await this.vscode.workspace.fs.delete(metaUri, { useTrash: false });
        } catch {
            // ignore
        }
    }

    async listConversations(): Promise<string[]> {
        try {
            const dirUri = this.vscode.Uri.joinPath(
                this.vscode.Uri.parse(this.baseDir),
                'conversations'
            );
            const entries = await this.vscode.workspace.fs.readDirectory(dirUri);
            const ids = new Set<string>();
            for (const [name, type] of entries as Array<[string, number]>) {
                if (type === 1 && name.endsWith('.json') && !name.endsWith('.meta.json')) {
                    ids.add(name.replace('.json', ''));
                    continue;
                }
                if (type === 2) {
                    ids.add(name);
                }
            }
            return Array.from(ids);
        } catch {
            return [];
        }
    }

    async saveMetadata(metadata: ConversationMetadata): Promise<void> {
        const uri = this.getMetadataPath(metadata.id);
        const content = JSON.stringify(metadata, null, 2);
        await this.vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    }

    async loadMetadata(conversationId: string): Promise<ConversationMetadata | null> {
        const result = await this.loadMetadataWithStatus(conversationId);
        return result.value;
    }

    async loadMetadataWithStatus(conversationId: string): Promise<StorageReadResult<ConversationMetadata>> {
        const uri = this.getMetadataPath(conversationId);
        return await this.readJsonFile<ConversationMetadata>(uri);
    }

    async getConversationIntegrity(conversationId: string): Promise<ConversationStorageIntegrity> {
        const [history, metadata] = await Promise.all([
            this.loadHistoryWithStatus(conversationId),
            this.loadMetadataWithStatus(conversationId),
        ]);
        const historyExists = history.value !== null || history.errorCode !== 'not_found';
        const metadataExists = metadata.value !== null || metadata.errorCode !== 'not_found';
        return {
            historyExists,
            metadataExists,
            historyReadable: history.value !== null,
            metadataReadable: metadata.value !== null,
            historyErrorCode: history.errorCode,
            metadataErrorCode: metadata.errorCode,
            historyErrorMessage: history.errorMessage,
            metadataErrorMessage: metadata.errorMessage,
        };
    }

    async saveSnapshot(snapshot: HistorySnapshot): Promise<void> {
        const uri = this.getSnapshotPath(snapshot.id);
        const content = JSON.stringify(snapshot, null, 2);
        await this.vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    }

    async loadSnapshot(snapshotId: string): Promise<HistorySnapshot | null> {
        try {
            const uri = this.getSnapshotPath(snapshotId);
            const content = await this.vscode.workspace.fs.readFile(uri);
            return JSON.parse(Buffer.from(content).toString('utf8'));
        } catch {
            return null;
        }
    }

    async deleteSnapshot(snapshotId: string): Promise<void> {
        try {
            const uri = this.getSnapshotPath(snapshotId);
            await this.vscode.workspace.fs.delete(uri);
        } catch {
            // 文件不存在，忽略
        }
    }

    async listSnapshots(conversationId: string): Promise<string[]> {
        try {
            const dirUri = this.vscode.Uri.joinPath(
                this.vscode.Uri.parse(this.baseDir),
                'snapshots'
            );
            const entries = await this.vscode.workspace.fs.readDirectory(dirUri);
            
            const snapshots: string[] = [];
            for (const [name, type] of entries) {
                if (type === 1 && name.endsWith('.json')) {
                    const snapshotId = name.replace('.json', '');
                    const snapshot = await this.loadSnapshot(snapshotId);
                    if (snapshot && snapshot.conversationId === conversationId) {
                        snapshots.push(snapshotId);
                    }
                }
            }
            return snapshots;
        } catch {
            return [];
        }
    }
}
