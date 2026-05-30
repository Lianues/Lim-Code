/**
 * LimCode - ContextOperationService
 *
 * 修改原因：trim、compact、summarize、undo、restore、reset 不能分别在 handler 或 service 中各写一套 projection/ledger 逻辑。
 * 修改方式：新增统一操作服务，所有上下文命令都先写 ledger，再通过 projection store 或 summarize service 执行，最后标记 success/failed。
 * 修改目的：保证可逆、有损、恢复边界和失败降级语义一致。
 */

import { t } from '../../../../i18n';
import type { ConversationManager } from '../../../conversation/ConversationManager';
import type { ConfigManager } from '../../../config/ConfigManager';
import type { Content } from '../../../conversation/types';
import type { UiStatusPayload } from '../../../conversation/contextTypes';
import { CONVERSATION_METADATA_SCHEMA_VERSION, type ContextLedgerEntry } from '../../../conversation/contextTypes';
import type { SummarizeService } from './SummarizeService';
import type { ContextProjectionStore } from './ContextProjectionStore';
import type { ContextLedgerService } from './ContextLedgerService';
import type { ContextStatusService } from './ContextStatusService';
import type { ContextTrimService } from './ContextTrimService';

export interface ContextOperationRequest {
    conversationId: string;
    configId?: string;
    command: string;
    args?: string[];
    actor?: 'system' | 'user' | 'slash_command';
    abortSignal?: AbortSignal;
}

export class ContextOperationService {
    constructor(
        private readonly conversationManager: ConversationManager,
        private readonly configManager: ConfigManager,
        private readonly summarizeService: SummarizeService,
        private readonly contextTrimService: ContextTrimService,
        private readonly projectionStore: ContextProjectionStore,
        private readonly ledgerService: ContextLedgerService,
        private readonly statusService: ContextStatusService
    ) {}

    async status(request: ContextOperationRequest): Promise<UiStatusPayload> {
        const status = await this.statusService.getStatus(request.conversationId);
        return {
            schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
            kind: status.degradedReason ? 'warning' : 'status',
            title: t('modules.api.chat.contextCommands.status.title'),
            description: this.describeStatus(status),
            iconName: status.degradedReason ? 'warning' : 'context-status',
            status,
            projectionId: status.projection?.projectionId,
            ledgerEntryId: status.lastOperation?.ledgerEntryId,
            lossy: status.projection?.lossy,
            reversible: status.projection?.reversible,
            nextActions: status.nextActions
        };
    }

    async compact(request: ContextOperationRequest): Promise<UiStatusPayload> {
        if (!request.configId) {
            // 修改原因：compact 状态 payload 会直接展示给用户，不能继续固定英文。
            // 修改方式：通过后端 i18n 的 contextCommands.compact 命名空间读取标题和描述。
            // 修改目的：让按钮、slash 命令和非流式兼容路径共享同一套本地化文案。
            return this.errorPayload(
                t('modules.api.chat.contextCommands.compact.missingConfigTitle'),
                t('modules.api.chat.contextCommands.compact.missingConfigDescription'),
                'manual_compact'
            );
        }
        const config = await this.configManager.getConfig(request.configId);
        if (!config) {
            return this.errorPayload(
                t('modules.api.chat.contextCommands.compact.failedTitle'),
                t('modules.api.chat.contextCommands.compact.configNotFoundDescription', { configId: request.configId }),
                'manual_compact'
            );
        }
        if (!config.enabled) {
            return this.errorPayload(
                t('modules.api.chat.contextCommands.compact.failedTitle'),
                t('modules.api.chat.contextCommands.compact.configDisabledDescription', { configId: request.configId }),
                'manual_compact'
            );
        }

        const mode = config.contextManagementMode === 'summarize' ? 'summarize' : 'trim';
        if (mode === 'summarize') {
            return await this.runSummarizeLikeOperation(request, 'manual_compact');
        }
        return await this.runTrimLikeOperation(request);
    }

