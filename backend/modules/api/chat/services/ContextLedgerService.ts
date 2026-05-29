/**
 * LimCode - ContextLedgerService
 *
 * 修改原因：P1 要求 trim、compact、summarize、undo、restore、reset 和失败降级全部写入上下文账本，不能静默修改 projection。
 * 修改方式：新增账本服务，统一 begin/success/failure 和最近可逆项查询；所有写入通过 typed metadata repository 串行更新。
 * 修改目的：让 slash command、自动压缩和恢复 UI 都能解释“发生了什么、是否有损、是否可逆、下一步能做什么”。
 */

import type { ConversationMetadataRepository } from '../../../conversation/ConversationMetadataRepository';
import {
    CONVERSATION_METADATA_SCHEMA_VERSION,
    type ContextActor,
    type ContextLedgerEntry,
    type ContextOperationKind
} from '../../../conversation/contextTypes';

export interface BeginContextLedgerOperationInput {
    conversationId: string;
    operation: ContextOperationKind;
    actor: ContextActor;
    reason: string;
    beforeProjectionId?: string;
    range?: { startIndex: number; endIndexExclusive: number };
    reversible: boolean;
    lossy: boolean;
    tokenBefore?: number;
}

export class ContextLedgerService {
    constructor(private readonly metadataRepository: ConversationMetadataRepository) {}

    async listEntries(conversationId: string): Promise<ContextLedgerEntry[]> {
        const document = await this.metadataRepository.getContextLedgerDocument(conversationId);
        return [...document.entries];
    }

    async beginOperation(input: BeginContextLedgerOperationInput): Promise<ContextLedgerEntry> {
        const entry: ContextLedgerEntry = {
            ledgerEntryId: this.createLedgerEntryId(input.operation),
            conversationId: input.conversationId,
            operation: input.operation,
            status: 'pending',
            createdAt: Date.now(),
            actor: input.actor,
            reason: input.reason,
            beforeProjectionId: input.beforeProjectionId,
            range: input.range,
            reversible: input.reversible,
            lossy: input.lossy,
            tokenBefore: input.tokenBefore
        };

        await this.metadataRepository.updateContextLedgerDocument(input.conversationId, document => ({
            schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
            entries: [...document.entries, entry]
        }));

        return entry;
    }

    async markSuccess(
        conversationId: string,
        ledgerEntryId: string,
        patch: { afterProjectionId?: string; tokenAfter?: number } = {}
    ): Promise<ContextLedgerEntry> {
        return await this.updateEntry(conversationId, ledgerEntryId, entry => ({
            ...entry,
            status: 'success',
            completedAt: Date.now(),
            afterProjectionId: patch.afterProjectionId ?? entry.afterProjectionId,
            tokenAfter: patch.tokenAfter ?? entry.tokenAfter
        }));
    }

    async markFailed(
        conversationId: string,
        ledgerEntryId: string,
        error: { code: string; message: string },
        recoveryHint?: string
    ): Promise<ContextLedgerEntry> {
        return await this.updateEntry(conversationId, ledgerEntryId, entry => ({
            ...entry,
            status: 'failed',
            completedAt: Date.now(),
            error,
            recoveryHint
        }));
    }

    async findLatestReversibleSuccess(conversationId: string): Promise<ContextLedgerEntry | undefined> {
        const entries = await this.listEntries(conversationId);
        /**
         * 修改原因：undo 只能基于成功且可逆、非有损的操作，不能把 failed/degraded/lossy 记录当成恢复点。
         * 修改方式：从账本尾部向前查找满足条件的 entry。
         * 修改目的：保证 /context-undo 的恢复边界诚实且可解释。
         */
        return [...entries].reverse().find(entry => entry.status === 'success' && entry.reversible && !entry.lossy && !!entry.beforeProjectionId);
    }

    private async updateEntry(
        conversationId: string,
        ledgerEntryId: string,
        updater: (entry: ContextLedgerEntry) => ContextLedgerEntry
    ): Promise<ContextLedgerEntry> {
        let updated: ContextLedgerEntry | undefined;
        await this.metadataRepository.updateContextLedgerDocument(conversationId, document => {
            const entries = document.entries.map(entry => {
                if (entry.ledgerEntryId !== ledgerEntryId) return entry;
                updated = updater(entry);
                return updated;
            });
            if (!updated) {
                throw new Error(`Context ledger entry not found: ${ledgerEntryId}`);
            }
            return { schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION, entries };
        });
        return updated!;
    }

    private createLedgerEntryId(operation: ContextOperationKind): string {
        return `ctxledger_${operation}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
}
