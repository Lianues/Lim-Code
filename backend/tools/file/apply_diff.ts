/**
 * Apply Diff 工具 - 精确搜索替换文件内容
 * 支持多工作区（Multi-root Workspaces）
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { Tool, ToolResult } from '../types';
import { getDiffManager } from './diffManager';
import { resolveUriWithInfo, getAllWorkspaces } from '../utils';
import { getDiffStorageManager } from '../../modules/conversation';

/**
 * 单个 diff 块
 */
interface DiffBlock {
    /** 要搜索的内容（必须 100% 精确匹配） */
    search: string;
    /** 替换后的内容 */
    replace: string;
    /** 搜索起始行号（1-based，可选） */
    start_line?: number;
}

/**
 * 规范化换行符为 LF
 */
function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 应用单个 diff
 */
function applyDiffToContent(
    content: string,
    search: string,
    replace: string,
    startLine?: number
): { success: boolean; result: string; error?: string; matchCount: number; matchedLine?: number } {
    const normalizedContent = normalizeLineEndings(content);
    const normalizedSearch = normalizeLineEndings(search);
    const normalizedReplace = normalizeLineEndings(replace);
    
    // 如果提供了起始行号，从该行开始搜索
    if (startLine !== undefined && startLine > 0) {
        const lines = normalizedContent.split('\n');
        const startIndex = startLine - 1;
        
        if (startIndex >= lines.length) {
            return {
                success: false,
                result: normalizedContent,
                error: `Start line ${startLine} is out of range. File has ${lines.length} lines.`,
                matchCount: 0
            };
        }
        
        // 计算从起始行开始的字符位置
        let charOffset = 0;
        for (let i = 0; i < startIndex; i++) {
            charOffset += lines[i].length + 1;
        }
        
        // 从起始位置开始查找
        const contentFromStart = normalizedContent.substring(charOffset);
        const matchIndex = contentFromStart.indexOf(normalizedSearch);
        
        if (matchIndex === -1) {
            return {
                success: false,
                result: normalizedContent,
                error: `No exact match found starting from line ${startLine}.`,
                matchCount: 0
            };
        }
        
        // 计算实际匹配的行号
        const textBeforeMatch = normalizedContent.substring(0, charOffset + matchIndex);
        const actualMatchedLine = textBeforeMatch.split('\n').length;
        
        // 执行替换
        const result =
            normalizedContent.substring(0, charOffset + matchIndex) +
            normalizedReplace +
            normalizedContent.substring(charOffset + matchIndex + normalizedSearch.length);
        
        return {
            success: true,
            result,
            matchCount: 1,
            matchedLine: actualMatchedLine
        };
    }
    
    // 没有提供起始行号，计算匹配次数
    const matches = normalizedContent.split(normalizedSearch).length - 1;
    
    if (matches === 0) {
        return {
            success: false,
            result: normalizedContent,
            error: 'No exact match found. Please verify the content matches exactly.',
            matchCount: 0
        };
    }
    
    if (matches > 1) {
        return {
            success: false,
            result: normalizedContent,
            error: `Multiple matches found (${matches}). Please provide 'start_line' parameter to specify which match to use.`,
            matchCount: matches
        };
    }
    
    // 计算实际匹配的行号
    const matchIndex = normalizedContent.indexOf(normalizedSearch);
    const textBeforeMatch = normalizedContent.substring(0, matchIndex);
    const actualMatchedLine = textBeforeMatch.split('\n').length;
    
    // 精确替换
    const result = normalizedContent.replace(normalizedSearch, normalizedReplace);
    
    return {
        success: true,
        result,
        matchCount: 1,
        matchedLine: actualMatchedLine
    };
}

/**
 * 创建 apply_diff 工具
 */
