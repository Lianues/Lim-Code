/**
 * SubAgent 运行时事件总线。
 *
 * 修改原因：SubAgent Monitor 要像正常聊天窗口一样恢复和渲染内部对话，而不是只展示事件列表。
 * 修改方式：每个 run 同时维护 runtime events 和标准 Content[] 子对话，并可将子对话保存到 conversation metadata。
 * 修改目的：主聊天时间线保持干净，Monitor 可恢复完整 SubAgent 内部记录，且前端能复用 MessageItem/ToolMessage/MessageTaskCards。
 */

import type { ITranscriptRepository } from '../../modules/conversation/TranscriptRepository';
import type { Content } from '../../modules/conversation/types';
import { SubAgentTranscriptRepository } from './SubAgentTranscriptRepository';
import type { ToolProgressEvent } from '../types';

export const SUBAGENT_RUNS_METADATA_KEY = 'subAgentRuns';

export interface SubAgentRunEvent extends ToolProgressEvent {
    runId: string;
    agentName?: string;
    timestamp: number;
    /**
     * 修改原因：Monitor window 与事件是异步跨 Webview 通道传输，前端需要可比较的单调事件序号避免旧响应覆盖新状态。
     * 修改方式：由 SubAgentRunEventBus 在每次发事件时递增并写入 eventSequence。
     * 修改目的：让 manifest、window 和 event 能共同判断状态新旧，而不是依赖 updatedAt 或请求返回时序。
     */
    eventSequence?: number;
    /**
     * 修改原因：Content[] transcript 已改为按需 window 传输，前端必须知道当前窗口是否仍对应后端最新 transcript 版本。
     * 修改方式：由所有 transcript 写入口递增 contentRevision，并随事件、manifest、window 下发。
     * 修改目的：阻止 stale window 继续接收 live delta，从协议层修复多轮回复混楼。
     */
    contentRevision?: number;
}

/**
 * SubAgent run 的显式状态机。
 *
 * 修改原因：原有 running/completed/failed/cancelled 无法区分 Monitor 暂停、等待用户处理和扩展重载中断。
 * 修改方式：增加 paused、awaiting_monitor_action、interrupted，并作为持久快照的唯一状态类型。
 * 修改目的：让 UI 控制按钮、主工具等待语义和历史 run 展示不再混用 failed/cancelled。
 */
export type SubAgentRunStatus = 'running' | 'paused' | 'awaiting_monitor_action' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface SubAgentRunPersistedRecord {
    runId: string;
    agentName?: string;
    status: SubAgentRunStatus;
    createdAt: number;
    updatedAt: number;
    contents: Content[];
    /**
     * 修改原因：历史 metadata 只有 contents/updatedAt，无法判断异步 window 响应是否过期。
     * 修改方式：持久化 transcript 修订号；旧 metadata 读取时会补 0，后续写入自然升级。
     * 修改目的：让 Monitor 恢复历史 run 时也能使用同一套 freshness 判断。
     */
    contentRevision?: number;
    /**
     * 修改原因：事件列表被瘦身且 llm_delta 不入持久 journal，仍需要一个 run 级事件时序供前端去重和调试。
     * 修改方式：持久化最新 eventSequence；旧 metadata 读取时补 0。
     * 修改目的：为后续统一 AgentRunEvent replay 保留单调时序基础。
     */
    eventSequence?: number;
}

export interface SubAgentRunSnapshot extends SubAgentRunPersistedRecord {
    events: SubAgentRunEvent[];
    conversationId?: string;
    contentRevision: number;
    eventSequence: number;
}

export interface SubAgentRunManifest {
    runId: string;
    agentName?: string;
    status: SubAgentRunStatus;
    createdAt: number;
    updatedAt: number;
    conversationId?: string;
    contentCount: number;
    eventCount: number;
    contentRevision: number;
    eventSequence: number;
    preview?: string;
    lastMessageRole?: Content['role'];
}

export interface SubAgentRunContentWindow {
    runId: string;
    contents: Content[];
    startIndex: number;
    endIndex: number;
    totalCount: number;
    contentRevision: number;
    eventSequence: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
}

