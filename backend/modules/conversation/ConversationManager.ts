/**
 * LimCode - 对话历史管理器
 *
 * 核心职责:
 * - 管理 Gemini 格式的对话历史
 * - 提供类型安全的操作 API
 * - 维护对话元数据
 * - 支持持久化存储
 *
 * 存储格式:
 * - 历史: 完整的 Gemini Content[] 数组
 * - 元数据: 对话标题、创建时间等
 * - 快照: 历史的时间点副本
 */

import { t } from '../../i18n';
import {
    ConversationHistory,
    ConversationMetadata,
    Content,
    ContentPart,
    MessagePosition,
    MessageFilter,
    HistorySnapshot,
    ConversationStats
} from './types';
import type { IStorageAdapter } from './storage';
import { cleanFunctionResponseForAPI } from './helpers';

/**
 * 多模态能力（用于过滤历史中的多模态数据）
 */
export interface MultimodalCapability {
    /** 是否支持图片 */
    supportsImages: boolean;
    /** 是否支持文档（PDF） */
    supportsDocuments: boolean;
    /** 是否支持回传多模态数据到历史记录 */
    supportsHistoryMultimodal: boolean;
}

/**
 * 获取历史的选项
 */
export interface GetHistoryOptions {
    /** 是否包含当前轮次的思考内容（默认 false） */
    includeThoughts?: boolean;
    
    /** 是否发送历史思考内容（默认 false） */
    sendHistoryThoughts?: boolean;
    
    /** 是否发送历史思考签名（默认 false） */
    sendHistoryThoughtSignatures?: boolean;

    /** 是否发送当前轮次的思考内容（默认根据渠道决定） */
    sendCurrentThoughts?: boolean;

    /** 是否发送当前轮次的思考签名（默认根据渠道决定） */
    sendCurrentThoughtSignatures?: boolean;
    
    /** 渠道类型，用于选择对应格式的签名 */
    channelType?: 'gemini' | 'openai' | 'anthropic' | 'openai-responses' | 'custom';
    
    /**
     * 多模态能力（可选）
     *
     * 如果提供，将根据能力过滤历史中的多模态数据：
     * - 如果不支持 supportsHistoryMultimodal，则过滤所有历史中的 inlineData
     * - 如果不支持 supportsDocuments，则过滤文档类型的 inlineData
     * - 如果不支持 supportsImages，则过滤图片类型的 inlineData
     */
    multimodalCapability?: MultimodalCapability;
    
    /**
     * 历史思考回合数
     *
     * 控制发送多少轮非最新回合的历史对话思考：
     * - `-1`: 发送全部历史回合的思考（默认值）
     * - `0`: 不发送任何历史回合的思考
     * - 正数 `n`: 发送最近 n 轮非最新回合的思考（如 1 表示只发送倒数第二回合）
     *
     * 仅在 sendHistoryThoughts 或 sendHistoryThoughtSignatures 为 true 时生效
     */
    historyThinkingRounds?: number;
    
    /**
     * 起始索引（可选）
     *
     * 从指定索引开始获取历史，用于上下文裁剪。
     * 默认为 0（从头开始）。
     */
    startIndex?: number;
}

/**
 * 对话管理器
 *
 * 特点:
 * - 完整支持 Gemini 格式的所有特性
 * - 自动维护元数据
 * - 支持思考签名、函数调用等高级特性
 * - 可直接将历史发送给 Gemini API
 * - 无内存缓存，每次操作直接读写存储，确保数据一致性
 */
export class ConversationManager {
    constructor(private storage: IStorageAdapter) {}

    /**
     * 规范化历史：补齐未响应的工具调用（rejected + functionResponse 插入），并在必要时写回存储。
     *
     * 注意：此过程会改变 history 的长度，从而改变消息 index。
     * 前端依赖 index 进行删除/重试等操作，因此必须在返回前完成该规范化。
     */
    private async normalizeHistoryForDisplay(conversationId: string, history: ConversationHistory): Promise<ConversationHistory> {
        // 收集所有 functionResponse 的 ID
        const respondedToolCallIds = new Set<string>();
        for (const message of history) {
            if (message.parts) {
                for (const part of message.parts) {
                    if (part.functionResponse?.id) {
                        respondedToolCallIds.add(part.functionResponse.id);
                    }
                }
            }
        }

        // 收集未响应的工具调用，记录它们所在的消息索引
        const unresolvedCallsByIndex: Map<number, Array<{ id: string; name: string }>> = new Map();
        for (let i = 0; i < history.length; i++) {
            const message = history[i];
            if (message.parts) {
                for (const part of message.parts) {
                    if (part.functionCall && part.functionCall.id) {
                        // 如果工具调用没有对应的响应，且还没有被标记为 rejected
                        if (!respondedToolCallIds.has(part.functionCall.id) && !part.functionCall.rejected) {
                            part.functionCall.rejected = true;
                            const calls = unresolvedCallsByIndex.get(i) || [];
                            calls.push({
                                id: part.functionCall.id,
                                name: part.functionCall.name || 'unknown'
                            });
                            unresolvedCallsByIndex.set(i, calls);
                        }
                    }
                }
            }
        }

        // 如果有未响应的工具调用，在工具调用消息紧接后面插入 functionResponse
        // 从后往前插入以避免索引偏移问题
        if (unresolvedCallsByIndex.size > 0) {
            const sortedIndices = Array.from(unresolvedCallsByIndex.keys()).sort((a, b) => b - a);

            for (const messageIndex of sortedIndices) {
                const calls = unresolvedCallsByIndex.get(messageIndex)!;
                const rejectedResponseParts: ContentPart[] = calls.map(call => ({
                    functionResponse: {
                        name: call.name,
                        id: call.id,
                        response: {
                            success: false,
                            error: t('modules.api.chat.errors.userRejectedTool'),
                            rejected: true
                        }
                    }
                }));

                // 在工具调用消息的紧接后面插入
                history.splice(messageIndex + 1, 0, {
                    role: 'user',
                    parts: rejectedResponseParts,
                    isFunctionResponse: true
                });
            }

            await this.storage.saveHistory(conversationId, history);
        }

        return history;
    }

