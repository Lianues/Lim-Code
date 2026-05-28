import { AnthropicFormatter } from '../../modules/channel/formatters/anthropic';
import { StreamAccumulator } from '../../modules/channel/StreamAccumulator';
import { StreamResponseProcessor } from '../../modules/api/chat/handlers/StreamResponseProcessor';
import { handleChunkType } from '../../../frontend/src/stores/chat/streamChunkHandlers';
import type { Message } from '../../../frontend/src/types';

async function* streamAnthropicEvents(events: any[]) {
    const formatter = new AnthropicFormatter();
    for (const event of events) {
        yield formatter.parseStreamChunk(event);
    }
}

async function processToFrontend(events: any[]) {
    const processor = new StreamResponseProcessor({
        requestStartTime: Date.now(),
        providerType: 'anthropic',
        toolMode: 'function_call',
        conversationId: 'anthropic-tool-use-test'
    });
    const message: Message = {
        id: 'assistant-under-test',
        role: 'assistant',
        content: '',
        timestamp: 0,
        parts: [],
        streaming: true
    };
    const state = {
        allMessages: { value: [message] },
        streamingMessageId: { value: message.id }
    } as any;
    const emitted: any[] = [];

    for await (const chunkData of processor.processStream(streamAnthropicEvents(events))) {
        emitted.push(chunkData.chunk);
        handleChunkType(chunkData as any, state);
    }

    return {
        processor,
        message: state.allMessages.value[0] as Message,
        emitted
    };
}

function toolCallsFromMessage(message: Message) {
    return message.parts?.filter(part => part.functionCall).map(part => part.functionCall as any) || [];
}

function toolCallsFromAccumulator(accumulator: StreamAccumulator) {
    return accumulator.getContent().parts.filter(part => part.functionCall).map(part => part.functionCall as any);
}

