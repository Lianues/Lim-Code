/**
 * 查找文件工具
 *
 * 支持单个或多个 glob 模式查找
 * 支持多工作区（Multi-root Workspaces）
 */

import * as vscode from 'vscode';
import type { Tool, ToolResult } from '../types';
import { getWorkspaceRoot, getAllWorkspaces, toRelativePath, countTextFileLines } from '../utils';
import { getGlobalSettingsManager } from '../../core/settingsContext';

/**
 * 默认排除模式
 */
const DEFAULT_EXCLUDE = '**/node_modules/**';

/**
 * 获取排除模式
 *
 * 从设置管理器获取用户配置的排除模式，如果未配置则使用默认值
 * 将多个模式合并为单个 glob 模式（用大括号语法）
 */
function getExcludePattern(): string {
    const settingsManager = getGlobalSettingsManager();
    if (settingsManager) {
        const config = settingsManager.getFindFilesConfig();
        if (config.excludePatterns && config.excludePatterns.length > 0) {
            // 多个模式用 {} 语法组合
            if (config.excludePatterns.length === 1) {
                return config.excludePatterns[0];
            }
            return `{${config.excludePatterns.join(',')}}`;
        }
    }
    return DEFAULT_EXCLUDE;
}

/**
 * 单个模式的查找结果
 */
interface FoundFileDetail {
    path: string;
    /**
     * 文本文件行数；二进制文件或读取失败时省略。
     *
     * 修改原因：find_files 经常作为 read_file 前置定位器，只有路径会诱导模型直接读取未知大小文件。
     * 修改方式：保持 files 字符串数组向后兼容，同时新增 fileDetails 存放 path + lineCount。
     * 修改目的：让模型能先按行数判断是否需要范围读取。
     */
    lineCount?: number;
}

interface FindResult {
    pattern: string;
    workspace?: string;
    success: boolean;
    files?: string[];
    fileDetails?: FoundFileDetail[];
    count?: number;
    truncated?: boolean;
    error?: string;
}

/**
 * 在单个工作区中执行模式查找
 */
