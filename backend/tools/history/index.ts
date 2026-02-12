/**
 * History 工具模块
 *
 * 导出所有历史对话检索相关的工具
 */

import type { Tool, ToolRegistration } from '../types';

// 导出各个工具的创建函数
export { registerHistorySearch } from './history_search';

// 导出 history_search 模块的所有内容（方便外部引用）
export * from './history_search';

/**
 * 获取所有 History 工具的注册函数
 */
export function getHistoryToolRegistrations(): ToolRegistration[] {
    const { registerHistorySearch } = require('./history_search');
    return [registerHistorySearch];
}

/**
 * 获取所有 History 工具
 */
export function getAllHistoryTools(): Tool[] {
    const { registerHistorySearch } = require('./history_search');
    return [registerHistorySearch()];
}
