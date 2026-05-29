/**
 * LimCode - ContextStatusService
 *
 * 修改原因：/context-status、状态卡片和诊断入口都需要同一份上下文健康视图，不能在命令、UI 和日志里重复拼状态。
 * 修改方式：聚合 ConversationManager、ContextProjectionStore 和 ContextLedgerService，返回 ContextStatusSnapshot。
 * 修改目的：让用户能理解当前 projection、ledger、旧会话兼容状态和下一步可执行动作。
 */

import type { ConversationManager } from '../../../conversation/ConversationManager';
import type { ContextStatusSnapshot } from '../../../conversation/contextTypes';
import { CONVERSATION_METADATA_SCHEMA_VERSION } from '../../../conversation/contextTypes';
import type { ContextProjectionStore } from './ContextProjectionStore';
import type { ContextLedgerService } from './ContextLedgerService';

export class ContextStatusService {
    constructor(
        private readonly conversationManager: ConversationManager,
        private readonly projectionStore: ContextProjectionStore,
        private readonly ledgerService: ContextLedgerService
    ) {}

    async getStatus(conversationId: string): Promise<ContextStatusSnapshot> {
        const [metadata, history, projection, ledgerEntries] = await Promise.all([
            this.conversationManager.getMetadata(conversationId),
            this.conversationManager.getHistory(conversationId),
            this.projectionStore.getCurrentProjection(conversationId),
            this.ledgerService.listEntries(conversationId)
        ]);

        const readonlyLegacy = !metadata || typeof metadata.schemaVersion !== 'number';
        const lastOperation = ledgerEntries.length > 0 ? ledgerEntries[ledgerEntries.length - 1] : undefined;
        const nextActions = this.resolveNextActions(!!projection, readonlyLegacy);

        return {
            conversationId,
            schemaVersion: metadata?.schemaVersion ?? CONVERSATION_METADATA_SCHEMA_VERSION,
            projection,
            ledgerEntryCount: ledgerEntries.length,
            lastOperation,
            historyLength: history.length,
            readonlyLegacy,
            degradedReason: metadata?.integrityStatus && metadata.integrityStatus !== 'ok'
                ? `Conversation storage integrity status: ${metadata.integrityStatus}`
                : undefined,
            nextActions
        };
    }

    private resolveNextActions(hasProjection: boolean, readonlyLegacy: boolean): string[] {
        /**
         * 修改原因：状态卡片不应只展示内部字段，必须告诉用户下一步能做什么。
         * 修改方式：根据 projection/legacy 状态生成可执行 slash command 建议。
         * 修改目的：让 /context-status 成为恢复协议入口，而不是控制台式裸状态。
         */
        const actions = ['/compact', '/summarize'];
        if (hasProjection) {
            actions.push('/context-undo', '/context-restore <projectionId>', '/context-reset');
        } else {
            actions.push('/context-reset');
        }
        if (readonlyLegacy) {
            actions.unshift('/context-reset');
        }
        return Array.from(new Set(actions));
    }
}