    async summarize(request: ContextOperationRequest): Promise<UiStatusPayload> {
        return await this.runSummarizeLikeOperation(request, 'manual_summarize');
    }

    async undo(request: ContextOperationRequest): Promise<UiStatusPayload> {
        const latest = await this.ledgerService.findLatestReversibleSuccess(request.conversationId);
        if (!latest?.beforeProjectionId) {
            return this.errorPayload(t('modules.api.chat.contextCommands.undo.unavailableTitle'), t('modules.api.chat.contextCommands.undo.unavailableDescription'), 'context-undo');
        }
        const ledger = await this.ledgerService.beginOperation({
            conversationId: request.conversationId,
            operation: 'undo',
            actor: request.actor ?? 'slash_command',
            reason: `Undo ${latest.ledgerEntryId}`,
            beforeProjectionId: latest.afterProjectionId,
            reversible: true,
            lossy: false
        });
        try {
            const projection = await this.projectionStore.restoreProjection(request.conversationId, latest.beforeProjectionId, 'undo');
            const updated = await this.ledgerService.markSuccess(request.conversationId, ledger.ledgerEntryId, {
                afterProjectionId: projection.projectionId
            });
            return this.successPayload(t('modules.api.chat.contextCommands.undo.completeTitle'), t('modules.api.chat.contextCommands.undo.completeDescription'), projection.projectionId, updated);
        } catch (error) {
            await this.ledgerService.markFailed(request.conversationId, ledger.ledgerEntryId, this.toError(error), t('modules.api.chat.contextCommands.undo.recoveryHint'));
            return this.errorPayload(t('modules.api.chat.contextCommands.undo.failedTitle'), error instanceof Error ? error.message : String(error), 'context-undo');
        }
    }

    async restore(request: ContextOperationRequest): Promise<UiStatusPayload> {
        const projectionId = request.args?.[0];
        if (!projectionId) {
            return this.errorPayload(t('modules.api.chat.contextCommands.restore.missingProjectionIdTitle'), t('modules.api.chat.contextCommands.restore.missingProjectionIdDescription'), 'context-restore');
        }
        const current = await this.projectionStore.getCurrentProjection(request.conversationId);
        const ledger = await this.ledgerService.beginOperation({
            conversationId: request.conversationId,
            operation: 'restore',
            actor: request.actor ?? 'slash_command',
            reason: `Restore projection ${projectionId}`,
            beforeProjectionId: current?.projectionId,
            reversible: true,
            lossy: false
        });
        try {
            const projection = await this.projectionStore.restoreProjection(request.conversationId, projectionId, 'restore');
            const updated = await this.ledgerService.markSuccess(request.conversationId, ledger.ledgerEntryId, {
                afterProjectionId: projection.projectionId
            });
            return this.successPayload(t('modules.api.chat.contextCommands.restore.completeTitle'), projection.restoreBoundary?.message || t('modules.api.chat.contextCommands.restore.completeDescription'), projection.projectionId, updated);
        } catch (error) {
            await this.ledgerService.markFailed(request.conversationId, ledger.ledgerEntryId, this.toError(error), t('modules.api.chat.contextCommands.restore.recoveryHint'));
            return this.errorPayload(t('modules.api.chat.contextCommands.restore.failedTitle'), error instanceof Error ? error.message : String(error), 'context-restore');
        }
    }

