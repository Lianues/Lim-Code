/**
 * SubAgent 活跃运行控制器。
 *
 * 修改原因：SubAgent Monitor 需要中止、继续和退出仍在等待主窗口工具调用的 run；这些控制语义不能塞进事件总线或 UI 状态里。
 * 修改方式：用独立控制器保存活跃 run 的 AbortController、状态和等待恢复/退出的 Promise 句柄。
 * 修改目的：让“历史快照展示”和“活跃运行控制”分离，扩展重载后不会错误复活已经丢失的主工具 Promise。
 */

import { subAgentRunEventBus } from './runEventBus';
import type { SubAgentRunStatus } from './runEventBus';

export type SubAgentControlAction = 'pause' | 'resume' | 'exit';

export interface SubAgentRunControlState {
    runId: string;
    agentName?: string;
    status: SubAgentRunStatus;
    active: boolean;
    abortSignal: AbortSignal;
}

interface ActiveRunRecord {
    runId: string;
    agentName?: string;
    status: SubAgentRunStatus;
    controller: AbortController;
    resumeWaiters: Array<() => void>;
    exitWaiters: Array<(reason: string) => void>;
    pausedStartedAt?: number;
    inactiveDurationMs: number;
    exitReason?: string;
}

export class SubAgentRunController {
    private readonly activeRuns = new Map<string, ActiveRunRecord>();

    register(runId: string, agentName?: string): AbortSignal {
        // 修改原因：每次 SubAgent run 需要一个可由 Monitor 独立中止的控制信号，不能复用主聊天的 AbortController。
        // 修改方式：注册活跃 run 时创建专属 AbortController，并把 run 标记为 running。
        // 修改目的：后续 pause/exit 可以只影响该 SubAgent run，不直接让主窗口其他流式请求中止。
        const existing = this.activeRuns.get(runId);
        if (existing) {
            return existing.controller.signal;
        }
        const record: ActiveRunRecord = {
            runId,
            agentName,
            status: 'running',
            controller: new AbortController(),
            resumeWaiters: [],
            exitWaiters: [],
            inactiveDurationMs: 0
        };
        this.activeRuns.set(runId, record);
        return record.controller.signal;
    }

    unregister(runId: string): void {
        // 修改原因：完成、失败或取消后的 run 不再能影响主工具 Promise，必须从活跃控制表移除。
        // 修改方式：删除 activeRuns 中对应记录，但保留 runEventBus 的持久快照。
        // 修改目的：Monitor 可以继续查看历史 run，同时不会显示会影响主工具的控制按钮。
        this.activeRuns.delete(runId);
    }

    isActive(runId: string): boolean {
        return this.activeRuns.has(runId);
    }

    getState(runId: string): SubAgentRunControlState | undefined {
        const record = this.activeRuns.get(runId);
        if (!record) return undefined;
        return {
            runId: record.runId,
            agentName: record.agentName,
            status: record.status,
            active: true,
            abortSignal: record.controller.signal
        };
    }

    getActiveRunIds(): string[] {
        return Array.from(this.activeRuns.keys());
    }

    pause(runId: string): boolean {
        const record = this.activeRuns.get(runId);
        if (!record || record.status !== 'running') return false;

        // 修改原因：Monitor 的“中止”只暂停当前 SubAgent 内部推理，不能让主窗口 subagents 工具立即失败。
        // 修改方式：把状态置为 paused 并 abort 当前控制器；executor 捕获取消后根据控制器状态等待 resume 或 exit。
        // 修改目的：中止当前 API/工具等待，同时保留主工具调用的挂起语义。
        record.status = 'paused';
        record.pausedStartedAt = Date.now();
        record.controller.abort();
        subAgentRunEventBus.emit({
            runId,
            agentName: record.agentName,
            type: 'run_paused',
            payload: { reason: 'User paused SubAgent run from Monitor' }
        });
        return true;
    }

    markAwaitingMonitorAction(runId: string, reason: string): boolean {
        const record = this.activeRuns.get(runId);
        if (!record) return false;

        // 修改原因：自动重试耗尽且配置为等待用户处理时，run 不是 failed，而是等待 Monitor 决策。
        // 修改方式：显式进入 awaiting_monitor_action 状态，并广播给 Monitor。
        // 修改目的：主窗口工具继续等待，用户可以在 Monitor 中选择重试或退出。
        record.status = 'awaiting_monitor_action';
        record.pausedStartedAt = Date.now();
        subAgentRunEventBus.emit({
            runId,
            agentName: record.agentName,
            type: 'run_awaiting_monitor_action',
            payload: { reason }
        });
        return true;
    }

