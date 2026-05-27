/**
 * 对话管理模块 - 注册文件
 *
 * 将 ConversationManager 的功能注册为模块 API
 */

import { ConversationManager } from './ConversationManager';
import type { ModuleDefinition } from '../../core/registry';
import type { IStorageAdapter } from './storage';

/**
 * 创建对话管理模块定义
 * @param storage 存储适配器
 */
export function createConversationModule(storage: IStorageAdapter): ModuleDefinition {
    // 创建对话管理器实例
    const manager = new ConversationManager(storage);

    return {
        id: 'conversation',
        name: 'Conversation Manager',
        // 为什么同步模块版本：对话历史、工具响应和前端投影都依赖该模块，旧版本号会误导问题定位。
        // 怎么改：随 1.1.29 最终发布统一内部模块版本展示。
        // 目的：让历史加载和工具结果相关诊断能对应到当前修复批次。
        version: '1.1.29',
        description: 'Provides conversation history management including message operations, snapshots, and statistics',

        apis: [
            // ========== 消息操作 ==========
            {
                name: 'addMessage',
                description: '添加消息到对话历史',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'role',
                        type: 'string',
                        required: true,
                        description: '消息角色 (user/model)'
                    },
                    {
                        name: 'parts',
                        type: 'array',
                        required: true,
                        description: '消息内容部分'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    const { conversationId, role, parts } = params;
                    await manager.addMessage(
                        conversationId as string,
                        role as 'user' | 'model',
                        parts as any[]
                    );
                }
            },

            {
                name: 'getMessages',
                description: '获取对话历史中的所有消息',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    }
                ],
                returnType: 'Content[]',
                handler: async (params) => {
                    return await manager.getMessages(params.conversationId as string);
                }
            },

            {
                name: 'getHistoryForAPI',
                description: '获取适合 API 调用的对话历史（可选择是否包含思考内容，不含 token 字段）',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'includeThoughts',
                        type: 'boolean',
                        required: false,
                        description: '是否包含思考内容（默认 false）'
                    }
                ],
                returnType: 'Content[]',
                handler: async (params) => {
                    return await manager.getHistoryForAPI(
                        params.conversationId as string,
                        params.includeThoughts as boolean | undefined
                    );
                }
            },

            {
                name: 'updateMessage',
                description: '更新指定消息',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'messageIndex',
                        type: 'number',
                        required: true,
                        description: '消息索引'
                    },
                    {
                        name: 'updates',
                        type: 'object',
                        required: true,
                        description: '要更新的字段'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.updateMessage(
                        params.conversationId as string,
                        params.messageIndex as number,
                        params.updates as any
                    );
                }
            },

            {
                name: 'deleteMessage',
                description: '删除指定消息',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'messageIndex',
                        type: 'number',
                        required: true,
                        description: '消息索引'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.deleteMessage(
                        params.conversationId as string,
                        params.messageIndex as number
                    );
                }
            },

            {
                name: 'insertMessage',
                description: '在指定位置插入消息',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'position',
                        type: 'number',
                        required: true,
                        description: '插入位置'
                    },
                    {
                        name: 'role',
                        type: 'string',
                        required: true,
                        description: '消息角色'
                    },
                    {
                        name: 'parts',
                        type: 'array',
                        required: true,
                        description: '消息内容部分'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.insertMessage(
                        params.conversationId as string,
                        params.position as number,
                        params.role as 'user' | 'model',
                        params.parts as any[]
                    );
                }
            },

            // ========== 批量操作 ==========
            {
                name: 'deleteMessagesInRange',
                description: '删除指定范围的消息',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'startIndex',
                        type: 'number',
                        required: true,
                        description: '起始索引（包含）'
                    },
                    {
                        name: 'endIndex',
                        type: 'number',
                        required: true,
                        description: '结束索引（包含）'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.deleteMessagesInRange(
                        params.conversationId as string,
                        params.startIndex as number,
                        params.endIndex as number
                    );
                }
            },

            {
                name: 'clearHistory',
                description: '清空对话历史',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.clearHistory(params.conversationId as string);
                }
            },

            // ========== 查询和过滤 ==========
            {
                name: 'findMessages',
                description: '查找符合条件的消息',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'filter',
                        type: 'object',
                        required: true,
                        description: '过滤条件'
                    }
                ],
                returnType: 'MessagePosition[]',
                handler: async (params) => {
                    return await manager.findMessages(
                        params.conversationId as string,
                        params.filter as any
                    );
                }
            },

            {
                name: 'getMessagesByRole',
                description: '获取指定角色的所有消息',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'role',
                        type: 'string',
                        required: true,
                        description: '消息角色'
                    }
                ],
                returnType: 'Content[]',
                handler: async (params) => {
                    return await manager.getMessagesByRole(
                        params.conversationId as string,
                        params.role as 'user' | 'model'
                    );
                }
            },

            // ========== 快照管理 ==========
            {
                name: 'createSnapshot',
                description: '创建当前对话的快照',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'name',
                        type: 'string',
                        required: false,
                        description: '快照名称'
                    },
                    {
                        name: 'description',
                        type: 'string',
                        required: false,
                        description: '快照描述'
                    }
                ],
                returnType: 'HistorySnapshot',
                handler: async (params) => {
                    return await manager.createSnapshot(
                        params.conversationId as string,
                        params.name as string | undefined,
                        params.description as string | undefined
                    );
                }
            },

            {
                name: 'restoreSnapshot',
                description: '恢复快照',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'snapshotId',
                        type: 'string',
                        required: true,
                        description: '快照 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.restoreSnapshot(
                        params.conversationId as string,
                        params.snapshotId as string
                    );
                }
            },

            {
                name: 'deleteSnapshot',
                description: '删除快照',
                parameters: [
                    {
                        name: 'snapshotId',
                        type: 'string',
                        required: true,
                        description: '快照 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.deleteSnapshot(params.snapshotId as string);
                }
            },

            // ========== 统计信息 ==========
            {
                name: 'getStats',
                description: '获取对话统计信息',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    }
                ],
                returnType: 'ConversationStats',
                handler: async (params) => {
                    return await manager.getStats(params.conversationId as string);
                }
            },

            // ========== 元数据管理 ==========
            {
                name: 'setCustomMetadata',
                description: '设置对话自定义元数据',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'key',
                        type: 'string',
                        required: true,
                        description: '元数据键'
                    },
                    {
                        name: 'value',
                        type: 'any',
                        required: true,
                        description: '元数据值'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.setCustomMetadata(
                        params.conversationId as string,
                        params.key as string,
                        params.value
                    );
                }
            },

            {
                name: 'getCustomMetadata',
                description: '获取对话自定义元数据',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'key',
                        type: 'string',
                        required: true,
                        description: '元数据键'
                    }
                ],
                returnType: 'any',
                handler: async (params) => {
                    return await manager.getCustomMetadata(
                        params.conversationId as string,
                        params.key as string
                    );
                }
            },

            {
                name: 'getConversationMetadata',
                description: '获取完整的对话元数据',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    }
                ],
                returnType: 'ConversationMetadata | null',
                handler: async (params) => {
                    return await manager.getMetadata(params.conversationId as string);
                }
            },

            // ========== 对话管理 ==========
            {
                name: 'createConversation',
                description: '创建新对话',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'title',
                        type: 'string',
                        required: false,
                        description: '对话标题'
                    },
                    {
                        name: 'workspaceUri',
                        type: 'string',
                        required: false,
                        description: '工作区 URI'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.createConversation(
                        params.conversationId as string,
                        params.title as string | undefined,
                        params.workspaceUri as string | undefined
                    );
                }
            },

            {
                name: 'deleteConversation',
                description: '删除对话',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.deleteConversation(params.conversationId as string);
                }
            },

            {
                name: 'listConversations',
                description: '列出所有对话',
                parameters: [],
                returnType: 'string[]',
                handler: async () => {
                    return await manager.listConversations();
                }
            },

            {
                name: 'setTitle',
                description: '设置对话标题',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'title',
                        type: 'string',
                        required: true,
                        description: '对话标题'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.setTitle(
                        params.conversationId as string,
                        params.title as string
                    );
                }
            },

            {
                name: 'setWorkspaceUri',
                description: '设置对话的工作区 URI',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'workspaceUri',
                        type: 'string',
                        required: true,
                        description: '工作区 URI'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.setWorkspaceUri(
                        params.conversationId as string,
                        params.workspaceUri as string
                    );
                }
            },

            // ========== 工具调用管理 ==========
            {
                name: 'rejectToolCalls',
                description: '标记指定消息中的工具调用为拒绝状态',
                parameters: [
                    {
                        name: 'conversationId',
                        type: 'string',
                        required: true,
                        description: '对话 ID'
                    },
                    {
                        name: 'messageIndex',
                        type: 'number',
                        required: true,
                        description: '消息索引'
                    },
                    {
                        name: 'toolCallIds',
                        type: 'array',
                        required: false,
                        description: '要标记为拒绝的工具调用 ID 列表（如果为空，则标记所有未执行的工具）'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    await manager.rejectToolCalls(
                        params.conversationId as string,
                        params.messageIndex as number,
                        params.toolCallIds as string[] | undefined
                    );
                }
            }
        ]
    };
}