    async reset(request: ContextOperationRequest): Promise<UiStatusPayload> {
        const current = await this.projectionStore.getCurrentProjection(request.conversationId);
        const ledger = await this.ledgerService.beginOperation({
            conversationId: request.conversationId,
            operation: 'reset',
            actor: request.actor ?? 'slash_command',
            reason: 'Reset context projection from immutable history',
            beforeProjectionId: current?.projectionId,
            reversible: true,
            lossy: false
        });
        try {
            const projection = await this.projectionStore.resetProjection(request.conversationId, ledger.ledgerEntryId);
            const updated = await this.ledgerService.markSuccess(request.conversationId, ledger.ledgerEntryId, {
                afterProjectionId: projection.projectionId
            });
            return this.successPayload(t('modules.api.chat.contextCommands.reset.completeTitle'), t('modules.api.chat.contextCommands.reset.completeDescription'), projection.projectionId, updated);
        } catch (error) {
            await this.ledgerService.markFailed(request.conversationId, ledger.ledgerEntryId, this.toError(error), t('modules.api.chat.contextCommands.reset.recoveryHint'));
            return this.errorPayload(t('modules.api.chat.contextCommands.reset.failedTitle'), error instanceof Error ? error.message : String(error), 'context-reset');
        }
    }

    private async runTrimLikeOperation(request: ContextOperationRequest): Promise<UiStatusPayload> {
        const history = await this.conversationManager.getHistory(request.conversationId);
        const current = await this.projectionStore.getCurrentProjection(request.conversationId);
        const baseStartIndex = current ? Math.min(Math.max(0, current.startIndex), Math.max(0, history.length - 1)) : 0;
        const rounds = this.contextTrimService.identifyRounds(history.slice(baseStartIndex));
        const keepRecentRounds = 2;

        if (rounds.length <= keepRecentRounds) {
            return {
                schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
                kind: 'warning',
                title: t('modules.api.chat.contextCommands.compact.notNeededTitle'),
                description: t('modules.api.chat.contextCommands.compact.notNeededDescription', { rounds: rounds.length }),
                iconName: 'warning',
                projectionId: current?.projectionId,
                reversible: current?.reversible,
                lossy: current?.lossy,
                nextActions: ['/context-status', '/summarize']
            };
        }

        const trimRound = rounds[Math.max(0, rounds.length - keepRecentRounds)];
        const trimStartIndex = baseStartIndex + trimRound.startIndex;
        if (trimStartIndex <= baseStartIndex) {
            return this.errorPayload(
                t('modules.api.chat.contextCommands.compact.unavailableTitle'),
                t('modules.api.chat.contextCommands.compact.unavailableNoBoundaryDescription'),
                'manual_compact'
            );
        }

        const tokenBefore = this.estimateHistoryTokens(history, baseStartIndex);
        const tokenAfter = this.estimateHistoryTokens(history, trimStartIndex);
        const ledger = await this.ledgerService.beginOperation({
            conversationId: request.conversationId,
            operation: 'manual_compact',
            actor: request.actor ?? 'slash_command',
            reason: `Manual compact by trim mode to start index ${trimStartIndex}`,
            beforeProjectionId: current?.projectionId,
            range: { startIndex: baseStartIndex, endIndexExclusive: trimStartIndex },
            reversible: true,
            lossy: false,
            tokenBefore
        });

        try {
            const projection = await this.projectionStore.createProjection({
                conversationId: request.conversationId,
                mode: 'trimmed',
                startIndex: trimStartIndex,
                reversible: true,
                lossy: false,
                cause: 'manual_compact',
                predecessorId: current?.projectionId,
                sourceLedgerEntryId: ledger.ledgerEntryId,
                tokenEstimate: { before: tokenBefore, after: tokenAfter },
                restoreBoundary: {
                    kind: 'full_history',
                    message: t('modules.api.chat.contextCommands.compact.restoreBoundaryMessage')
                }
            });
            const updated = await this.ledgerService.markSuccess(request.conversationId, ledger.ledgerEntryId, {
                afterProjectionId: projection.projectionId,
                tokenAfter
            });
            return this.successPayload(
                t('modules.api.chat.contextCommands.compact.completeTitle'),
                t('modules.api.chat.contextCommands.compact.trimmedDescription', { keepRecentRounds }),
                projection.projectionId,
                updated,
                tokenBefore,
                tokenAfter,
                false,
                true
            );
        } catch (error) {
            await this.ledgerService.markFailed(request.conversationId, ledger.ledgerEntryId, this.toError(error), t('modules.api.chat.contextCommands.compact.recoveryHint'));
            return this.errorPayload(t('modules.api.chat.contextCommands.compact.failedTitle'), error instanceof Error ? error.message : String(error), 'manual_compact');
        }
    }