export interface SubAgentRunContentWindowOptions {
    startIndex?: number;
    endIndex?: number;
    limit?: number;
    fromTail?: boolean;
}

export interface SubAgentRunConversationStore {
    getCustomMetadata(conversationId: string, key: string): Promise<unknown>;
    setCustomMetadata(conversationId: string, key: string, value: unknown): Promise<void>;
}

type SubAgentRunListener = (event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot) => void;

const DEFAULT_CONTENT_WINDOW_LIMIT = 20;
const MANIFEST_PREVIEW_MAX_LENGTH = 160;

function cloneContentsForWindow(contents: Content[]): Content[] {
    // 修改原因：按需 transcript window 会被前端本地流式 delta 临时修改，不能把事件总线内存对象引用直接交出去。
    // 修改方式：只对窗口切片做 JSON 深拷贝，而不是像旧 snapshots 首包那样复制所有 run 的完整 contents。
    // 修改目的：保持事件总线仍是唯一真源，同时把 Monitor 首屏和窗口请求的复制成本限定在窗口大小内。
    return JSON.parse(JSON.stringify(contents || [])) as Content[];
}

function extractContentPreview(content: Content | undefined): string | undefined {
    if (!content) return undefined;
    const text = (content.parts || [])
        .map(part => {
            if (typeof part.text === 'string' && part.text.trim()) return part.text.trim();
            if (part.functionCall?.name) return `调用工具 ${part.functionCall.name}`;
            if (part.functionResponse?.name) return `工具结果 ${part.functionResponse.name}`;
            return '';
        })
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return undefined;
    return text.length > MANIFEST_PREVIEW_MAX_LENGTH
        ? `${text.slice(0, MANIFEST_PREVIEW_MAX_LENGTH)}…`
        : text;
}

function ensureSnapshotProtocolFields(snapshot: SubAgentRunSnapshot): void {
    // 修改原因：旧 conversation metadata 中没有 contentRevision/eventSequence，新协议读取历史 run 时不能让字段变成 undefined。
    // 修改方式：在所有 snapshot 进入事件总线时统一补齐协议字段，并把非数字值归零。
    // 修改目的：manifest、window、event 的 freshness 判断在新旧数据上使用同一语义。
    snapshot.contentRevision = Number.isFinite(snapshot.contentRevision) ? snapshot.contentRevision : 0;
    snapshot.eventSequence = Number.isFinite(snapshot.eventSequence) ? snapshot.eventSequence : 0;
}

function stampRunEvent(snapshot: SubAgentRunSnapshot, event: SubAgentRunEvent): SubAgentRunEvent {
    // 修改原因：Webview postMessage 和 getRunWindow response 可能乱序到达，事件必须携带 run 内单调序号。
    // 修改方式：所有事件统一通过本 helper 递增 snapshot.eventSequence，并同时附带当前 contentRevision。
    // 修改目的：前端可以拒绝旧事件或旧窗口，不再依赖 updatedAt 和加载时机猜测。
    snapshot.eventSequence += 1;
    return {
        ...event,
        eventSequence: snapshot.eventSequence,
        contentRevision: snapshot.contentRevision
    };
}

function bumpContentRevision(snapshot: SubAgentRunSnapshot): void {
    // 修改原因：append/update/replace 都会改变 transcript 真源，窗口缓存必须能识别这些变化。
    // 修改方式：所有 Content[] 写入口在发 content_snapshot 前递增 contentRevision。
    // 修改目的：避免旧窗口继续接收下一轮 delta，修复多次回复混为一楼。
    snapshot.contentRevision += 1;
}

