import {
    EarlyStreamingToolProgressQueue,
    createChatToolStatusUpdate,
    deriveChatToolStatusFromResult
} from '../../../../modules/api/chat/services/streamingToolProgress';
import type { FunctionCallInfo } from '../../../../modules/api/chat/utils';
import type { ToolExecutionFullResult } from '../../../../modules/api/chat/services/ToolExecutionService';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function fullResult(id: string, name = 'read_file', result: Record<string, unknown> = { success: true }): ToolExecutionFullResult {
    return {
        responseParts: [{ functionResponse: { id, name, response: result } }],
        toolResults: [{ id, name, result }],
        checkpoints: []
    };
}

describe('streaming tool progress helpers', () => {
    it('derives one shared tool status vocabulary from tool results', () => {
        // 修改原因：同一工具结果过去在不同路径下可能被推导成不同 UI 状态。
        // 修改方式：直接覆盖 success、error、awaiting_apply 和 warning 四种关键语义。
        // 修改目的：保证所有 toolStatus 发送点共享同一状态机。
        expect(deriveChatToolStatusFromResult({ success: true })).toBe('success');
        expect(deriveChatToolStatusFromResult({ success: false, error: 'boom' })).toBe('error');
        expect(deriveChatToolStatusFromResult({ success: true, data: { status: 'pending' } })).toBe('awaiting_apply');
        expect(deriveChatToolStatusFromResult({ success: true, data: { appliedCount: 1, failedCount: 1 } })).toBe('warning');

        expect(createChatToolStatusUpdate({
            id: 'tool-1',
            name: 'apply_diff',
            result: { success: true, data: { status: 'pending' } }
        })).toEqual({
            id: 'tool-1',
            name: 'apply_diff',
            status: 'awaiting_apply',
            result: { success: true, data: { status: 'pending' } }
        });
    });

    it('drains a completed early streaming tool without waiting for the rest of the batch', async () => {
        // 修改原因：旧流式提前执行使用 Promise.all，快工具会被慢工具拖住，前端保持 queued/pending。
        // 修改方式：用两个受控 promise 模拟同批工具，只 resolve 第一个并立即 drain。
        // 修改目的：锁定“单工具完成即可单独上报”的并发语义。
        const queue = new EarlyStreamingToolProgressQueue();
        const fast = deferred<ToolExecutionFullResult>();
        const slow = deferred<ToolExecutionFullResult>();
        const fastCall: FunctionCallInfo = { id: 'fast', name: 'read_file', args: {} };
        const slowCall: FunctionCallInfo = { id: 'slow', name: 'search_in_files', args: {} };

        const fastTracked = queue.track(fastCall, fast.promise);
        const slowTracked = queue.track(slowCall, slow.promise);

        fast.resolve(fullResult('fast'));
        await queue.waitForNextSettlement();

        const firstSettled = queue.drainSettled();
        expect(firstSettled.map(item => item.call.id)).toEqual(['fast']);
        expect(queue.hasPending()).toBe(true);

        slow.resolve(fullResult('slow'));
        await Promise.all([fastTracked, slowTracked]);
        await queue.waitForNextSettlement();
        expect(queue.drainSettled().map(item => item.call.id)).toEqual(['slow']);
        expect(queue.hasPending()).toBe(false);
    });
});
