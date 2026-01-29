import { describe, it, expect, beforeEach } from 'vitest';
import type { Tool, ToolContext } from '../backend/tools/types';
import { createTodoWriteTool } from '../backend/tools/todo/todo_write';

/**
 * 简单的 in-memory conversationStore 实现
 */
class InMemoryConversationStore {
    private metadata = new Map<string, Map<string, unknown>>();

    async getCustomMetadata(conversationId: string, key: string): Promise<unknown> {
        const conversationMeta = this.metadata.get(conversationId);
        if (!conversationMeta) {
            return undefined;
        }
        return conversationMeta.get(key);
    }

    async setCustomMetadata(conversationId: string, key: string, value: unknown): Promise<void> {
        let conversationMeta = this.metadata.get(conversationId);
        if (!conversationMeta) {
            conversationMeta = new Map();
            this.metadata.set(conversationId, conversationMeta);
        }
        conversationMeta.set(key, value);
    }

    clear(): void {
        this.metadata.clear();
    }
}

describe('todo_write tool', () => {
    let conversationStore: InMemoryConversationStore;
    const testConversationId = 'test-conv-123';

    beforeEach(() => {
        conversationStore = new InMemoryConversationStore();
    });

    describe('Module loading', () => {
        it('should be able to load the module (TDD: should fail until implemented)', async () => {
            // If this file can be imported, the module is loadable.
            expect(createTodoWriteTool).toBeTypeOf('function');
        });
    });

    describe('Tool declaration', () => {
        it('should have correct tool name', async () => {
            const tool: Tool = createTodoWriteTool();
            expect(tool.declaration).toBeTruthy();
            expect(tool.declaration.name).toBe('todo_write');
        });
    });

    describe('Handler behavior', () => {
        function createTool(): Tool {
            return createTodoWriteTool();
        }

        describe('merge=false', () => {
            it('should replace todoList when merge=false', async () => {
                const tool = createTool();
                // 先设置初始数据
                await conversationStore.setCustomMetadata(testConversationId, 'todoList', [
                    { id: 'old-1', content: 'Old task 1', status: 'pending' },
                    { id: 'old-2', content: 'Old task 2', status: 'completed' }
                ]);

                const context: ToolContext = {
                    conversationStore,
                    conversationId: testConversationId
                } as ToolContext;

                const newTodos = [
                    { id: 'new-1', content: 'New task 1', status: 'pending' },
                    { id: 'new-2', content: 'New task 2', status: 'in_progress' }
                ];

                const result = await tool.handler(
                    {
                        merge: false,
                        todos: newTodos
                    },
                    context
                );

                expect(result.success).toBe(true);

                // 验证旧数据被替换
                const storedTodos = await conversationStore.getCustomMetadata(testConversationId, 'todoList');
                expect(storedTodos).toEqual(newTodos);
            });
        });

        describe('merge=true', () => {
            beforeEach(async () => {
                // 设置初始数据
                await conversationStore.setCustomMetadata(testConversationId, 'todoList', [
                    { id: 'task-1', content: 'Task 1', status: 'pending' },
                    { id: 'task-2', content: 'Task 2', status: 'completed' },
                    { id: 'task-3', content: 'Task 3', status: 'pending' }
                ]);
            });

            it('should update existing todos with same id when merge=true', async () => {
                const tool = createTool();
                const context: ToolContext = {
                    conversationStore,
                    conversationId: testConversationId
                } as ToolContext;

                const updatedTodos = [
                    { id: 'task-1', content: 'Updated Task 1', status: 'in_progress' },
                    { id: 'task-2', content: 'Updated Task 2', status: 'completed' }
                ];

                const result = await tool.handler(
                    {
                        merge: true,
                        todos: updatedTodos
                    },
                    context
                );

                expect(result.success).toBe(true);

                // 验证同 id 的项被更新，未提到的旧项保留
                const storedTodos = await conversationStore.getCustomMetadata(testConversationId, 'todoList') as Array<{ id: string; content: string; status: string }>;
                expect(storedTodos).toBeTruthy();
                expect(Array.isArray(storedTodos)).toBe(true);

                // task-1 应该被更新
                const task1 = storedTodos.find(t => t.id === 'task-1');
                expect(task1).toBeTruthy();
                expect(task1?.content).toBe('Updated Task 1');
                expect(task1?.status).toBe('in_progress');

                // task-2 应该被更新
                const task2 = storedTodos.find(t => t.id === 'task-2');
                expect(task2).toBeTruthy();
                expect(task2?.content).toBe('Updated Task 2');
                expect(task2?.status).toBe('completed');

                // task-3 应该保留（未在更新列表中）
                const task3 = storedTodos.find(t => t.id === 'task-3');
                expect(task3).toBeTruthy();
                expect(task3?.content).toBe('Task 3');
                expect(task3?.status).toBe('pending');
            });

            it('should append new todos when merge=true', async () => {
                const tool = createTool();
                const context: ToolContext = {
                    conversationStore,
                    conversationId: testConversationId
                } as ToolContext;

                const newTodos = [
                    { id: 'task-4', content: 'New Task 4', status: 'pending' },
                    { id: 'task-5', content: 'New Task 5', status: 'in_progress' }
                ];

                const result = await tool.handler(
                    {
                        merge: true,
                        todos: newTodos
                    },
                    context
                );

                expect(result.success).toBe(true);

                // 验证新项被追加，旧项保留
                const storedTodos = await conversationStore.getCustomMetadata(testConversationId, 'todoList') as Array<{ id: string; content: string; status: string }>;
                expect(storedTodos).toBeTruthy();
                expect(Array.isArray(storedTodos)).toBe(true);
                expect(storedTodos.length).toBe(5); // 3 个旧项 + 2 个新项

                // 验证旧项还在
                expect(storedTodos.find(t => t.id === 'task-1')).toBeTruthy();
                expect(storedTodos.find(t => t.id === 'task-2')).toBeTruthy();
                expect(storedTodos.find(t => t.id === 'task-3')).toBeTruthy();

                // 验证新项被添加
                const task4 = storedTodos.find(t => t.id === 'task-4');
                expect(task4).toBeTruthy();
                expect(task4?.content).toBe('New Task 4');
                expect(task4?.status).toBe('pending');

                const task5 = storedTodos.find(t => t.id === 'task-5');
                expect(task5).toBeTruthy();
                expect(task5?.content).toBe('New Task 5');
                expect(task5?.status).toBe('in_progress');
            });

            it('should update existing and append new todos when merge=true', async () => {
                const tool = createTool();
                const context: ToolContext = {
                    conversationStore,
                    conversationId: testConversationId
                } as ToolContext;

                const mixedTodos = [
                    { id: 'task-1', content: 'Updated Task 1', status: 'completed' }, // 更新现有
                    { id: 'task-4', content: 'New Task 4', status: 'pending' } // 新增
                ];

                const result = await tool.handler(
                    {
                        merge: true,
                        todos: mixedTodos
                    },
                    context
                );

                expect(result.success).toBe(true);

                // 验证更新和新增都生效，未提到的旧项保留
                const storedTodos = await conversationStore.getCustomMetadata(testConversationId, 'todoList') as Array<{ id: string; content: string; status: string }>;
                expect(storedTodos).toBeTruthy();
                expect(Array.isArray(storedTodos)).toBe(true);
                expect(storedTodos.length).toBe(4); // 3 个旧项（1个被更新）+ 1 个新项

                // task-1 应该被更新
                const task1 = storedTodos.find(t => t.id === 'task-1');
                expect(task1).toBeTruthy();
                expect(task1?.content).toBe('Updated Task 1');
                expect(task1?.status).toBe('completed');

                // task-2 和 task-3 应该保留
                expect(storedTodos.find(t => t.id === 'task-2')).toBeTruthy();
                expect(storedTodos.find(t => t.id === 'task-3')).toBeTruthy();

                // task-4 应该被添加
                const task4 = storedTodos.find(t => t.id === 'task-4');
                expect(task4).toBeTruthy();
                expect(task4?.content).toBe('New Task 4');
                expect(task4?.status).toBe('pending');
            });
        });

        describe('Error handling', () => {
            it('should return success:false when conversationId is missing', async () => {
                const tool = createTool();
                const context: ToolContext = {
                    conversationStore
                    // conversationId 缺失
                } as ToolContext;

                const result = await tool.handler(
                    {
                        merge: false,
                        todos: [{ id: 'task-1', content: 'Task 1', status: 'pending' }]
                    },
                    context
                );

                expect(result.success).toBe(false);
                expect(result.error).toBeTruthy();
            });

            it('should return success:false when conversationStore is missing', async () => {
                const tool = createTool();
                const context: ToolContext = {
                    conversationId: testConversationId
                    // conversationStore 缺失
                } as ToolContext;

                const result = await tool.handler(
                    {
                        merge: false,
                        todos: [{ id: 'task-1', content: 'Task 1', status: 'pending' }]
                    },
                    context
                );

                expect(result.success).toBe(false);
                expect(result.error).toBeTruthy();
            });

            it('should return success:false when both conversationId and conversationStore are missing', async () => {
                const tool = createTool();
                const context: ToolContext = {} as ToolContext;

                const result = await tool.handler(
                    {
                        merge: false,
                        todos: [{ id: 'task-1', content: 'Task 1', status: 'pending' }]
                    },
                    context
                );

                expect(result.success).toBe(false);
                expect(result.error).toBeTruthy();
            });
        });
    });
});