export function createApplyDiffTool(): Tool {
    // 获取工作区信息
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    // 根据工作区数量生成描述
    let pathDescription = 'Path to the file (relative to workspace root)';
    let descriptionSuffix = '';
    
    if (isMultiRoot) {
        pathDescription = `Path to the file, must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
        descriptionSuffix = `\n\nMulti-root workspace: Must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
    }
    
    return {
        declaration: {
            name: 'apply_diff',
            category: 'file',
            description: `Apply precise search-and-replace diff(s) to a file. The search content must match EXACTLY (including whitespace and indentation).

Parameters:
- path: Path to the file (relative to workspace root)
- diffs: Array of diff objects to apply

Each diff object contains:
- search: The exact content to search for (must match 100%)
- replace: The content to replace with
- start_line: (REQUIRED) The line number (1-based) where search content starts in the original file

Important:
- The 'search' content must match EXACTLY (100% match required)
- The 'start_line' parameter is REQUIRED for accurate diff positioning
- Include enough context to make the search unique
- Diffs are applied in order
- If any diff fails, the entire operation is rolled back

**IMPORTANT**: The \`diffs\` parameter MUST be an array, even for a single diff. Example: \`{"path": "file.txt", "diffs": [{"search": "...", "replace": "...", "start_line": 1}]}\`${descriptionSuffix}`,
            
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: pathDescription
                    },
                    diffs: {
                        type: 'array',
                        description: 'Array of diff objects to apply. MUST be an array even for a single diff.',
                        items: {
                            type: 'object',
                            properties: {
                                search: {
                                    type: 'string',
                                    description: 'The exact content to search for'
                                },
                                replace: {
                                    type: 'string',
                                    description: 'The content to replace with'
                                },
                                start_line: {
                                    type: 'number',
                                    description: 'Line number (1-based) where search content starts in the original file (REQUIRED)'
                                }
                            },
                            required: ['search', 'replace', 'start_line']
                        }
                    }
                },
                required: ['path', 'diffs']
            }
        },
        handler: async (args): Promise<ToolResult> => {
            const filePath = args.path as string;
            const diffs = args.diffs as DiffBlock[] | undefined;
            
            if (!filePath || typeof filePath !== 'string') {
                return { success: false, error: 'Path is required' };
            }
            
            if (!diffs || !Array.isArray(diffs) || diffs.length === 0) {
                return { success: false, error: 'Diffs array is required and must not be empty' };
            }
            
            const { uri, workspace } = resolveUriWithInfo(filePath);
            if (!uri) {
                return { success: false, error: 'No workspace folder open' };
            }
            
            const absolutePath = uri.fsPath;
            if (!fs.existsSync(absolutePath)) {
                return { success: false, error: `File not found: ${filePath}` };
            }
            
            try {
                const originalContent = fs.readFileSync(absolutePath, 'utf8');
                let currentContent = originalContent;
                
                // 记录每个 diff 的应用结果
                const diffResults: Array<{
                    index: number;
                    success: boolean;
                    error?: string;
                    matchedLine?: number;
                }> = [];
                
                // 依次尝试应用每个 diff
                for (let i = 0; i < diffs.length; i++) {
                    const diff = diffs[i];
                    
                    if (!diff.search || diff.replace === undefined) {
                        diffResults.push({
                            index: i,
                            success: false,
                            error: `Diff at index ${i} is missing 'search' or 'replace' field`
                        });
                        continue;
                    }
                    
                    const result = applyDiffToContent(currentContent, diff.search, diff.replace, diff.start_line);
                    
                    diffResults.push({
                        index: i,
                        success: result.success,
                        error: result.error,
                        matchedLine: result.matchedLine
                    });
                    
                    if (result.success) {
                        currentContent = result.result;
                    }
                }
                
                const appliedCount = diffResults.filter(r => r.success).length;
                const failedCount = diffResults.length - appliedCount;
                
                // 收集失败的 diff 信息供 AI 参考
                const failedDiffs = diffResults
                    .filter(r => !r.success)
                    .map(r => ({
                        index: r.index,
                        error: r.error
                    }));
                
                // 如果没有任何一个 diff 成功应用，则返回失败
                if (appliedCount === 0 && diffs.length > 0) {
                    const firstError = diffResults.find(r => !r.success)?.error || 'All diffs failed';
                    return {
                        success: false,
                        error: `Failed to apply any diffs: ${firstError}`,
                        data: {
                            file: filePath,
                            message: `Failed to apply any diffs to ${filePath}.`,
                            // 包含失败详情供 AI 修复
                            failedDiffs,
                            appliedCount: 0,
                            totalCount: diffs.length,
                            failedCount: diffs.length
                        }
                    };
                }
                
                // 至少有一个 diff 成功应用，创建待审阅的 diff
                const diffManager = getDiffManager();
                const pendingDiff = await diffManager.createPendingDiff(
                    filePath,
                    absolutePath,
                    originalContent,
                    currentContent
                );

                // 尝试将大内容保存到 DiffStorageManager
                const diffStorageManager = getDiffStorageManager();
                let diffContentId: string | undefined;

                if (diffStorageManager) {
                    try {
                        const diffRef = await diffStorageManager.saveGlobalDiff({
                            originalContent,
                            newContent: currentContent,
                            filePath
                        });
                        diffContentId = diffRef.diffId;
                    } catch (e) {
                        console.warn('Failed to save diff content to storage:', e);
                    }
                }

                // 等待 diff 被处理（保存或拒绝）或用户中断
                const wasInterrupted = await new Promise<boolean>((resolve) => {
                    const checkStatus = () => {
                        // 检查用户中断
                        if (diffManager.isUserInterrupted()) {
                            resolve(true);
                            return;
                        }

                        const diff = diffManager.getDiff(pendingDiff.id);
                        if (!diff || diff.status !== 'pending') {
                            resolve(false);
                        } else {
                            setTimeout(checkStatus, 100);
                        }
                    };
                    checkStatus();
                });

                // 获取最终状态
                const finalDiff = diffManager.getDiff(pendingDiff.id);
                const wasAccepted = !wasInterrupted && (!finalDiff || finalDiff.status === 'accepted');

                // 检查用户是否编辑了内容
                const userEditedContent = finalDiff?.userEditedContent;

                if (wasInterrupted) {
                    // 用户中断，返回 pending 状态
                    return {
                        success: true,
                        data: {
                            file: filePath,
                            message: failedCount === 0
                                ? `Diff for ${filePath} is still pending. User may not have reviewed/saved the changes yet.`
                                : `Applied ${appliedCount}/${diffs.length} diffs for ${filePath}, but ${failedCount} failed. Still pending user review.`,
                            status: 'pending',
                            diffCount: diffs.length,
                            appliedCount: appliedCount,
                            failedCount: failedCount,
                            failedDiffs: failedDiffs.length > 0 ? failedDiffs : undefined,
                            diffContentId,
                            pendingDiffId: pendingDiff.id
                        }
                    };
                }

                // 完成，返回最终状态
                let message = wasAccepted
                    ? `Diff applied and saved to ${filePath}`
                    : `Diff was rejected for ${filePath}`;

                if (wasAccepted && failedCount > 0) {
                    message = `Partially applied diffs to ${filePath}: ${appliedCount} succeeded, ${failedCount} failed. Saved successfully.`;
                }

                if (wasAccepted && userEditedContent) {
                    message += `\n\n[USER EDIT] The user modified the AI-suggested content before saving. User's final content:\n${userEditedContent}`;
                }

                return {
                    success: wasAccepted,
                    data: {
                        file: filePath,
                        message,
                        status: wasAccepted ? 'accepted' : 'rejected',
                        diffCount: diffs.length,
                        appliedCount: appliedCount,
                        failedCount: failedCount,
                        failedDiffs: failedDiffs.length > 0 ? failedDiffs : undefined,
                        userEditedContent: userEditedContent,
                        diffContentId
                    }
                };
            } catch (error) {
                return {
                    success: false,
                    error: `Failed to apply diff: ${error instanceof Error ? error.message : String(error)}`
                };
            }
        }
    };
}

/**
 * 注册 apply_diff 工具
 */
export function registerApplyDiff(): Tool {
    return createApplyDiffTool();
}