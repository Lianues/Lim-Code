/**
 * 在文件中搜索（和替换）内容工具
 *
 * 支持多工作区（Multi-root Workspaces）
 * 支持正则表达式搜索和替换
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { Tool, ToolResult } from '../types';
import { getWorkspaceRoot, getAllWorkspaces, parseWorkspacePath, toRelativePath } from '../utils';
import { getGlobalSettingsManager } from '../../core/settingsContext';
import { getDiffStorageManager } from '../../modules/conversation';

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
        const config = settingsManager.getSearchInFilesConfig();
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
 * 转义正则特殊字符
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 搜索匹配项
 */
interface SearchMatch {
    file: string;
    workspace?: string;
    line: number;
    column: number;
    match: string;
    context: string;
}

/**
 * 替换结果
 */
interface ReplaceResult {
    file: string;
    workspace?: string;
    replacements: number;
    diffContentId?: string;
}

/**
 * 在单个目录中搜索（仅搜索，不替换）
 */
async function searchInDirectory(
    searchRoot: vscode.Uri,
    filePattern: string,
    searchRegex: RegExp,
    maxResults: number,
    workspaceName: string | null,
    excludePattern: string
): Promise<SearchMatch[]> {
    const results: SearchMatch[] = [];
    
    const pattern = new vscode.RelativePattern(searchRoot, filePattern);
    const files = await vscode.workspace.findFiles(pattern, excludePattern, 1000);
    
    for (const fileUri of files) {
        if (results.length >= maxResults) {
            break;
        }
        
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = new TextDecoder().decode(content);
            const lines = text.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                if (results.length >= maxResults) {
                    break;
                }
                
                const line = lines[i];
                let match;
                searchRegex.lastIndex = 0;
                
                while ((match = searchRegex.exec(line)) !== null) {
                    if (results.length >= maxResults) {
                        break;
                    }
                    
                    // 获取上下文（前后各1行）
                    const contextLines = [];
                    if (i > 0) {
                        contextLines.push(`${i}: ${lines[i - 1]}`);
                    }
                    contextLines.push(`${i + 1}: ${line}`);
                    if (i < lines.length - 1) {
                        contextLines.push(`${i + 2}: ${lines[i + 1]}`);
                    }
                    
                    // 使用支持多工作区的相对路径
                    const relativePath = toRelativePath(fileUri, workspaceName !== null);
                    
                    results.push({
                        file: relativePath,
                        workspace: workspaceName || undefined,
                        line: i + 1,
                        column: match.index + 1,
                        match: match[0],
                        context: contextLines.join('\n')
                    });
                }
            }
        } catch {
            // 跳过无法读取的文件
        }
    }
    
    return results;
}

/**
 * 在单个目录中搜索并替换
 */
