/**
 * 通用对话转录变更工具。
 *
 * 修改原因：主聊天和 SubAgent Monitor 都需要删除/重试消息，并且都必须正确处理 functionCall 与 functionResponse 的配对关系。
 * 修改方式：把“截断、删除逻辑消息组、重新规范化 index”集中到 conversation 模块，调用方只提供 Content[]。
 * 修改目的：避免主窗口和 SubAgent 子对话各自复制一套消息变更逻辑，后续工具配对规则升级时只改一个入口。
 */

import type { Content } from './types';

export interface TranscriptAdapter {
    load(): Promise<Content[]>;
    save(contents: Content[]): Promise<void>;
}

function cloneContents(contents: Content[]): Content[] {
    // 修改原因：调用方传入的 Content[] 可能来自内存快照或存储层，直接原地改会造成难以追踪的引用污染。
    // 修改方式：所有变更函数先做 JSON 深拷贝，再返回新的数组。
    // 修改目的：让 TranscriptMutation 成为纯变更入口，便于测试和复用。
    return JSON.parse(JSON.stringify(contents || []));
}

function normalizeIndexes(contents: Content[]): Content[] {
    // 修改原因：删除或截断后 backendIndex/content.index 必须重新连续，否则前端按 index 定位会错位。
    // 修改方式：按数组当前位置重写 index 字段，保留其它 Content 字段。
    // 修改目的：让主对话窗口和 SubAgent Monitor 都能用稳定的真实 contentIndex 做后续操作。
    return contents.map((content, index) => ({
        ...content,
        index
    } as Content));
}

function getFunctionCallIds(content: Content | undefined): Set<string> {
    const ids = new Set<string>();
    for (const part of content?.parts || []) {
        const id = part.functionCall?.id;
        if (typeof id === 'string' && id.trim()) {
            ids.add(id);
        }
    }
    return ids;
}

function hasMatchingFunctionResponse(content: Content | undefined, functionCallIds: Set<string>): boolean {
    if (!content || functionCallIds.size === 0) return false;
    for (const part of content.parts || []) {
        const id = part.functionResponse?.id;
        if (typeof id === 'string' && functionCallIds.has(id)) {
            return true;
        }
    }
    return false;
}

export function truncateFrom(contents: Content[], contentIndex: number): Content[] {
    const cloned = cloneContents(contents);
    if (contentIndex < 0 || contentIndex > cloned.length) {
        throw new Error(`Transcript content index out of bounds: ${contentIndex}`);
    }

    // 修改原因：重试语义是从目标楼开始删除后续上下文，主窗口和 Monitor 必须一致。
    // 修改方式：直接保留目标索引之前的 Content，并统一重建 index。
    // 修改目的：避免留下目标楼之后的 functionResponse 或工具结果污染下一次模型请求。
    return normalizeIndexes(cloned.slice(0, contentIndex));
}

export function deleteLogicalMessage(contents: Content[], contentIndex: number): Content[] {
    const cloned = cloneContents(contents);
    if (contentIndex < 0 || contentIndex >= cloned.length) {
        throw new Error(`Transcript content index out of bounds: ${contentIndex}`);
    }

    const target = cloned[contentIndex];
    const functionCallIds = getFunctionCallIds(target);
    const indexesToDelete = new Set<number>([contentIndex]);

    if (functionCallIds.size > 0) {
        // 修改原因：删除包含工具调用的模型消息时，如果保留配对 functionResponse，会在后续请求中形成孤儿工具结果。
        // 修改方式：扫描目标消息之后的 Content，删除含有匹配 functionResponse.id 的消息。
        // 修改目的：保持 provider 要求的 functionCall/functionResponse 配对完整性，避免重试时报历史结构错误。
        for (let index = contentIndex + 1; index < cloned.length; index++) {
            if (hasMatchingFunctionResponse(cloned[index], functionCallIds)) {
                indexesToDelete.add(index);
            }
        }
    }

    const next = cloned.filter((_, index) => !indexesToDelete.has(index));
    return normalizeIndexes(next);
}

export async function mutateTranscript(
    adapter: TranscriptAdapter,
    mutator: (contents: Content[]) => Content[]
): Promise<Content[]> {
    // 修改原因：主对话和 SubAgent 子对话使用不同存储后端，但变更流程都是 load -> mutate -> save。
    // 修改方式：抽象 adapter 后统一执行变更，并返回保存后的新快照。
    // 修改目的：让 handler 不复制读写流程，也方便后续加入完整性校验。
    const contents = await adapter.load();
    const next = mutator(contents);
    await adapter.save(next);
    return next;
}
