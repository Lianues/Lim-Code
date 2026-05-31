/**
 * LimCode - Runtime Ledger default bootstrap
 *
 * 修改原因：Runtime Ledger 需要一个共享的 registry/ledger 实例，不能让每个 producer 自己发明 eventType 和 schema。
 * 修改方式：集中注册运行时事件类型，并默认以 canonical 模式创建 ledger。
 * 修改目的：让主聊天、工具和 Monitor 共享同一套事实层与投影契约。
 */

import { RuntimeEventRegistry, RuntimeOperationRegistry, RuntimeSchemaRegistry, createRuntimeSchema } from './registry';
import { RuntimeLedger } from './RuntimeLedger';
import type { RuntimeLedgerMode, RuntimeLedgerStore } from './types';

export interface RuntimeLedgerBootstrap {
    schemas: RuntimeSchemaRegistry;
    events: RuntimeEventRegistry;
    operations: RuntimeOperationRegistry;
    ledger: RuntimeLedger;
}

export interface DefaultRuntimeLedgerOptions {
    mode?: RuntimeLedgerMode;
    store?: RuntimeLedgerStore;
    recentEventLimit?: number;
}

export function createDefaultRuntimeLedger(options: RuntimeLedgerMode | DefaultRuntimeLedgerOptions = 'canonical'): RuntimeLedgerBootstrap {
    const mode = typeof options === 'string' ? options : options.mode ?? 'canonical';
    const store = typeof options === 'string' ? undefined : options.store;
    const recentEventLimit = typeof options === 'string' ? undefined : options.recentEventLimit;
    const schemas = new RuntimeSchemaRegistry();
    const events = new RuntimeEventRegistry(schemas);
    const operations = new RuntimeOperationRegistry(schemas);

    events.register({
        eventType: 'runtime.subagent.run_event',
        kind: 'integration',
        context: 'subagent',
        subject: 'run',
        persistence: 'durable',
        schema: createRuntimeSchema<{ sourceType: string }>('runtime.subagent.run_event', 1, payload => {
            if (!payload || typeof payload.sourceType !== 'string') {
                throw new Error('sourceType is required');
            }
        })
    });

    events.register({
        eventType: 'runtime.subagent.live_delta',
        kind: 'integration',
        context: 'subagent',
        subject: 'liveDelta',
        persistence: 'ephemeral',
        schema: createRuntimeSchema<{ sourceType: string; payloadKind?: string }>('runtime.subagent.live_delta', 1, payload => {
            if (!payload || payload.sourceType !== 'llm_delta') {
                throw new Error('live delta must preserve llm_delta source type');
            }
        })
    });

    events.register({
        eventType: 'runtime.subagent.content_snapshot',
        kind: 'domain',
        context: 'content',
        subject: 'contentWindow',
        persistence: 'snapshot',
        schema: createRuntimeSchema<{ contentCount: number; contentRevision: number }>('runtime.subagent.content_snapshot', 1, payload => {
            if (typeof payload?.contentCount !== 'number') throw new Error('contentCount is required');
            if (typeof payload?.contentRevision !== 'number') throw new Error('contentRevision is required');
        })
    });

    events.register({
        eventType: 'runtime.chat.stream_event',
        kind: 'integration',
        context: 'chat',
        subject: 'stream',
        persistence: 'ephemeral',
        schema: createRuntimeSchema<{ sourceType: string; keyCount: number }>('runtime.chat.stream_event', 1, payload => {
            if (!payload || typeof payload.sourceType !== 'string') {
                throw new Error('sourceType is required');
            }
            if (typeof payload.keyCount !== 'number') {
                throw new Error('keyCount is required');
            }
        })
    });

    events.register({
        eventType: 'runtime.chat.mutation',
        kind: 'domain',
        context: 'mutation',
        subject: 'transcript',
        persistence: 'durable',
        schema: createRuntimeSchema<{ operation: string; messageCount?: number }>('runtime.chat.mutation', 1, payload => {
            if (!payload || typeof payload.operation !== 'string') {
                throw new Error('operation is required');
            }
        })
    });

    events.register({
        eventType: 'runtime.tool.lifecycle',
        kind: 'domain',
        context: 'tool',
        subject: 'toolInvocation',
        persistence: 'durable',
        schema: createRuntimeSchema<{ phase: string; toolName?: string }>('runtime.tool.lifecycle', 1, payload => {
            if (!payload || typeof payload.phase !== 'string') {
                throw new Error('phase is required');
            }
        })
    });

    events.register({
        eventType: 'runtime.tool.function_response',
        kind: 'domain',
        context: 'tool',
        subject: 'functionResponse',
        persistence: 'durable',
        schema: createRuntimeSchema<{ isError?: boolean; toolName?: string }>('runtime.tool.function_response', 1)
    });

    events.register({
        eventType: 'runtime.tool.function_response_unbound',
        kind: 'diagnostic',
        context: 'diagnostic',
        subject: 'functionResponse',
        persistence: 'durable',
        schema: createRuntimeSchema<{ reason: string; toolName?: string }>('runtime.tool.function_response_unbound', 1, payload => {
            if (!payload || typeof payload.reason !== 'string') {
                throw new Error('reason is required');
            }
        })
    });

    operations.register({
        operationId: 'runtime.subagent.getRunWindow',
        kind: 'query',
        context: 'monitor',
        subject: 'contentWindow',
        schema: createRuntimeSchema<{ runId: string }>('runtime.subagent.getRunWindow', 1)
    });

    operations.register({
        operationId: 'runtime.chat.observeStream',
        kind: 'command',
        context: 'chat',
        subject: 'stream',
        schema: createRuntimeSchema<{ conversationId: string; streamId: string }>('runtime.chat.observeStream', 1)
    });

    operations.register({
        operationId: 'runtime.chat.mutateTranscript',
        kind: 'command',
        context: 'mutation',
        subject: 'transcript',
        schema: createRuntimeSchema<{ conversationId: string; operation: string }>('runtime.chat.mutateTranscript', 1)
    });

    return {
        schemas,
        events,
        operations,
        ledger: new RuntimeLedger({ mode, eventRegistry: events, store, recentEventLimit })
    };
}
