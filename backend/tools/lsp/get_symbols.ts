/**
 * 获取文件符号工具
 *
 * 使用 VSCode LSP 获取文件中的符号列表（类、函数、变量等）
 * 支持批量查询多个文件
 */

import * as vscode from 'vscode';
import type { Tool, ToolResult } from '../types';
import { resolveUri, getAllWorkspaces } from '../utils';

/**
 * 符号类型映射
 */
const SymbolKindNames: Record<vscode.SymbolKind, string> = {
    [vscode.SymbolKind.File]: 'file',
    [vscode.SymbolKind.Module]: 'module',
    [vscode.SymbolKind.Namespace]: 'namespace',
    [vscode.SymbolKind.Package]: 'package',
    [vscode.SymbolKind.Class]: 'class',
    [vscode.SymbolKind.Method]: 'method',
    [vscode.SymbolKind.Property]: 'property',
    [vscode.SymbolKind.Field]: 'field',
    [vscode.SymbolKind.Constructor]: 'constructor',
    [vscode.SymbolKind.Enum]: 'enum',
    [vscode.SymbolKind.Interface]: 'interface',
    [vscode.SymbolKind.Function]: 'function',
    [vscode.SymbolKind.Variable]: 'variable',
    [vscode.SymbolKind.Constant]: 'constant',
    [vscode.SymbolKind.String]: 'string',
    [vscode.SymbolKind.Number]: 'number',
    [vscode.SymbolKind.Boolean]: 'boolean',
    [vscode.SymbolKind.Array]: 'array',
    [vscode.SymbolKind.Object]: 'object',
    [vscode.SymbolKind.Key]: 'key',
    [vscode.SymbolKind.Null]: 'null',
    [vscode.SymbolKind.EnumMember]: 'enum_member',
    [vscode.SymbolKind.Struct]: 'struct',
    [vscode.SymbolKind.Event]: 'event',
    [vscode.SymbolKind.Operator]: 'operator',
    [vscode.SymbolKind.TypeParameter]: 'type_parameter',
};

/**
 * 符号信息
 */
interface SymbolInfo {
    name: string;
    kind: string;
    line: number;        // 1-based
    endLine: number;     // 1-based
    detail?: string;
    children?: SymbolInfo[];
}

/**
 * 单个文件的符号结果
 */
interface FileSymbolResult {
    path: string;
    success: boolean;
    symbolCount?: number;
    symbols?: SymbolInfo[];
    error?: string;
}

/**
 * 将 VSCode DocumentSymbol 转换为简化的符号信息
 */
function convertDocumentSymbol(symbol: vscode.DocumentSymbol): SymbolInfo {
    const info: SymbolInfo = {
        name: symbol.name,
        kind: SymbolKindNames[symbol.kind] || 'unknown',
        line: symbol.range.start.line + 1,
        endLine: symbol.range.end.line + 1,
    };
    
    if (symbol.detail) {
        info.detail = symbol.detail;
    }
    
    if (symbol.children && symbol.children.length > 0) {
        info.children = symbol.children.map(convertDocumentSymbol);
    }
    
    return info;
}

/**
 * 将 VSCode SymbolInformation 转换为简化的符号信息
 */
function convertSymbolInformation(symbol: vscode.SymbolInformation): SymbolInfo {
    return {
        name: symbol.name,
        kind: SymbolKindNames[symbol.kind] || 'unknown',
        line: symbol.location.range.start.line + 1,
        endLine: symbol.location.range.end.line + 1,
    };
}

/**
 * 获取单个文件的符号
 */
async function getSymbolsForFile(filePath: string): Promise<FileSymbolResult> {
    const uri = resolveUri(filePath);
    if (!uri) {
        return {
            path: filePath,
            success: false,
            error: 'Could not resolve file path. Make sure a workspace is open.'
        };
    }
    
    try {
        // 使用 VSCode 的 executeDocumentSymbolProvider 命令
        const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
            'vscode.executeDocumentSymbolProvider',
            uri
        );
        
        if (!symbols || symbols.length === 0) {
            return {
                path: filePath,
                success: true,
                symbolCount: 0,
                symbols: []
            };
        }
        
        // 转换符号
        let convertedSymbols: SymbolInfo[];
        
        // 检查是 DocumentSymbol 还是 SymbolInformation
        if ('children' in symbols[0] || 'range' in symbols[0]) {
            // DocumentSymbol (更新的格式，有层级结构)
            convertedSymbols = (symbols as vscode.DocumentSymbol[]).map(convertDocumentSymbol);
        } else {
            // SymbolInformation (旧格式，扁平结构)
            convertedSymbols = (symbols as vscode.SymbolInformation[]).map(convertSymbolInformation);
        }
        
        return {
            path: filePath,
            success: true,
            symbolCount: countSymbols(convertedSymbols),
            symbols: convertedSymbols
        };
    } catch (error) {
        return {
            path: filePath,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

/**
 * 创建获取符号工具
 */
export function createGetSymbolsTool(): Tool {
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    let description = `Get all symbols (classes, functions, variables, etc.) in one or more files. This is useful for:
- Understanding file structure before reading specific sections
- Finding the line numbers of functions/classes you want to examine
- Getting an overview of multiple files without reading all content

Returns hierarchical symbol list with name, kind, and line numbers.`;
    
    // 数组格式强调说明
    const arrayFormatNote = '\n\n**IMPORTANT**: The `paths` parameter MUST be an array, even for a single file. Example: `{"paths": ["file.ts"]}`, NOT `{"path": "file.ts"}`.';
    description += arrayFormatNote;
    
    if (isMultiRoot) {
        description += '\n\nMulti-root workspace: Use "workspace_name/path" format to specify the workspace.';
    }
    
    let pathsDescription = 'Array of file paths (relative to workspace root). MUST be an array even for single file, e.g., ["file.ts"]';
    if (isMultiRoot) {
        pathsDescription = `Array of file paths, use "workspace_name/path" format. MUST be an array even for single file. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }
    
    return {
        declaration: {
            name: 'get_symbols',
            description,
            category: 'lsp',
            parameters: {
                type: 'object',
                properties: {
                    paths: {
                        type: 'array',
                        items: {
                            type: 'string'
                        },
                        description: pathsDescription
                    }
                },
                required: ['paths']
            }
        },
        handler: async (args, context): Promise<ToolResult> => {
            const pathList = args.paths as string[];
            
            if (!pathList || !Array.isArray(pathList) || pathList.length === 0) {
                return { success: false, error: 'paths is required and must be a non-empty array' };
            }
            
            const results: FileSymbolResult[] = [];
            let successCount = 0;
            let failCount = 0;
            let totalSymbolCount = 0;
            
            for (const filePath of pathList) {
                const result = await getSymbolsForFile(filePath);
                results.push(result);
                
                if (result.success) {
                    successCount++;
                    totalSymbolCount += result.symbolCount || 0;
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
                    totalCount: pathList.length,
                    totalSymbolCount
                },
                error: allSuccess ? undefined : `${failCount} file(s) failed to get symbols`
            };
        }
    };
}

/**
 * 递归计算符号总数
 */
function countSymbols(symbols: SymbolInfo[]): number {
    let count = symbols.length;
    for (const symbol of symbols) {
        if (symbol.children) {
            count += countSymbols(symbol.children);
        }
    }
    return count;
}

/**
 * 注册获取符号工具
 */
export function registerGetSymbols(): Tool {
    return createGetSymbolsTool();
}
