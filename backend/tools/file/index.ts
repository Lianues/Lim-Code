/**
 * 文件工具模块
 *
 * 导出所有文件相关的工具
 */

import type { Tool } from '../types';

// 导出各个工具的创建函数
export { registerReadFile } from './read_file';
export { registerWriteFile } from './write_file';
export { registerListFiles } from './list_files';
export { registerDeleteFile } from './delete_file';
export { registerCreateDirectory } from './create_directory';
export { registerApplyDiff } from './apply_diff';
export { registerInsertCode } from './insert_code';
export { registerDeleteCode } from './delete_code';

// 导出 DiffManager 相关
export { getDiffManager, type PendingDiff, type DiffSettings } from './diffManager';

/**
 * 获取所有文件工具
 * @returns 所有文件工具的数组
 */
export function getAllFileTools(): Tool[] {
    const { registerReadFile } = require('./read_file');
    const { registerWriteFile } = require('./write_file');
    const { registerListFiles } = require('./list_files');
    const { registerDeleteFile } = require('./delete_file');
    const { registerCreateDirectory } = require('./create_directory');
    const { registerApplyDiff } = require('./apply_diff');
    const { registerInsertCode } = require('./insert_code');
    const { registerDeleteCode } = require('./delete_code');
    
    return [
        registerReadFile(),
        registerWriteFile(),
        registerListFiles(),
        registerDeleteFile(),
        registerCreateDirectory(),
        registerApplyDiff(),
        registerInsertCode(),
        registerDeleteCode()
    ];
}

/**
 * 获取所有文件工具的注册函数
 * @returns 注册函数数组
 */
export function getFileToolRegistrations() {
    const { registerReadFile } = require('./read_file');
    const { registerWriteFile } = require('./write_file');
    const { registerListFiles } = require('./list_files');
    const { registerDeleteFile } = require('./delete_file');
    const { registerCreateDirectory } = require('./create_directory');
    const { registerApplyDiff } = require('./apply_diff');
    const { registerInsertCode } = require('./insert_code');
    const { registerDeleteCode } = require('./delete_code');
    
    return [
        registerReadFile,
        registerWriteFile,
        registerListFiles,
        registerDeleteFile,
        registerCreateDirectory,
        registerApplyDiff,
        registerInsertCode,
        registerDeleteCode
    ];
}