    private estimateHistoryTokens(history: readonly Content[], startIndex: number): number {
        // 修改原因：手动 trim 不调用模型生成摘要，但前端环状指示灯仍需要一个压缩后的即时用量估计。
        // 修改方式：优先使用消息已持久化的 token metadata，缺失时按文本长度做保守近似估算。
        // 修改目的：compact 成功后可以立即刷新 UI 用量，而不用等待下一轮 provider usage。
        let total = 0;
        for (let i = Math.max(0, startIndex); i < history.length; i++) {
            const message = history[i];
            const byChannel = message.tokenCountByChannel ? Object.values(message.tokenCountByChannel).find(value => typeof value === 'number') : undefined;
            if (typeof byChannel === 'number') {
                total += byChannel;
                continue;
            }
            if (typeof message.estimatedTokenCount === 'number') {
                total += message.estimatedTokenCount;
                continue;
            }
            if (message.usageMetadata) {
                total += Math.max(0, message.usageMetadata.candidatesTokenCount ?? 0);
                total += Math.max(0, message.usageMetadata.thoughtsTokenCount ?? 0);
                continue;
            }
            const text = (message.parts || []).map(part => part.text || '').join('\n');
            total += Math.max(1, Math.ceil(text.length / 4));
        }
        return total;
    }

    private async runSummarizeLikeOperation(request: ContextOperationRequest, operation: 'manual_compact' | 'manual_summarize'): Promise<UiStatusPayload> {
        if (!request.configId) {
            // 修改原因：manual compact 在 summarize 模式下会复用 summarize-like 操作，失败标题也需要按界面语言显示。
            // 修改方式：把配置缺失、成功、失败、restore boundary 文案统一改为 i18n key。
            // 修改目的：避免同一条 compact 操作在不同分支出现中英混排。
            return this.errorPayload(
                t('modules.api.chat.contextCommands.summarize.missingConfigTitle'),
                t('modules.api.chat.contextCommands.summarize.missingConfigDescription'),
                operation
            );
        }
        const current = await this.projectionStore.getCurrentProjection(request.conversationId);
        const ledger = await this.ledgerService.beginOperation({
            conversationId: request.conversationId,
            operation,
            actor: request.actor ?? 'slash_command',
            reason: operation === 'manual_compact' ? 'Manual compact command' : 'Manual summarize command',
            beforeProjectionId: current?.projectionId,
            reversible: false,
            lossy: true
        });

        try {
            const result = await this.summarizeService.handleSummarizeContext({
                conversationId: request.conversationId,
                configId: request.configId,
                abortSignal: request.abortSignal
            });
            if (result.success !== true) {
                throw new Error(result.error.message);
            }
            const projection = await this.projectionStore.createProjection({
                conversationId: request.conversationId,
                mode: 'summarized',
                startIndex: Math.max(0, result.insertIndex ?? 0),
                summaryMessageIndex: result.insertIndex,
                reversible: false,
                lossy: true,
                cause: operation,
                predecessorId: current?.projectionId,
                sourceLedgerEntryId: ledger.ledgerEntryId,
                tokenEstimate: {
                    before: result.beforeTokenCount,
                    after: result.afterTokenCount
                },
                restoreBoundary: {
                    kind: 'lossy_summary',
                    message: t('modules.api.chat.contextCommands.summarize.restoreBoundaryMessage')
                }
            });
            const updated = await this.ledgerService.markSuccess(request.conversationId, ledger.ledgerEntryId, {
                afterProjectionId: projection.projectionId,
                tokenAfter: result.afterTokenCount
            });
            return this.successPayload(
                operation === 'manual_compact'
                    ? t('modules.api.chat.contextCommands.summarize.compactCompleteTitle')
                    : t('modules.api.chat.contextCommands.summarize.summarizeCompleteTitle'),
                t('modules.api.chat.contextCommands.summarize.summarizedDescription', { count: result.summarizedMessageCount }),
                projection.projectionId,
                updated,
                result.beforeTokenCount,
                result.afterTokenCount,
                true,
                false
            );
        } catch (error) {
            await this.ledgerService.markFailed(request.conversationId, ledger.ledgerEntryId, this.toError(error), t('modules.api.chat.contextCommands.summarize.recoveryHint'));
            return this.errorPayload(
                operation === 'manual_compact'
                    ? t('modules.api.chat.contextCommands.summarize.compactFailedTitle')
                    : t('modules.api.chat.contextCommands.summarize.summarizeFailedTitle'),
                error instanceof Error ? error.message : String(error),
                operation
            );
        }
    }

