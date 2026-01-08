/**
 * 跳转到定义工具
 *
 * 使用 VSCode LSP 查找符号的定义位置，并直接返回完整的定义代码
 */

import * as vscode from 'vscode';
import type { Tool, ToolResult } from '../types';
import { resolveUri, getAllWorkspaces } from '../utils';

/**
 * 定义位置信息
 */
interface DefinitionLocation {
    path: string;
    line: number;       // 1-based
    endLine: number;    // 1-based
    content: string;    // 定义处的代码内容（带行号）
    lineCount: number;  // 返回的代码行数
}

/**
 * 创建跳转到定义工具
 */
export function createGotoDefinitionTool(): Tool {
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    let description = `Go to the definition of a symbol and return the complete definition code. This is useful for:
- Finding where a function/class/variable is defined and seeing its full implementation
- Understanding how a symbol is implemented without additional read_file calls

Returns the complete definition code with line numbers.`;
    
    if (isMultiRoot) {
        description += '\n\nMulti-root workspace: Use "workspace_name/path" format to specify the workspace.';
    }
    
    let pathDescription = 'File path (relative to workspace root)';
    if (isMultiRoot) {
        pathDescription = `File path, use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }
    
    return {
        declaration: {
            name: 'goto_definition',
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
                        description: 'The symbol name to find (optional, for documentation purposes)'
                    }
                },
                required: ['path', 'line']
            }
        },
        handler: async (args, context): Promise<ToolResult> => {
            const filePath = args.path as string;
            const line = args.line as number;
            const column = (args.column as number) || 1;
            const symbolName = args.symbol as string | undefined;
            
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
                
                // 使用 VSCode 的 executeDefinitionProvider 命令
                const definitions = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
                    'vscode.executeDefinitionProvider',
                    uri,
                    position
                );
                
                if (!definitions || definitions.length === 0) {
                    return {
                        success: true,
                        data: {
                            path: filePath,
                            line,
                            column,
                            symbol: symbolName,
                            definitions: [],
                            message: 'No definition found. The symbol may not have a definition, or no language server is available.'
                        }
                    };
                }
                
                // 转换定义位置并获取完整定义代码
                const convertedDefinitions: DefinitionLocation[] = [];
                
                for (const def of definitions) {
                    let targetUri: vscode.Uri;
                    let targetRange: vscode.Range;
                    
                    if ('targetUri' in def) {
                        // LocationLink
                        targetUri = def.targetUri;
                        targetRange = def.targetRange;
                    } else {
                        // Location
                        targetUri = def.uri;
                        targetRange = def.range;
                    }
                    
                    // 获取相对路径
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
                    let relativePath: string;
                    if (workspaceFolder) {
                        relativePath = vscode.workspace.asRelativePath(targetUri, isMultiRoot);
                    } else {
                        relativePath = targetUri.fsPath;
                    }
                    
                    // 读取完整定义代码
                    try {
                        const doc = await vscode.workspace.openTextDocument(targetUri);
                        
                        // 使用 LSP 返回的定义范围
                        let startLine = targetRange.start.line;  // 0-based
                        let endLine = targetRange.end.line;      // 0-based
                        
                        // 如果定义范围太小（可能只是符号名称），尝试扩展到完整的代码块
                        // 通过查找匹配的括号来确定完整范围
                        if (endLine - startLine < 2) {
                            const expandedEnd = findBlockEnd(doc, startLine);
                            if (expandedEnd > endLine) {
                                endLine = expandedEnd;
                            }
                        }
                        
                        // 确保不超过文件范围
                        const totalLines = doc.lineCount;
                        if (endLine >= totalLines) {
                            endLine = totalLines - 1;
                        }
                        
                        // 提取代码并添加行号
                        const lines: string[] = [];
                        for (let i = startLine; i <= endLine; i++) {
                            const lineText = doc.lineAt(i).text;
                            const lineNum = i + 1; // 转换为 1-based
                            lines.push(`${lineNum.toString().padStart(4)} | ${lineText}`);
                        }
                        
                        convertedDefinitions.push({
                            path: relativePath,
                            line: startLine + 1,     // 1-based
                            endLine: endLine + 1,    // 1-based
                            content: lines.join('\n'),
                            lineCount: lines.length
                        });
                    } catch (e) {
                        // 无法读取文件，返回基本信息
                        convertedDefinitions.push({
                            path: relativePath,
                            line: targetRange.start.line + 1,
                            endLine: targetRange.end.line + 1,
                            content: '(Unable to read file content)',
                            lineCount: 0
                        });
                    }
                }
                
                return {
                    success: true,
                    data: {
                        path: filePath,
                        line,
                        column,
                        symbol: symbolName,
                        definitionCount: convertedDefinitions.length,
                        definitions: convertedDefinitions
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
 * 查找代码块的结束位置
 * 通过跟踪括号匹配来确定函数/类的完整范围
 */
function findBlockEnd(doc: vscode.TextDocument, startLine: number): number {
    let braceCount = 0;
    let foundOpenBrace = false;
    const totalLines = doc.lineCount;
    
    for (let i = startLine; i < totalLines; i++) {
        const lineText = doc.lineAt(i).text;
        
        for (const char of lineText) {
            if (char === '{') {
                braceCount++;
                foundOpenBrace = true;
            } else if (char === '}') {
                braceCount--;
                if (foundOpenBrace && braceCount === 0) {
                    return i;
                }
            }
        }
        
        // 防止无限循环，最多查找 500 行
        if (i - startLine > 500) {
            break;
        }
    }
    
    // 如果没找到匹配的括号，返回起始行
    return startLine;
}

/**
 * 注册跳转到定义工具
 */
export function registerGotoDefinition(): Tool {
    return createGotoDefinitionTool();
}
