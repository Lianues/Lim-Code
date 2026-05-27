/**
 * LimCode - 渠道调用模块注册
 * 
 * 注册渠道调用模块到 ModuleRegistry
 */

import type { ModuleDefinition } from '../../core/registry/types';
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
        // 为什么同步模块版本：Channel 模块是本次工具格式、流式合并和 provider formatter 修复的核心路径。
        // 怎么改：随 1.1.28 发布统一内部模块版本展示。
        // 目的：排查渠道 formatter 问题时可以从模块元数据识别当前修复批次。
        version: '1.1.28',
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