function toManifest(snapshot: SubAgentRunSnapshot): SubAgentRunManifest {
    // 修改原因：Monitor run tab 和首屏只需要列表元数据，不需要完整 transcript。
    // 修改方式：从唯一 snapshot 派生轻量 manifest，并把 preview 截断到固定长度，同时携带单调 revision/sequence。
    // 修改目的：避免 monitorReady 阶段把所有 run 的 contents 经 stringify/postMessage/deserialize 一次性送进前端，并让前端能判断窗口新旧。
    ensureSnapshotProtocolFields(snapshot);
    const contents = snapshot.contents || [];
    const lastContent = contents.length > 0 ? contents[contents.length - 1] : undefined;
    return {
        runId: snapshot.runId,
        agentName: snapshot.agentName,
        status: snapshot.status,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        conversationId: snapshot.conversationId,
        contentCount: contents.length,
        eventCount: (snapshot.events || []).length,
        contentRevision: snapshot.contentRevision,
        eventSequence: snapshot.eventSequence,
        preview: extractContentPreview(lastContent),
        lastMessageRole: lastContent?.role
    };
}

function isLiveOnlyEvent(event: SubAgentRunEvent): boolean {
    // 修改原因：llm_delta 是高频流式热路径，写入 snapshot.events 会让内存事件列表和 Monitor postMessage 随输出长度 O(n²) 膨胀。
    // 修改方式：把 llm_delta 标记为仅实时广播事件，不进入持久事件 journal，也不触发 metadata 落盘。
    // 修改目的：SubAgent Monitor 能实时消费 delta，但历史恢复仍只依赖最终 contents 快照。
    return event.type === 'llm_delta';
}

function normalizePersistedMap(raw: unknown): Record<string, SubAgentRunPersistedRecord> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }
    return raw as Record<string, SubAgentRunPersistedRecord>;
}

class SubAgentRunEventBus {
    getTranscriptRepository(runId: string): ITranscriptRepository {
        // 修改原因：SubAgent 子 transcript 需要与主聊天共享同一仓储抽象，而不暴露事件总线内部的 snapshot/persist 细节。
        // 修改方式：为指定 runId 创建一个绑定当前事件总线的 SubAgentTranscriptRepository。
        // 修改目的：调用方通过统一接口读写子 transcript，同时保留事件总线现有广播与 metadata 持久化语义。
        return new SubAgentTranscriptRepository(this, runId);
    }

    private readonly listeners = new Set<SubAgentRunListener>();
    private readonly snapshots = new Map<string, SubAgentRunSnapshot>();
    private readonly stores = new Map<string, SubAgentRunConversationStore>();
    private readonly persistQueues = new Map<string, Promise<void>>();

    createRun(
        runId: string,
        agentName?: string,
        payload?: unknown,
        options?: {
            conversationId?: string;
            conversationStore?: SubAgentRunConversationStore;
            initialContents?: Content[];
        }
    ): SubAgentRunSnapshot {
        const now = Date.now();
        const snapshot: SubAgentRunSnapshot = {
            runId,
            agentName,
            status: 'running',
            createdAt: now,
            updatedAt: now,
            contents: options?.initialContents || [],
            events: [],
            conversationId: options?.conversationId,
            // 修改原因：新建 run 需要立即具备 freshness 协议字段，后续 run_created/窗口响应才能共享同一判断规则。
            // 修改方式：eventSequence/contentRevision 从 0 开始，事件发送和 transcript 写入分别递增。
            // 修改目的：避免前端在首个 manifest/window 上收到 undefined revision，导致旧窗口保护失效。
            contentRevision: 0,
            eventSequence: 0
        };
        this.snapshots.set(runId, snapshot);
        if (options?.conversationId && options.conversationStore) {
            this.stores.set(runId, options.conversationStore);
        }
        this.emit({
            runId,
            agentName,
            type: 'run_created',
            timestamp: now,
            payload
        });
        this.enqueuePersist(runId);
        return snapshot;
    }

