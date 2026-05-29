import { SubAgentBudgetGovernor, SubAgentConcurrencyGuard, SubAgentDepthGuard, resolveSubAgentGovernancePolicy } from '../../tools/subagents/governance';
import type { SubAgentConfig } from '../../tools/subagents/types';

function config(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
    return {
        type: 'test-agent',
        name: 'Test Agent',
        description: 'test',
        systemPrompt: 'system',
        channel: { channelId: 'test-channel' },
        tools: { mode: 'builtin' },
        enabled: true,
        ...overrides
    };
}

describe('SubAgent P1 governance helpers', () => {
    it('enforces input budget before a SubAgent run starts', () => {
        const policy = resolveSubAgentGovernancePolicy(config({ maxInputChars: 10 }), 3);
        const governor = new SubAgentBudgetGovernor(policy);

        /**
         * 修改原因：SubAgent token budget P1 不能只靠运行结束后截断，超大 prompt/context 应在 run 前拒绝。
         * 修改方式：当前阶段用字符预算作为本地 token budget 近似防线。
         * 目的：防止无界输入直接进入独立子上下文。
         */
        expect(governor.checkInput('12345', '67890').allowed).toBe(true);
        const rejected = governor.checkInput('123456', '78901');
        expect(rejected.allowed).toBe(false);
        expect(rejected.code).toBe('SUBAGENT_INPUT_BUDGET_EXCEEDED');
    });

    it('tracks active concurrency globally and releases slots', () => {
        const guard = new SubAgentConcurrencyGuard();
        const policy = resolveSubAgentGovernancePolicy(config(), 1);

        expect(guard.acquire('run-1', policy).allowed).toBe(true);
        expect(guard.acquire('run-2', policy).allowed).toBe(false);
        expect(guard.getActiveCount()).toBe(1);
        guard.release('run-1');
        expect(guard.acquire('run-2', policy).allowed).toBe(true);
    });

    it('keeps explicit depth guard even though direct recursion is also filtered by tools', () => {
        const policy = resolveSubAgentGovernancePolicy(config({ maxDepth: 1 }), 3);
        const guard = new SubAgentDepthGuard(policy);

        expect(guard.checkDepth(1).allowed).toBe(true);
        expect(guard.checkDepth(2)).toMatchObject({
            allowed: false,
            code: 'SUBAGENT_DEPTH_EXCEEDED'
        });
    });
});
