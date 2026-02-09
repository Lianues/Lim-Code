/**
 * Plan 工具模块
 */

import type { Tool, ToolRegistration } from '../types';

// 导出各个工具的注册函数
export { registerCreatePlan } from './create_plan';

/**
 * 获取所有 Plan 工具的注册函数
 */
export function getPlanToolRegistrations(): ToolRegistration[] {
    const { registerCreatePlan } = require('./create_plan');
    return [registerCreatePlan];
}

/**
 * 获取所有 Plan 工具
 */
export function getAllPlanTools(): Tool[] {
    const { registerCreatePlan } = require('./create_plan');
    return [registerCreatePlan()];
}