async function findInWorkspace(
    workspace: { name: string; uri: vscode.Uri },
    pattern: string,
    exclude: string,
    maxResults: number,
    includeWorkspacePrefix: boolean
): Promise<FindResult> {
    try {
        // 创建相对于工作区的模式
        const relativePattern = new vscode.RelativePattern(workspace.uri, pattern);
        const files = await vscode.workspace.findFiles(relativePattern, exclude, maxResults);
        
        const fileDetails = await Promise.all(files.map(async (fileUri: vscode.Uri): Promise<FoundFileDetail> => {
            const relativePath = toRelativePath(fileUri, includeWorkspacePrefix);
            return {
                path: relativePath,
                // 修改原因：find_files 返回路径后，模型通常下一步会读文件；提前给出行数能帮助它选择 startLine/endLine。
                // 修改方式：按文件 URI 读取文本内容并统计行数，二进制或失败时省略 lineCount。
                // 修改目的：在保留原 files 数组的同时提供更丰富的文件规模元数据。
                lineCount: await countTextFileLines(fileUri, relativePath)
            };
        }));
        fileDetails.sort((a, b) => a.path.localeCompare(b.path));
        const relativePaths = fileDetails.map(file => file.path);

        return {
            pattern,
            workspace: includeWorkspacePrefix ? workspace.name : undefined,
            success: true,
            files: relativePaths,
            fileDetails,
            count: relativePaths.length,
            truncated: relativePaths.length >= maxResults
        };
    } catch (error) {
        return {
            pattern,
            workspace: includeWorkspacePrefix ? workspace.name : undefined,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * 执行单个模式的查找（支持多工作区）
 */
async function findWithPattern(
    pattern: string,
    exclude: string,
    maxResults: number
): Promise<FindResult> {
    const workspaces = getAllWorkspaces();
    if (workspaces.length === 0) {
        return {
            pattern,
            success: false,
            error: 'No workspace folder open'
        };
    }
    
    // 单工作区模式
    if (workspaces.length === 1) {
        return findInWorkspace(workspaces[0], pattern, exclude, maxResults, false);
    }
    
    // 多工作区模式：在所有工作区中查找
    const allFiles: string[] = [];
    const allFileDetails: FoundFileDetail[] = [];
    let truncated = false;
    
    for (const ws of workspaces) {
        if (allFiles.length >= maxResults) {
            truncated = true;
            break;
        }
        
        const remaining = maxResults - allFiles.length;
        const result = await findInWorkspace(ws, pattern, exclude, remaining, true);
        
        if (result.success && result.files) {
            allFiles.push(...result.files);
            // 修改原因：多工作区聚合时不能只合并旧的 files 数组，否则新增 lineCount 元数据会在该路径丢失。
            // 修改方式：同步合并每个工作区 result.fileDetails，并在最终返回前统一排序。
            // 修改目的：单工作区和多工作区 find_files 返回相同的信息层级。
            allFileDetails.push(...(result.fileDetails || []));
        }
    }
    
    allFiles.sort();
    allFileDetails.sort((a, b) => a.path.localeCompare(b.path));
    return {
        pattern,
        success: true,
        files: allFiles,
        fileDetails: allFileDetails,
        count: allFiles.length,
        truncated: truncated || allFiles.length >= maxResults
    };
}

/**
 * 创建查找文件工具
 */
export function createFindFilesTool(): Tool {
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    return {
        declaration: {
            name: 'find_files',
            // 修改原因：用户要求 find_files 与 list_files 的新工具描述统一改为中文，并强调新增 lineCount 元数据。
            // 修改方式：主描述说明 glob、fileDetails.lineCount、数组参数和多根工作区规则，参数描述也同步中文化。
            // 修改目的：减少中文会话中模型误用 pattern 单字符串或忽略行数元数据的概率。
            description: isMultiRoot
                ? `根据一个或多个 glob 模式查找文件。结果会保留 files 字符串数组，并额外返回 fileDetails；其中可统计的文本文件会带 lineCount 行数，便于决定是否用 read_file 范围读取。当前是多根工作区，结果会带工作区前缀。可用工作区：${workspaces.map(w => w.name).join(', ')}。\n\n重要：patterns 参数必须是数组，即使只有一个模式也要写成 {"patterns": ["*.ts"]}，不要写成 {"pattern": "*.ts"}。`
                : '根据一个或多个 glob 模式查找文件。结果会保留 files 字符串数组，并额外返回 fileDetails；其中可统计的文本文件会带 lineCount 行数，便于决定是否用 read_file 范围读取。\n\n重要：patterns 参数必须是数组，即使只有一个模式也要写成 {"patterns": ["*.ts"]}，不要写成 {"pattern": "*.ts"}。',
            category: 'search',
            parameters: {
                type: 'object',
                properties: {
                    patterns: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
                        description: '要搜索的 glob 模式数组。即使只有一个模式也必须传数组，例如：["**/*.ts", "src/**/*.js"]。'
                    },
                    exclude: {
                        type: 'string',
                        description: '排除模式，例如："**/node_modules/**"。',
                        default: '**/node_modules/**'
                    },
                    maxResults: {
                        type: 'number',
                        description: '每个模式最多返回多少个结果。',
                        default: 500
                    }
                },
                required: ['patterns']
            }
        },
        handler: async (args): Promise<ToolResult> => {
            // 支持 patterns 数组或单个 pattern（向后兼容）
            let patternList: string[] = [];
            
            if (args.patterns && Array.isArray(args.patterns)) {
                patternList = args.patterns as string[];
            } else if (args.pattern && typeof args.pattern === 'string') {
                // 向后兼容单个 pattern 参数
                patternList = [args.pattern];
            }
            
            if (patternList.length === 0) {
                return { success: false, error: 'patterns is required' };
            }

            // 如果用户指定了 exclude 参数则使用，否则使用配置的默认值
            const exclude = (args.exclude as string) || getExcludePattern();
            const maxResults = (args.maxResults as number) || 500;

            const results: FindResult[] = [];
            let successCount = 0;
            let failCount = 0;
            let totalFiles = 0;

            for (const pattern of patternList) {
                const result = await findWithPattern(pattern, exclude, maxResults);
                results.push(result);
                
                if (result.success) {
                    successCount++;
                    totalFiles += result.count || 0;
                } else {
                    failCount++;
                }
            }

            const allSuccess = failCount === 0;
            return {
                success: allSuccess,
                data: {
                    results,
                    successCount,
                    failCount,
                    totalCount: patternList.length,
                    totalFiles
                },
                error: allSuccess ? undefined : `${failCount} patterns failed to search`
            };
        }
    };
}

/**
 * 注册查找文件工具
 */
export function registerFindFiles(): Tool {
    return createFindFilesTool();
}
