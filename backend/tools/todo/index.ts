/**
 * Todo 工具模块
 *
 * 导出所有 Todo 相关的工具
 */

import type { Tool, ToolRegistration } from '../types';

// 导出各个工具的创建函数
export { registerTodoWrite } from './todo_write';

// 导出 todo_write 模块的所有内容（方便外部引用）
export * from './todo_write';

/**
 * 获取所有 Todo 工具的注册函数
 */
export function getTodoToolRegistrations(): ToolRegistration[] {
    const { registerTodoWrite } = require('./todo_write');
    return [registerTodoWrite];
}

/**
 * 获取所有 Todo 工具
 */
export function getAllTodoTools(): Tool[] {
    const { registerTodoWrite } = require('./todo_write');
    return [registerTodoWrite()];
}
