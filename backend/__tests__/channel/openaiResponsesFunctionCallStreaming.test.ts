import { OpenAIResponsesFormatter } from '../../modules/channel/formatters/openai-responses';
import { OpenAIFormatter } from '../../modules/channel/formatters/openai';
import { StreamAccumulator } from '../../modules/channel/StreamAccumulator';
import { StreamResponseProcessor } from '../../modules/api/chat/handlers/StreamResponseProcessor';

function accumulateResponsesEvents(events: any[]) {
    const formatter = new OpenAIResponsesFormatter();
    const accumulator = new StreamAccumulator('function_call', () => 'generated_tool_id');
    accumulator.setProviderType('openai-responses');

    for (const event of events) {
        accumulator.add(formatter.parseStreamChunk(event));
    }

    return accumulator.getContent();
}

async function* streamResponsesEvents(events: any[]) {
    // 修改原因：StreamResponseProcessor 的回归测试需要走 formatter → processor 的真实流式路径，而不是手写 StreamChunk。
    // 修改方式：把 Responses 原始事件按 AsyncGenerator 产出，并在每步调用 formatter.parseStreamChunk。
    // 修改目的：同时覆盖 provider 事件别名归一化、累加器和 processor 的 snapshot 策略。
    const formatter = new OpenAIResponsesFormatter();
    for (const event of events) {
        yield formatter.parseStreamChunk(event);
    }
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

    it('waits for output_item.done call_id when output_item.added omits call_id', () => {
        // 为什么要覆盖这个兼容网关形态：OpenAI Responses 官方/兼容流有时 added 事件只有 item.id，最终 done 才给 call_id。
        // 怎么改：added 阶段不生成本地临时工具 id；arguments.done 只补参数；output_item.done 到达后用官方 call_id 覆盖同一个 item。
        // 目的：避免后端终结 content 使用本地临时 id，而前端本地流式状态使用 call_id，导致 pending/executing 阶段最后一个工具重复显示。
        const finalArguments = JSON.stringify({ query: 'responses missing call id until done', numResults: 5 });

        const formatter = new OpenAIResponsesFormatter();
        const accumulator = new StreamAccumulator('function_call', () => 'generated_tool_id');
        accumulator.setProviderType('openai-responses');

        accumulator.add(formatter.parseStreamChunk({
            type: 'response.output_item.added',
            output_index: 1,
            item: {
                type: 'function_call',
                id: 'fc_item_late_call_id',
                name: 'mcp__exa__web_search_exa',
                arguments: '',
                status: 'in_progress'
            }
        }));

        accumulator.add(formatter.parseStreamChunk({
            type: 'response.function_call_arguments.done',
            item_id: 'fc_item_late_call_id',
            output_index: 1,
            name: 'mcp__exa__web_search_exa',
            arguments: finalArguments
        }));

        expect(accumulator.getNewCompletedFunctionCalls()).toHaveLength(0);

        accumulator.add(formatter.parseStreamChunk({
            type: 'response.output_item.done',
            output_index: 1,
            item: {
                type: 'function_call',
                id: 'fc_item_late_call_id',
                call_id: 'call_late_actual_id',
                name: 'mcp__exa__web_search_exa',
                arguments: finalArguments,
                status: 'completed'
            }
        }));

        const readyCalls = accumulator.getNewCompletedFunctionCalls();
        const content = accumulator.getContent();
        const calls = content.parts.filter(part => part.functionCall).map(part => part.functionCall! as any);

        expect(readyCalls).toHaveLength(1);
        expect(readyCalls[0].id).toBe('call_late_actual_id');
        expect(calls).toHaveLength(1);
        expect(calls[0].id).toBe('call_late_actual_id');
        expect(calls[0].args).toEqual(JSON.parse(finalArguments));
        expect(calls[0]).not.toHaveProperty('itemId');
        expect(calls[0]).not.toHaveProperty('index');
        expect(calls[0]).not.toHaveProperty('partialArgs');
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

    it('normalizes dotted function_call argument event aliases before dispatch', () => {
        // 修改原因：项目中不能在 switch 分支里散落 response.function_call_arguments.* 和 response.function_call.arguments.* 两套重复 case。
        // 修改方式：测试兼容网关常见的 dotted spelling 会被 formatter 归一化到同一条内部处理路径。
        // 修改目的：以后新增 Responses 事件时只扩展别名表，不复制整段工具参数处理逻辑。
        const finalArguments = JSON.stringify({ path: 'alias.md', content: 'ok' });
        const content = accumulateResponsesEvents([
            {
                type: 'response.output_item.added',
                output_index: 0,
                item: {
                    type: 'function_call',
                    id: 'fc_alias_item',
                    call_id: 'call_alias_id',
                    name: 'write_file',
                    arguments: '',
                    status: 'in_progress'
                }
            },
            {
                type: 'response.function_call.arguments.delta',
                item_id: 'fc_alias_item',
                output_index: 0,
                delta: finalArguments.slice(0, 10)
            },
            {
                type: 'response.function_call.arguments.done',
                item_id: 'fc_alias_item',
                output_index: 0,
                name: 'write_file',
                arguments: finalArguments
            }
        ]);

        const calls = content.parts.filter(part => part.functionCall).map(part => part.functionCall! as any);
        expect(calls).toHaveLength(1);
        expect(calls[0].id).toBe('call_alias_id');
        expect(calls[0].args).toEqual(JSON.parse(finalArguments));
    });

    it('does not attach contentSnapshot or parse partial JSON during Responses argument deltas', async () => {
        // 修改原因：OpenAI Responses 大工具参数卡顿的根因是 arguments.delta 热路径触发 contentSnapshot 和半截 JSON parse。
        // 修改方式：走 StreamResponseProcessor 流式路径，确认 delta 期间没有 contentSnapshot，也没有 console.warn。
        // 修改目的：防止后续改动把高频 tool args delta 重新带回完整 Content 重建路径。
        const parseSpy = jest.spyOn(JSON, 'parse');
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const processor = new StreamResponseProcessor({
            requestStartTime: Date.now(),
            providerType: 'openai-responses',
            toolMode: 'function_call',
            conversationId: 'test-responses-hot-path'
        });

        const received: any[] = [];
        try {
            for await (const chunkData of processor.processStream(streamResponsesEvents([
                {
                    type: 'response.output_item.added',
                    output_index: 0,
                    item: {
                        type: 'function_call',
                        id: 'fc_hot_path_item',
                        call_id: 'call_hot_path_id',
                        name: 'write_file',
                        arguments: '',
                        status: 'in_progress'
                    }
                },
                {
                    type: 'response.function_call_arguments.delta',
                    item_id: 'fc_hot_path_item',
                    output_index: 0,
                    delta: '{"path":"big.ts",'
                },
                {
                    type: 'response.function_call_arguments.delta',
                    item_id: 'fc_hot_path_item',
                    output_index: 0,
                    delta: '"content":"still incomplete"'
                }
            ]))) {
                received.push(chunkData.chunk);
            }

            expect(received.some(chunk => chunk.contentSnapshot)).toBe(false);
            expect(warnSpy).not.toHaveBeenCalled();
            // 修改原因：热路径 parse 退化最容易以“看不见的额外 JSON.parse”形式回归。
            // 修改方式：直接观察原生 JSON.parse 调用次数，确认只发生在非热路径初始化 JSON 或最终断言解析中。
            // 修改目的：把“不在 arguments.delta 期间重复 parse 半截 JSON”固化成可回归断言。
            expect(parseSpy).toHaveBeenCalledTimes(0);

            const streamingContent = processor.getAccumulator().getStreamingContent();
            const call = streamingContent.parts.find(part => part.functionCall)?.functionCall as any;
            expect(call.partialArgs).toBe('{"path":"big.ts","content":"still incomplete"');
            expect(call.args).toEqual({});
            expect(parseSpy).toHaveBeenCalledTimes(0);

            const finalContent = processor.getContent();
            const finalCall = finalContent.parts.find(part => part.functionCall)?.functionCall as any;
            expect(finalCall.args).toEqual({});
            expect(parseSpy).toHaveBeenCalledTimes(1);
        } finally {
            parseSpy.mockRestore();
            warnSpy.mockRestore();
        }
    });

    it('does not emit per-chunk console.log while normalizing OpenAI tool_call deltas', () => {
        // 修改原因：普通 OpenAI tool_calls.arguments 也是流式热路径，调试 console.log 会在每个 chunk 触发。
        // 修改方式：直接覆盖 OpenAI formatter 的 parseStreamChunk，确认日志侧效应被移除且归一化结果保持不变。
        // 修改目的：锁定“热路径无 per-chunk console.log”这一约束，防止后续再次把调试输出塞回 formatter。
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        const formatter = new OpenAIFormatter();

        try {
            const chunk = formatter.parseStreamChunk({
                id: 'chatcmpl-hot-path',
                model: 'gpt-4.1',
                choices: [
                    {
                        index: 0,
                        delta: {
                            tool_calls: [
                                {
                                    index: 0,
                                    id: 'call_openai_hot_path',
                                    type: 'function',
                                    function: {
                                        name: 'write_file',
                                        arguments: '{"path":"demo.ts"}'
                                    }
                                }
                            ]
                        }
                    }
                ]
            });

            expect(logSpy).not.toHaveBeenCalled();
            expect(chunk.delta).toEqual([
                {
                    functionCall: {
                        name: 'write_file',
                        args: {},
                        partialArgs: '{"path":"demo.ts"}',
                        id: 'call_openai_hot_path',
                        index: 0
                    }
                }
            ]);
        } finally {
            logSpy.mockRestore();
        }
    });
});