    resume(runId: string): boolean {
        const record = this.activeRuns.get(runId);
        if (!record) return false;
        if (record.status !== 'paused' && record.status !== 'awaiting_monitor_action') return false;

        // 修改原因：暂停时旧 AbortController 已经被 abort，继续执行必须使用新的 signal。
        // 修改方式：重建 AbortController、恢复 running 状态，并唤醒 executor 中等待 resume 的 Promise。
        // 修改目的：从暂停/等待位置继续同一个 runId，而不是创建新的 SubAgent run。
        record.controller = new AbortController();
        if (record.pausedStartedAt) {
            record.inactiveDurationMs += Date.now() - record.pausedStartedAt;
            record.pausedStartedAt = undefined;
        }
        record.status = 'running';
        const waiters = record.resumeWaiters.splice(0);
        for (const resolve of waiters) resolve();
        subAgentRunEventBus.emit({
            runId,
            agentName: record.agentName,
            type: 'run_resumed',
            payload: { reason: 'User resumed SubAgent run from Monitor' }
        });
        return true;
    }

    exit(runId: string, reason = '用户主动终止 SubAgent 执行'): boolean {
        const record = this.activeRuns.get(runId);
        if (!record) return false;

        // 修改原因：“退出 SubAgent 执行”必须让主窗口对应 subagents 工具失败，并尽力中止当前工具/API。
        // 修改方式：记录退出原因、abort 当前控制器、唤醒等待中的 executor，并将 run 标记为 cancelled。
        // 修改目的：区别于 pause 的非失败语义，确保用户主动退出会返回明确失败原因。
        record.status = 'cancelled';
        record.exitReason = reason;
        record.controller.abort();
        const exitWaiters = record.exitWaiters.splice(0);
        for (const reject of exitWaiters) reject(reason);
        const resumeWaiters = record.resumeWaiters.splice(0);
        for (const resolve of resumeWaiters) resolve();
        subAgentRunEventBus.emit({
            runId,
            agentName: record.agentName,
            type: 'run_cancelled',
            payload: { reason }
        });
        return true;
    }

    async waitUntilRunnable(runId: string): Promise<'running' | 'cancelled' | 'inactive'> {
        const record = this.activeRuns.get(runId);
        if (!record) return 'inactive';
        if (record.status === 'running') return 'running';
        if (record.status === 'cancelled') return 'cancelled';

        // 修改原因：executor 在 pause 或 awaiting_monitor_action 时需要挂起主工具 Promise，而不是返回失败。
        // 修改方式：等待 resume/exit 事件；resume 返回 running，exit 返回 cancelled。
        // 修改目的：让 Monitor 顶部控制按钮可以决定同一个 run 的后续命运。
        await new Promise<void>((resolve) => {
            record.resumeWaiters.push(resolve);
            record.exitWaiters.push(() => resolve());
        });
        const latest = this.activeRuns.get(runId);
        if (!latest) return 'inactive';
        return latest.status === 'cancelled' ? 'cancelled' : 'running';
    }

    getAbortSignal(runId: string): AbortSignal | undefined {
        return this.activeRuns.get(runId)?.controller.signal;
    }

    getExitReason(runId: string): string | undefined {
        return this.activeRuns.get(runId)?.exitReason;
    }

    getInactiveDurationMs(runId: string): number {
        const record = this.activeRuns.get(runId);
        if (!record) return 0;
        // 修改原因：暂停和等待 Monitor 操作的时间不应计入 SubAgent maxRuntime。
        // 修改方式：记录历史 inactiveDurationMs，并在当前仍暂停/等待时加上从 pausedStartedAt 到现在的时长。
        // 修改目的：用户查看 Monitor 或等待手动决策时不会让主工具莫名超时失败。
        const currentPaused = record.pausedStartedAt ? Date.now() - record.pausedStartedAt : 0;
        return record.inactiveDurationMs + currentPaused;
    }
}

export const subAgentRunController = new SubAgentRunController();