    private describeStatus(status: Awaited<ReturnType<ContextStatusService['getStatus']>>): string {
        const projection = status.projection;
        if (status.degradedReason) {
            // 修改原因：/context-status 是用户诊断入口，降级状态不能只暴露内部字段名或让用户猜下一步。
            // 修改方式：优先把 degradedReason 写成面向用户的状态说明，并提示可用 nextActions。
            // 修改目的：让用户看到命令结果时能理解“哪里不可信”和“下一步可以做什么”。
            return t('modules.api.chat.contextCommands.status.degradedDescription', { reason: status.degradedReason, count: status.historyLength ?? 0 });
        }
        if (!projection) {
            // 修改原因：/context-status 的描述也会出现在 compact/summarize 的后续操作中，不能保留硬编码英文。
            // 修改方式：把完整历史和当前 projection 两种状态描述拆成 i18n 模板。
            // 修改目的：让 context command 卡片在所有状态下都使用同一语言环境。
            return t('modules.api.chat.contextCommands.status.noProjectionDescription', {
                historyLength: status.historyLength ?? 0,
                ledgerCount: status.ledgerEntryCount
            });
        }
        return t('modules.api.chat.contextCommands.status.projectionDescription', {
            projectionId: projection.projectionId,
            mode: projection.mode,
            startIndex: projection.startIndex,
            lossiness: projection.lossy
                ? t('modules.api.chat.contextCommands.status.lossySummaryData')
                : t('modules.api.chat.contextCommands.status.losslessTrimmedHistory'),
            reversibility: projection.reversible
                ? t('modules.api.chat.contextCommands.status.reversibleProjection')
                : t('modules.api.chat.contextCommands.status.irreversibleProjection'),
            ledgerCount: status.ledgerEntryCount
        });
    }

    private successPayload(
        title: string,
        description: string,
        projectionId: string | undefined,
        ledger: ContextLedgerEntry,
        tokenBefore?: number,
        tokenAfter?: number,
        lossy = false,
        reversible = true
    ): UiStatusPayload {
        return {
            schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
            kind: 'success',
            title,
            description,
            iconName: 'check',
            projectionId,
            ledgerEntryId: ledger.ledgerEntryId,
            tokenBefore,
            tokenAfter,
            lossy,
            reversible,
            nextActions: ['/context-status', '/context-undo', '/context-reset']
        };
    }

    private errorPayload(title: string, description: string, command: string): UiStatusPayload {
        return {
            schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
            kind: 'error',
            title,
            description,
            iconName: 'error',
            command,
            nextActions: ['/context-status']
        };
    }

    private toError(error: unknown): { code: string; message: string } {
        return {
            code: error instanceof Error ? error.name || 'CONTEXT_OPERATION_ERROR' : 'CONTEXT_OPERATION_ERROR',
            message: error instanceof Error ? error.message : String(error)
        };
    }
}
