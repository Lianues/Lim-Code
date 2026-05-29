/**
 * LimCode - typed conversation metadata repository
 *
 * 修改原因：P1 方案要求 ConversationMetadata.custom 成为中央事实源，但裸 setCustomMetadata 会让多个服务并发覆盖写同一份 metadata。
 * 修改方式：新增 typed repository，只允许白名单 key，通过 ConversationManager.updateCustomMetadata 串行读改写，并在读取时执行类型守卫。
 * 修改目的：让 context projection、ledger、artifact、Monitor 和 SubAgent record 都有统一的 schema/migration 边界。
 */

import type { ConversationMetadata } from './types';
import {
    CONVERSATION_ARTIFACT_REFS_KEY,
    CONVERSATION_CONTEXT_LEDGER_KEY,
    CONVERSATION_CONTEXT_PROJECTION_KEY,
    CONVERSATION_METADATA_SCHEMA_VERSION,
    CONVERSATION_MONITOR_WINDOW_STATE_KEY,
    CONVERSATION_SUBAGENT_RUNS_KEY,
    createEmptyArtifactRefDocument,
    createEmptyContextLedgerDocument,
    createEmptyContextProjectionDocument,
    createEmptyMonitorWindowStateDocument,
    isArtifactRefDocument,
    isContextLedgerDocument,
    isContextProjectionDocument,
    isConversationCustomMetadataKey,
    isMonitorWindowStateDocument,
    type ArtifactRefDocument,
    type ContextLedgerDocument,
    type ContextProjectionDocument,
    type ConversationCustomMetadataKey,
    type MonitorWindowStateDocument
} from './contextTypes';

export interface ConversationMetadataRepositoryDelegate {
    getMetadata(conversationId: string): Promise<ConversationMetadata | null>;
    updateCustomMetadata(
        conversationId: string,
        updater: (custom: Record<string, unknown>, metadata: ConversationMetadata) => void | Promise<void>
    ): Promise<ConversationMetadata>;
}

export class ConversationMetadataRepository {
    constructor(private readonly delegate: ConversationMetadataRepositoryDelegate) {}

    async getMetadata(conversationId: string): Promise<ConversationMetadata> {
        const metadata = await this.delegate.getMetadata(conversationId);
        if (!metadata) {
            /**
             * 修改原因：typed repository 的调用方需要一个稳定 metadata 视图，即使历史会话还没有 .meta.json。
             * 修改方式：只读路径返回内存 fallback；真正的持久化仍由 updateCustomMetadata 负责创建。
             * 修改目的：让 status/projection 读取不因为 meta 缺失而提前失败。
             */
            const now = Date.now();
            return { id: conversationId, createdAt: now, updatedAt: now, schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION, custom: {} };
        }
        if (typeof metadata.schemaVersion !== 'number') {
            /**
             * 修改原因：旧会话 metadata 没有 schemaVersion，直接报错会让历史会话无法打开。
             * 修改方式：读取时返回带默认版本的浅拷贝，真正写回由 update 路径完成。
             * 修改目的：支持惰性迁移和只读降级判断，同时不在只读路径制造额外写入。
             */
            return { ...metadata, schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION };
        }
        return metadata;
    }

    async getCustomValue<T>(
        conversationId: string,
        key: ConversationCustomMetadataKey,
        guard: (value: unknown) => value is T,
        fallback: () => T
    ): Promise<T> {
        this.assertKnownKey(key);
        const metadata = await this.getMetadata(conversationId);
        const value = metadata.custom?.[key];
        if (guard(value)) {
            return value;
        }
        return fallback();
    }

    async setCustomValue<T>(conversationId: string, key: ConversationCustomMetadataKey, value: T): Promise<ConversationMetadata> {
        this.assertKnownKey(key);
        return await this.delegate.updateCustomMetadata(conversationId, custom => {
            custom[key] = value;
        });
    }

