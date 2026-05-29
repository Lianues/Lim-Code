/**
 * LimCode - ContextProjectionStore
 *
 * 修改原因：旧上下文裁剪只持久化 trimState.startIndex，无法表达 P1 要求的 projection 版本链、可逆/有损边界和 restore/reset 语义。
 * 修改方式：通过 ConversationMetadataRepository 读写 contextProjection 文档，并提供 create/restore/reset/legacy migration 这些纯 projection 操作。
 * 修改目的：让 ContextTrimService、slash command 和未来 UI 都把“当前工作上下文”视为 projection，而不是删除原始历史。
 */

import type { ConversationMetadataRepository } from '../../../conversation/ConversationMetadataRepository';
import {
    CONVERSATION_METADATA_SCHEMA_VERSION,
    type ContextOperationKind,
    type ContextProjection,
    type ContextProjectionDocument,
    type ContextProjectionMode,
    type ContextRestoreBoundary,
    type VerbatimMap
} from '../../../conversation/contextTypes';

export interface CreateContextProjectionInput {
    conversationId: string;
    mode: ContextProjectionMode;
    startIndex: number;
    cause: ContextOperationKind;
    sourceLedgerEntryId?: string;
    predecessorId?: string;
    summaryMessageIndex?: number;
    summaryMessageId?: string;
    reversible: boolean;
    lossy: boolean;
    tokenEstimate?: ContextProjection['tokenEstimate'];
    restoreBoundary?: ContextRestoreBoundary;
    verbatimMap?: VerbatimMap;
}

export class ContextProjectionStore {
    constructor(private readonly metadataRepository: ConversationMetadataRepository) {}

    async getDocument(conversationId: string): Promise<ContextProjectionDocument> {
        return await this.metadataRepository.getContextProjectionDocument(conversationId);
    }

    async getCurrentProjection(conversationId: string): Promise<ContextProjection | undefined> {
        const document = await this.getDocument(conversationId);
        return document.currentProjectionId ? document.projections[document.currentProjectionId] : undefined;
    }

    async createProjection(input: CreateContextProjectionInput): Promise<ContextProjection> {
        const projection: ContextProjection = {
            projectionId: this.createProjectionId(input.cause),
            predecessorId: input.predecessorId,
            conversationId: input.conversationId,
            createdAt: Date.now(),
            mode: input.mode,
            startIndex: Math.max(0, Math.floor(input.startIndex)),
            summaryMessageIndex: input.summaryMessageIndex,
            summaryMessageId: input.summaryMessageId,
            reversible: input.reversible,
            lossy: input.lossy,
            tokenEstimate: input.tokenEstimate,
            cause: input.cause,
            sourceLedgerEntryId: input.sourceLedgerEntryId,
            restoreBoundary: input.restoreBoundary,
            verbatimMap: input.verbatimMap
        };

        await this.metadataRepository.updateContextProjectionDocument(input.conversationId, document => {
            const next: ContextProjectionDocument = {
                schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
                currentProjectionId: projection.projectionId,
                projections: { ...document.projections, [projection.projectionId]: projection },
                legacyTrimStateMigratedAt: document.legacyTrimStateMigratedAt,
                degradedReason: document.degradedReason
            };
            return next;
        });

        return projection;
    }

    async restoreProjection(conversationId: string, projectionId: string, cause: ContextOperationKind = 'restore'): Promise<ContextProjection> {
        let restored: ContextProjection | undefined;
        await this.metadataRepository.updateContextProjectionDocument(conversationId, document => {
            const target = document.projections[projectionId];
            if (!target) {
                throw new Error(`Context projection not found: ${projectionId}`);
            }
            /**
             * 修改原因：restore 不能直接把 currentProjectionId 指向旧对象后丢失操作链，否则用户无法知道这次 restore 发生过。
             * 修改方式：创建一个继承目标边界的新 projection，predecessor 指向 restore 前的 currentProjectionId。
             * 修改目的：保留可审计版本链，同时让当前 projection 表达已恢复到指定版本。
             */
            restored = {
                ...target,
                projectionId: this.createProjectionId(cause),
                predecessorId: document.currentProjectionId,
                createdAt: Date.now(),
                cause
            };
            return {
                ...document,
                schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
                currentProjectionId: restored.projectionId,
                projections: { ...document.projections, [restored.projectionId]: restored }
            };
        });
        return restored!;
    }

    async resetProjection(conversationId: string, sourceLedgerEntryId?: string): Promise<ContextProjection> {
        const current = await this.getCurrentProjection(conversationId);
        return await this.createProjection({
            conversationId,
            mode: 'full',
            startIndex: 0,
            cause: 'reset',
            predecessorId: current?.projectionId,
            sourceLedgerEntryId,
            reversible: true,
            lossy: false,
            restoreBoundary: {
                kind: 'full_history',
                message: 'Projection has been rebuilt from the immutable conversation history.'
            }
        });
    }

    async migrateLegacyTrimState(conversationId: string, trimStartIndex: number): Promise<ContextProjection> {
        const existing = await this.getCurrentProjection(conversationId);
        if (existing) return existing;
        /**
         * 修改原因：旧 trimState 只有 startIndex，但 P1 要求新的 source of truth 是 ContextProjection。
         * 修改方式：首次发现 legacy trimState 时创建 readonly_legacy projection，并记录 legacyTrimStateMigratedAt。
         * 修改目的：兼容旧会话，同时避免继续把 trimState 当作唯一事实源。
         */
        const projection = await this.createProjection({
            conversationId,
            mode: 'readonly_legacy',
            startIndex: trimStartIndex,
            cause: 'migration',
            reversible: true,
            lossy: false,
            restoreBoundary: {
                kind: 'legacy_unknown',
                message: 'Projection was migrated from legacy trimState; exact operation provenance is unavailable.'
            }
        });
        await this.metadataRepository.updateContextProjectionDocument(conversationId, document => ({
            ...document,
            legacyTrimStateMigratedAt: Date.now()
        }));
        return projection;
    }

    private createProjectionId(cause: ContextOperationKind): string {
        return `ctxproj_${cause}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
}
