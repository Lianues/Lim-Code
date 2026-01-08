/**
 * LSP 工具模块
 *
 * 提供基于 Language Server Protocol 的代码导航和智能分析工具
 */

import type { Tool } from '../types';

// 导出各个工具的创建函数
export { registerGetSymbols } from './get_symbols';
export { registerGotoDefinition } from './goto_definition';
export { registerFindReferences } from './find_references';

/**
 * 获取所有 LSP 工具
 * @returns 所有 LSP 工具的数组
 */
export function getAllLspTools(): Tool[] {
    const { registerGetSymbols } = require('./get_symbols');
    const { registerGotoDefinition } = require('./goto_definition');
    const { registerFindReferences } = require('./find_references');
    
    return [
        registerGetSymbols(),
        registerGotoDefinition(),
        registerFindReferences(),
    ];
}

/**
 * 获取所有 LSP 工具的注册函数
 * @returns 注册函数数组
 */
export function getLspToolRegistrations() {
    const { registerGetSymbols } = require('./get_symbols');
    const { registerGotoDefinition } = require('./goto_definition');
    const { registerFindReferences } = require('./find_references');
    
    return [
        registerGetSymbols,
        registerGotoDefinition,
        registerFindReferences,
    ];
}