    emit(event: ToolProgressEvent & { runId: string; agentName?: string }): void {
        const timestamp = event.timestamp || Date.now();
        const normalized: SubAgentRunEvent = {
            ...event,
            timestamp
        };

        let snapshot = this.snapshots.get(normalized.runId);
        if (!snapshot) {
            snapshot = {
                runId: normalized.runId,
                agentName: normalized.agentName,
                status: 'running',
                createdAt: timestamp,
                updatedAt: timestamp,
                contents: [],
                events: [],
                // 修改原因：事件先于 createRun 到达时也必须具备协议字段，不能让自动创建路径落后于正常 createRun。
                // 修改方式：自动 snapshot 同样从 0 初始化 eventSequence/contentRevision。
                // 修改目的：保证 Monitor 对异常/恢复事件也能执行同一 stale 判断。
                contentRevision: 0,
                eventSequence: 0
            };
            this.snapshots.set(normalized.runId, snapshot);
        }

        ensureSnapshotProtocolFields(snapshot);
        snapshot.agentName = normalized.agentName || snapshot.agentName;
        snapshot.updatedAt = timestamp;
        const stamped = stampRunEvent(snapshot, normalized);
        if (!isLiveOnlyEvent(stamped)) {
            snapshot.events.push(stamped);
        }

        if (stamped.type === 'run_completed') {
            snapshot.status = 'completed';
        } else if (stamped.type === 'run_failed') {
            snapshot.status = 'failed';
        } else if (stamped.type === 'run_cancelled') {
            snapshot.status = 'cancelled';
        } else if (stamped.type === 'run_paused') {
            // 修改原因：Monitor 中止不能被记录成 failed，否则主窗口工具会误判 SubAgent 已经失败。
            // 修改方式：运行事件总线将 run_paused 映射为 paused 状态。
            // 修改目的：保留主工具等待语义，同时让 Monitor 明确显示“已暂停”。
            snapshot.status = 'paused';
        } else if (stamped.type === 'run_resumed') {
            snapshot.status = 'running';
        } else if (stamped.type === 'run_awaiting_monitor_action') {
            snapshot.status = 'awaiting_monitor_action';
        } else if (stamped.type === 'run_interrupted') {
            snapshot.status = 'interrupted';
        }

        this.notify(stamped, snapshot);
        if (stamped.type.startsWith('run_')) {
            this.enqueuePersist(stamped.runId);
        }
    }

    appendContent(runId: string, content: Content): void {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return;
        }
        ensureSnapshotProtocolFields(snapshot);
        const now = Date.now();
        snapshot.contents.push({
            ...content,
            timestamp: content.timestamp || now,
            index: snapshot.contents.length
        } as Content);
        snapshot.updatedAt = now;
        bumpContentRevision(snapshot);