    // ==================== 对话管理 ====================

    /**
     * 创建新对话
     * @param conversationId 对话 ID
     * @param title 对话标题
     * @param workspaceUri 工作区 URI（可选）
     */
    async createConversation(conversationId: string, title?: string, workspaceUri?: string): Promise<void> {
        // 检查存储中是否已存在
        const existing = await this.storage.loadHistory(conversationId);
        if (existing) {
            throw new Error(t('modules.conversation.errors.conversationExists', { conversationId }));
        }

        const now = Date.now();
        const meta: ConversationMetadata = {
            id: conversationId,
            title: title || t('modules.conversation.defaultTitle', { conversationId }),
            createdAt: now,
            updatedAt: now,
            workspaceUri,
            custom: {}
        };

        await this.storage.saveHistory(conversationId, []);
        await this.storage.saveMetadata(meta);
    }

    /**
     * 删除对话
     */
    async deleteConversation(conversationId: string): Promise<void> {
        await this.storage.deleteHistory(conversationId);
    }

    /**
     * 列出所有对话
     */
    async listConversations(): Promise<string[]> {
        return await this.storage.listConversations();
    }

    /**
     * 加载对话历史（直接从存储读取）
     */
    private async loadHistory(conversationId: string): Promise<ConversationHistory> {
        const history = await this.storage.loadHistory(conversationId);
        if (!history) {
            // 如果不存在，创建空对话
            await this.createConversation(conversationId);
            return [];
        }
        return history;
    }

    /**
     * 获取对话历史的只读副本
     */
    async getHistory(conversationId: string): Promise<Readonly<ConversationHistory>> {
        const history = await this.loadHistory(conversationId);
        return JSON.parse(JSON.stringify(history));
    }

    /**
     * 获取对话历史的引用（用于直接发送给 API）
     * 注意: 每次调用都从存储读取最新数据
     */
    async getHistoryRef(conversationId: string): Promise<ConversationHistory> {
        return await this.loadHistory(conversationId);
    }

    // ==================== 消息操作 ====================

    /**
     * 添加消息（Gemini 格式）
     * 
     * @param conversationId 对话 ID
     * @param role 角色
     * @param parts 消息内容
     * @param metadata 可选的元数据（如 isUserInput）
     */
    async addMessage(
        conversationId: string,
        role: 'user' | 'model' | 'system',
        parts: ContentPart[],
        metadata?: Partial<Pick<Content, 'isUserInput' | 'isFunctionResponse' | 'isSummary'>>
    ): Promise<void> {
        const history = await this.loadHistory(conversationId);
        history.push({
            role,
            parts: JSON.parse(JSON.stringify(parts)),
            timestamp: Date.now(),  // 自动添加时间戳
            ...metadata  // 合并可选元数据
        });
        await this.storage.saveHistory(conversationId, history);
    }

    /**
     * 添加完整的 Content 对象
     */
    async addContent(conversationId: string, content: Content): Promise<void> {
        const history = await this.loadHistory(conversationId);
        const contentCopy = JSON.parse(JSON.stringify(content));
        // 如果没有时间戳，自动添加
        if (!contentCopy.timestamp) {
            contentCopy.timestamp = Date.now();
        }
        history.push(contentCopy);
        await this.storage.saveHistory(conversationId, history);
    }

    /**
     * 批量添加消息
     */
    async addBatch(conversationId: string, contents: Content[]): Promise<void> {
        const history = await this.loadHistory(conversationId);
        const now = Date.now();
        const contentsCopy = JSON.parse(JSON.stringify(contents)).map((content: Content, index: number) => {
            // 如果没有时间戳，自动添加（同一批次的消息时间戳递增）
            if (!content.timestamp) {
                content.timestamp = now + index;
            }
            return content;
        });
        history.push(...contentsCopy);
        await this.storage.saveHistory(conversationId, history);
    }

    /**
     * 获取所有消息
     *
     * 返回的每条消息都包含 index 字段，用于前端在删除/重试时直接使用
     * 每次调用都从存储读取最新数据
     * 
     * 注意：对于没有响应的 pending 工具调用，会自动标记为 rejected 并添加 functionResponse
     */
    async getMessages(conversationId: string): Promise<Content[]> {
        let history = await this.loadHistory(conversationId);
        history = await this.normalizeHistoryForDisplay(conversationId, history);

        // 为每条消息添加 index 字段（绝对索引）
        return history.map((message, index) => {
            // 过滤后端内部字段（turnDynamicContext 数据量大且前端无需使用）
            const { turnDynamicContext, ...rest } = message;
            return {
                ...JSON.parse(JSON.stringify(rest)),
                index
            };
        });
    }

