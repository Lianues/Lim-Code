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
        // 修改原因：SubAgent serializer 的截断提示已接入 i18n，测试不能再硬编码英文提示，否则中文环境会误判失败。
        // 修改方式：只断言语言无关的 Monitor 定位信息和原始长度元数据仍在 summary 中。
        // 目的：既保留“完整输出在 Monitor 中查看”的契约，又允许用户语言环境决定最终文案。
        expect(data.summary).toContain('SubAgent Monitor');
        expect(data.summary).toContain(String(raw.length));
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
