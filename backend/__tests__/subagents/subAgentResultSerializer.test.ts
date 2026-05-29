import { serializeSubAgentResult } from '../../tools/subagents/resultSerializer';
import type { SubAgentResult } from '../../tools/subagents/types';

describe('SubAgentResultSerializer', () => {
    it('keeps raw long SubAgent output out of the parent tool result while preserving run identity', () => {
        const uniqueTail = 'UNIQUE_RAW_TAIL_SHOULD_NOT_BE_FULLY_PRESENT';
        const raw = `start\n${'A'.repeat(12000)}\n${uniqueTail}`;
        const result: SubAgentResult = {
            success: true,
            response: raw,
            steps: 3,
            runId: 'subagent-run-serializer',
            toolCalls: []
        };

        /**
         * 修改原因：SubAgent raw response 进入主 functionResponse 会污染主对话上下文。
         * 修改方式：serializer 只返回 bounded summary 与 metadata，完整 raw 内容留在 Monitor。
         * 目的：锁定 P1 主对话隔离边界，避免后续又把 result.response 原样塞回 data.response。
         */
        const data = serializeSubAgentResult(result, {
            agentName: 'reviewer',
            channelName: 'Test Channel',
            modelId: 'test-model',
            maxSummaryChars: 2000
        });

        expect(data.outcome).toBe('completed');
        expect(data.runId).toBe('subagent-run-serializer');
        expect(data.response).toBe(data.summary);
        expect(data.summary.length).toBeLessThan(raw.length);
        expect(data.truncated).toBe(true);
        expect(data.fullResponseChars).toBe(raw.length);
        expect(data.summary).toContain('Full output remains available in the SubAgent Monitor');
        expect(JSON.stringify(data)).not.toContain('A'.repeat(6000));
    });

    it('extracts artifact refs from SubAgent output paths instead of hiding them only in prose', () => {
        const data = serializeSubAgentResult({
            success: true,
            response: 'Report written to docs/pm/context-compression-monitor/reports/example.md and backend/tools/subagents/resultSerializer.ts',
            runId: 'artifact-run',
            toolCalls: []
        }, { agentName: 'worker' });

        expect(data.artifacts.map((artifact: any) => artifact.path)).toEqual(expect.arrayContaining([
            'docs/pm/context-compression-monitor/reports/example.md',
            'backend/tools/subagents/resultSerializer.ts'
        ]));
    });

    it('serializes cancelled and partial runs with bounded partialResponse and runId', () => {
        const result: SubAgentResult = {
            success: false,
            response: 'partial investigation result',
            steps: 1,
            runId: 'subagent-run-cancelled',
            toolCalls: [],
            cancelled: true,
            error: 'User cancelled the sub-agent execution.'
        };

        const data = serializeSubAgentResult(result, { agentName: 'worker' });

        expect(data.outcome).toBe('cancelled');
        expect(data.partialResponse).toBe('partial investigation result');
        expect(data.errors[0].message).toContain('User cancelled');
        expect(data.provenance.runId).toBe('subagent-run-cancelled');
    });
});