    /**
     * 分页获取对话消息（仅返回一个窗口，避免一次性向 Webview 发送全量历史）
     *
     * - beforeIndex: 取 [0, beforeIndex) 区间内的最后 limit 条（用于上拉加载更早消息）
     * - offset/limit: 取 [offset, offset+limit) 区间（用于任意分页）
     *
     * 返回的 messages 中每条都包含绝对 index（即后端历史索引）。
     */
    async getMessagesPaged(
        conversationId: string,
        options: { beforeIndex?: number; offset?: number; limit?: number } = {}
    ): Promise<{ total: number; messages: Content[] }> {
        let history = await this.loadHistory(conversationId);
        history = await this.normalizeHistoryForDisplay(conversationId, history);

        const total = history.length;
        const limit = Math.max(1, Math.min(options.limit ?? 120, 1000));

        let start = 0;
        let endExclusive = total;

        if (typeof options.beforeIndex === 'number' && Number.isFinite(options.beforeIndex)) {
            endExclusive = Math.max(0, Math.min(total, Math.floor(options.beforeIndex)));
            start = Math.max(0, endExclusive - limit);
        } else if (typeof options.offset === 'number' && Number.isFinite(options.offset)) {
            start = Math.max(0, Math.min(total, Math.floor(options.offset)));
            endExclusive = Math.max(start, Math.min(total, start + limit));
        } else {
            // 默认：取最后 limit 条
            start = Math.max(0, total - limit);
            endExclusive = total;
        }

        const slice = history.slice(start, endExclusive);
        const messages = slice.map((message, i) => {
            const index = start + i;
            // 深拷贝并过滤后端内部字段（turnDynamicContext 数据量大且前端无需使用）
            const { turnDynamicContext, ...rest } = message;
            return {
                ...JSON.parse(JSON.stringify(rest)),
                index
            } as Content;
        });

        return { total, messages };
    }

    /**
     * 获取指定索引的消息
     */
    async getMessage(conversationId: string, index: number): Promise<Content | undefined> {
        const history = await this.loadHistory(conversationId);
        if (index < 0 || index >= history.length) {
            return undefined;
        }
        return JSON.parse(JSON.stringify(history[index]));
    }

