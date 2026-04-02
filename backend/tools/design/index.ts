/**
 * Design 工具模块
 */

import type { Tool, ToolRegistration } from '../types';

// 导出各个工具的注册函数
export { registerCreateDesign } from './create_design';
export { registerUpdateDesign } from './update_design';

/**
 * 获取所有 Design 工具的注册函数
 */
export function getDesignToolRegistrations(): ToolRegistration[] {
  const { registerCreateDesign } = require('./create_design');
  const { registerUpdateDesign } = require('./update_design');
  return [registerCreateDesign, registerUpdateDesign];
}

/**
 * 获取所有 Design 工具
 */
export function getAllDesignTools(): Tool[] {
  const { registerCreateDesign } = require('./create_design');
  const { registerUpdateDesign } = require('./update_design');
  return [registerCreateDesign(), registerUpdateDesign()];
}
