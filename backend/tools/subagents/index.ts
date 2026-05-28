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

// 导出运行时事件总线
export {
    subAgentRunEventBus,
    type SubAgentRunEvent,
    type SubAgentRunSnapshot,
    type SubAgentRunStatus,
    type SubAgentRunManifest,
    type SubAgentRunContentWindow,
    type SubAgentRunContentWindowOptions
} from './runEventBus';
export {
    // 修改原因：WP22 需要让子 transcript adapter 也能作为 subagents 模块的正式 seam 被测试和后续协作者复用。
    // 修改方式：从 subagents 模块统一导出 SubAgentTranscriptRepository。
    // 修改目的：调用方不必直接耦合具体文件路径，也避免再次出现平行 adapter 实现。
    SubAgentTranscriptRepository
} from './SubAgentTranscriptRepository';

// 导出活跃运行控制器
export {
    // 修改原因：Monitor 控制按钮需要访问活跃 run 的 pause/resume/exit 能力，但不应直接操作事件总线。
    // 修改方式：从 subagents 模块统一导出 subAgentRunController。
    // 修改目的：让后端 handler 和 executor 复用同一控制入口，避免控制状态散落。
    subAgentRunController,
    type SubAgentControlAction,
    type SubAgentRunControlState
} from './runController';

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
