/**
 * 查找引用工具
 *
 * 使用 VSCode LSP 查找符号的所有引用
 */

import * as vscode from 'vscode';
import type { Tool, ToolResult } from '../types';
import { resolveUri, getAllWorkspaces } from '../utils';

/**
 * 引用位置信息
 */
interface ReferenceLocation {
    path: string;
    line: number;       // 1-based
    column: number;     // 1-based
    content: string;    // 该行的内容（或带上下文）
}

/**
 * 按文件分组的引用
 */
interface GroupedReferences {
    path: string;
    count: number;
    references: {
        line: number;
        column: number;
        content: string;
    }[];
}

/**
 * 创建查找引用工具
 */
export function createFindReferencesTool(): Tool {
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    let description = `Find all references to a symbol at a specific position in a file. This is useful for:
- Understanding how a function/class/variable is used across the codebase
- Finding all places that need to be updated when refactoring
- Understanding the impact of changes

Returns references grouped by file, with line numbers and code content.`;
    
    if (isMultiRoot) {
        description += '\n\nMulti-root workspace: Use "workspace_name/path" format to specify the workspace.';
    }
    
    let pathDescription = 'File path (relative to workspace root)';
    if (isMultiRoot) {
        pathDescription = `File path, use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }
    
    return {
        declaration: {
            name: 'find_references',
            description,
            category: 'lsp',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: pathDescription
                    },
                    line: {
                        type: 'number',
                        description: 'Line number (1-based) where the symbol is located'
                    },
                    column: {
                        type: 'number',
                        description: 'Column number (1-based) where the symbol starts. If not specified, uses column 1.'
                    },
                    symbol: {
                        type: 'string',
                        description: 'The symbol name to find references for (optional, for documentation purposes)'
                    },
                    context: {
                        type: 'number',
                        description: 'Number of context lines to include before and after each reference. Default: 2. Use 0 for single line only.'
                    }
                },
                required: ['path', 'line']
            }
        },
        handler: async (args, _context): Promise<ToolResult> => {
            const filePath = args.path as string;
            const line = args.line as number;
            const column = (args.column as number) || 1;
            const symbolName = args.symbol as string | undefined;
            const contextLines = typeof args.context === 'number' ? args.context : 2;
            
            if (!filePath) {
                return { success: false, error: 'path is required' };
            }
            if (typeof line !== 'number' || line < 1) {
                return { success: false, error: 'line must be a positive number' };
            }
            
            const uri = resolveUri(filePath);
            if (!uri) {
                return { success: false, error: 'Could not resolve file path. Make sure a workspace is open.' };
            }
            
            try {
                // 创建位置（转换为 0-based）
                const position = new vscode.Position(line - 1, column - 1);
                
                // 使用 VSCode 的 executeReferenceProvider 命令
                const references = await vscode.commands.executeCommand<vscode.Location[]>(
                    'vscode.executeReferenceProvider',
                    uri,
                    position
                );
                
                if (!references || references.length === 0) {
                    return {
                        success: true,
                        data: {
                            path: filePath,
                            line,
                            column,
                            symbol: symbolName,
                            totalCount: 0,
                            fileCount: 0,
                            references: [],
                            message: 'No references found. The symbol may not be used, or no language server is available.'
                        }
                    };
                }
                
                // 按文件分组引用
                const groupedMap = new Map<string, ReferenceLocation[]>();
                // 缓存已打开的文档
                const docCache = new Map<string, vscode.TextDocument>();
                
                for (const ref of references) {
                    // 获取相对路径
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(ref.uri);
                    let relativePath: string;
                    if (workspaceFolder) {
                        relativePath = vscode.workspace.asRelativePath(ref.uri, isMultiRoot);
                    } else {
                        relativePath = ref.uri.fsPath;
                    }
                    
                    const refLine = ref.range.start.line; // 0-based
                    
                    // 获取代码内容
                    let content = '';
                    try {
                        // 使用缓存
                        let doc = docCache.get(ref.uri.toString());
                        if (!doc) {
                            doc = await vscode.workspace.openTextDocument(ref.uri);
                            docCache.set(ref.uri.toString(), doc);
                        }
                        
                        const totalLines = doc.lineCount;
                        const startLine = Math.max(0, refLine - contextLines);
                        const endLine = Math.min(totalLines - 1, refLine + contextLines);
                        
                        const lines: string[] = [];
                        for (let i = startLine; i <= endLine; i++) {
                            const lineText = doc.lineAt(i).text;
                            const lineNum = i + 1; // 1-based
                            // 标记引用所在行
                            const marker = (i === refLine) ? '>' : ' ';
                            lines.push(`${marker}${lineNum.toString().padStart(4)} | ${lineText}`);
                        }
                        content = lines.join('\n');
                    } catch {
                        content = '(Unable to read file content)';
                    }
                    
                    const location: ReferenceLocation = {
                        path: relativePath,
                        line: refLine + 1,
                        column: ref.range.start.character + 1,
                        content
                    };
                    
                    if (!groupedMap.has(relativePath)) {
                        groupedMap.set(relativePath, []);
                    }
                    groupedMap.get(relativePath)!.push(location);
                }
                
                // 转换为分组数组
                const groupedReferences: GroupedReferences[] = [];
                for (const [path, refs] of groupedMap) {
                    // 按行号排序
                    refs.sort((a, b) => a.line - b.line);
                    
                    groupedReferences.push({
                        path,
                        count: refs.length,
                        references: refs.map(r => ({
                            line: r.line,
                            column: r.column,
                            content: r.content
                        }))
                    });
                }
                
                // 按引用数量排序（多的在前）
                groupedReferences.sort((a, b) => b.count - a.count);
                
                return {
                    success: true,
                    data: {
                        path: filePath,
                        line,
                        column,
                        symbol: symbolName,
                        totalCount: references.length,
                        fileCount: groupedReferences.length,
                        references: groupedReferences
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        }
    };
}

/**
 * 注册查找引用工具
 */
export function registerFindReferences(): Tool {
    return createFindReferencesTool();
}
