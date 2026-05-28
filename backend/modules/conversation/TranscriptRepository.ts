/**
 * 通用 transcript 仓储抽象。
 *
 * 修改原因：主聊天 transcript 与 SubAgent 子 transcript 都要执行 get/append/replace/mutate 这四类写操作，
 * 但此前两边分别直接操作 storage.saveHistory 或 snapshot.contents，导致边界一致性只能靠约定维持。
 * 修改方式：定义 ITranscriptRepository 统一读写接口，再用委托式适配器把不同持久化后端接入同一套入口。
 * 修改目的：后续对 transcript 完整性、配对删除、审计或性能优化，只需要围绕一个仓储抽象扩展，而不是继续复制读写流程。
 */

import type { Content } from './types';

export type TranscriptContentsMutator = (contents: Content[]) => Content[];

export interface ITranscriptRepository {
    getContents(): Promise<Content[]>;
    appendContent(content: Content): Promise<Content[]>;
    replaceContents(contents: Content[]): Promise<Content[]>;
    mutateContents(mutator: TranscriptContentsMutator): Promise<Content[]>;
}

export interface TranscriptRepositoryDelegate {
    loadContents(): Promise<Content[]>;
    saveContents(contents: Content[]): Promise<void>;
}

export function cloneTranscriptContents(contents: ReadonlyArray<Content> = []): Content[] {
    // 修改原因：transcript 内容可能来自存储层、内存快照或测试数据，直接把引用泄漏给调用方会让“绕过仓储的原地修改”重新出现。
    // 修改方式：沿用 conversation 模块既有 JSON 深拷贝策略，仓储边界内外都只交换独立副本。
    // 修改目的：把 transcript 变更收敛到显式的 append/replace/mutate 调用，而不是靠调用方自觉不改数组引用。
    return JSON.parse(JSON.stringify(contents || [])) as Content[];
}

export class DelegatingTranscriptRepository implements ITranscriptRepository {
    constructor(private readonly delegate: TranscriptRepositoryDelegate) {}

    async getContents(): Promise<Content[]> {
        return cloneTranscriptContents(await this.delegate.loadContents());
    }

    async appendContent(content: Content): Promise<Content[]> {
        // 修改原因：append 是最常见的 transcript 写操作，调用方不应自己重复 load -> push -> save 样板代码。
        // 修改方式：append 在仓储内部转成 mutate，从而与 replace/mutate 共用同一条保存路径。
        // 修改目的：任何 append 的后续增强（审计、校验、监控）都能自动覆盖主聊天和 SubAgent。
        const [contentCopy] = cloneTranscriptContents([content]);
        return await this.mutateContents(contents => {
            contents.push(contentCopy as Content);
            return contents;
        });
    }

    async replaceContents(contents: Content[]): Promise<Content[]> {
        // 修改原因：不同适配器在 save 时可能补 timestamp/index 或触发持久化副作用，直接返回传入数组会丢失“真实已保存快照”。
        // 修改方式：保存后重新走一次 getContents，返回适配器最终落地的数据形态。
        // 修改目的：调用方拿到的结果与真实 transcript 状态一致，避免主聊天与 SubAgent 对返回值语义产生分叉。
        await this.delegate.saveContents(cloneTranscriptContents(contents));
        return await this.getContents();
    }

    async mutateContents(mutator: TranscriptContentsMutator): Promise<Content[]> {
        // 修改原因：删除、截断、批量追加等操作都属于“读取当前 transcript 后生成新数组”的同一语义，不应在调用方各写一套流程。
        // 修改方式：仓储统一负责 get -> mutate -> replace，mutator 只关注纯数组变换。
        // 修改目的：把 TranscriptMutation 这类纯函数自然接到统一入口，主聊天和 SubAgent 共享同一套变更方式。
        const currentContents = await this.getContents();
        const nextContents = mutator(currentContents);
        return await this.replaceContents(nextContents);
    }
}

export class ConversationTranscriptRepository extends DelegatingTranscriptRepository {
    constructor(delegate: TranscriptRepositoryDelegate) {
        // 修改原因：主聊天 transcript 的真实读取语义需要由 ConversationManager 决定，例如缺失历史时自动创建会话并补元数据。
        // 修改方式：主聊天 adapter 只接收已经绑定好 load/save 语义的委托，而不是直接假设某种 storage 接口。
        // 修改目的：仓储抽象保持通用，ConversationManager 可以在不暴露内部规则的情况下接入统一 transcript 入口。
        super(delegate);
    }

    async appendContent(content: Content): Promise<Content[]> {
        // 修改原因：主聊天现有 append 语义会为缺失 timestamp 的内容补时间戳；仓储适配后不能悄悄改变这条持久化约定。
        // 修改方式：主聊天 adapter 在进入通用 append 流程前补齐 timestamp，其它字段保持原样，不触碰持久化格式和 index/backendIndex 语义。
        // 修改目的：让新的统一仓储接口与 ConversationManager 既有追加语义保持一致。
        const [contentCopy] = cloneTranscriptContents([content]);
        if (contentCopy && !contentCopy.timestamp) {
            contentCopy.timestamp = Date.now();
        }
        return await super.appendContent(contentCopy as Content);
    }
}