        const event = stampRunEvent(snapshot, {
            runId,
            agentName: snapshot.agentName,
            type: 'content_snapshot',
            timestamp: now,
            payload: { contents: snapshot.contents }
        });
        snapshot.events.push(event);
        this.notify(event, snapshot);
        this.enqueuePersist(runId);
    }

    updateLastModelContent(runId: string, content: Content): void {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return;
        }
        ensureSnapshotProtocolFields(snapshot);
        const lastIndex = snapshot.contents.length - 1;
        if (lastIndex >= 0 && snapshot.contents[lastIndex]?.role === 'model') {
            snapshot.contents[lastIndex] = {
                ...content,
                timestamp: content.timestamp || snapshot.contents[lastIndex].timestamp || Date.now(),
                index: snapshot.contents[lastIndex].index ?? lastIndex
            } as Content;
        } else {
            this.appendContent(runId, content);
            return;
        }

        const now = Date.now();
        snapshot.updatedAt = now;
        bumpContentRevision(snapshot);
        const event = stampRunEvent(snapshot, {
            runId,
            agentName: snapshot.agentName,
            type: 'content_snapshot',
            timestamp: now,
            payload: { contents: snapshot.contents }
        });
        snapshot.events.push(event);
        this.notify(event, snapshot);
    }

    replaceContents(runId: string, contents: Content[]): SubAgentRunSnapshot | undefined {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return undefined;
        }

        // 修改原因：Monitor 删除/重试内部楼层后，新的 Content[] 必须写回 run 快照和 conversation metadata。
        // 修改方式：由事件总线提供 replaceContents 作为唯一写入口，统一更新时间、通知前端和入队持久化。
        // 修改目的：避免 SubAgentsHandlers 直接改 snapshot.contents，保证内存和持久化记录同步。
        ensureSnapshotProtocolFields(snapshot);
        const now = Date.now();
        snapshot.contents = contents.map((content, index) => ({
            ...content,
            index,
            timestamp: content.timestamp || now
        } as Content));
        snapshot.updatedAt = now;
        bumpContentRevision(snapshot);

        const event = stampRunEvent(snapshot, {
            runId,
            agentName: snapshot.agentName,
            type: 'content_snapshot',
            timestamp: now,
            payload: { contents: snapshot.contents }
        });
        snapshot.events.push(event);
        this.notify(event, snapshot);
        this.enqueuePersist(runId);
        return snapshot;
    }

    mutateContents(runId: string, mutator: (contents: Content[]) => Content[]): SubAgentRunSnapshot | undefined {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return undefined;
        }

        // 修改原因：SubAgent 子对话要复用 TranscriptMutation 这类纯变更函数，同时由事件总线负责保存结果。
        // 修改方式：复制当前 contents 后交给 mutator，再通过 replaceContents 统一落盘和广播。
        // 修改目的：让 Monitor 消息操作不绕过事件总线的持久化队列。
        const nextContents = mutator(JSON.parse(JSON.stringify(snapshot.contents || [])) as Content[]);
        return this.replaceContents(runId, nextContents);
    }

    subscribe(listener: SubAgentRunListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getSnapshot(runId: string): SubAgentRunSnapshot | undefined {
        return this.snapshots.get(runId);
    }

    getManifest(runId: string): SubAgentRunManifest | undefined {
        const snapshot = this.snapshots.get(runId);
        return snapshot ? toManifest(snapshot) : undefined;
    }

    getManifests(): SubAgentRunManifest[] {
        // 修改原因：SubAgent Monitor 首屏只需要 run 列表、状态和预览，完整 contents 会在大输出场景造成打开卡顿。
        // 修改方式：保留 getSnapshots 供兼容路径使用，新增 getManifests 只派生轻量字段且绝不包含 contents/events。
        // 修改目的：不引入第二真源，仍从现有 snapshot 派生 Monitor manifest。
        return Array.from(this.snapshots.values())
            .map(snapshot => toManifest(snapshot))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    getContentWindow(runId: string, options: SubAgentRunContentWindowOptions = {}): SubAgentRunContentWindow | undefined {
        const snapshot = this.snapshots.get(runId);
        if (!snapshot) {
            return undefined;
        }

        // 修改原因：聚焦 run 后只需要先渲染一段 transcript，不应一次性传输完整 contents。
        // 修改方式：基于 snapshot.contents 做窗口切片；默认从尾部取最后 20 条，显式 start/end/limit 可支持后续“加载更多”。
        // 修改目的：保持 Content[]/MessageItem 渲染语义不分叉，同时把传输、反序列化和 Markdown 渲染成本限制在窗口内。
        const contents = snapshot.contents || [];
        const totalCount = contents.length;
        const rawLimit = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit!)) : DEFAULT_CONTENT_WINDOW_LIMIT;
        const limit = rawLimit > 0 ? rawLimit : DEFAULT_CONTENT_WINDOW_LIMIT;
        let startIndex: number;
        let endIndex: number;

        if (typeof options.startIndex === 'number' || typeof options.endIndex === 'number') {
            // 修改原因：“加载更早消息”会只传 endIndex=当前窗口 startIndex，语义是取该位置之前的一页；旧逻辑会错误返回 0..limit。
            // 修改方式：分别处理 start-only、end-only、start+end 三种窗口请求；end-only 从 endIndex 向前回退 limit 条。
            // 修改目的：前端可以用真实 backendIndex 分页向前加载，而不需要知道完整 transcript 长度或自行换算。
            if (typeof options.startIndex === 'number' && typeof options.endIndex === 'number') {
                startIndex = Math.max(0, Math.min(totalCount, Math.floor(options.startIndex)));
                endIndex = Math.max(startIndex, Math.min(totalCount, Math.floor(options.endIndex)));
                if (endIndex - startIndex > limit) {
                    endIndex = startIndex + limit;
                }
            } else if (typeof options.endIndex === 'number') {
                endIndex = Math.max(0, Math.min(totalCount, Math.floor(options.endIndex)));
                startIndex = Math.max(0, endIndex - limit);
            } else {
                startIndex = Math.max(0, Math.min(totalCount, Math.floor(options.startIndex!)));
                endIndex = Math.min(totalCount, startIndex + limit);
            }
        } else if (options.fromTail !== false) {
            endIndex = totalCount;
            startIndex = Math.max(0, endIndex - limit);
        } else {
            startIndex = 0;
            endIndex = Math.min(totalCount, limit);
        }

        ensureSnapshotProtocolFields(snapshot);
        return {
            runId,
            contents: cloneContentsForWindow(contents.slice(startIndex, endIndex)),
            startIndex,
            endIndex,
            totalCount,
            contentRevision: snapshot.contentRevision,
            eventSequence: snapshot.eventSequence,
            hasMoreBefore: startIndex > 0,
            hasMoreAfter: endIndex < totalCount
        };
    }

    getSnapshots(): SubAgentRunSnapshot[] {
        return Array.from(this.snapshots.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async loadConversationSnapshots(
        conversationId: string,
        store: SubAgentRunConversationStore
    ): Promise<SubAgentRunSnapshot[]> {
        const raw = await store.getCustomMetadata(conversationId, SUBAGENT_RUNS_METADATA_KEY);
        const persistedMap = normalizePersistedMap(raw);
        const snapshots: SubAgentRunSnapshot[] = [];

        for (const record of Object.values(persistedMap)) {
            const existing = this.snapshots.get(record.runId);
            if (existing) {
                snapshots.push(existing);
                continue;
            }
            const snapshot: SubAgentRunSnapshot = {
                ...record,
                events: [],
                conversationId,
                // 修改原因：旧 metadata 没有 revision/sequence 字段；恢复为 snapshot 时必须补齐，后续写回会自动升级持久格式。
                // 修改方式：缺失字段统一补 0，保留已有新格式字段。
                // 修改目的：历史 run 也能参与前端 stale window 判断，不需要专门兼容分支。
                contentRevision: Number.isFinite(record.contentRevision) ? record.contentRevision! : 0,
                eventSequence: Number.isFinite(record.eventSequence) ? record.eventSequence! : 0
            };
            this.snapshots.set(record.runId, snapshot);
            this.stores.set(record.runId, store);
            snapshots.push(snapshot);
        }

        return snapshots.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    private notify(event: SubAgentRunEvent, snapshot: SubAgentRunSnapshot): void {
        for (const listener of this.listeners) {
            listener(event, snapshot);
        }
    }

    private enqueuePersist(runId: string): void {
        const snapshot = this.snapshots.get(runId);
        const store = this.stores.get(runId);
        if (!snapshot?.conversationId || !store) {
            return;
        }

        const previous = this.persistQueues.get(runId) || Promise.resolve();
        const next = previous
            .catch(() => undefined)
            .then(async () => {
                const raw = await store.getCustomMetadata(snapshot.conversationId!, SUBAGENT_RUNS_METADATA_KEY);
                const persistedMap = normalizePersistedMap(raw);
                ensureSnapshotProtocolFields(snapshot);
                const record: SubAgentRunPersistedRecord = {
                    runId: snapshot.runId,
                    agentName: snapshot.agentName,
                    status: snapshot.status,
                    createdAt: snapshot.createdAt,
                    updatedAt: snapshot.updatedAt,
                    contents: snapshot.contents,
                    contentRevision: snapshot.contentRevision,
                    eventSequence: snapshot.eventSequence
                };
                persistedMap[runId] = record;
                await store.setCustomMetadata(snapshot.conversationId!, SUBAGENT_RUNS_METADATA_KEY, persistedMap);
            })
            .catch(error => {
                console.warn('[SubAgentRunEventBus] Failed to persist SubAgent run:', error);
            });

        this.persistQueues.set(runId, next);
    }
}

export const subAgentRunEventBus = new SubAgentRunEventBus();
