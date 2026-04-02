/**
 * Plan 工具模块
 */

import type { Tool, ToolRegistration } from '../types';

// 导出各个工具的注册函数
export { registerCreatePlan } from './create_plan';
export { registerUpdatePlan } from './update_plan';

/**
 * 获取所有 Plan 工具的注册函数
 */
export function getPlanToolRegistrations(): ToolRegistration[] {
    const { registerCreatePlan } = require('./create_plan');
    const { registerUpdatePlan } = require('./update_plan');
    return [registerCreatePlan, registerUpdatePlan];
}

/**
 * 获取所有 Plan 工具
 */
export function getAllPlanTools(): Tool[] {
    const { registerCreatePlan } = require('./create_plan');
    const { registerUpdatePlan } = require('./update_plan');
    return [registerCreatePlan(), registerUpdatePlan()];
}
