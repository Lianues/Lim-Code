import type { ChatStreamToolStatusData } from '../types';
import type { FunctionCallInfo, ToolExecutionResult } from '../utils';
import type { ToolExecutionFullResult } from './ToolExecutionService';

/**
 * 根据工具业务返回值推导聊天流里的统一工具状态。
 *
 * 修改原因：流式提前执行、普通工具队列和确认后续执行原先各自手写一份状态推导，容易出现成功工具仍显示 pending/queued，或者 diff pending 无法显示 awaiting_apply。
 * 修改方式：把 success/error/warning/awaiting_apply 的判断收敛到一个共享函数，所有 toolStatus 事件都使用同一语义。
 * 修改目的：单个工具一旦产生业务结果，就能独立进入最终状态，不再被同批其他工具的生命周期拖住。
 */
export function deriveChatToolStatusFromResult(result: unknown): ChatStreamToolStatusData['tool']['status'] {
    const r = result as any;
    if (r?.success === false || r?.error || r?.cancelled || r?.rejected) {
        return 'error';
    }

    const data = r?.data;
    if (data && typeof data === 'object') {
        if ((data as any).status === 'pending') {
            return 'awaiting_apply';
        }

        const appliedCount = (data as any).appliedCount;
        const failedCount = (data as any).failedCount;
        if (typeof appliedCount === 'number' && typeof failedCount === 'number' && appliedCount > 0 && failedCount > 0) {
            return 'warning';
        }
    }

    return 'success';
}

/**
 * 从 ToolExecutionResult 构造前端可直接消费的 toolStatus payload。
 *
 * 修改原因：多个调用点都需要把工具结果翻译成同一种流式状态结构，重复拼装会让字段和状态判断再次分叉。
 * 修改方式：集中生成 id/name/status/result 四个字段，调用点只负责选择发送时机。
 * 修改目的：保持主聊天、工具确认续跑和流式提前执行的 UI 状态完全一致。
 */
export function createChatToolStatusUpdate(toolResult: ToolExecutionResult): ChatStreamToolStatusData['tool'] {
    return {
        id: toolResult.id,
        name: toolResult.name,
        status: deriveChatToolStatusFromResult(toolResult.result),
        // 修改原因：流式提前执行时，前端可能还没把 partialArgs 解析成最终 args，单独的 result/status 无法补齐卡片描述。
        // 修改方式：如果 ToolExecutionResult 带有 args，就随 toolStatus 一起透传。
        // 修改目的：让所有工具状态更新都携带足够的 UI 输入快照，不再依赖最终 content 才能完整显示。
        args: toolResult.args,
        result: toolResult.result
    };
}

export interface EarlyStreamingToolSettlement {
    call: FunctionCallInfo;
    fullResult: ToolExecutionFullResult;
}

/**
 * 维护“流式边输出边执行”的提前工具完成队列。
 *
 * 修改原因：旧逻辑在模型输出结束后 await Promise.all(streamingToolPromises)，导致同一批里已经成功的工具必须等最慢工具结束后才发 toolStatus，前端就会长期保持 queued/pending。
 * 修改方式：每个提前执行工具单独入队已完成结果，调用方可以 drain 已完成项并继续等待下一项，而不是等待整批全部完成。
 * 修改目的：让工具状态以单工具为粒度推进；并发工具之间只共享历史写入顺序，不共享 UI 完成时机。
 */
export class EarlyStreamingToolProgressQueue {
    private readonly pendingToolIds = new Set<string>();
    private readonly settled: EarlyStreamingToolSettlement[] = [];
    private waiter: (() => void) | undefined;

    track(call: FunctionCallInfo, promise: Promise<ToolExecutionFullResult>): Promise<ToolExecutionFullResult> {
        this.pendingToolIds.add(call.id);
        return promise.then(fullResult => {
            this.settled.push({ call, fullResult });
            const waiter = this.waiter;
            this.waiter = undefined;
            waiter?.();
            return fullResult;
        });
    }

    drainSettled(): EarlyStreamingToolSettlement[] {
        const items = this.settled.splice(0, this.settled.length);
        for (const item of items) {
            this.pendingToolIds.delete(item.call.id);
        }
        return items;
    }

    hasPending(): boolean {
        return this.pendingToolIds.size > 0;
    }

    waitForNextSettlement(): Promise<void> {
        if (this.settled.length > 0 || this.pendingToolIds.size === 0) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            const previous = this.waiter;
            this.waiter = () => {
                previous?.();
                resolve();
            };
        });
    }
}