    async updateCustomValue<T>(
        conversationId: string,
        key: ConversationCustomMetadataKey,
        guard: (value: unknown) => value is T,
        fallback: () => T,
        updater: (value: T) => T | void | Promise<T | void>
    ): Promise<T> {
        this.assertKnownKey(key);
        let nextValue = fallback();
        await this.delegate.updateCustomMetadata(conversationId, async custom => {
            const current = guard(custom[key]) ? custom[key] as T : fallback();
            const updated = await updater(current);
            // 修改原因：updater 允许通过 void 表示“原地修改 current 后沿用它”，但泛型 T 无法从 void | T 自动收窄。
            // 修改方式：显式判断 undefined，再把结果作为 T 写回。
            // 修改目的：保留原地更新 ergonomics，同时让 typed metadata repository 通过严格 TypeScript 编译。
            nextValue = (updated === undefined ? current : updated) as T;
            custom[key] = nextValue;
        });
        return nextValue;
    }

    async getContextProjectionDocument(conversationId: string): Promise<ContextProjectionDocument> {
        return await this.getCustomValue(
            conversationId,
            CONVERSATION_CONTEXT_PROJECTION_KEY,
            isContextProjectionDocument,
            createEmptyContextProjectionDocument
        );
    }

    async updateContextProjectionDocument(
        conversationId: string,
        updater: (document: ContextProjectionDocument) => ContextProjectionDocument | void | Promise<ContextProjectionDocument | void>
    ): Promise<ContextProjectionDocument> {
        return await this.updateCustomValue(
            conversationId,
            CONVERSATION_CONTEXT_PROJECTION_KEY,
            isContextProjectionDocument,
            createEmptyContextProjectionDocument,
            updater
        );
    }

    async getContextLedgerDocument(conversationId: string): Promise<ContextLedgerDocument> {
        return await this.getCustomValue(
            conversationId,
            CONVERSATION_CONTEXT_LEDGER_KEY,
            isContextLedgerDocument,
            createEmptyContextLedgerDocument
        );
    }

    async updateContextLedgerDocument(
        conversationId: string,
        updater: (document: ContextLedgerDocument) => ContextLedgerDocument | void | Promise<ContextLedgerDocument | void>
    ): Promise<ContextLedgerDocument> {
        return await this.updateCustomValue(
            conversationId,
            CONVERSATION_CONTEXT_LEDGER_KEY,
            isContextLedgerDocument,
            createEmptyContextLedgerDocument,
            updater
        );
    }

    async getArtifactRefDocument(conversationId: string): Promise<ArtifactRefDocument> {
        return await this.getCustomValue(
            conversationId,
            CONVERSATION_ARTIFACT_REFS_KEY,
            isArtifactRefDocument,
            createEmptyArtifactRefDocument
        );
    }

    async getMonitorWindowStateDocument(conversationId: string): Promise<MonitorWindowStateDocument> {
        return await this.getCustomValue(
            conversationId,
            CONVERSATION_MONITOR_WINDOW_STATE_KEY,
            isMonitorWindowStateDocument,
            createEmptyMonitorWindowStateDocument
        );
    }

    async updateSubAgentRunsValue(
        conversationId: string,
        updater: (runs: Record<string, unknown>) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>
    ): Promise<Record<string, unknown>> {
        /**
         * 修改原因：现有 SubAgent runEventBus 已经使用 subAgentRuns key 持久化 transcript window，P1 不能另建同义 key。
         * 修改方式：typed repository 提供 subAgentRuns 的白名单串行更新入口，兼容 legacy record map 的开放结构。
         * 修改目的：把 SubAgentRunRecord/ArtifactRef 后续扩展纳入中央事实源写路径，同时不破坏已有历史 run 恢复。
         */
        return await this.updateCustomValue(
            conversationId,
            CONVERSATION_SUBAGENT_RUNS_KEY,
            isPlainRecord,
            () => ({}),
            updater
        );
    }

    private assertKnownKey(key: string): asserts key is ConversationCustomMetadataKey {
        if (!isConversationCustomMetadataKey(key)) {
            throw new Error(`Unsupported conversation custom metadata key: ${key}`);
        }
    }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
