/**
 * LimCode - 渠道调用模块注册
 * 
 * 注册渠道调用模块到 ModuleRegistry
 */

import type { ModuleDefinition } from '../../core/registry/types';
import { getProductVersion } from '../../core/productMetadata';
import type { ConfigManager } from '../config/ConfigManager';
import { ChannelManager } from './ChannelManager';
import type {
    GenerateRequest,
    GenerateResponse,
    StreamChunk
} from './types';

/**
 * 注册渠道调用模块
 * 
 * @param configManager 配置管理器
 * @returns 模块定义
 */
export function registerChannelModule(
    configManager: ConfigManager
): ModuleDefinition {
    const manager = new ChannelManager(configManager);
    
    return {
        id: 'channel',
        name: 'Channel Manager',
        // 修改原因：模块注册元数据过去手写发布版本，每次 release 都要逐文件同步。
        // 修改方式：从 productMetadata 读取当前扩展 packageJSON 版本。
        // 修改目的：让模块清单自动跟随发布版本，避免诊断信息落后。
        version: getProductVersion(),
        description: '管理 LLM 渠道调用，支持 Gemini、OpenAI、Anthropic 等多种格式',
        
        apis: [
            // ========== 生成操作 ==========
            
            {
                name: 'generate',
                description: '生成内容（非流式）',
                parameters: [
                    {
                        name: 'request',
                        type: 'object',
                        required: true,
                        description: '生成请求'
                    }
                ],
                returnType: 'GenerateResponse',
                handler: async (params) => {
                    return await manager.generate(params.request as GenerateRequest);
                }
            },
            
            {
                name: 'generateStream',
                description: '生成内容（流式）',
                parameters: [
                    {
                        name: 'request',
                        type: 'object',
                        required: true,
                        description: '生成请求'
                    }
                ],
                returnType: 'AsyncGenerator<StreamChunk>',
                handler: async (params) => {
                    return manager.generateStream(params.request as GenerateRequest);
                }
            }
        ]
    };
}