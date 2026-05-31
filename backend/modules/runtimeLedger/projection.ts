/**
 * LimCode - Runtime projection builder
 *
 * 修改原因：UI 最终只能消费 projection，不能直接拼接散乱事件或根据缺失字段猜状态。
 * 修改方式：从 RuntimeEventEnvelope 顺序折叠出一个最小可测试 projection；全局物理序号只在未 scoped 的总账视图中检查。
 * 修改目的：先锁定 projection 契约，后续再扩展成 Main/Monitor 的完整 render model。
 */

import type {
    RuntimeEventEnvelope,
    RuntimeLedgerScope,
    RuntimeProjection
} from './types';
import { createRuntimeScopeKey, matchesRuntimeScope } from './scope';

const TOOL_STATE_BY_PHASE: Record<string, RuntimeProjection['toolStatesByInvocationId'][string]> = {
    queued: 'queued',
    started: 'executing',
    executing: 'executing',
    completed: 'success',
    success: 'success',
    failed: 'error',
    error: 'error',
    cancelled: 'cancelled',
    canceled: 'cancelled'
};

export function buildRuntimeProjection(
    events: RuntimeEventEnvelope[],
    scope: RuntimeLedgerScope,
    now: () => number = () => Date.now()
): RuntimeProjection {
    const scopedEvents = events.filter(event => matchesRuntimeScope(event, scope)).sort((a, b) => a.sequence - b.sequence);
    const diagnostics: string[] = [];
    const eventCountsByType: Record<string, number> = {};
    const eventCountsByContext: Record<string, number> = {};
    const toolStatesByInvocationId: RuntimeProjection['toolStatesByInvocationId'] = {};
    let previousSequence: number | undefined;
    // Scoped projections filter out other runs/contexts, so global envelope sequence gaps are expected there.
    // Run-local ordering belongs to coverage.eventSequence and producer-specific eventSequence fields.
    const shouldCheckGlobalEnvelopeGaps = !scope.conversationId && !scope.runId && !scope.context && !scope.subject;

    for (const event of scopedEvents) {
        eventCountsByType[event.eventType] = (eventCountsByType[event.eventType] ?? 0) + 1;
        eventCountsByContext[event.context] = (eventCountsByContext[event.context] ?? 0) + 1;
        if (shouldCheckGlobalEnvelopeGaps && previousSequence !== undefined && event.sequence !== previousSequence + 1) {
            diagnostics.push(`gap:${previousSequence}->${event.sequence}`);
        }
        previousSequence = event.sequence;

        if (event.toolInvocationId) {
            const phase = String((event.payload as any)?.phase ?? (event.payload as any)?.status ?? '');
            const mapped = TOOL_STATE_BY_PHASE[phase];
            if (mapped) {
                toolStatesByInvocationId[event.toolInvocationId] = mapped;
            }
            if (event.eventType === 'runtime.tool.function_response') {
                const isError = Boolean((event.payload as any)?.isError);
                toolStatesByInvocationId[event.toolInvocationId] = isError ? 'error' : 'success';
            }
        }
    }

    return {
        projectionId: `rtproj_${createRuntimeScopeKey(scope)}_${previousSequence ?? 0}`,
        scopeKey: createRuntimeScopeKey(scope),
        generatedAt: now(),
        lastEventSequence: previousSequence ?? 0,
        status: diagnostics.length > 0 ? 'degraded' : 'ok',
        diagnostics,
        eventCountsByType,
        eventCountsByContext,
        toolStatesByInvocationId
    };
}
