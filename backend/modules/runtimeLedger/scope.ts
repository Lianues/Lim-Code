/**
 * LimCode - Runtime Ledger scope helpers
 *
 * 修改原因：replay、coverage、partial snapshot 和 projection 必须使用同一套 scope 规则，否则会出现不同查询各自成真相。
 * 修改方式：集中生成 scope key 和匹配函数。
 * 修改目的：让后续 Main/Monitor 接入时不会重复发明窗口归属规则。
 */

import type { RuntimeEventEnvelope, RuntimeLedgerScope } from './types';

export function createRuntimeScopeKey(scope: RuntimeLedgerScope): string {
    const parts = [
        scope.conversationId ? `conversation:${scope.conversationId}` : 'conversation:*',
        scope.runId ? `run:${scope.runId}` : 'run:*',
        scope.context ? `context:${scope.context}` : 'context:*',
        scope.subject ? `subject:${scope.subject}` : 'subject:*'
    ];
    return parts.join('|');
}

export function matchesRuntimeScope(event: RuntimeEventEnvelope, scope: RuntimeLedgerScope): boolean {
    if (scope.conversationId && event.conversationId !== scope.conversationId) return false;
    if (scope.runId && event.runId !== scope.runId) return false;
    if (scope.context && event.context !== scope.context) return false;
    if (scope.subject && event.subject !== scope.subject) return false;
    return true;
}