    /**
     * 更新消息
     */
    async updateMessage(
        conversationId: string,
        messageIndex: number,
        updates: Partial<Content>
    ): Promise<void> {
        const history = await this.loadHistory(conversationId);
        if (messageIndex < 0 || messageIndex >= history.length) {
            throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: messageIndex }));
        }
        Object.assign(history[messageIndex], updates);
        await this.storage.saveHistory(conversationId, history);
    }

    /**
     * 批量更新多条消息（一次读写，避免并发 updateMessage 导致的覆盖写入）
     *
     * 典型场景：Token 预计算会并行更新多条 user 消息的 tokenCountByChannel。
     * 如果对每条消息单独 load+save，并行执行会出现“后写覆盖先写”，导致大量 token 结果丢失，
     * 进而在下一次请求里又重复对同一批消息进行 token 计数。
     */
    async updateMessagesBatch(
        conversationId: string,
        updates: Array<{ messageIndex: number; updates: Partial<Content> }>
    ): Promise<void> {
        if (updates.length === 0) {
            return;
        }

        const history = await this.loadHistory(conversationId);

        for (const item of updates) {
            const { messageIndex, updates: patch } = item;
            if (messageIndex < 0 || messageIndex >= history.length) {
                throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: messageIndex }));
            }
            Object.assign(history[messageIndex], patch);
        }

        await this.storage.saveHistory(conversationId, history);
    }

    /**
     * 删除消息
     */
    async deleteMessage(conversationId: string, messageIndex: number): Promise<void> {
        const history = await this.loadHistory(conversationId);
        if (messageIndex < 0 || messageIndex >= history.length) {
            throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: messageIndex }));
        }
        history.splice(messageIndex, 1);
        await this.storage.saveHistory(conversationId, history);
    }

    /**
     * 插入消息
     */
    async insertMessage(
        conversationId: string,
        position: number,
        role: 'user' | 'model' | 'system',
        parts: ContentPart[]
    ): Promise<void> {
        const history = await this.loadHistory(conversationId);
        const index = Math.max(0, Math.min(position, history.length));
        history.splice(index, 0, {
            role,
            parts: JSON.parse(JSON.stringify(parts)),
            timestamp: Date.now()  // 自动添加时间戳
        });
        await this.storage.saveHistory(conversationId, history);
    }

    /**
     * 在指定位置插入完整的 Content 对象
     */
    async insertContent(
        conversationId: string,
        position: number,
        content: Content
    ): Promise<void> {
        const history = await this.loadHistory(conversationId);
        const index = Math.max(0, Math.min(position, history.length));
        const contentCopy = JSON.parse(JSON.stringify(content));
        // 如果没有时间戳，自动添加
        if (!contentCopy.timestamp) {
            contentCopy.timestamp = Date.now();
        }
        history.splice(index, 0, contentCopy);
        await this.storage.saveHistory(conversationId, history);
    }

    // ==================== 批量操作 ====================

    /**
     * 删除指定范围的消息
     */
    async deleteMessagesInRange(
        conversationId: string,
        startIndex: number,
        endIndex: number
    ): Promise<void> {
        const history = await this.loadHistory(conversationId);
        const start = Math.max(0, startIndex);
        const end = Math.min(history.length, endIndex + 1);
        history.splice(start, end - start);
        await this.storage.saveHistory(conversationId, history);
    }

    /**
     * 删除到指定消息（从后往前删除）
     *
     * @param conversationId 对话 ID
     * @param targetIndex 目标消息索引（删除到这个索引为止，包括该消息）
     * @returns 删除的消息数量
     *
     * @example
     * // 删除最后 3 条消息（假设历史有 10 条）
     * await manager.deleteToMessage('chat-001', 7); // 删除索引 7, 8, 9
     *
     * 注意：删除后可能留下孤立的 functionCall（没有对应的 functionResponse）
     * ChatHandler 在重试时会检测并重新执行这些孤立的函数调用
     */
    async deleteToMessage(
        conversationId: string,
        targetIndex: number
    ): Promise<number> {
        const history = await this.loadHistory(conversationId);
        
        if (targetIndex < 0 || targetIndex >= history.length) {
            throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: targetIndex }));
        }
        
        // 从后往前删除，直到删除到目标索引（包括目标索引）
        const deleteCount = history.length - targetIndex;
        history.splice(targetIndex, deleteCount);
        
        await this.storage.saveHistory(conversationId, history);
        return deleteCount;
    }

    /**
     * 清空对话历史
     */
    async clearHistory(conversationId: string): Promise<void> {
        await this.storage.saveHistory(conversationId, []);
    }

    // ==================== 查询和过滤 ====================

    /**
     * 查找消息
     */
    async findMessages(
        conversationId: string,
        filter: MessageFilter
    ): Promise<MessagePosition[]> {
        const history = await this.loadHistory(conversationId);
        const results: MessagePosition[] = [];

        for (let i = 0; i < history.length; i++) {
            const message = history[i];
            let matches = true;

            if (filter.role && message.role !== filter.role) {
                matches = false;
            }

            if (filter.hasFunctionCall !== undefined) {
                const hasFunctionCall = message.parts.some(p => p.functionCall !== undefined);
                if (hasFunctionCall !== filter.hasFunctionCall) {
                    matches = false;
                }
            }

            if (filter.hasText !== undefined) {
                const hasText = message.parts.some(
                    p => p.text !== undefined && p.text.trim() !== ''
                );
                if (hasText !== filter.hasText) {
                    matches = false;
                }
            }

            if (filter.isThought !== undefined) {
                const isThought = message.parts.some(p => p.thought === true);
                if (isThought !== filter.isThought) {
                    matches = false;
                }
            }

            if (filter.indexRange) {
                const { start, end } = filter.indexRange;
                if (i < start || i >= end) {
                    matches = false;
                }
            }

            if (matches) {
                results.push({ index: i, role: message.role });
            }
        }

        return results;
    }

    /**
     * 获取指定角色的所有消息
     */
    async getMessagesByRole(
        conversationId: string,
        role: 'user' | 'model' | 'system'
    ): Promise<Content[]> {
        const history = await this.loadHistory(conversationId);
        return history
            .filter(msg => msg.role === role)
            .map(msg => JSON.parse(JSON.stringify(msg)));
    }

    // ==================== 快照管理 ====================

    /**
     * 创建快照
     */
    async createSnapshot(
        conversationId: string,
        name?: string,
        description?: string
    ): Promise<HistorySnapshot> {
        const history = await this.loadHistory(conversationId);
        const snapshot: HistorySnapshot = {
            id: `snapshot_${conversationId}_${Date.now()}`,
            conversationId,
            name,
            description,
            timestamp: Date.now(),
            history: JSON.parse(JSON.stringify(history))
        };
        await this.storage.saveSnapshot(snapshot);
        return snapshot;
    }

    /**
     * 恢复快照
     */
    async restoreSnapshot(conversationId: string, snapshotId: string): Promise<void> {
        const snapshot = await this.storage.loadSnapshot(snapshotId);
        if (!snapshot) {
            throw new Error(t('modules.conversation.errors.snapshotNotFound', { snapshotId }));
        }
        if (snapshot.conversationId !== conversationId) {
            throw new Error(t('modules.conversation.errors.snapshotNotBelongToConversation'));
        }
        
        await this.storage.saveHistory(conversationId, snapshot.history);
    }

    /**
     * 删除快照
     */
    async deleteSnapshot(snapshotId: string): Promise<void> {
        await this.storage.deleteSnapshot(snapshotId);
    }

    /**
     * 列出对话的所有快照
     */
    async listSnapshots(conversationId: string): Promise<string[]> {
        return await this.storage.listSnapshots(conversationId);
    }

    // ==================== 统计信息 ====================

    /**
     * 获取统计信息
     */
    async getStats(conversationId: string): Promise<ConversationStats> {
        const history = await this.loadHistory(conversationId);
        
        let userMessages = 0;
        let modelMessages = 0;
        let functionCalls = 0;
        let hasThoughtSignatures = false;
        let hasThoughts = false;
        let hasFileData = false;
        let hasInlineData = false;
        let inlineDataSize = 0;
        const multimedia = {
            images: 0,
            audio: 0,
            video: 0,
            documents: 0
        };
        
        // Token 统计
        let totalThoughtsTokens = 0;
        let totalCandidatesTokens = 0;
        let messagesWithThoughtsTokens = 0;
        let messagesWithCandidatesTokens = 0;

        for (const message of history) {
            if (message.role === 'user') {
                userMessages++;
            } else {
                modelMessages++;
            }
            
            // 统计 token（优先使用 usageMetadata，向后兼容旧格式）
            const thoughtsTokens = message.usageMetadata?.thoughtsTokenCount ?? message.thoughtsTokenCount;
            const candidatesTokens = message.usageMetadata?.candidatesTokenCount ?? message.candidatesTokenCount;
            
            if (thoughtsTokens !== undefined) {
                totalThoughtsTokens += thoughtsTokens;
                messagesWithThoughtsTokens++;
            }
            if (candidatesTokens !== undefined) {
                totalCandidatesTokens += candidatesTokens;
                messagesWithCandidatesTokens++;
            }

            for (const part of message.parts) {
                // 函数调用
                if (part.functionCall) {
                    functionCalls++;
                }
                
                // 检查思考签名
                if (part.thoughtSignatures) {
                    hasThoughtSignatures = true;
                }
                
                // 检查思考内容
                if (part.thought === true) {
                    hasThoughts = true;
                }
                
                // 检查文件数据
                if (part.fileData) {
                    hasFileData = true;
                }
                
                // 检查内嵌数据
                if (part.inlineData) {
                    hasInlineData = true;
                    
                    // 计算 Base64 数据大小（约为原始数据的 4/3）
                    const base64Length = part.inlineData.data.length;
                    inlineDataSize += Math.ceil((base64Length * 3) / 4);
                    
                    // 统计多模态类型
                    const mimeType = part.inlineData.mimeType;
                    if (mimeType.startsWith('image/')) {
                        multimedia.images++;
                    } else if (mimeType.startsWith('audio/')) {
                        multimedia.audio++;
                    } else if (mimeType.startsWith('video/')) {
                        multimedia.video++;
                    } else if (mimeType === 'application/pdf' || mimeType === 'text/plain') {
                        multimedia.documents++;
                    }
                }
            }
        }

        return {
            totalMessages: history.length,
            userMessages,
            modelMessages,
            functionCalls,
            hasThoughtSignatures,
            hasThoughts,
            hasFileData,
            hasInlineData,
            inlineDataSize,
            multimedia,
            tokens: {
                totalThoughtsTokens,
                totalCandidatesTokens,
                totalTokens: totalThoughtsTokens + totalCandidatesTokens,
                messagesWithThoughtsTokens,
                messagesWithCandidatesTokens
            }
        };
    }

    /**
     * 获取适合 API 调用的对话历史
     *
     * 此方法返回格式化的历史记录，移除内部字段（如 token 计数）
     *
     * 思考内容过滤策略：
     * - 默认情况下，只保留最后一个非函数响应 user 消息及之后的思考内容和签名
     * - 如果启用 sendHistoryThoughts，则保留所有历史思考内容
     * - 如果启用 sendHistoryThoughtSignatures，则保留所有历史思考签名（按渠道类型过滤）
     *
     * @param conversationId 对话 ID
     * @param options 选项对象（向后兼容：如果传入 boolean，视为 includeThoughts）
     * @returns 格式化的对话历史，移除了 token 计数字段
     *
     * @example
     * // 不含思考（用于常规 API 调用）
     * const history = await manager.getHistoryForAPI('chat-001');
     *
     * // 含思考（用于带思考的 API 调用，如 Gemini 3）
     * const historyWithThoughts = await manager.getHistoryForAPI('chat-001', { includeThoughts: true });
     *
     * // 发送所有历史思考签名（Gemini 格式）
     * const historyWithSignatures = await manager.getHistoryForAPI('chat-001', {
     *     includeThoughts: true,
     *     sendHistoryThoughtSignatures: true,
     *     channelType: 'gemini'
     * });
     */
    async getHistoryForAPI(
        conversationId: string,
        options: GetHistoryOptions | boolean = false
    ): Promise<ConversationHistory> {
        let history = await this.loadHistory(conversationId);
        
        // 向后兼容：如果传入 boolean，视为 includeThoughts
        const opts: GetHistoryOptions = typeof options === 'boolean'
            ? { includeThoughts: options }
            : options;
        
        // 应用起始索引（用于上下文裁剪）
        const startIndex = opts.startIndex ?? 0;
        if (startIndex > 0 && startIndex < history.length) {
            history = history.slice(startIndex);
        }
        
        const includeThoughts = opts.includeThoughts ?? false;
        const sendHistoryThoughts = opts.sendHistoryThoughts ?? false;
        const sendHistoryThoughtSignatures = opts.sendHistoryThoughtSignatures ?? false;
        // 当前轮次配置：如果没有传，Anthropic 默认全传，Gemini/OpenAI 默认不传文本内容
        const sendCurrentThoughts = opts.sendCurrentThoughts ?? (opts.channelType === 'anthropic' || opts.channelType === 'openai-responses');
        const sendCurrentThoughtSignatures = opts.sendCurrentThoughtSignatures ?? (opts.channelType === 'gemini' || opts.channelType === 'openai-responses');
        const channelType = opts.channelType;
        // 历史思考回合数，默认 -1 表示全部
        const historyThinkingRounds = opts.historyThinkingRounds ?? -1;
        
        // 找到最后一个非函数响应的 user 消息的索引
        let lastNonFunctionResponseUserIndex = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            const message = history[i];
            if (message.role === 'user' && !message.isFunctionResponse) {
                lastNonFunctionResponseUserIndex = i;
                break;
            }
        }
        
        // 识别所有回合并计算哪些回合需要发送历史思考
        // 回合定义：从一个非函数响应的 user 消息开始，到下一个非函数响应的 user 消息之前结束
        const roundStartIndices: number[] = [];
        for (let i = 0; i < history.length; i++) {
            const message = history[i];
            if (message.role === 'user' && !message.isFunctionResponse) {
                roundStartIndices.push(i);
            }
        }
        
        // 计算需要发送历史思考的消息索引范围
        // historyThinkingRounds 控制发送多少轮非最新回合的思考
        let historyThoughtMinIndex = 0;  // 最小索引（包含）
        let historyThoughtMaxIndex = lastNonFunctionResponseUserIndex;  // 最大索引（不包含，因为最新回合由 sendCurrentThoughts 控制）
        
        if (historyThinkingRounds === 0) {
            // 0 表示不发送任何历史回合的思考
            // 设置 min > max 使范围无效
            historyThoughtMinIndex = history.length;
            historyThoughtMaxIndex = -1;
        } else if (historyThinkingRounds > 0) {
            // 正数 n 表示发送最近 n 轮非最新回合的思考
            // 例如 historyThinkingRounds=1，总共有 5 个回合（索引 0-4），最新回合是 4
            // 那么只发送回合 3（倒数第二回合）的思考
            const totalRounds = roundStartIndices.length;
            
            if (totalRounds > 1) {
                // 需要跳过的回合数 = 总回合数 - 1（最新回合） - historyThinkingRounds
                const roundsToSkip = Math.max(0, totalRounds - 1 - historyThinkingRounds);
                
                if (roundsToSkip > 0 && roundsToSkip < totalRounds) {
                    // 从 roundsToSkip 回合开始发送
                    historyThoughtMinIndex = roundStartIndices[roundsToSkip];
                }
            }
        }
        // historyThinkingRounds === -1 时保持默认值，发送所有历史回合的思考
        
        /**
         * 处理单个 part 的思考签名
         * 根据配置决定是否保留签名，并按渠道类型过滤
         *
         * 注意：思考签名发送不依赖于 includeThoughts（渠道是否支持思考）
         * 这是因为历史中的签名可能来自任何渠道（如 Gemini），而当前使用其他渠道继续对话
         * 用户可能希望将 Gemini 产生的签名发送给其他渠道
         *
         * @param part 要处理的 part
         * @param isHistoryPart 是否是历史消息中的 part
         * @param messageIndex 消息在历史中的索引
         */
        const processThoughtSignatures = (
            part: ContentPart,
            isHistoryPart: boolean,
            messageIndex: number
        ): ContentPart => {
            // 1. 处理历史消息的签名
            if (isHistoryPart) {
                if (!sendHistoryThoughtSignatures) {
                    const { thoughtSignatures, thoughtSignature, ...rest } = part as any;
                    return rest;
                }
                // 检查是否在允许的历史思考回合范围内
                const isInHistoryThoughtRange = messageIndex >= historyThoughtMinIndex && messageIndex < historyThoughtMaxIndex;
                if (!isInHistoryThoughtRange) {
                    const { thoughtSignatures, thoughtSignature, ...rest } = part as any;
                    return rest;
                }
            } else {
                // 2. 处理当前轮次的签名
                // 当前轮次的签名发送由 sendCurrentThoughtSignatures 独立控制
                if (!sendCurrentThoughtSignatures) {
                    const { thoughtSignatures, thoughtSignature, ...rest } = part as any;
                    return rest;
                }
            }

            if (!part.thoughtSignatures) {
                return part;
            }
            
            // 3. 如果指定了渠道类型，只保留对应格式的签名
            if (channelType && part.thoughtSignatures[channelType]) {
                return {
                    ...part,
                    thoughtSignatures: {
                        [channelType]: part.thoughtSignatures[channelType]
                    }
                };
            }
            
            // 如果没有指定渠道类型或没有对应格式的签名，保留原样
            return part;
        };
        
        /**
         * 支持的图片 MIME 类型
         */
        const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
        
        /**
         * 支持的文档 MIME 类型
         */
        const DOCUMENT_MIME_TYPES = ['application/pdf', 'text/plain'];
        
        /**
         * 清理 inlineData 中的元数据字段
         *
         * 根据渠道类型决定保留哪些字段：
         * - Gemini: 保留 mimeType, data, displayName（Gemini API 支持 displayName）
         * - OpenAI/Anthropic: 只保留 mimeType, data（不支持 displayName）
         *
         * id 和 name 字段仅用于存储和前端显示，始终不发送给 AI
         *
         * 多模态能力过滤策略：
         * - 用户主动提交的附件不受多模态工具配置影响
         * - 对于工具响应消息：
         *   - 如果渠道不支持多模态（如 OpenAI function_call），始终过滤
         *   - 如果渠道支持但不支持历史多模态，只过滤历史中的多模态数据
         *   - 否则保留多模态数据
         *
         * @param part 要处理的 ContentPart
         * @param isFunctionResponse 是否是工具响应消息
         * @param isHistoryMessage 是否是历史消息（当前轮次之前的消息）
         */
        const cleanInlineData = (part: ContentPart, isFunctionResponse: boolean, isHistoryMessage: boolean): ContentPart | null => {
            if (!part.inlineData) {
                return part;
            }
            
            // 获取多模态能力配置
            const capability = opts.multimodalCapability;
            
            // 多模态能力过滤策略（仅对工具响应消息生效）：
            // 用户主动提交的附件不受多模态工具配置影响
            if (capability && isFunctionResponse) {
                const mimeType = part.inlineData.mimeType;
                
                // 首先检查渠道是否支持此类型的多模态
                // 如果不支持，即使是当前轮次也要过滤（如 OpenAI function_call 模式）
                const isImage = IMAGE_MIME_TYPES.includes(mimeType);
                const isDocument = DOCUMENT_MIME_TYPES.includes(mimeType);
                
                if (isImage && !capability.supportsImages) {
                    // 渠道不支持图片（如 OpenAI function_call），始终过滤
                    return null;
                }
                
                if (isDocument && !capability.supportsDocuments) {
                    // 渠道不支持文档，始终过滤
                    return null;
                }
                
                // 渠道支持此类型，但需要检查是否支持历史多模态
                // 如果是历史消息且不支持历史多模态，则过滤
                if (isHistoryMessage && !capability.supportsHistoryMultimodal) {
                    return null;
                }
            }
            
            // 根据渠道类型决定是否保留 displayName
            // Gemini 支持 displayName，OpenAI/Anthropic 不支持
            if (channelType === 'gemini') {
                // Gemini: 保留 displayName，移除 id 和 name
                const { id, name, ...cleanedInlineData } = part.inlineData;
                return {
                    ...part,
                    inlineData: cleanedInlineData
                };
            } else {
                // OpenAI/Anthropic/Custom: 移除 id, name, displayName
                const { id, name, displayName, ...cleanedInlineData } = part.inlineData;
                return {
                    ...part,
                    inlineData: cleanedInlineData
                };
            }
        };
        
        // 首先收集所有被拒绝的工具调用 ID
        const rejectedToolCallIds = new Set<string>();
        for (const message of history) {
            for (const part of message.parts) {
                if (part.functionCall?.rejected && part.functionCall.id) {
                    rejectedToolCallIds.add(part.functionCall.id);
                }
            }
        }
        
        /**
         * 清理 functionCall 中的内部字段
         *
         * rejected 字段是内部使用的，用于标记用户拒绝执行的工具
         * 不应该发送给 AI API，因为 API 不识别此字段
         */
        const cleanFunctionCall = (part: ContentPart): ContentPart => {
            if (!part.functionCall) {
                return part;
            }
            
            // 移除 rejected 字段
            const { rejected, ...cleanedFunctionCall } = part.functionCall;
            return {
                ...part,
                functionCall: cleanedFunctionCall
            };
        };
        
        /**
         * 处理 functionResponse
         *
         * 如果对应的 functionCall 被标记为 rejected，
         * 需要将 response 修改为表示被拒绝的状态，
         * 这样 AI 才能知道工具没有被执行
         *
         * 同时清理不应发送给 AI 的内部字段（如 diffContentId）
         */
        const processFunctionResponse = (part: ContentPart): ContentPart => {
            if (!part.functionResponse) {
                return part;
            }
            
            // 检查对应的 functionCall 是否被拒绝
            if (part.functionResponse.id && rejectedToolCallIds.has(part.functionResponse.id)) {
                // 修改 response 为表示被拒绝的状态
                return {
                    ...part,
                    functionResponse: {
                        ...part.functionResponse,
                        response: {
                            success: false,
                            error: t('modules.api.chat.errors.userRejectedTool'),
                            rejected: true
                        }
                    }
                };
            }
            
            // 清理不应发送给 AI 的内部字段（使用共享函数确保一致性）
            const cleanedResponse = cleanFunctionResponseForAPI(
                part.functionResponse.response as Record<string, unknown>
            );
            
            return {
                ...part,
                functionResponse: {
                    ...part.functionResponse,
                    response: cleanedResponse
                }
            };
        };
        
        /**
         * 处理单条消息
         */
        const processMessage = (message: Content, index: number): Content | null => {
            const isHistoryMessage = index < lastNonFunctionResponseUserIndex;
            // 检查消息是否是工具响应（用于决定是否应用多模态能力过滤）
            const isFunctionResponse = !!message.isFunctionResponse;
            
            let parts = message.parts;
            
            // 处理思考内容 (Thought Text/Reasoning Content)
            // 注意：思考发送不依赖于 includeThoughts（渠道是否支持思考）
            // 这是因为历史中的思考内容可能来自任何渠道（如 Gemini），而当前使用其他渠道继续对话
            // 用户可能希望将 Gemini 产生的思考内容发送给 OpenAI/Anthropic 渠道
            if (isHistoryMessage) {
                // 历史消息：根据 sendHistoryThoughts 配置和 historyThinkingRounds 决定
                if (!sendHistoryThoughts) {
                    // 仅过滤掉纯思考内容，保留包含签名的 Part
                    parts = parts.filter(part => !part.thought || part.thoughtSignatures);
                } else {
                    // 检查当前消息是否在允许的历史思考回合范围内
                    const isInHistoryThoughtRange = index >= historyThoughtMinIndex && index < historyThoughtMaxIndex;
                    if (!isInHistoryThoughtRange) {
                        parts = parts.filter(part => !part.thought);
                    }
                }
            } else {
                // 当前轮次 (Latest Round)
                // 当前轮次的思考发送由 sendCurrentThoughts 独立控制
                if (!sendCurrentThoughts) {
                    // 仅过滤掉纯思考内容，保留包含签名的 Part
                    parts = parts.filter(part => !part.thought || part.thoughtSignatures);
                }
            }
            
            // 处理思考签名、清理 inlineData 元数据、清理 functionCall 内部字段、处理被拒绝的工具响应
            // 注意：只有历史中的工具响应消息才会应用 supportsHistoryMultimodal 过滤
            // 当前轮次的工具响应始终保留多模态数据
            parts = parts
                .map(part => processThoughtSignatures(part, isHistoryMessage, index))
                .map(part => cleanInlineData(part, isFunctionResponse, isHistoryMessage))
                .map(part => part ? cleanFunctionCall(part) : part)
                .map(part => part ? processFunctionResponse(part) : part)
                // 过滤空 part：
                // - null（被 cleanInlineData 等过滤）
                // - 空对象
                // - 仅包含 thought: true 的“空 thought 块”（常见于：原本只有 thoughtSignatures，后续又被配置过滤掉签名）
                //   这类 part 在不同模型/渠道下可能导致兼容性问题。
                .filter((part): part is ContentPart => {
                    if (part === null) return false;
                    const keys = Object.keys(part);
                    if (keys.length === 0) return false;
                    if (keys.length === 1 && keys[0] === 'thought' && (part as any).thought === true) return false;
                    return true;
                });
            
            if (parts.length === 0) {
                return null;
            }
            
            // 保留必要的元数据字段
            const result: Content = {
                role: message.role,
                parts
            };
            
            // 保留 isUserInput 标记（用于确定动态提示词插入位置）
            if (message.isUserInput) {
                result.isUserInput = true;
            }
            
            return result;
        };
        
        // 处理所有消息
        return history
            .map((message, index) => processMessage(message, index))
            .filter((message): message is Content => message !== null);
    }

    // ==================== 元数据管理 ====================

    /**
     * 设置对话标题
     */
    async setTitle(conversationId: string, title: string): Promise<void> {
        let meta = await this.storage.loadMetadata(conversationId);
        if (!meta) {
            meta = {
                id: conversationId,
                title,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                custom: {}
            };
        } else {
            meta.title = title;
            meta.updatedAt = Date.now();
        }
        await this.storage.saveMetadata(meta);
    }

    /**
     * 设置工作区 URI
     */
    async setWorkspaceUri(conversationId: string, workspaceUri: string): Promise<void> {
        let meta = await this.storage.loadMetadata(conversationId);
        if (!meta) {
            meta = {
                id: conversationId,
                title: t('modules.conversation.defaultTitle', { conversationId }),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                workspaceUri,
                custom: {}
            };
        } else {
            meta.workspaceUri = workspaceUri;
            meta.updatedAt = Date.now();
        }
        await this.storage.saveMetadata(meta);
    }

    /**
     * 获取对话元数据
     */
    async getMetadata(conversationId: string): Promise<ConversationMetadata | null> {
        const meta = await this.storage.loadMetadata(conversationId);
        return meta ? JSON.parse(JSON.stringify(meta)) : null;
    }

    /**
     * 设置自定义元数据
     */
    async setCustomMetadata(
        conversationId: string,
        key: string,
        value: unknown
    ): Promise<void> {
        let meta = await this.storage.loadMetadata(conversationId);
        if (!meta) {
            meta = {
                id: conversationId,
                title: t('modules.conversation.defaultTitle', { conversationId }),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                custom: {}
            };
        }
        
        if (!meta.custom) {
            meta.custom = {};
        }
        meta.custom[key] = value;
        meta.updatedAt = Date.now();
        
        await this.storage.saveMetadata(meta);
    }

    /**
     * 获取自定义元数据
     */
    async getCustomMetadata(conversationId: string, key: string): Promise<unknown> {
        const meta = await this.getMetadata(conversationId);
        return meta?.custom?.[key];
    }

    // ==================== 工具调用管理 ====================

    /**
     * 标记指定消息中的工具调用为拒绝状态
     *
     * 当用户在等待工具确认时点击终止按钮，需要将等待中的工具标记为拒绝
     * 同时添加对应的 functionResponse，这样 API 才不会报错
     *
     * @param conversationId 对话 ID
     * @param messageIndex 消息索引
     * @param toolCallIds 要标记为拒绝的工具调用 ID 列表（如果为空，则标记所有未执行的工具）
     */
    async rejectToolCalls(
        conversationId: string,
        messageIndex: number,
        toolCallIds?: string[]
    ): Promise<void> {
        const history = await this.loadHistory(conversationId);
        
        if (messageIndex < 0 || messageIndex >= history.length) {
            throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: messageIndex }));
        }
        
        const message = history[messageIndex];
        let modified = false;
        
        // 收集所有已有响应的工具 ID
        const respondedToolIds = new Set<string>();
        for (let i = messageIndex + 1; i < history.length; i++) {
            const msg = history[i];
            for (const part of msg.parts) {
                if (part.functionResponse?.id) {
                    respondedToolIds.add(part.functionResponse.id);
                }
            }
        }
        
        // 收集需要拒绝的工具调用
        const rejectedCalls: Array<{ id: string; name: string }> = [];
        
        // 标记工具为拒绝状态
        for (const part of message.parts) {
            if (part.functionCall && part.functionCall.id) {
                // 检查是否需要标记此工具
                const shouldReject = toolCallIds
                    ? toolCallIds.includes(part.functionCall.id)
                    : !respondedToolIds.has(part.functionCall.id);
                
                if (shouldReject && !part.functionCall.rejected) {
                    part.functionCall.rejected = true;
                    modified = true;
                    
                    // 收集被拒绝的工具信息
                    rejectedCalls.push({
                        id: part.functionCall.id,
                        name: part.functionCall.name || 'unknown'
                    });
                }
            }
        }
        
        // 为被拒绝的工具添加 functionResponse
        if (rejectedCalls.length > 0) {
            const rejectedResponseParts: ContentPart[] = rejectedCalls.map(call => ({
                functionResponse: {
                    name: call.name,
                    id: call.id,
                    response: {
                        success: false,
                        error: t('modules.api.chat.errors.userRejectedTool'),
                        rejected: true
                    }
                }
            }));
            
            // 在工具调用消息的紧接后面插入 functionResponse
            history.splice(messageIndex + 1, 0, {
                role: 'user',
                parts: rejectedResponseParts,
                isFunctionResponse: true
            });
            modified = true;
        }
        
        if (modified) {
            await this.storage.saveHistory(conversationId, history);
        }
    }
    
    /**
     * 拒绝所有未响应的工具调用
     * 
     * 用于用户中断操作（删除消息、切换对话等）时，将所有 pending 的工具调用标记为 rejected
     * 并在工具调用消息紧接后面插入 functionResponse
     * 
     * @param conversationId 对话 ID
     */
    async rejectAllPendingToolCalls(conversationId: string): Promise<void> {
        const history = await this.loadHistory(conversationId);
        if (history.length === 0) return;
        
        // 收集所有 functionResponse 的 ID
        const respondedToolCallIds = new Set<string>();
        for (const message of history) {
            if (message.parts) {
                for (const part of message.parts) {
                    if (part.functionResponse?.id) {
                        respondedToolCallIds.add(part.functionResponse.id);
                    }
                }
            }
        }
        
        // 收集未响应的工具调用，记录它们所在的消息索引
        const unresolvedCallsByIndex: Map<number, Array<{ id: string; name: string }>> = new Map();
        for (let i = 0; i < history.length; i++) {
            const message = history[i];
            if (message.parts) {
                for (const part of message.parts) {
                    if (part.functionCall && part.functionCall.id) {
                        // 如果工具调用没有对应的响应，且还没有被标记为 rejected
                        if (!respondedToolCallIds.has(part.functionCall.id) && !part.functionCall.rejected) {
                            part.functionCall.rejected = true;
                            const calls = unresolvedCallsByIndex.get(i) || [];
                            calls.push({
                                id: part.functionCall.id,
                                name: part.functionCall.name || 'unknown'
                            });
                            unresolvedCallsByIndex.set(i, calls);
                        }
                    }
                }
            }
        }
        
        // 如果有未响应的工具调用，在工具调用消息紧接后面插入 functionResponse
        // 从后往前插入以避免索引偏移问题
        if (unresolvedCallsByIndex.size > 0) {
            const sortedIndices = Array.from(unresolvedCallsByIndex.keys()).sort((a, b) => b - a);
            
            for (const messageIndex of sortedIndices) {
                const calls = unresolvedCallsByIndex.get(messageIndex)!;
                const rejectedResponseParts: ContentPart[] = calls.map(call => ({
                    functionResponse: {
                        name: call.name,
                        id: call.id,
                        response: {
                            success: false,
                            error: t('modules.api.chat.errors.userRejectedTool'),
                            rejected: true
                        }
                    }
                }));
                
                // 在工具调用消息的紧接后面插入
                history.splice(messageIndex + 1, 0, {
                    role: 'user',
                    parts: rejectedResponseParts,
                    isFunctionResponse: true
                });
            }
            
            await this.storage.saveHistory(conversationId, history);
        }
    }
}