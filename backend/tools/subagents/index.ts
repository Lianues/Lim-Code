/**
 * SubAgents 工具模块
 *
 * 导出所有子代理相关的工具和类型
 */

import type { Tool } from '../types';

// 导出类型
export type {
    SubAgentType,
    SubAgentConfig,
    SubAgentRequest,
    SubAgentResult,
    SubAgentToolCall,
    SubAgentChannelConfig,
    SubAgentToolsConfig,
    SubAgentRegistryEntry,
    SubAgentExecutor,
    SubAgentExecutorContext,
    SubAgentExecutorFactory
} from './types';

// 导出注册器
export { SubAgentRegistry, subAgentRegistry } from './registry';

// 导出执行器
export {
    setSubAgentExecutorContext,
    getSubAgentExecutorContext,
    createDefaultExecutor,
    defaultExecutorFactory
} from './executor';

// 导出工具
export { 
    createSubAgentsTool, 
    getSubAgentsTool,
    getSubAgentsToolDeclaration,
    refreshSubAgentsTool,
    registerSubAgents 
} from './subagents';

/**
 * 获取所有 SubAgents 工具
 * @returns 所有 SubAgents 工具的数组
 */
export function getAllSubAgentsTools(): Tool[] {
    const { getSubAgentsTool } = require('./subagents');
    
    return [
        getSubAgentsTool()
    ];
}

/**
 * 获取所有 SubAgents 工具的注册函数
 * @returns 注册函数数组
 */
export function getSubAgentsToolRegistrations() {
    const { getSubAgentsTool } = require('./subagents');
    
    return [
        getSubAgentsTool
    ];
}