async function searchAndReplaceInDirectory(
    searchRoot: vscode.Uri,
    filePattern: string,
    searchRegex: RegExp,
    replacement: string,
    maxFiles: number,
    workspaceName: string | null,
    excludePattern: string,
    dryRun: boolean
): Promise<{
    matches: SearchMatch[];
    replacements: ReplaceResult[];
    totalReplacements: number;
}> {
    const matches: SearchMatch[] = [];
    const replacements: ReplaceResult[] = [];
    let totalReplacements = 0;
    
    const pattern = new vscode.RelativePattern(searchRoot, filePattern);
    const files = await vscode.workspace.findFiles(pattern, excludePattern, 1000);
    
    let processedFiles = 0;
    
    for (const fileUri of files) {
        if (processedFiles >= maxFiles) {
            break;
        }
        
        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const originalText = new TextDecoder().decode(content);
            const lines = originalText.split('\n');
            
            // 检查是否有匹配
            searchRegex.lastIndex = 0;
            if (!searchRegex.test(originalText)) {
                continue;
            }
            
            processedFiles++;
            
            // 使用支持多工作区的相对路径
            const relativePath = toRelativePath(fileUri, workspaceName !== null);
            
            // 收集该文件的匹配信息
            let fileReplacementCount = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                let match;
                searchRegex.lastIndex = 0;
                
                while ((match = searchRegex.exec(line)) !== null) {
                    // 获取上下文（前后各1行）
                    const contextLines = [];
                    if (i > 0) {
                        contextLines.push(`${i}: ${lines[i - 1]}`);
                    }
                    contextLines.push(`${i + 1}: ${line}`);
                    if (i < lines.length - 1) {
                        contextLines.push(`${i + 2}: ${lines[i + 1]}`);
                    }
                    
                    matches.push({
                        file: relativePath,
                        workspace: workspaceName || undefined,
                        line: i + 1,
                        column: match.index + 1,
                        match: match[0],
                        context: contextLines.join('\n')
                    });
                    
                    fileReplacementCount++;
                }
            }
            
            // 执行替换
            searchRegex.lastIndex = 0;
            const newText = originalText.replace(searchRegex, replacement);
            
            if (newText !== originalText) {
                totalReplacements += fileReplacementCount;
                
                let diffContentId: string | undefined;
                
                if (!dryRun) {
                    // 保存文件
                    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(newText));
                    
                    // 保存 diff 内容用于查看差异
                    const diffStorageManager = getDiffStorageManager();
                    if (diffStorageManager) {
                        try {
                            const diffRef = await diffStorageManager.saveGlobalDiff({
                                originalContent: originalText,
                                newContent: newText,
                                filePath: relativePath
                            });
                            diffContentId = diffRef.diffId;
                        } catch (e) {
                            console.warn('Failed to save diff content:', e);
                        }
                    }
                }
                
                replacements.push({
                    file: relativePath,
                    workspace: workspaceName || undefined,
                    replacements: fileReplacementCount,
                    diffContentId
                });
            }
        } catch {
            // 跳过无法读取/写入的文件
        }
    }
    
    return { matches, replacements, totalReplacements };
}

/**
 * 根据 workspace 根和相对路径，判断是目录还是单个文件，并返回合适的搜索根和文件匹配模式。
 *
 * 使用约定：
 * - 目录 path 末尾应带有 "/"（例如 "src/" 或 "workspace_name/src/"）。
 * - 文件 path 不带末尾斜杠（例如 "src/index.ts"）。
 *
 * 实现上仍会通过 fs.stat 精确判断文件/目录，但在工具定义中会提示 AI 使用上述约定，
 * 以减少歧义。
 *
 * - 如果 relativePath 指向一个存在的文件，则：
 *   - searchRoot 为该文件所在的目录；
 *   - effectivePattern 为该文件名（只搜索这一文件）。
 * - 其它情况按目录处理：
 *   - searchRoot = rootUri + relativePath；
 *   - effectivePattern = 原始 filePattern。
 */
async function getSearchRootAndPattern(
    rootUri: vscode.Uri,
    relativePath: string,
    filePattern: string
): Promise<{ searchRoot: vscode.Uri; effectivePattern: string }> {
    // 空路径或当前目录，直接用 workspace 根目录
    if (!relativePath || relativePath === '.' || relativePath === './') {
        return { searchRoot: rootUri, effectivePattern: filePattern };
    }

    const fullUri = vscode.Uri.joinPath(rootUri, relativePath);

    try {
        const stat = await vscode.workspace.fs.stat(fullUri);
        if (stat.type === vscode.FileType.File) {
            // 是单个文件：搜索根为所在目录，pattern 为文件名
            const fsPath = fullUri.fsPath;
            const dirPath = path.dirname(fsPath);
            const fileName = path.basename(fsPath);
            return {
                searchRoot: vscode.Uri.file(dirPath),
                effectivePattern: fileName

            };
        }
    } catch {
        // stat 失败（路径不存在或权限问题），按目录处理
    }

    // 默认按目录处理
    return {
        searchRoot: fullUri,
        effectivePattern: filePattern
    };
}

/**
 * 创建搜索文件内容工具
 */
