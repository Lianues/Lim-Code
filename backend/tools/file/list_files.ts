/**
 * 列出文件工具
 *
 * 支持列出单个或多个目录，同时返回文件和子目录
 * 支持多工作区（Multi-root Workspaces）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool, ToolResult } from '../types';
import { getWorkspaceRoot, resolveUri, getAllWorkspaces, parseWorkspacePath, resolveUriWithInfo, countTextFileLines } from '../utils';
import { getGlobalSettingsManager } from '../../core/settingsContext';

/**
 * 默认忽略的目录和文件
 */
const DEFAULT_IGNORED = ['.git'];

/**
 * 获取忽略列表
 *
 * 从设置管理器获取用户配置的忽略列表，如果未配置则使用默认值
 */
function getIgnorePatterns(): string[] {
    const settingsManager = getGlobalSettingsManager();
    if (settingsManager) {
        const config = settingsManager.getListFilesConfig();
        return config.ignorePatterns || DEFAULT_IGNORED;
    }
    return DEFAULT_IGNORED;
}

/**
 * 检查是否应该忽略
 *
 * 支持通配符匹配：
 * - *.ext 匹配任意以 .ext 结尾的文件
 * - prefix* 匹配任意以 prefix 开头的文件
 * - 精确匹配
 */
function shouldIgnore(name: string, ignorePatterns: string[]): boolean {
    for (const pattern of ignorePatterns) {
        // 通配符匹配
        if (pattern.startsWith('*') && pattern.length > 1) {
            // *.ext 匹配
            const suffix = pattern.slice(1);
            if (name.endsWith(suffix)) {
                return true;
            }
        } else if (pattern.endsWith('*') && pattern.length > 1) {
            // prefix* 匹配
            const prefix = pattern.slice(0, -1);
            if (name.startsWith(prefix)) {
                return true;
            }
        } else {
            // 精确匹配
            if (name === pattern) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 条目类型
 */
interface Entry {
    name: string;
    type: 'file' | 'directory';
    /**
     * 文本文件行数；目录和二进制文件不提供。
     *
     * 修改原因：模型在决定是否直接 read_file 时需要知道文件规模，只看文件名会诱发读取超大文件。
     * 修改方式：list_files 生成文件 entry 时尝试统计文本行数，失败或二进制文件保持 undefined。
     * 修改目的：让目录浏览结果具备足够的读取决策信息，同时不破坏既有 name/type 字段。
     */
    lineCount?: number;
}

/**
 * 单个目录的列出结果
 */
interface ListResult {
    path: string;
    workspace?: string;
    entries: Entry[];
    fileCount: number;
    dirCount: number;
    success: boolean;
    error?: string;
}

/**
 * 递归列出目录内容
 */
async function listDirectoryRecursive(
    dirUri: vscode.Uri,
    basePath: string,
    entries: Entry[],
    ignorePatterns: string[]
): Promise<void> {
    const items = await vscode.workspace.fs.readDirectory(dirUri);
    
    for (const [name, type] of items) {
        // 跳过忽略的目录和文件
        if (shouldIgnore(name, ignorePatterns)) {
            continue;
        }
        
        const relativePath = basePath ? path.join(basePath, name) : name;
        
        if (type === vscode.FileType.Directory) {
            entries.push({ name: relativePath + '/', type: 'directory' });
            // 递归进入子目录
            const subDirUri = vscode.Uri.joinPath(dirUri, name);
            await listDirectoryRecursive(subDirUri, relativePath, entries, ignorePatterns);
        } else if (type === vscode.FileType.File) {
            const fileUri = vscode.Uri.joinPath(dirUri, name);
            entries.push({
                name: relativePath,
                type: 'file',
                // 修改原因：递归列表里也要给每个文本文件带行数，避免只有顶层列表可用。
                // 修改方式：用当前目录 URI 与文件名拼出真实 URI，再通过共享工具统计文本行数。
                // 修改目的：无论 recursive 是否开启，返回结构都一致携带可选 lineCount。
                lineCount: await countTextFileLines(fileUri, relativePath)
            });
        }
    }
}

/**
 * 创建列出文件工具
 */
export function createListFilesTool(): Tool {
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    // 数组格式强调说明
    // 修改原因：用户要求两个文件发现类工具的新描述统一使用中文，同时保留数组参数约束，降低模型把 path 写成字符串的概率。
    // 修改方式：将主描述和参数描述改为中文，并明确文件 entry 会携带 lineCount。
    // 修改目的：让模型在中文对话中更容易理解 list_files 的批量目录语义和行数元数据。
    const arrayFormatNote = '。即使只列出一个目录，也必须传数组，例如：["src"]。';
    
    let pathsDescription = '要列出的目录路径数组，相对于当前工作区根目录' + arrayFormatNote;
    if (isMultiRoot) {
        pathsDescription = `要列出的目录路径数组；当前是多根工作区，必须使用 "workspace_name/path" 格式${arrayFormatNote}可用工作区：${workspaces.map(w => w.name).join(', ')}。`;
    }
    
    return {
        declaration: {
            name: 'list_files',
            description: isMultiRoot
                ? `列出一个或多个目录中的文件和子目录。文件条目在可统计时会包含 lineCount（文本文件行数），便于决定是否用 read_file 范围读取。当前是多根工作区，path 必须使用 "workspace_name/path" 格式。可用工作区：${workspaces.map(w => w.name).join(', ')}。`
                : '列出一个或多个目录中的文件和子目录，支持批量列出。文件条目在可统计时会包含 lineCount（文本文件行数），便于决定是否用 read_file 范围读取。',
            category: 'file',
            parameters: {
                type: 'object',
                properties: {
                    paths: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
                        description: pathsDescription
                    },
                    recursive: {
                        type: 'boolean',
                        description: '是否递归列出子目录。false 时只列出指定目录直属的一层；true 时递归列出所有子目录内容。',
                        default: false
                    }
                },
                required: ['paths']
            }
        },
        handler: async (args): Promise<ToolResult> => {
            // 支持 paths 数组或单个 path（向后兼容）
            let pathList: string[] = [];
            
            if (args.paths && Array.isArray(args.paths)) {
                pathList = args.paths as string[];
            } else if (args.path && typeof args.path === 'string') {
                // 向后兼容单个 path 参数
                pathList = [args.path];
            }
            
            if (pathList.length === 0) {
                pathList = ['.']; // 默认为根目录
            }
            
            const recursive = (args.recursive as boolean) || false;

            const workspaces = getAllWorkspaces();
            if (workspaces.length === 0) {
                return { success: false, error: 'No workspace folder open' };
            }
            
            const isMultiRoot = workspaces.length > 1;

            // 获取忽略列表配置
            const ignorePatterns = getIgnorePatterns();

            const results: ListResult[] = [];
            let totalFiles = 0;
            let totalDirs = 0;

            for (const dirPath of pathList) {
                try {
                    const { uri: dirUri, workspace, relativePath, isExplicit } = resolveUriWithInfo(dirPath);
                    if (!dirUri) {
                        results.push({
                            path: dirPath,
                            entries: [],
                            fileCount: 0,
                            dirCount: 0,
                            success: false,
                            error: 'No workspace folder open'
                        });
                        continue;
                    }
                    
                    const entries: Entry[] = [];
                    
                    if (recursive) {
                        // 递归列出
                        await listDirectoryRecursive(dirUri, '', entries, ignorePatterns);
                    } else {
                        // 只列出顶层
                        const items = await vscode.workspace.fs.readDirectory(dirUri);
                        
                        for (const [name, type] of items) {
                            // 跳过忽略的目录和文件
                            if (shouldIgnore(name, ignorePatterns)) {
                                continue;
                            }
                            
                            if (type === vscode.FileType.Directory) {
                                entries.push({ name: name + '/', type: 'directory' });
                            } else if (type === vscode.FileType.File) {
                                const fileUri = vscode.Uri.joinPath(dirUri, name);
                                entries.push({
                                    name,
                                    type: 'file',
                                    // 修改原因：非递归 list_files 是最常用的目录探查入口，需要直接告诉模型每个文本文件有多少行。
                                    // 修改方式：对文件 entry 统计 lineCount；二进制或读取失败时保持 undefined。
                                    // 修改目的：减少模型盲目 read_file 整个大文件的概率。
                                    lineCount: await countTextFileLines(fileUri, name)
                                });
                            }
                        }
                    }
                    
                    // 排序：目录在前，文件在后，各自按名称排序
                    entries.sort((a, b) => {
                        if (a.type !== b.type) {
                            return a.type === 'directory' ? -1 : 1;
                        }
                        return a.name.localeCompare(b.name);
                    });
                    
                    const fileCount = entries.filter(e => e.type === 'file').length;
                    const dirCount = entries.filter(e => e.type === 'directory').length;

                    results.push({
                        path: dirPath,
                        workspace: isMultiRoot ? workspace?.name : undefined,
                        entries,
                        fileCount,
                        dirCount,
                        success: true
                    });
                    totalFiles += fileCount;
                    totalDirs += dirCount;
                } catch (error) {
                    results.push({
                        path: dirPath,
                        entries: [],
                        fileCount: 0,
                        dirCount: 0,
                        success: false,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            const allSuccess = results.every(r => r.success);
            return {
                success: allSuccess,
                data: {
                    results,
                    totalFiles,
                    totalDirs,
                    totalPaths: pathList.length
                },
                error: allSuccess ? undefined : 'Some directories failed to list'
            };
        }
    };
}

/**
 * 注册列出文件工具
 */
export function registerListFiles(): Tool {
    return createListFilesTool();
}