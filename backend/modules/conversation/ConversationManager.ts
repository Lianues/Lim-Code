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
    ConversationStats,
    CONVERSATION_CONTEXT_TRIM_STATE_KEY
} from './types';
import type { ConversationStorageIntegrity, ConversationStorageLocation, IStorageAdapter } from './storage';
import { cleanFunctionResponseForAPI } from './helpers';
import { ConversationTranscriptRepository, type ITranscriptRepository } from './TranscriptRepository';
import { deleteLogicalMessage, truncateFrom } from './TranscriptMutation';
import { CONVERSATION_CONTEXT_PROJECTION_KEY, CONVERSATION_METADATA_SCHEMA_VERSION } from './contextTypes';
import { ConversationMetadataRepository } from './ConversationMetadataRepository';

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
    /**
     * 修改原因：P1 中央事实源会让 contextProjection、contextLedger、subAgentRuns 和 monitorWindowState 并发写同一 metadata 文件。
     * 修改方式：在 ConversationManager 内维护按 conversationId 串行的 metadata 更新队列，让 typed repository 的读改写不会互相覆盖。
     * 修改目的：先用轻量 per-conversation mutex 承载 P1，不为了当前阶段引入 SQLite、CAS 或重型存储接口变更。
     */
    private metadataUpdateQueues: Map<string, Promise<unknown>> = new Map();

    constructor(private storage: IStorageAdapter) {}

    /**
     * 修改原因：上下文裁剪状态是由 transcript 结构推导出的派生状态，删除/插入/回档后继续复用旧 trimState 会造成上下文异常缺失。
     * 修改方式：在 ConversationManager 暴露统一失效入口，由所有结构性历史变更调用；普通追加和 token 计数更新不触发。
     * 修改目的：让上下文管理状态跟随 transcript 结构变化重新计算，而不是依赖各个 Webview handler 手动清理。
     */
    async invalidateContextManagementState(conversationId: string, reason: string): Promise<void> {
        // 修改原因：失效上下文状态是高频历史变更路径的一部分，不能为了调试在正常运行时持续 console.log。
        // 修改方式：保留 reason 参数作为调用点自说明和未来日志扩展点，但当前只统一清理 metadata。
        // 修改目的：实现统一失效机制，同时遵守热路径日志收敛规则，避免长会话删除/回档时制造额外输出。
        void reason;
        await this.setCustomMetadata(conversationId, CONVERSATION_CONTEXT_TRIM_STATE_KEY, null);
        // 修改原因：ContextProjection 现在会参与下一轮 prompt assembly；历史插入、删除、回档后继续复用旧 projection startIndex 会错误截断上下文。
        // 修改方式：结构性历史变更统一清理 current projection 文档；后续 compact/summarize/reset 会重新创建合法 projection。
        // 修改目的：避免 stale projection 成为 prompt source-of-truth 后造成不可见上下文缺失。
        await this.setCustomMetadata(conversationId, CONVERSATION_CONTEXT_PROJECTION_KEY, null);
    }

    private shouldInvalidateContextManagementStateForUpdate(updates: Partial<Content>): boolean {
        return Object.prototype.hasOwnProperty.call(updates, 'parts')
            || Object.prototype.hasOwnProperty.call(updates, 'isSummary')
            || Object.prototype.hasOwnProperty.call(updates, 'isAutoSummary')
            || Object.prototype.hasOwnProperty.call(updates, 'summarizedMessageCount')
            || Object.prototype.hasOwnProperty.call(updates, 'isFunctionResponse');
    }

    getTranscriptRepository(conversationId: string): ITranscriptRepository {
        // 修改原因：主聊天 transcript 需要一个统一的仓储入口，供当前适配和后续 WP24/WP23 之类协作者复用。
        // 修改方式：把 ConversationManager 既有的“缺失历史时自动建会话”读取语义，与底层 saveHistory 持久化语义一起绑定到仓储委托。
        // 修改目的：外部协作者不再直接接触 storage.loadHistory/saveHistory，也不会复制主聊天特有的初始化规则。
        return new ConversationTranscriptRepository({
            loadContents: async () => await this.loadHistory(conversationId),
            saveContents: async contents => await this.storage.saveHistory(conversationId, contents)
        });
    }

    async getConversationStorageLocation(conversationId: string): Promise<ConversationStorageLocation | null> {
        // 修改原因：webview handler 需要打开对话存储位置，但 ConversationManager 外部不应知道具体存储布局。
        // 修改方式：通过 IStorageAdapter 的可选窄接口委托给文件系统存储实现；非文件存储返回 null。
        // 修改目的：保持路径规则单一来源，避免后续 segmented/legacy 存储格式升级时遗漏历史 reveal 功能。
        if (!this.storage.getConversationStorageLocation) {
            return null;
        }
        return await this.storage.getConversationStorageLocation(conversationId);
    }

    private resolveIntegrityStatus(
        integrity: ConversationStorageIntegrity | null
    ): ConversationMetadata['integrityStatus'] | undefined {
        if (!integrity) return undefined;
        if (!integrity.historyExists) return 'history_missing';
        if (!integrity.historyReadable) return 'history_corrupt';
        if (!integrity.metadataExists) return 'meta_missing';
        if (!integrity.metadataReadable) return 'meta_corrupt';
        return 'ok';
    }

    private async loadMetadataForWrite(conversationId: string): Promise<ConversationMetadata | null> {
        const result = await this.storage.loadMetadataWithStatus(conversationId);
        if (result.value) {
            return result.value;
        }
        if (!result.errorCode || result.errorCode === 'not_found') {
            return null;
        }
        throw new Error(
            `Failed to load conversation metadata (${result.errorCode}) for ${conversationId}: ${result.errorMessage || 'Unknown error'}`
        );
    }

    private async loadStoredMetadata(conversationId: string): Promise<ConversationMetadata | null> {
        const result = await this.storage.loadMetadataWithStatus(conversationId);
        if (result.value) {
            return result.value;
        }
        if (!result.errorCode || result.errorCode === 'not_found') {
            return null;
        }
        throw new Error(
            `Failed to load conversation metadata (${result.errorCode}) for ${conversationId}: ${result.errorMessage || 'Unknown error'}`
        );
    }

    private createFallbackMetadata(
        conversationId: string,
        history: ConversationHistory | null
    ): ConversationMetadata {
        const timestamps = (history || [])
            .map(item => item.timestamp)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
        const now = Date.now();
        const createdAt = timestamps.length > 0 ? Math.min(...timestamps) : now;
        const updatedAt = timestamps.length > 0 ? Math.max(...timestamps) : now;

        return {
            id: conversationId,
            title: t('modules.conversation.defaultTitle', { conversationId }),
            createdAt,
            updatedAt,
            // 修改原因：旧会话缺少 root schemaVersion 时，P1 typed metadata repository 无法区分已迁移和 legacy 状态。
            // 修改方式：所有新建或 fallback metadata 统一写入当前 schemaVersion，旧会话在首次写入时惰性补齐。
            // 修改目的：让 context projection、ledger 和 Monitor state 的兼容判断有统一入口。
            schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
            custom: {},
        };
    }

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

            // 修改原因：展示前自动补齐被拒绝的 functionResponse 也是 transcript 的一次整份替换，不应绕开统一仓储边界。
            // 修改方式：在完成历史规范化后，通过 repository.replaceContents 保存修正后的 transcript。
            // 修改目的：把主聊天的自动修正规则也纳入统一 transcript 写入口。
            await this.getTranscriptRepository(conversationId).replaceContents(history);
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
        const existing = await this.storage.loadHistoryWithStatus(conversationId);
        if (existing.value) {
            throw new Error(t('modules.conversation.errors.conversationExists', { conversationId }));
        }
        if (existing.errorCode && existing.errorCode !== 'not_found') {
            throw new Error(
                `Cannot create conversation ${conversationId}: history file is not readable (${existing.errorCode})`
            );
        }

        const now = Date.now();
        const meta: ConversationMetadata = {
            id: conversationId,
            title: title || t('modules.conversation.defaultTitle', { conversationId }),
            createdAt: now,
            updatedAt: now,
            workspaceUri,
            // 修改原因：P1 中央事实源需要从创建时就带 root schemaVersion，避免新旧会话状态混杂。
            // 修改方式：创建会话 metadata 时直接写当前版本，而不是等第一次 context 操作再补。
            // 修改目的：让后续 ContextStatusService 能可靠报告会话是否已经进入 typed metadata 体系。
            schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
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
        const result = await this.storage.loadHistoryWithStatus(conversationId);
        if (result.value) {
            return result.value;
        }
        if (!result.errorCode || result.errorCode === 'not_found') {
            try {
                await this.createConversation(conversationId);
                return [];
            } catch (error) {
                // 修改原因：cancel/stop 与流式工具写入可能并发触发 loadHistory 的“缺失则创建”兜底。
                // 修改方式：如果 create 时发现同 ID 已由另一条路径创建，重新读取并复用现有 history。
                // 修改目的：主界面 stop 不应因为初始化竞态冒出“对话已存在”的 UNKNOWN_ERROR。
                const retry = await this.storage.loadHistoryWithStatus(conversationId);
                if (retry.value) {
                    return retry.value;
                }
                throw error;
            }
        }
        throw new Error(
            `Failed to load conversation history (${result.errorCode}) for ${conversationId}: ${result.errorMessage || 'Unknown error'}`
        );
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
        // 修改原因：主聊天追加消息不应继续散落成手写 load -> push -> save；这正是 TranscriptRepository 要统一的 append 语义。
        // 修改方式：先构造完整 Content，再委托 conversation 级 transcript repository 追加。
        // 修改目的：主聊天和 SubAgent 子 transcript 在“追加一条楼层”时走同一抽象入口。
        await this.getTranscriptRepository(conversationId).appendContent({
            role,
            parts: JSON.parse(JSON.stringify(parts)),
            timestamp: Date.now(),  // 自动添加时间
            ...metadata  // 合并可选元数据
        } as Content);
    }

    /**
     * 添加完整的 Content 对象（对 functionResponse 自动去重）
     */
    async addContent(conversationId: string, content: Content): Promise<void> {
        const repository = this.getTranscriptRepository(conversationId);
        const history = await repository.getContents();
        const contentCopy = JSON.parse(JSON.stringify(content));
        // 如果没有时间戳，自动添加
        if (!contentCopy.timestamp) {
            contentCopy.timestamp = Date.now();
        }

        // 去重：如果本次添加的是 functionResponse 消息，过滤掉历史中已有响应的 tool call ID。
        // 这是一道安全网，防止 cancelStream→rejectAllPendingToolCalls 与工具执行循环之间的
        // 竞态条件导致同一 tool_use_id 出现多条 functionResponse（会触发 API 400 错误）。
        if (contentCopy.isFunctionResponse && contentCopy.parts) {
            const existingResponseIds = new Set<string>();
            for (const msg of history) {
                if (msg.parts) {
                    for (const part of msg.parts) {
                        if (part.functionResponse?.id) {
                            existingResponseIds.add(part.functionResponse.id);
                        }
                    }
                }
            }

            contentCopy.parts = contentCopy.parts.filter((part: any) =>
                !(part.functionResponse?.id && existingResponseIds.has(part.functionResponse.id))
            );

            if (contentCopy.parts.length === 0) {
                return; // 所有 parts 均已有响应，无需添加空消息
            }
        }

        // 修改原因：addContent 是主聊天最常用的 transcript append 写入口，必须率先接到统一仓储抽象。
        // 修改方式：保留现有 functionResponse 去重安全网，再把最终 content 交给 repository.appendContent 落盘。
        // 修改目的：主聊天与 SubAgent 在 append 语义上共享同一接口，同时不改变去重与持久化格式。
        await repository.appendContent(contentCopy);
    }

    /**
     * 批量添加消息
     */
    async addBatch(conversationId: string, contents: Content[]): Promise<void> {
        const now = Date.now();
        const contentsCopy = JSON.parse(JSON.stringify(contents)).map((content: Content, index: number) => {
            // 如果没有时间戳，自动添加（同一批次的消息时间戳递增）
            if (!content.timestamp) {
                content.timestamp = now + index;
            }
            return content;
        });
        // 修改原因：批量追加本质上仍是 transcript append，只是一次追加多条，没必要再维护第二套直接 saveHistory 路径。
        // 修改方式：通过 repository.mutateContents 在单次 load/save 中把多条内容追加到当前 transcript 尾部。
        // 修改目的：append 和 batch append 都纳入统一仓储边界，后续更容易做审计或锁语义收敛。
        await this.getTranscriptRepository(conversationId).mutateContents(history => {
            history.push(...contentsCopy);
            return history;
        });
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
        const pagedHistory = await this.storage.loadHistoryPage(conversationId, options);
        if (pagedHistory.value && pagedHistory.value.format === 'paged') {
            return {
                total: pagedHistory.value.total,
                messages: pagedHistory.value.messages.map((message, i) => {
                    const index = pagedHistory.value!.startIndex + i;
                    const { turnDynamicContext, ...rest } = message;
                    return { ...JSON.parse(JSON.stringify(rest)), index } as Content;
                })
            };
        }

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
        // 修改原因：单条楼层更新仍属于 transcript mutate，不应保留独立的直写存储流程。
        // 修改方式：通过 repository.mutateContents 执行边界检查与原位补丁，再统一保存。
        // 修改目的：主聊天所有“读当前 transcript 再生成新 transcript”的操作都开始收敛到统一接口。
        await this.getTranscriptRepository(conversationId).mutateContents(history => {
            if (messageIndex < 0 || messageIndex >= history.length) {
                throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: messageIndex }));
            }
            Object.assign(history[messageIndex], updates);
            return history;
        });
        if (this.shouldInvalidateContextManagementStateForUpdate(updates)) {
            await this.invalidateContextManagementState(conversationId, 'message_structure_updated');
        }
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

        // 修改原因：批量更新的价值就在于“一次读写避免覆盖写入”；TranscriptRepository 的 mutate 正好是这类语义的统一入口。
        // 修改方式：把所有 patch 应用压缩到一次 repository.mutateContents 中执行。
        // 修改目的：保留并发覆盖防御，同时消除一条重复的直接 saveHistory 路径。
        await this.getTranscriptRepository(conversationId).mutateContents(history => {
            for (const item of updates) {
                const { messageIndex, updates: patch } = item;
                if (messageIndex < 0 || messageIndex >= history.length) {
                    throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: messageIndex }));
                }
                Object.assign(history[messageIndex], patch);
            }
            return history;
        });
    }

    /**
     * 删除消息
     */
    async deleteMessage(conversationId: string, messageIndex: number): Promise<void> {
        // 修改原因：deleteMessage 是 transcript mutate，而且必须保留 TranscriptMutation 的 functionCall/functionResponse 配对删除语义。
        // 修改方式：通过 repository.mutateContents 委托 deleteLogicalMessage，仍由纯函数负责配对删除与 index 规范化。
        // 修改目的：让主对话删除操作与 SubAgent 子对话未来删除操作共享同一仓储入口和同一删除语义。
        await this.getTranscriptRepository(conversationId).mutateContents(history => {
            if (messageIndex < 0 || messageIndex >= history.length) {
                throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: messageIndex }));
            }
            return deleteLogicalMessage(history, messageIndex);
        });
        await this.invalidateContextManagementState(conversationId, 'message_deleted');
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
        // 修改原因：插入消息也是 transcript mutate；若继续手写 splice + save，会与 append/delete 的统一边界再次分叉。
        // 修改方式：通过 repository.mutateContents 在当前 transcript 中插入构造好的 Content。
        // 修改目的：主聊天的插入、删除、更新都开始沿同一仓储语义收敛。
        await this.getTranscriptRepository(conversationId).mutateContents(history => {
            const index = Math.max(0, Math.min(position, history.length));
            history.splice(index, 0, {
                role,
                parts: JSON.parse(JSON.stringify(parts)),
                timestamp: Date.now()  // 自动添加时间
            } as Content);
            return history;
        });
        await this.invalidateContextManagementState(conversationId, 'message_inserted');
    }

    /**
     * 在指定位置插入完整的 Content 对象
     */
    async insertContent(
        conversationId: string,
        position: number,
        content: Content
    ): Promise<void> {
        const contentCopy = JSON.parse(JSON.stringify(content));
        // 如果没有时间戳，自动添加
        if (!contentCopy.timestamp) {
            contentCopy.timestamp = Date.now();
        }
        // 修改原因：插入完整 Content 与插入简化消息本质相同，应该复用同一 mutate 入口。
        // 修改方式：准备好深拷贝内容后，通过 repository.mutateContents 执行 splice。
        // 修改目的：避免 main chat 继续保留一条独立的 insertContent 直写路径。
        await this.getTranscriptRepository(conversationId).mutateContents(history => {
            const index = Math.max(0, Math.min(position, history.length));
            history.splice(index, 0, contentCopy);
            return history;
        });
        await this.invalidateContextManagementState(conversationId, contentCopy.isSummary ? 'summary_inserted' : 'content_inserted');
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
        // 修改原因：范围删除也是 transcript mutate，不应再保留单独的 load/splice/save 模板代码。
        // 修改方式：通过 repository.mutateContents 统一执行区间裁剪。
        // 修改目的：为后续把更多主聊天编辑操作统一到仓储层打基础。
        await this.getTranscriptRepository(conversationId).mutateContents(history => {
            const start = Math.max(0, startIndex);
            const end = Math.min(history.length, endIndex + 1);
            history.splice(start, end - start);
            return history;
        });
        await this.invalidateContextManagementState(conversationId, 'message_range_deleted');
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
        const repository = this.getTranscriptRepository(conversationId);
        const history = await repository.getContents();
        
        if (targetIndex < 0 || targetIndex >= history.length) {
            throw new Error(t('modules.conversation.errors.messageIndexOutOfBounds', { index: targetIndex }));
        }
        
        // 修改原因：重试/删除到指定消息的语义是从目标索引开始截断，不能在主对话和 SubAgent 子对话各写一套实现。
        // 修改方式：通过 TranscriptRepository.mutateContents 委托 TranscriptMutation.truncateFrom 统一处理截断和 index 规范化。
        // 修改目的：保证后续工具配对规则升级时，主窗口和 Monitor 同步继承。
        const nextHistory = await repository.mutateContents(currentHistory => truncateFrom(currentHistory, targetIndex));
        const deleteCount = history.length - nextHistory.length;
        if (deleteCount > 0) {
            await this.invalidateContextManagementState(conversationId, 'history_truncated');
        }
        
        return deleteCount;
    }

    /**
     * 清空对话历史
     */
    async clearHistory(conversationId: string): Promise<void> {
        // 修改原因：清空 transcript 属于 replace 整体快照的典型场景，应直接走统一 replace 入口。
        // 修改方式：委托 repository.replaceContents([]) 保存空 transcript。
        // 修改目的：主聊天 clear 与 SubAgent replace 拥有同一仓储操作语义。
        await this.getTranscriptRepository(conversationId).replaceContents([]);
        await this.invalidateContextManagementState(conversationId, 'history_cleared');
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
        
        // 修改原因：快照恢复本质上是整份 transcript replace，适合直接落在统一 replace 入口。
        // 修改方式：读取快照后，委托 repository.replaceContents 保存快照历史。
        // 修改目的：主聊天的全量覆盖操作也纳入 TranscriptRepository 契约。
        await this.getTranscriptRepository(conversationId).replaceContents(snapshot.history);
        await this.invalidateContextManagementState(conversationId, 'snapshot_restored');
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
        const sendCurrentThoughtSignatures = opts.sendCurrentThoughtSignatures ?? (opts.channelType === 'gemini' || opts.channelType === 'anthropic' || opts.channelType === 'openai-responses');
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
        let historyThoughtMaxIndex = lastNonFunctionResponseUserIndex;  // 最大索引（不包含，由 sendCurrentThoughts 控制）
        
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
        let meta = await this.loadMetadataForWrite(conversationId);
        if (!meta) {
            meta = {
                id: conversationId,
                title,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                // 修改原因：setTitle 可能为只有 history、没有 meta 的 legacy 会话创建 fallback metadata。
                // 修改方式：fallback metadata 同样写入 schemaVersion，保持所有写路径一致。
                // 修改目的：避免某些旧会话经过标题修改后仍停留在未标记 schema 状态。
                schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
                custom: {}
            };
        } else {
            meta.title = title;
            if (typeof meta.schemaVersion !== 'number') {
                meta.schemaVersion = CONVERSATION_METADATA_SCHEMA_VERSION;
            }
            meta.updatedAt = Date.now();
        }
        await this.storage.saveMetadata(meta);
    }

    /**
     * 设置工作区 URI
     */
    async setWorkspaceUri(conversationId: string, workspaceUri: string): Promise<void> {
        let meta = await this.loadMetadataForWrite(conversationId);
        if (!meta) {
            meta = {
                id: conversationId,
                title: t('modules.conversation.defaultTitle', { conversationId }),
                createdAt: Date.now(),
                updatedAt: Date.now(),
                workspaceUri,
                // 修改原因：setWorkspaceUri 也可能补建 metadata，不能遗漏 P1 schemaVersion。
                // 修改方式：所有补建 metadata 的路径统一写当前 schemaVersion。
                // 修改目的：让 typed metadata repository 不需要为每个来源补丁式判断。
                schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
                custom: {}
            };
        } else {
            meta.workspaceUri = workspaceUri;
            if (typeof meta.schemaVersion !== 'number') {
                meta.schemaVersion = CONVERSATION_METADATA_SCHEMA_VERSION;
            }
            meta.updatedAt = Date.now();
        }
        await this.storage.saveMetadata(meta);
    }

    /**
     * 获取对话元数据
     */
    async getMetadata(conversationId: string): Promise<ConversationMetadata | null> {
        const [metadataResult, historyPageResult] = await Promise.all([
            this.storage.loadMetadataWithStatus(conversationId),
            this.storage.loadHistoryPage(conversationId, { limit: 1 }),
        ]);

        const historyExists = historyPageResult.value !== null || historyPageResult.errorCode !== 'not_found';
        const integrity: ConversationStorageIntegrity = {
            historyExists,
            metadataExists: metadataResult.value !== null || metadataResult.errorCode !== 'not_found',
            historyReadable: historyPageResult.value !== null,
            metadataReadable: metadataResult.value !== null,
            historyErrorCode: historyPageResult.errorCode,
            metadataErrorCode: metadataResult.errorCode,
            historyErrorMessage: historyPageResult.errorMessage,
            metadataErrorMessage: metadataResult.errorMessage,
        };
        const integrityStatus = this.resolveIntegrityStatus(integrity);

        if (metadataResult.value) {
            const metadata = JSON.parse(JSON.stringify(metadataResult.value)) as ConversationMetadata;
            if (integrityStatus && integrityStatus !== 'ok') {
                metadata.integrityStatus = integrityStatus;
            } else {
                delete metadata.integrityStatus;
            }
            return metadata;
        }

        if (historyPageResult.errorCode === 'not_found' && !historyPageResult.value) {
            return null;
        }

        const historyResult = await this.storage.loadHistoryWithStatus(conversationId);
        const fallback = this.createFallbackMetadata(conversationId, historyResult.value);
        if (integrityStatus) {
            fallback.integrityStatus = integrityStatus;
        }
        return fallback;
    }

    getMetadataRepository(): ConversationMetadataRepository {
        /**
         * 修改原因：P1 新服务不能继续直接使用裸 custom 字典，否则 schemaVersion、白名单和并发写策略会分叉。
         * 修改方式：ConversationManager 暴露 typed repository 工厂，repository 再回调 updateCustomMetadata 串行更新。
         * 修改目的：让 ContextProjectionStore、ContextLedgerService 和 SubAgent/Monitor 后续扩展复用同一事实源入口。
         */
        return new ConversationMetadataRepository(this);
    }

    async updateCustomMetadata(
        conversationId: string,
        updater: (custom: Record<string, unknown>, metadata: ConversationMetadata) => void | Promise<void>
    ): Promise<ConversationMetadata> {
        /**
         * 修改原因：原 setCustomMetadata 是“load -> 改一个 key -> save”，并发调用会丢失其他 P1 域刚写入的 custom key。
         * 修改方式：把同一 conversationId 的 metadata 更新串成 promise 队列，并在回调内统一补齐 schemaVersion/custom/updatedAt。
         * 修改目的：不改变 IStorageAdapter 的前提下，给中央事实源提供原子读改写边界。
         */
        const previous = this.metadataUpdateQueues.get(conversationId) || Promise.resolve();
        let nextMetadata!: ConversationMetadata;
        const next = previous.catch(() => undefined).then(async () => {
            let meta = await this.loadMetadataForWrite(conversationId);
            if (!meta) {
                meta = {
                    id: conversationId,
                    title: t('modules.conversation.defaultTitle', { conversationId }),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
                    custom: {}
                };
            }
            if (typeof meta.schemaVersion !== 'number') {
                meta.schemaVersion = CONVERSATION_METADATA_SCHEMA_VERSION;
            }
            if (!meta.custom) {
                meta.custom = {};
            }
            await updater(meta.custom, meta);
            meta.updatedAt = Date.now();
            await this.storage.saveMetadata(meta);
            nextMetadata = meta;
        });
        this.metadataUpdateQueues.set(conversationId, next);
        try {
            await next;
            return nextMetadata;
        } finally {
            if (this.metadataUpdateQueues.get(conversationId) === next) {
                this.metadataUpdateQueues.delete(conversationId);
            }
        }
    }

    /**
     * 设置自定义元数据
     */
    async setCustomMetadata(
        conversationId: string,
        key: string,
        value: unknown
    ): Promise<void> {
        await this.updateCustomMetadata(conversationId, custom => {
            custom[key] = value;
        });
    }

    /**
     * 获取自定义元数据
     */
    async getCustomMetadata(conversationId: string, key: string): Promise<unknown> {
        const meta = await this.loadStoredMetadata(conversationId);
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
    ): Promise<{
        modified: boolean;
        insertedIndex?: number;
        rejectedToolCalls: Array<{ id: string; name: string }>;
        functionResponseContent?: Content;
    }> {
        const repository = this.getTranscriptRepository(conversationId);
        const history = await repository.getContents();
        
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
        
        let functionResponseContent: Content | undefined;
        let insertedIndex: number | undefined;

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
            insertedIndex = messageIndex + 1;
            functionResponseContent = {
                role: 'user',
                parts: rejectedResponseParts,
                isFunctionResponse: true
            };
            history.splice(insertedIndex, 0, functionResponseContent);
            modified = true;
        }
        
        if (modified) {
            // 修改原因：rejectToolCalls 修改的是现有 transcript 内容，应该通过统一 replace 入口保存。
            // 修改方式：保留原有拒绝语义与 functionResponse 插入逻辑，只把最终持久化改为 repository.replaceContents。
            // 修改目的：避免主聊天在 transcript 仓储引入后继续保留第二条同语义写路径。
            await repository.replaceContents(history);
            await this.invalidateContextManagementState(conversationId, 'tool_calls_rejected');
        }

        return {
            modified,
            insertedIndex,
            rejectedToolCalls: rejectedCalls,
            functionResponseContent
        };
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
        const repository = this.getTranscriptRepository(conversationId);
        const history = await repository.getContents();
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
            
            // 修改原因：rejectAllPendingToolCalls 与 rejectToolCalls 同属 transcript 变更，应该共享统一 replace 入口。
            // 修改方式：沿用原有批量补 rejected functionResponse 逻辑，再通过 repository.replaceContents 落盘。
            // 修改目的：把主聊天所有“修改现有 transcript 后保存”的热路径继续收敛到统一接口。
            await repository.replaceContents(history);
            await this.invalidateContextManagementState(conversationId, 'pending_tool_calls_rejected');
        }
    }
}
