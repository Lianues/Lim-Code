/**
 * todo_update 工具
 *
 * 对当前会话的 TODO 列表（ConversationMetadata.custom['todoList']）进行增量更新：
 * - add: 新增或 upsert（若 id 已存在则更新）
 * - set_status: 更新状态
 * - set_content: 更新描述
 * - cancel: 将状态设为 cancelled
 * - remove: 从列表中移除
 *
 * 注意：为节省 token，工具响应只返回摘要统计，不回传完整列表。
 */

import type { Tool, ToolDeclaration, ToolResult, ToolContext } from '../types';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
    id: string;
    content: string;
    status: TodoStatus;
}

export type TodoUpdateOp =
    | { op: 'add'; id: string; content: string; status?: TodoStatus }
    | { op: 'set_status'; id: string; status: TodoStatus }
    | { op: 'set_content'; id: string; content: string }
    | { op: 'cancel'; id: string }
    | { op: 'remove'; id: string };

export interface TodoUpdateArgs {
    ops: TodoUpdateOp[];
}

const TODO_METADATA_KEY = 'todoList';

function isTodoStatus(value: unknown): value is TodoStatus {
    return value === 'pending' ||
        value === 'in_progress' ||
        value === 'completed' ||
        value === 'cancelled';
}

function normalizeTodos(raw: unknown): TodoItem[] {
    if (!Array.isArray(raw)) return [];
    const out: TodoItem[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const id = (item as any).id;
        const content = (item as any).content;
        const status = (item as any).status;
        if (typeof id === 'string' && id.trim() && typeof content === 'string' && isTodoStatus(status)) {
            out.push({ id: id.trim(), content, status });
        }
    }
    return out;
}

async function loadExistingTodos(context: ToolContext): Promise<TodoItem[]> {
    const store = (context as any).conversationStore as
        | { getCustomMetadata: (conversationId: string, key: string) => Promise<unknown> }
        | undefined;
    const conversationId = (context as any).conversationId as string | undefined;

    if (!store || !conversationId) {
        return [];
    }

    const raw = await store.getCustomMetadata(conversationId, TODO_METADATA_KEY);
    return normalizeTodos(raw);
}

async function saveTodos(context: ToolContext, todos: TodoItem[]): Promise<void> {
    const store = (context as any).conversationStore as
        | { setCustomMetadata: (conversationId: string, key: string, value: unknown) => Promise<void> }
        | undefined;
    const conversationId = (context as any).conversationId as string | undefined;

    if (!store || !conversationId) {
        throw new Error('conversationStore and conversationId are required');
    }

    await store.setCustomMetadata(conversationId, TODO_METADATA_KEY, todos);
}

function countByStatus(todos: TodoItem[]): Record<TodoStatus, number> {
    const c: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
    for (const t of todos) c[t.status]++;
    return c;
}

