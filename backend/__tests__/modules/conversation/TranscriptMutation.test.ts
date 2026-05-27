import { deleteLogicalMessage, truncateFrom } from '../../../modules/conversation/TranscriptMutation';
import type { Content } from '../../../modules/conversation/types';

function modelWithTool(id: string): Content {
    return {
        role: 'model',
        parts: [{ functionCall: { id, name: 'read_file', args: { path: 'README.md' } } }],
        index: 1
    } as Content;
}

function functionResponse(id: string): Content {
    return {
        role: 'user',
        parts: [{ functionResponse: { id, name: 'read_file', response: { success: true } } }],
        isFunctionResponse: true,
        index: 2
    } as Content;
}

describe('TranscriptMutation', () => {
    it('deletes paired functionResponse when deleting a model message with tool calls', () => {
        const transcript: Content[] = [
            { role: 'user', parts: [{ text: 'start' }], index: 0 } as Content,
            modelWithTool('call-1'),
            functionResponse('call-1'),
            { role: 'model', parts: [{ text: 'done' }], index: 3 } as Content
        ];

        const next = deleteLogicalMessage(transcript, 1);

        // 修改原因：删除带工具调用的模型楼层时，孤儿 functionResponse 会破坏后续 provider 历史配对校验。
        // 修改方式：断言 deleteLogicalMessage 同时删除目标模型消息和匹配 id 的 functionResponse。
        // 修改目的：锁定主窗口和 SubAgent Monitor 共用的配对删除语义。
        expect(next).toHaveLength(2);
        expect(next.map(item => item.parts?.[0]?.text || item.parts?.[0]?.functionResponse?.id)).toEqual(['start', 'done']);
        expect(next.map(item => item.index)).toEqual([0, 1]);
    });

    it('keeps unrelated functionResponse entries when deleting a tool message', () => {
        const transcript: Content[] = [
            { role: 'user', parts: [{ text: 'start' }], index: 0 } as Content,
            modelWithTool('call-1'),
            functionResponse('other-call'),
            functionResponse('call-1')
        ];

        const next = deleteLogicalMessage(transcript, 1);

        // 修改原因：配对删除不能粗暴删除目标楼层之后的所有 functionResponse，否则会误删其它工具结果。
        // 修改方式：只删除 functionResponse.id 与目标 functionCall.id 匹配的消息。
        // 修改目的：保护并行工具或相邻工具调用的独立结果。
        expect(next).toHaveLength(2);
        expect(next[1].parts?.[0]?.functionResponse?.id).toBe('other-call');
        expect(next.map(item => item.index)).toEqual([0, 1]);
    });

    it('truncates from the target index and normalizes indexes', () => {
        const transcript: Content[] = [
            { role: 'user', parts: [{ text: 'a' }], index: 10 } as Content,
            { role: 'model', parts: [{ text: 'b' }], index: 11 } as Content,
            { role: 'user', parts: [{ text: 'c' }], index: 12 } as Content
        ];

        const next = truncateFrom(transcript, 1);

        // 修改原因：重试语义要求从目标楼开始清除后续上下文，且索引必须回到连续状态。
        // 修改方式：断言只保留目标前内容，并重写 index。
        // 修改目的：防止 Monitor 使用可见索引或旧 index 导致后续删除/重试错位。
        expect(next).toHaveLength(1);
        expect(next[0].parts?.[0]?.text).toBe('a');
        expect(next[0].index).toBe(0);
    });
});
