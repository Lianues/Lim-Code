/**
 * LimCode MCP 模块 - 注册到 ModuleRegistry
 */

import type { ModuleDefinition } from '../../core/registry/types';
import type { McpStorageAdapter } from './types';
import { McpManager } from './McpManager';
import type {
    CreateMcpServerInput,
    UpdateMcpServerInput,
    McpToolCallRequest,
    McpResourceReadRequest,
    McpPromptGetRequest
} from './types';

/**
 * 注册 MCP 模块
 * 
 * @param storageAdapter 存储适配器
 * @returns 模块定义
 */
export function registerMcpModule(
    storageAdapter: McpStorageAdapter
): { module: ModuleDefinition; manager: McpManager } {
    const manager = new McpManager(storageAdapter);

    const module: ModuleDefinition = {
        id: 'mcp',
        name: 'MCP Manager',
        // 为什么同步模块版本：模块注册元数据长期停留在 1.0.5，不利于诊断当前运行的扩展能力。
        // 怎么改：随 1.1.29 最终发布统一内部模块版本展示。
        // 目的：让模块注册表、MCP 客户端握手和扩展版本保持一致。
        version: '1.1.29',
        description: 'Manage Model Context Protocol (MCP) server configuration and connections',

        initialize: async () => {
            await manager.initialize();
        },

        dispose: async () => {
            await manager.dispose();
        },

        apis: [
            // ==================== 服务器配置管理 ====================

            {
                name: 'createServer',
                description: '创建新的 MCP 服务器配置',
                parameters: [
                    {
                        name: 'input',
                        type: 'object',
                        required: true,
                        description: 'MCP 服务器配置输入'
                    }
                ],
                returnType: 'string',
                handler: async (params) => {
                    return await manager.createServer(params.input as CreateMcpServerInput);
                }
            },

            {
                name: 'getServer',
                description: '获取指定的 MCP 服务器配置',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
                    }
                ],
                returnType: 'McpServerConfig | null',
                handler: async (params) => {
                    return await manager.getServer(params.serverId as string);
                }
            },

            {
                name: 'getServerInfo',
                description: '获取 MCP 服务器运行时信息',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
                    }
                ],
                returnType: 'McpServerInfo | null',
                handler: async (params) => {
                    return manager.getServerInfo(params.serverId as string);
                }
            },

            {
                name: 'updateServer',
                description: '更新 MCP 服务器配置',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
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
                    return await manager.updateServer(
                        params.serverId as string,
                        params.updates as UpdateMcpServerInput
                    );
                }
            },

            {
                name: 'deleteServer',
                description: '删除 MCP 服务器配置',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    return await manager.deleteServer(params.serverId as string);
                }
            },

            {
                name: 'listServers',
                description: '列出所有 MCP 服务器（包含运行时信息）',
                parameters: [],
                returnType: 'McpServerInfo[]',
                handler: async () => {
                    return manager.listServers();
                }
            },

            {
                name: 'listServerConfigs',
                description: '列出所有 MCP 服务器配置',
                parameters: [],
                returnType: 'McpServerConfig[]',
                handler: async () => {
                    return manager.listServerConfigs();
                }
            },

            {
                name: 'setServerEnabled',
                description: '设置 MCP 服务器启用状态',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
                    },
                    {
                        name: 'enabled',
                        type: 'boolean',
                        required: true,
                        description: '是否启用'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    return await manager.setServerEnabled(
                        params.serverId as string,
                        params.enabled as boolean
                    );
                }
            },

            // ==================== 连接管理 ====================

            {
                name: 'connect',
                description: '连接到 MCP 服务器',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    return await manager.connect(params.serverId as string);
                }
            },

            {
                name: 'disconnect',
                description: '断开 MCP 服务器连接',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    return await manager.disconnect(params.serverId as string);
                }
            },

            {
                name: 'reconnect',
                description: '重新连接 MCP 服务器',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    return await manager.reconnect(params.serverId as string);
                }
            },

            {
                name: 'getServerStatus',
                description: '获取 MCP 服务器连接状态',
                parameters: [
                    {
                        name: 'serverId',
                        type: 'string',
                        required: true,
                        description: '服务器 ID'
                    }
                ],
                returnType: 'McpServerStatus | null',
                handler: async (params) => {
                    return manager.getServerStatus(params.serverId as string);
                }
            },

            // ==================== MCP 操作 ====================

            {
                name: 'callTool',
                description: '调用 MCP 工具',
                parameters: [
                    {
                        name: 'request',
                        type: 'object',
                        required: true,
                        description: '工具调用请求'
                    }
                ],
                returnType: 'McpToolCallResult',
                handler: async (params) => {
                    return await manager.callTool(params.request as McpToolCallRequest);
                }
            },

            {
                name: 'readResource',
                description: '读取 MCP 资源',
                parameters: [
                    {
                        name: 'request',
                        type: 'object',
                        required: true,
                        description: '资源读取请求'
                    }
                ],
                returnType: 'McpResourceContent | null',
                handler: async (params) => {
                    return await manager.readResource(params.request as McpResourceReadRequest);
                }
            },

            {
                name: 'getPrompt',
                description: '获取 MCP 提示模板',
                parameters: [
                    {
                        name: 'request',
                        type: 'object',
                        required: true,
                        description: '提示获取请求'
                    }
                ],
                returnType: 'McpPromptMessage[]',
                handler: async (params) => {
                    return await manager.getPrompt(params.request as McpPromptGetRequest);
                }
            },

            // ==================== 聚合查询 ====================

            {
                name: 'getAllTools',
                description: '获取所有已连接服务器的工具列表',
                parameters: [],
                returnType: 'Array<{ serverId: string; serverName: string; tools: McpToolDefinition[] }>',
                handler: async () => {
                    return manager.getAllTools();
                }
            },

            {
                name: 'getAllResources',
                description: '获取所有已连接服务器的资源列表',
                parameters: [],
                returnType: 'Array<{ serverId: string; serverName: string; resources: McpResourceDefinition[] }>',
                handler: async () => {
                    return manager.getAllResources();
                }
            },

            {
                name: 'getAllPrompts',
                description: '获取所有已连接服务器的提示模板列表',
                parameters: [],
                returnType: 'Array<{ serverId: string; serverName: string; prompts: McpPromptDefinition[] }>',
                handler: async () => {
                    return manager.getAllPrompts();
                }
            }
        ]
    };

    return { module, manager };
}