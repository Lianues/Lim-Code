import { OpenAIResponsesFormatter } from '../../modules/channel/formatters/openai-responses';
import { StreamAccumulator } from '../../modules/channel/StreamAccumulator';

function accumulateResponsesEvents(events: any[]) {
    const formatter = new OpenAIResponsesFormatter();
    const accumulator = new StreamAccumulator('function_call', () => 'generated_tool_id');
    accumulator.setProviderType('openai-responses');

    for (const event of events) {
        accumulator.add(formatter.parseStreamChunk(event));
    }

    return accumulator.getContent();
}

describe('OpenAI Responses function-call streaming', () => {
    it('merges placeholder, argument deltas, arguments.done and output_item.done into one call_id based functionCall', () => {
        // 为什么要覆盖完整事件链：Responses 先发 output item 占位，随后用 item_id/output_index 发送参数，最后才在 item 上保留 call_id。
        // 怎么改：测试从 formatter 到 StreamAccumulator 的真实组合路径，而不是只测单个函数，确保 item_id 只用于合并，call_id 才成为最终 functionCall.id。
        // 目的：防止 UI 残留“0 个参数”的占位工具，也防止工具结果回传时用错 OpenAI 要求的 call_id。
        const finalArguments = JSON.stringify({
            path: 'frontend/src/i18n/langs/zh-CN.ts',
            hunks: [
                {
                    oldContent: "formatUnified: '统一 diff',",
                    newContent: "formatUnified: '结构化 hunks',"
                }
            ]
        });

        const content = accumulateResponsesEvents([
            {
                type: 'response.output_item.added',
                output_index: 0,
                item: {
                    type: 'function_call',
                    id: 'fc_item_123',
                    call_id: 'call_actual_123',
                    name: 'apply_diff',
                    arguments: '',
                    status: 'in_progress'
                }
            },
            {
                type: 'response.function_call_arguments.delta',
                item_id: 'fc_item_123',
                output_index: 0,
                delta: finalArguments.slice(0, 24)
            },
            {
                type: 'response.function_call_arguments.delta',
                item_id: 'fc_item_123',
                output_index: 0,
                delta: finalArguments.slice(24)
            },
            {
                type: 'response.function_call_arguments.done',
                item_id: 'fc_item_123',
                output_index: 0,
                name: 'apply_diff',
                arguments: finalArguments
            },
            {
                type: 'response.output_item.done',
                output_index: 0,
                item: {
                    type: 'function_call',
                    id: 'fc_item_123',
                    call_id: 'call_actual_123',
                    name: 'apply_diff',
                    arguments: finalArguments,
                    status: 'completed'
                }
            }
        ]);

        const calls = content.parts.filter(part => part.functionCall).map(part => part.functionCall! as any);

        expect(calls).toHaveLength(1);
        expect(calls[0].id).toBe('call_actual_123');
        expect(calls[0].name).toBe('apply_diff');
        expect(calls[0].args).toEqual(JSON.parse(finalArguments));
        expect(calls[0]).not.toHaveProperty('itemId');
        expect(calls[0]).not.toHaveProperty('finalArgs');
        expect(calls[0]).not.toHaveProperty('partialArgs');
        expect(calls[0]).not.toHaveProperty('index');
    });

    it('uses item_id as an internal merge key when compatible gateways omit output_index on arguments.done', () => {
        // 为什么要覆盖无 output_index 场景：部分兼容网关可能保留 item_id 但省略 output_index，旧逻辑会把 done 拆成第二个工具。
        // 怎么改：确认 itemId 合并键能把最终 arguments 覆盖回同一个占位 functionCall，同时最终历史仍只保留 call_id。
        // 目的：让修复对官方 OpenAI 和兼容 Responses 网关都稳定，避免偶发 0 参数占位残留。
        const finalArguments = JSON.stringify({ path: 'README.md', hunks: [] });

        const content = accumulateResponsesEvents([
            {
                type: 'response.output_item.added',
                output_index: 3,
                item: {
                    type: 'function_call',
                    id: 'fc_item_without_done_index',
                    call_id: 'call_without_done_index',
                    name: 'apply_diff',
                    arguments: '',
                    status: 'in_progress'
                }
            },
            {
                type: 'response.function_call_arguments.done',
                item_id: 'fc_item_without_done_index',
                name: 'apply_diff',
                arguments: finalArguments
            }
        ]);

        const calls = content.parts.filter(part => part.functionCall).map(part => part.functionCall! as any);

        expect(calls).toHaveLength(1);
        expect(calls[0].id).toBe('call_without_done_index');
        expect(calls[0].args).toEqual(JSON.parse(finalArguments));
    });
});
