/**
 * 写入文件工具
 *
 * 支持写入单个文件
 * 支持多工作区（Multi-root Workspaces）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { Tool, ToolResult, ToolContext } from '../types';
import { resolveUriWithInfo, getAllWorkspaces, normalizeLineEndingsToLF } from '../utils';
import { getDiffManager } from './diffManager';
import { getDiffStorageManager } from '../../modules/conversation';

/**
 * 单个文件写入配置
 */
interface WriteFileEntry {
    path: string;
    content: string;
}

/**
 * 单个文件写入结果
 * 简化版：AI 已经知道写入的内容，不需要重复返回
 */
interface WriteResult {
    path: string;
    success: boolean;
    action?: 'created' | 'modified' | 'unchanged';
    status?: 'accepted' | 'rejected' | 'pending';
    error?: string;
    /** 是否被用户取消（终止/中断） */
    cancelled?: boolean;
    /** 前端按需加载 diff 内容用 */
    diffContentId?: string;
    /**
     * 自动保存失败原因。
     * 为什么新增：DiffManager 现在会在 autoSave 失败时终结 pending diff，并把失败原因传回工具结果。
     * 怎么改：在写文件结果类型中允许该字段，避免运行时代码和 TypeScript 契约不一致。
     * 目的：让自动确认失败能明确显示原因，同时不再卡住等待链路。
     */
    autoSaveError?: string;
    /** Pending diff ID，用于确认/拒绝（历史字段，尽量避免再依赖） */
    pendingDiffId?: string;
}

/**
 * 写入单个文件
 * @param entry 文件条目
 * @param isMultiRoot 是否是多工作区模式
 * @param toolId 工具调用 ID
 * 始终等待 diff 被处理（保存或拒绝）
 */
