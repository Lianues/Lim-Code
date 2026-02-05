/**
 * TODO LIST tool
 *
 * Maintains a per-conversation TODO list that the model can update.
 *
 * Storage: ConversationMetadata.custom['todoList'] (via ToolContext.conversationStore)
 */

import type { Tool, ToolDeclaration, ToolResult, ToolContext } from '../types';

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
    id: string;
    content: string;
    status: TodoStatus;
}

export interface TodoWriteArgs {
    todos: TodoItem[];
    merge: boolean;
}

const TODO_METADATA_KEY = 'todoList';

function isTodoStatus(value: unknown): value is TodoStatus {
    return value === 'pending' ||
        value === 'in_progress' ||
        value === 'completed' ||
        value === 'cancelled';
}

function validateTodos(value: unknown): { ok: true; todos: TodoItem[] } | { ok: false; error: string } {
    if (!Array.isArray(value)) {
        return { ok: false, error: 'todos must be an array' };
    }

    const todos: TodoItem[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') {
            return { ok: false, error: 'each todo must be an object' };
        }
        const id = (item as any).id;
        const content = (item as any).content;
        const status = (item as any).status;

        if (typeof id !== 'string' || !id.trim()) {
            return { ok: false, error: 'todo.id must be a non-empty string' };
        }
        if (typeof content !== 'string') {
            return { ok: false, error: 'todo.content must be a string' };
        }
        if (!isTodoStatus(status)) {
            return { ok: false, error: 'todo.status must be one of: pending, in_progress, completed, cancelled' };
        }

        todos.push({ id, content, status });
    }

    return { ok: true, todos };
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
    if (!Array.isArray(raw)) {
        return [];
    }

    // Best-effort normalize
    const normalized: TodoItem[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const id = (item as any).id;
        const content = (item as any).content;
        const status = (item as any).status;
        if (typeof id === 'string' && typeof content === 'string' && isTodoStatus(status)) {
            normalized.push({ id, content, status });
        }
    }
    return normalized;
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

function mergeTodos(existing: TodoItem[], incoming: TodoItem[]): TodoItem[] {
    const result: TodoItem[] = existing.map(t => ({ ...t }));
    const indexById = new Map<string, number>();
    for (let i = 0; i < result.length; i++) {
        indexById.set(result[i].id, i);
    }

    for (const todo of incoming) {
        const idx = indexById.get(todo.id);
        if (idx === undefined) {
            indexById.set(todo.id, result.length);
            result.push({ ...todo });
            continue;
        }
        result[idx] = {
            ...result[idx],
            content: todo.content,
            status: todo.status
        };
    }

    return result;
}

function countByStatus(todos: TodoItem[]): Record<TodoStatus, number> {
    const c: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
    for (const t of todos) c[t.status]++;
    return c;
}

export function createTodoWriteToolDeclaration(): ToolDeclaration {
    return {
        name: 'todo_write',
        description: 'Create (replace) or merge-update a per-conversation TODO list. IMPORTANT: Use this tool at the start to initialize the list. For incremental updates (status/content), prefer todo_update.',
        category: 'todo',
        parameters: {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    description: 'Array of todo items',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'Unique todo id' },
                            content: { type: 'string', description: 'Todo content' },
                            status: {
                                type: 'string',
                                description: 'Todo status',
                                enum: ['pending', 'in_progress', 'completed', 'cancelled']
                            }
                        },
                        required: ['id', 'content', 'status']
                    }
                },
                merge: {
                    type: 'boolean',
                    description: 'true = merge/update by id; false = replace the entire list'
                }
            },
            required: ['todos', 'merge']
        }
    };
}

async function todoWriteHandler(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
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

    const merge = (args as any).merge;
    if (typeof merge !== 'boolean') {
        return { success: false, error: 'merge must be a boolean' };
    }

    const validated = validateTodos((args as any).todos);
    if (validated.ok === false) {
        return { success: false, error: validated.error };
    }

    try {
        if (merge) {
            const existing = await loadExistingTodos(context);
            const merged = mergeTodos(existing, validated.todos);
            await saveTodos(context, merged);
            return {
                success: true,
                data: {
                    total: merged.length,
                    counts: countByStatus(merged)
                }
            };
        }

        // replace
        await saveTodos(context, validated.todos);
        return {
            success: true,
            data: {
                total: validated.todos.length,
                counts: countByStatus(validated.todos)
            }
        };
    } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
    }
}

export function createTodoWriteTool(): Tool {
    return {
        declaration: createTodoWriteToolDeclaration(),
        handler: todoWriteHandler
    };
}

export function registerTodoWrite(): Tool {
    return createTodoWriteTool();
}