function applyOps(existing: TodoItem[], rawOps: unknown): {
    todos: TodoItem[];
    stats: {
        appliedOps: number;
        added: number;
        updated: number;
        cancelled: number;
        removed: number;
        invalidOps: number;
        notFoundIds: string[];
    };
} {
    const notFoundIds: string[] = [];
    let invalidOps = 0;
    let added = 0;
    let updated = 0;
    let cancelled = 0;
    let removed = 0;

    const result: Array<TodoItem | null> = existing.map(t => ({ ...t }));
    const indexById = new Map<string, number>();
    for (let i = 0; i < result.length; i++) {
        const t = result[i];
        if (t) indexById.set(t.id, i);
    }

    const ops = Array.isArray(rawOps) ? rawOps : [];
    for (const opAny of ops) {
        if (!opAny || typeof opAny !== 'object') {
            invalidOps++;
            continue;
        }

        const op = (opAny as any).op;
        const id = (opAny as any).id;

        if (typeof op !== 'string') {
            invalidOps++;
            continue;
        }

        if (op !== 'add' && (typeof id !== 'string' || !id.trim())) {
            invalidOps++;
            continue;
        }

        const normalizedId = typeof id === 'string' ? id.trim() : '';

        if (op === 'add') {
            const addId = (typeof id === 'string' && id.trim()) ? id.trim() : '';
            const content = (opAny as any).content;
            const status = (opAny as any).status;
            if (!addId || typeof content !== 'string') {
                invalidOps++;
                continue;
            }
            const nextStatus: TodoStatus = isTodoStatus(status) ? status : 'pending';

            const idx = indexById.get(addId);
            if (idx === undefined) {
                indexById.set(addId, result.length);
                result.push({ id: addId, content, status: nextStatus });
                added++;
            } else {
                const current = result[idx];
                if (!current) {
                    // theoretically unreachable, but keep safe
                    invalidOps++;
                    continue;
                }
                current.content = content;
                current.status = nextStatus;
                updated++;
            }
            continue;
        }

        const idx = indexById.get(normalizedId);
        if (idx === undefined) {
            notFoundIds.push(normalizedId);
            continue;
        }

        const current = result[idx];
        if (!current) {
            notFoundIds.push(normalizedId);
            continue;
        }

        if (op === 'set_status') {
            const status = (opAny as any).status;
            if (!isTodoStatus(status)) {
                invalidOps++;
                continue;
            }
            if (current.status !== status) {
                current.status = status;
                updated++;
            }
            continue;
        }

        if (op === 'set_content') {
            const content = (opAny as any).content;
            if (typeof content !== 'string') {
                invalidOps++;
                continue;
            }
            if (current.content !== content) {
                current.content = content;
                updated++;
            }
            continue;
        }

        if (op === 'cancel') {
            if (current.status !== 'cancelled') {
                current.status = 'cancelled';
                cancelled++;
            }
            continue;
        }

        if (op === 'remove') {
            result[idx] = null;
            indexById.delete(normalizedId);
            removed++;
            continue;
        }

        invalidOps++;
    }

    const finalTodos = result.filter((t): t is TodoItem => !!t);
    return {
        todos: finalTodos,
        stats: {
            appliedOps: Array.isArray(rawOps) ? rawOps.length : 0,
            added,
            updated,
            cancelled,
            removed,
            invalidOps,
            notFoundIds
        }
    };
}

export function createTodoUpdateToolDeclaration(): ToolDeclaration {
    return {
        name: 'todo_update',
        description:
            'Incrementally update the per-conversation TODO list stored in ConversationMetadata.custom["todoList"]. Use this to update status/content without rewriting the entire list.',
        category: 'todo',
        parameters: {
            type: 'object',
            properties: {
                ops: {
                    type: 'array',
                    description: 'Operations to apply to the current TODO list',
                    items: {
                        type: 'object',
                        properties: {
                            op: {
                                type: 'string',
                                description: 'Operation type',
                                enum: ['add', 'set_status', 'set_content', 'cancel', 'remove']
                            },
                            id: { type: 'string', description: 'Target todo id' },
                            content: { type: 'string', description: 'Todo content (for add/set_content)' },
                            status: {
                                type: 'string',
                                description: 'Todo status (for add/set_status)',
                                enum: ['pending', 'in_progress', 'completed', 'cancelled']
                            }
                        },
                        required: ['op']
                    }
                }
            },
            required: ['ops']
        }
    };
}

async function todoUpdateHandler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    if (!context) {
        return { success: false, error: 'tool context is required' };
    }

    const conversationId = (context as any).conversationId as string | undefined;
    const conversationStore = (context as any).conversationStore as unknown | undefined;
    if (!conversationId) {
        return { success: false, error: 'conversationId is required in tool context' };
    }
    if (!conversationStore) {
        return { success: false, error: 'conversationStore is required in tool context' };
    }

    const rawOps = (args as any).ops;
    if (!Array.isArray(rawOps)) {
        return { success: false, error: 'ops must be an array' };
    }

    try {
        const existing = await loadExistingTodos(context);
        const { todos, stats } = applyOps(existing, rawOps);
        await saveTodos(context, todos);

        const counts = countByStatus(todos);

        return {
            success: true,
            data: {
                ...stats,
                total: todos.length,
                counts
            }
        };
    } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
    }
}

export function createTodoUpdateTool(): Tool {
    return {
        declaration: createTodoUpdateToolDeclaration(),
        handler: todoUpdateHandler
    };
}

export function registerTodoUpdate(): Tool {
    return createTodoUpdateTool();
}

