/**
 * LimCode - 配置管理模块注册
 * 
 * 注册配置管理模块到 ModuleRegistry
 */

import type { ModuleDefinition } from '../../core/registry/types';
import type { ConfigStorageAdapter } from './storage';
import { ConfigManager } from './ConfigManager';
import type {
    ChannelConfig,
    CreateConfigInput,
    UpdateConfigInput,
    ConfigFilter,
    ConfigSortOptions,
    ExportOptions,
    ImportOptions
} from './types';

/**
 * 注册配置管理模块
 * 
 * @param storageAdapter 存储适配器
 * @returns 模块定义
 */
export function registerConfigModule(
    storageAdapter: ConfigStorageAdapter
): ModuleDefinition {
    const manager = new ConfigManager(storageAdapter);
    
    return {
        id: 'config',
        name: 'Configuration Manager',
        // 为什么同步模块版本：配置模块注册元数据仍显示旧版本，会干扰运行时诊断。
        // 怎么改：随 1.2.3 apply_diff 缩进容错发布统一内部模块版本展示。
        // 目的：让模块清单中的版本号反映当前扩展发布批次。
        version: '1.2.3',
        description: 'Manage LLM channel configurations, supporting Gemini, OpenAI, Anthropic and other formats',
        
        apis: [
            // ========== CRUD 操作 ==========
            
            {
                name: 'createConfig',
                description: '创建新的渠道配置',
                parameters: [
                    {
                        name: 'input',
                        type: 'object',
                        required: true,
                        description: '配置输入（不含 id、createdAt、updatedAt）'
                    }
                ],
                returnType: 'string',
                handler: async (params) => {
                    return await manager.createConfig(params.input as CreateConfigInput);
                }
            },
            
            {
                name: 'getConfig',
                description: '获取指定配置',
                parameters: [
                    {
                        name: 'configId',
                        type: 'string',
                        required: true,
                        description: '配置 ID'
                    }
                ],
                returnType: 'ChannelConfig | null',
                handler: async (params) => {
                    return await manager.getConfig(params.configId as string);
                }
            },
            
            {
                name: 'updateConfig',
                description: '更新配置',
                parameters: [
                    {
                        name: 'configId',
                        type: 'string',
                        required: true,
                        description: '配置 ID'
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
                    return await manager.updateConfig(
                        params.configId as string,
                        params.updates as UpdateConfigInput
                    );
                }
            },
            
            {
                name: 'deleteConfig',
                description: '删除配置',
                parameters: [
                    {
                        name: 'configId',
                        type: 'string',
                        required: true,
                        description: '配置 ID'
                    }
                ],
                returnType: 'void',
                handler: async (params) => {
                    return await manager.deleteConfig(params.configId as string);
                }
            },
            
            {
                name: 'listConfigs',
                description: '列出所有配置',
                parameters: [
                    {
                        name: 'filter',
                        type: 'object',
                        required: false,
                        description: '过滤条件'
                    },
                    {
                        name: 'sort',
                        type: 'object',
                        required: false,
                        description: '排序选项'
                    }
                ],
                returnType: 'ChannelConfig[]',
                handler: async (params) => {
                    return await manager.listConfigs(
                        params.filter as ConfigFilter | undefined,
                        params.sort as ConfigSortOptions | undefined
                    );
                }
            },
            
            {
                name: 'listConfigsByType',
                description: '按类型列出配置',
                parameters: [
                    {
                        name: 'type',
                        type: 'string',
                        required: true,
                        description: '渠道类型'
                    }
                ],
                returnType: 'ChannelConfig[]',
                handler: async (params) => {
                    return await manager.listConfigsByType(params.type as any);
                }
            },
            
            {
                name: 'listEnabledConfigs',
                description: '列出所有启用的配置',
                parameters: [],
                returnType: 'ChannelConfig[]',
                handler: async () => {
                    return await manager.listEnabledConfigs();
                }
            },
            
            // ========== 配置管理 ==========
            
            {
                name: 'setConfigEnabled',
                description: '启用或禁用配置',
                parameters: [
                    {
                        name: 'configId',
                        type: 'string',
                        required: true,
                        description: '配置 ID'
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
                    return await manager.setConfigEnabled(
                        params.configId as string,
                        params.enabled as boolean
                    );
                }
            },
            
            {
                name: 'validateConfig',
                description: '验证配置是否有效',
                parameters: [
                    {
                        name: 'config',
                        type: 'object',
                        required: true,
                        description: '要验证的配置'
                    }
                ],
                returnType: 'ValidationResult',
                handler: async (params) => {
                    return await manager.validateConfig(params.config as ChannelConfig);
                }
            },
            
            {
                name: 'getStats',
                description: '获取配置统计信息',
                parameters: [],
                returnType: 'ConfigStats',
                handler: async () => {
                    return await manager.getStats();
                }
            },
            
            {
                name: 'exportConfig',
                description: '导出配置（可选择是否包含敏感信息）',
                parameters: [
                    {
                        name: 'configId',
                        type: 'string',
                        required: true,
                        description: '配置 ID'
                    },
                    {
                        name: 'options',
                        type: 'object',
                        required: false,
                        description: '导出选项'
                    }
                ],
                returnType: 'any',
                handler: async (params) => {
                    return await manager.exportConfig(
                        params.configId as string,
                        params.options as ExportOptions | undefined
                    );
                }
            },
            
            {
                name: 'importConfig',
                description: '导入配置',
                parameters: [
                    {
                        name: 'configData',
                        type: 'object',
                        required: true,
                        description: '配置数据'
                    },
                    {
                        name: 'options',
                        type: 'object',
                        required: false,
                        description: '导入选项'
                    }
                ],
                returnType: 'string',
                handler: async (params) => {
                    return await manager.importConfig(
                        params.configData,
                        params.options as ImportOptions | undefined
                    );
                }
            },
            
            {
                name: 'exists',
                description: '检查配置是否存在',
                parameters: [
                    {
                        name: 'configId',
                        type: 'string',
                        required: true,
                        description: '配置 ID'
                    }
                ],
                returnType: 'boolean',
                handler: async (params) => {
                    return await manager.exists(params.configId as string);
                }
            }
        ]
    };
}