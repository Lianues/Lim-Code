/**
 * LimCode - SubAgent P1 governance helpers
 *
 * 修改原因：SubAgent 不能只依赖每批工具调用数量限制；P1 要求有输出预算、并发 guard、递归深度语义和可解释拒绝原因。
 * 修改方式：把预算策略、并发槽位和深度判断集中到本文件，handler/executor 只消费统一决策。
 * 修改目的：避免在 ToolExecutionService、executor 和前端分别实现截断、拒绝或错误映射。
 */

import type { SubAgentConfig } from './types';
import { t } from '../../i18n';

export interface SubAgentGovernancePolicy {
    maxOutputChars: number;
    maxInputChars: number;
    maxDepth: number;
    maxConcurrentAgents: number;
}

export interface SubAgentGovernanceDecision {
    allowed: boolean;
    code?: string;
    message?: string;
}

const DEFAULT_MAX_OUTPUT_CHARS = 4000;
const DEFAULT_MAX_INPUT_CHARS = 60000;
const DEFAULT_MAX_DEPTH = 1;

export function resolveSubAgentGovernancePolicy(config: SubAgentConfig, maxConcurrentAgents: number | undefined): SubAgentGovernancePolicy {
    return {
        maxOutputChars: normalizePositive(config.maxOutputChars, DEFAULT_MAX_OUTPUT_CHARS),
        maxInputChars: normalizePositive(config.maxInputChars, DEFAULT_MAX_INPUT_CHARS),
        maxDepth: normalizePositive(config.maxDepth, DEFAULT_MAX_DEPTH),
        maxConcurrentAgents: maxConcurrentAgents === -1 ? -1 : normalizePositive(maxConcurrentAgents, 3)
    };
}

export class SubAgentBudgetGovernor {
    constructor(private readonly policy: SubAgentGovernancePolicy) {}

    checkInput(prompt: string, context?: string): SubAgentGovernanceDecision {
        const chars = prompt.length + (context?.length || 0);
        if (chars > this.policy.maxInputChars) {
            return {
                allowed: false,
                code: t('tools.subagents.errors.inputBudgetExceededCode'),
                message: t('tools.subagents.errors.inputBudgetExceeded', { chars, max: this.policy.maxInputChars })
            };
        }
        return { allowed: true };
    }

    getMaxOutputChars(): number {
        return this.policy.maxOutputChars;
    }
}

export class SubAgentDepthGuard {
    constructor(private readonly policy: SubAgentGovernancePolicy) {}

    checkDepth(depth = 0): SubAgentGovernanceDecision {
        /**
         * 修改原因：当前通过 excludeToolNames 阻止直接递归，但 P1 要求显式 depth guard，避免未来重新暴露 subagents 工具后失控。
         * 修改方式：handler 从 ToolContext 读取可选 subAgentDepth，超过策略就拒绝。
         * 修改目的：把“不能递归扇出”从声明过滤提升为运行时治理语义。
         */
        if (depth > this.policy.maxDepth) {
            return {
                allowed: false,
                code: t('tools.subagents.errors.depthExceededCode'),
                message: t('tools.subagents.errors.depthExceeded', { depth, max: this.policy.maxDepth })
            };
        }
        return { allowed: true };
    }
}

export class SubAgentConcurrencyGuard {
    private activeRunIds = new Set<string>();

    acquire(runId: string, policy: SubAgentGovernancePolicy): SubAgentGovernanceDecision {
        if (policy.maxConcurrentAgents !== -1 && this.activeRunIds.size >= policy.maxConcurrentAgents) {
            return {
                allowed: false,
                code: t('tools.subagents.errors.concurrencyExceededCode'),
                message: t('tools.subagents.errors.concurrencyExceeded', { max: policy.maxConcurrentAgents })
            };
        }
        this.activeRunIds.add(runId);
        return { allowed: true };
    }

    release(runId: string): void {
        this.activeRunIds.delete(runId);
    }

    getActiveCount(): number {
        return this.activeRunIds.size;
    }

    resetForTests(): void {
        this.activeRunIds.clear();
    }
}

function normalizePositive(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const subAgentConcurrencyGuard = new SubAgentConcurrencyGuard();