export function createSearchInFilesTool(): Tool {
    // 获取工作区信息用于描述
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    let pathDescription = 'Search path relative to workspace root. Use "dir/" (trailing slash) for directories, or "dir/file.ext" for a single file. Default "." searches the entire workspace.';
    if (isMultiRoot) {
        pathDescription = `Search path, use "workspace_name/path" format. Use "workspace_name/dir/" (trailing slash) for directories, or "workspace_name/file.ext" for a single file. Use "." to search all workspaces. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }
    
    return {
        declaration: {
            name: 'search_in_files',
            description: isMultiRoot
                ? `Search (and optionally replace) content in multiple workspace files. Supports regular expressions. Use "workspace_name/dir/" (trailing slash) for directories, or "workspace_name/file.ext" for a single file. Use "." to search all workspaces. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`
                : 'Search (and optionally replace) content in workspace files. Supports regular expressions. Use "dir/" (trailing slash) for directories, or "dir/file.ext" for a single file. Returns matching files and context. If "replace" is provided, performs replacement and saves changes.',
            category: 'search',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Search keyword or regular expression'
                    },
                    path: {
                        type: 'string',
                        description: pathDescription,
                        default: '.'
                    },
                    pattern: {
                        type: 'string',
                        description: 'File matching pattern, e.g., "*.ts" or "**/*.js"',
                        default: '**/*'
                    },
                    isRegex: {
                        type: 'boolean',
                        description: 'Whether to treat query as a regular expression',
                        default: false
                    },
                    replace: {
                        type: 'string',
                        description: 'Replacement string. If provided, matching content will be replaced. Supports regex capture groups like $1, $2 when isRegex is true.'
                    },
                    dryRun: {
                        type: 'boolean',
                        description: 'If true, only preview replacements without actually modifying files',
                        default: false
                    },
                    maxResults: {
                        type: 'number',
                        description: 'Maximum number of match results (for search only mode)',
                        default: 100
                    },
                    maxFiles: {
                        type: 'number',
                        description: 'Maximum number of files to process (for replace mode)',
                        default: 50
                    }
                },
                required: ['query']
            }
        },
        handler: async (args): Promise<ToolResult> => {
            const query = args.query as string;
            const searchPath = (args.path as string) || '.';
            const filePattern = (args.pattern as string) || '**/*';
            const isRegex = (args.isRegex as boolean) || false;
            const replacement = args.replace as string | undefined;
            const dryRun = (args.dryRun as boolean) || false;
            const maxResults = (args.maxResults as number) || 100;
            const maxFiles = (args.maxFiles as number) || 50;

            if (!query) {
                return { success: false, error: 'query is required' };
            }

            const workspaces = getAllWorkspaces();
            if (workspaces.length === 0) {
                return { success: false, error: 'No workspace folder open' };
            }

            const isReplaceMode = replacement !== undefined;

            try {
                // 创建搜索正则表达式
                // 对于搜索模式，使用 'gim' 标志（全局、不区分大小写、多行）
                // 对于替换模式，使用 'g' 标志（全局匹配）确保替换所有匹配项
                const flags = isReplaceMode ? 'g' : 'gim';
                const searchRegex = isRegex
                    ? new RegExp(query, flags)
                    : new RegExp(escapeRegex(query), flags);
                
                // 获取排除模式
                const excludePattern = getExcludePattern();
                
                // 解析路径，确定搜索范围
                const { workspace: targetWorkspace, relativePath, isExplicit } = parseWorkspacePath(searchPath);
                
                if (isReplaceMode) {
                    // 替换模式
                    let allMatches: SearchMatch[] = [];
                    let allReplacements: ReplaceResult[] = [];
                    let totalReplacements = 0;
                    
                    if (isExplicit && targetWorkspace) {
                        // 显式指定了工作区，只搜索该工作区
                        const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                            targetWorkspace.uri,
                            relativePath,
                            filePattern
                        );
                        const result = await searchAndReplaceInDirectory(
                            searchRoot,
                            effectivePattern,
                            searchRegex,
                            replacement,
                            maxFiles,
                            workspaces.length > 1 ? targetWorkspace.name : null,
                            excludePattern,
                            dryRun
                        );
                        allMatches = result.matches;
                        allReplacements = result.replacements;
                        totalReplacements = result.totalReplacements;
                    } else if (searchPath === '.' && workspaces.length > 1) {
                        // 搜索所有工作区
                        let remainingFiles = maxFiles;
                        for (const ws of workspaces) {
                            if (remainingFiles <= 0) break;
                            
                            const result = await searchAndReplaceInDirectory(
                                ws.uri,
                                filePattern,
                                searchRegex,
                                replacement,
                                remainingFiles,
                                ws.name,
                                excludePattern,
                                dryRun
                            );
                            allMatches.push(...result.matches);
                            allReplacements.push(...result.replacements);
                            totalReplacements += result.totalReplacements;
                            remainingFiles -= result.replacements.length;
                        }
                    } else {
                        // 单工作区或未指定，使用默认
                        const root = targetWorkspace?.uri || workspaces[0].uri;
                        const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                            root,
                            relativePath,
                            filePattern
                        );
                        const result = await searchAndReplaceInDirectory(
                            searchRoot,
                            effectivePattern,
                            searchRegex,
                            replacement,
                            maxFiles,
                            workspaces.length > 1 ? (targetWorkspace?.name || workspaces[0].name) : null,
                            excludePattern,
                            dryRun
                        );
                        allMatches = result.matches;
                        allReplacements = result.replacements;
                        totalReplacements = result.totalReplacements;
                    }
                    
                    return {
                        success: true,
                        data: {
                            matches: allMatches.map(m => ({
                                file: m.file,
                                workspace: m.workspace,
                                line: m.line,
                                column: m.column,
                                match: m.match
                                // 替换模式下不返回 context，减小体积，前端已有 diff 视图
                            })),
                            results: allReplacements,
                            filesModified: allReplacements.length,
                            totalReplacements,
                            multiRoot: workspaces.length > 1
                        }
                    };
                } else {
                    // 仅搜索模式
                    let allResults: SearchMatch[] = [];
                    
                    if (isExplicit && targetWorkspace) {
                        // 显式指定了工作区，只搜索该工作区
                        const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                            targetWorkspace.uri,
                            relativePath,
                            filePattern
                        );
                        allResults = await searchInDirectory(
                            searchRoot,
                            effectivePattern,
                            searchRegex,
                            maxResults,
                            workspaces.length > 1 ? targetWorkspace.name : null,
                            excludePattern
                        );
                    } else if (searchPath === '.' && workspaces.length > 1) {
                        // 搜索所有工作区
                        for (const ws of workspaces) {
                            if (allResults.length >= maxResults) break;
                            
                            const remaining = maxResults - allResults.length;
                            const wsResults = await searchInDirectory(
                                ws.uri,
                                filePattern,
                                searchRegex,
                                remaining,
                                ws.name,
                                excludePattern
                            );
                            allResults.push(...wsResults);
                        }
                    } else {
                        // 单工作区或未指定，使用默认
                        const root = targetWorkspace?.uri || workspaces[0].uri;
                        const { searchRoot, effectivePattern } = await getSearchRootAndPattern(
                            root,
                            relativePath,
                            filePattern
                        );
                        allResults = await searchInDirectory(
                            searchRoot,
                            effectivePattern,
                            searchRegex,
                            maxResults,
                            workspaces.length > 1 ? (targetWorkspace?.name || workspaces[0].name) : null,
                            excludePattern
                        );
                    }

                    return {
                        success: true,
                        data: {
                            results: allResults,
                            count: allResults.length,
                            truncated: allResults.length >= maxResults,
                            multiRoot: workspaces.length > 1
                        }
                    };
                }
            } catch (error) {
                return {
                    success: false,
                    error: `Search failed: ${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
    };
}

/**
 * 注册搜索文件内容工具
 */
export function registerSearchInFiles(): Tool {
    return createSearchInFilesTool();
}