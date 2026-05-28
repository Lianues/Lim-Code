/**
 * SubAgent 子 transcript 仓储适配器。
 *
 * 修改原因：SubAgentRunEventBus 既要维护 Monitor 运行时快照，又要把 contents 持久化回 conversation metadata；
 * 这些职责不能继续散落在 append/replace 调用方中各自维护。
 * 修改方式：为 runId 绑定一个 ITranscriptRepository 适配器，把 contents 读写统一委托给事件总线提供的单一入口。
 * 修改目的：主聊天与 SubAgent 子 transcript 最终共享同一抽象层，同时保持 SubAgent 现有 content_snapshot 事件和 metadata 落盘语义不变。
 */

import type { ITranscriptRepository } from '../../modules/conversation/TranscriptRepository';
import { DelegatingTranscriptRepository } from '../../modules/conversation/TranscriptRepository';
import type { Content } from '../../modules/conversation/types';
import type { SubAgentRunSnapshot } from './runEventBus';

export interface SubAgentTranscriptStore {
    getSnapshot(runId: string): SubAgentRunSnapshot | undefined;
    appendContent(runId: string, content: Content): void;
    replaceContents(runId: string, contents: Content[]): SubAgentRunSnapshot | undefined;
}

export class SubAgentTranscriptRepository extends DelegatingTranscriptRepository implements ITranscriptRepository {
    constructor(store: SubAgentTranscriptStore, runId: string) {
        // 修改原因：SubAgent transcript 的真实写入口是事件总线，而不是某个裸数组；仓储必须复用这条入口以保留广播与持久化队列语义。
        // 修改方式：把 runId 绑定到事件总线暴露的 getSnapshot/appendContent/replaceContents 上，形成仓储委托。
        // 修改目的：调用方只面对 transcript 仓储接口，不需要知道 snapshot.events、metadata key 或持久化队列的存在。
        super({
            loadContents: async () => {
                const snapshot = store.getSnapshot(runId);
                return snapshot?.contents || [];
            },
            saveContents: async contents => {
                store.replaceContents(runId, contents);
            }
        });
        this.store = store;
        this.runId = runId;
    }

    private readonly store: SubAgentTranscriptStore;
    private readonly runId: string;

    async appendContent(content: Content): Promise<Content[]> {
        // 修改原因：事件总线 appendContent 额外负责补 index/timestamp、广播 content_snapshot、入队 metadata 落盘；
        // 如果 SubAgent 仓储退化成 generic mutate，会绕开这条既有单一入口。
        // 修改方式：append 特化为直接委托事件总线 appendContent，再回读保存后的 contents。
        // 修改目的：在统一仓储接口下继续保持 SubAgent append 的原始副作用与时序不变。
        this.store.appendContent(this.runId, content);
        return await this.getContents();
    }
}