async function writeSingleFile(
    entry: WriteFileEntry,
    isMultiRoot: boolean,
    toolId?: string,
    abortSignal?: AbortSignal
): Promise<WriteResult> {
    const { path: filePath, content } = entry;
    
    const { uri, workspace } = resolveUriWithInfo(filePath);
    if (!uri) {
        return {
            path: filePath,
            success: false,
            error: 'No workspace folder open'
        };
    }

    const absolutePath = uri.fsPath;
    const workspaceName = isMultiRoot ? workspace?.name : undefined;

    try {
        // 检查文件是否存在并获取原始内容
        let originalContent = '';
        let fileExists = false;
        
        try {
            await vscode.workspace.fs.stat(uri);
            fileExists = true;
            const contentBytes = await vscode.workspace.fs.readFile(uri);
            originalContent = normalizeLineEndingsToLF(new TextDecoder().decode(contentBytes));
        } catch {
            // 文件不存在，原始内容为空
            fileExists = false;
            originalContent = '';
        }

        // 如果内容相同，无需修改
        if (originalContent === content) {
            return {
                path: filePath,
                success: true,
                action: 'unchanged'
            };
        }

        // 如果文件不存在，需要先创建目录
        if (!fileExists) {
            const dirPath = path.dirname(absolutePath);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            // 创建空文件以便 DiffManager 可以操作
            fs.writeFileSync(absolutePath, '', 'utf8');
        }

        // 使用 DiffManager 创建待审阅的 diff
        const diffManager = getDiffManager();
        
        // 计算新内容的行数，作为一个完整的 block
        const newContentLines = content.split('\n').length;
        const blocks = [{
            index: 0,
            startLine: 1,
            endLine: newContentLines
        }];
        
        const pendingDiff = await diffManager.createPendingDiff(
            filePath,
            absolutePath,
            originalContent,
            content,
            blocks,  // 传递 blocks 信息以启用 CodeLens 和 inline decorations
            undefined,  // diffs
            toolId  // 传递 toolId 以便前端跟踪
        );

        // 等待 diff 被处理（保存或拒绝）或用户中断/取消
        const interruptReason = await new Promise<'none' | 'abort' | 'user'>((resolve) => {
            let resolved = false;

            const finish = (reason: 'none' | 'abort' | 'user') => {
                if (resolved) return;
                resolved = true;
                if (abortHandler && abortSignal) {
                    try {
                        abortSignal.removeEventListener('abort', abortHandler);
                    } catch {
                        // ignore
                    }
                }
                resolve(reason);
            };

            const abortHandler = () => {
                diffManager.rejectDiff(pendingDiff.id).catch(() => {});
                finish('abort');
            };

            if (abortSignal) {
                if (abortSignal.aborted) {
                    abortHandler();
                    return;
                }
                abortSignal.addEventListener('abort', abortHandler, { once: true } as any);
            }

            const checkStatus = () => {
                // 检查用户中断
                if (diffManager.isUserInterrupted()) {
                    diffManager.rejectDiff(pendingDiff.id).catch(() => {});
                    finish('user');
                    return;
                }

                const diff = diffManager.getDiff(pendingDiff.id);
                if (!diff || diff.status !== 'pending') {
                    finish('none');
                } else {
                    setTimeout(checkStatus, 100);
                }
            };
            checkStatus();
        });

        const wasInterrupted = interruptReason !== 'none';
        
        const finalDiff = diffManager.getDiff(pendingDiff.id);
        const wasAccepted = !wasInterrupted && (!finalDiff || finalDiff.status === 'accepted');
        const autoSaveError = finalDiff?.autoSaveError;

        // 尝试将内容保存到 DiffStorageManager，供前端按需加载
        const diffStorageManager = getDiffStorageManager();
        let diffContentId: string | undefined;
        
        if (diffStorageManager) {
            try {
                const diffRef = await diffStorageManager.saveGlobalDiff({
                    originalContent,
                    newContent: content,
                    filePath
                });
                diffContentId = diffRef.diffId;
            } catch (e) {
                console.warn('Failed to save diff content to storage:', e);
            }
        }
        
        if (wasInterrupted) {
            // 用户终止/中断，视为取消
            return {
                path: filePath,
                success: false,
                cancelled: true,
                action: fileExists ? 'modified' : 'created',
                status: 'rejected',
                error: interruptReason === 'abort'
                    ? 'Write was cancelled by user'
                    : 'Write was interrupted by user',
                diffContentId
            };
        }
        
        // 简化返回：AI 已经知道写入的内容，不需要重复返回
        return {
            path: filePath,
            success: wasAccepted,
            action: fileExists ? 'modified' : 'created',
            status: wasAccepted ? 'accepted' : 'rejected',
            error: wasAccepted ? undefined : (autoSaveError || 'Diff was rejected'),
            autoSaveError,
            diffContentId
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
 * 创建写入文件工具
 * 使用 DiffManager 来管理文件修改的审阅流程
 */
export function createWriteFileTool(): Tool {
    // 获取工作区信息
    const workspaces = getAllWorkspaces();
    const isMultiRoot = workspaces.length > 1;
    
    // 根据工作区数量生成描述
    let description = `写入内容到一个文件。若文件不存在则创建；若文件已存在则用 content 覆盖其完整内容。执行前会展示 Diff 预览并等待用户确认。

适用场景：
- 创建新文件
- 重写一个已有文件的完整内容

注意：path 是相对于工作区根目录的路径；content 必须是文件的完整目标内容。修改大文件时，优先考虑 apply_diff，避免整文件重写带来的误删风险。`;
    let pathDescription = '文件路径，相对于当前工作区根目录。例如：docs/example.md。';
    
    if (isMultiRoot) {
        description += `\n\n多根工作区：path 必须使用 "workspace_name/path" 格式。可用工作区：${workspaces.map(w => w.name).join(', ')}。`;
        pathDescription = `文件路径。当前是多根工作区，必须使用 "workspace_name/path" 格式。可用工作区：${workspaces.map(w => w.name).join(', ')}。`;
    }
    
    return {
        declaration: {
            name: 'write_file',
            strict: true,  // API 端强制 schema 校验
            description,
            category: 'file',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: pathDescription
                    },
                    content: {
                        type: 'string',
                        description: '要写入文件的完整内容。已有文件会被该内容整体覆盖。'
                    }
                },
                required: ['path', 'content']
            }
        },
        handler: async (args, context?: ToolContext): Promise<ToolResult> => {
            const entry: WriteFileEntry = {
                path: args.path as string,
                content: args.content as string
            };
            if (typeof entry.path !== 'string' || entry.path.trim() === '') {
                return { success: false, error: 'path is required' };
            }
            if (typeof entry.content !== 'string') {
                return { success: false, error: 'content is required' };
            }
            
            // 获取工作区信息
            const workspaces = getAllWorkspaces();
            const isMultiRoot = workspaces.length > 1;

            const diffManager = getDiffManager();
            const settings = diffManager.getSettings();

            const results: WriteResult[] = [];
            let successCount = 0;
            let failCount = 0;
            let createdCount = 0;
            let modifiedCount = 0;
            let unchangedCount = 0;

            const result = await writeSingleFile(entry, isMultiRoot, context?.toolId, context?.abortSignal);
            results.push(result);

            if (result.success) {
                successCount++;
                if (result.action === 'created') createdCount++;
                else if (result.action === 'modified') modifiedCount++;
                else if (result.action === 'unchanged') unchangedCount++;
            } else {
                failCount++;
            }

            const anyCancelled = results.some(r => r.cancelled);
            const allSuccess = failCount === 0 && !anyCancelled;
            
            // 简化返回：AI 已经知道写入的内容，只需要知道结果
            return {
                success: allSuccess,
                cancelled: anyCancelled,
                data: {
                    results,
                    successCount,
                    failCount,
                    totalCount: 1
                },
                error: anyCancelled
                    ? 'Write was cancelled by user'
                    : (allSuccess ? undefined : `${failCount} file failed to write`)
            };
        }
    };
}

/**
 * 注册写入文件工具
 */
export function registerWriteFile(): Tool {
    return createWriteFileTool();
}