describe('Anthropic tool_use streaming', () => {
    it('merges tool_use start and input_json_delta into one rendered tool card with complete JSON args', async () => {
        // 为什么覆盖官方事件链：Anthropic tool_use 的 start 只有 input:{}，真实参数随后以 input_json_delta.partial_json 到达。
        // 怎么改：走 formatter → StreamResponseProcessor → frontend handleChunkType 的真实组合路径，验证统一 index/id 抽象能贯通后端和前端。
        // 目的：防止 UI 渲染出“0 参数占位工具 + 带参数工具”两张卡。
        const finalArgs = { path: 'README.md' };
        const { processor, message } = await processToFrontend([
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'tool_use', id: 'toolu_read_1', name: 'read_file', input: {} }
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '{"path":"README' }
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'input_json_delta', partial_json: '.md"}' }
            },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 42 } },
            { type: 'message_stop' }
        ]);

        const backendCalls = toolCallsFromAccumulator(processor.getAccumulator());
        const renderedCalls = toolCallsFromMessage(message);

        expect(backendCalls).toHaveLength(1);
        expect(backendCalls[0].id).toBe('toolu_read_1');
        expect(backendCalls[0].name).toBe('read_file');
        expect(backendCalls[0].args).toEqual(finalArgs);
        expect(backendCalls[0]).not.toHaveProperty('partialArgs');
        expect(backendCalls[0]).not.toHaveProperty('index');

        expect(renderedCalls).toHaveLength(1);
        expect(message.tools).toHaveLength(1);
        expect(message.tools?.[0].id).toBe('toolu_read_1');
        expect(message.tools?.[0].name).toBe('read_file');
        expect(message.tools?.[0].args).toEqual(finalArgs);
        expect(message.tools?.[0].partialArgs).toBeUndefined();
        expect(message.tools?.[0].status).toBe('queued');
    });

    it('keeps thinking and tool_use content block indexes isolated when deltas are interleaved', async () => {
        // 为什么覆盖 thinking + tool_use 穿插：旧 Anthropic delta 没有 index/id，只能靠“最后一个工具”兜底；一旦中间插入 thinking/text，就可能串扰或拆出新工具。
        // 怎么改：模拟 thinking index=0 与 tool_use index=1 穿插到达，断言 input_json_delta 仍按 index=1 合并回原 tool_use。
        // 目的：把 content_block.index 作为统一流式定位键固化为契约。
        const finalArgs = { command: 'npm run compile', cwd: '.' };
        const { message } = await processToFrontend([
            {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'thinking', thinking: '' }
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: 'I should run a command. ' }
            },
            {
                type: 'content_block_start',
                index: 1,
                content_block: { type: 'tool_use', id: 'toolu_exec_1', name: 'execute_command', input: {} }
            },
            {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: 'Now prepare arguments.' }
            },
            {
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'input_json_delta', partial_json: '{"command":"npm run compile"' }
            },
            {
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'input_json_delta', partial_json: ',"cwd":"."}' }
            },
            { type: 'content_block_stop', index: 1 },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_stop' }
        ]);

        const renderedCalls = toolCallsFromMessage(message);
        const thoughtText = message.parts?.filter(part => part.thought && part.text).map(part => part.text).join('') || '';

        expect(thoughtText).toContain('I should run a command.');
        expect(thoughtText).toContain('Now prepare arguments.');
        expect(renderedCalls).toHaveLength(1);
        expect(message.tools).toHaveLength(1);
        expect(renderedCalls[0].id).toBe('toolu_exec_1');
        expect(message.tools?.[0].id).toBe('toolu_exec_1');
        expect(message.tools?.[0].args).toEqual(finalArgs);
        expect(message.tools?.[0].partialArgs).toBeUndefined();
    });

    it('settles tool card state at content_block_stop and keeps message_stop from leaving an empty-args ghost card', async () => {
        // 为什么分两段断言：Anthropic 官方把 tool_use.input 完成边界放在 content_block_stop，message_stop 只是整条消息结束。
        // 怎么改：先处理到 content_block_stop，确认 snapshot 已把 streaming 卡片收束为 queued；再处理 message_stop，确认不会追加空参数卡。
        // 目的：覆盖工具状态机收尾，防止最终 UI 中残留 0 参数幽灵工具。
        const formatter = new AnthropicFormatter();
        const accumulator = new StreamAccumulator('function_call', () => 'generated_tool_id');
        accumulator.setProviderType('anthropic');
        const message: Message = {
            id: 'assistant-stop-under-test',
            role: 'assistant',
            content: '',
            timestamp: 0,
            parts: [],
            streaming: true
        };
        const state = {
            allMessages: { value: [message] },
            streamingMessageId: { value: message.id }
        } as any;

        const emit = (event: any) => {
            const chunk = formatter.parseStreamChunk(event);
            const normalizedDelta = accumulator.add(chunk);
            handleChunkType({
                conversationId: 'anthropic-tool-use-test',
                chunk: { ...chunk, delta: normalizedDelta }
            } as any, state);
        };

        emit({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_stop_1', name: 'write_file', input: {} } });
        emit({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":"demo.txt"' } });
        emit({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: ',"content":"hello"}' } });
        emit({ type: 'content_block_stop', index: 2 });

        let renderedCalls = toolCallsFromMessage(state.allMessages.value[0]);
        expect(renderedCalls).toHaveLength(1);
        expect(state.allMessages.value[0].tools).toHaveLength(1);
        expect(state.allMessages.value[0].tools?.[0].status).toBe('queued');
        expect(state.allMessages.value[0].tools?.[0].args).toEqual({ path: 'demo.txt', content: 'hello' });
        expect(state.allMessages.value[0].tools?.[0].partialArgs).toBeUndefined();

        emit({ type: 'message_stop' });

        renderedCalls = toolCallsFromMessage(state.allMessages.value[0]);
        expect(renderedCalls).toHaveLength(1);
        expect(state.allMessages.value[0].tools).toHaveLength(1);
        expect(state.allMessages.value[0].tools?.[0].id).toBe('toolu_stop_1');
        expect(state.allMessages.value[0].tools?.[0].args).toEqual({ path: 'demo.txt', content: 'hello' });
        expect(state.allMessages.value[0].tools?.[0].status).toBe('queued');
    });
});
