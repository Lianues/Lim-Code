/**
 * 写入文件工具
 *
 * 支持写入单个或多个文件
 * 支持多工作区（Multi-root Workspaces）
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { Tool, ToolResult } from '../types';
import { resolveUriWithInfo, getAllWorkspaces } from '../utils';
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
    /** 前端按需加载 diff 内容用 */
    diffContentId?: string;
    /** 用户编辑后的内容（仅当用户修改了 AI 建议时存在） */
    userEditedContent?: string;
    /** 消息（包含用户编辑说明等） */
    message?: string;
    /** pending diff ID */
    pendingDiffId?: string;
}

/**
 * 写入单个文件
 * @param entry 文件条目
 * @param isMultiRoot 是否是多工作区模式
 * 始终等待 diff 被处理（保存或拒绝）
 */
async function writeSingleFile(entry: WriteFileEntry, isMultiRoot: boolean): Promise<WriteResult> {
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
            originalContent = new TextDecoder().decode(contentBytes);
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
        const pendingDiff = await diffManager.createPendingDiff(
            filePath,
            absolutePath,
            originalContent,
            content
        );

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
        
        const finalDiff = diffManager.getDiff(pendingDiff.id);
        const wasAccepted = !wasInterrupted && (!finalDiff || finalDiff.status === 'accepted');
        
        // 检查用户是否编辑了内容
        const userEditedContent = finalDiff?.userEditedContent;
        
        if (wasInterrupted) {
            return {
                path: filePath,
                success: true,  // 用户主动中断，不算失败
                action: fileExists ? 'modified' : 'created',
                status: 'pending',
                diffContentId,
                pendingDiffId: pendingDiff.id
            };
        }
        
        // 构建消息，如果用户编辑了内容则包含在返回中
        let message: string | undefined;
        if (wasAccepted && userEditedContent) {
            message = `[USER EDIT] The user modified the AI-suggested content before saving. User's final content:\n${userEditedContent}`;
        }
        
        return {
            path: filePath,
            success: wasAccepted,
            action: fileExists ? 'modified' : 'created',
            status: wasAccepted ? 'accepted' : 'rejected',
            error: wasAccepted ? undefined : 'Diff was rejected',
            diffContentId,
            userEditedContent,
            message
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
    
    // 数组格式强调说明
    const arrayFormatNote = '\n\n**IMPORTANT**: The `files` parameter MUST be an array, even for a single file. Example: `{"files": [{"path": "file.txt", "content": "..."}]}`, NOT `{"path": "file.txt", "content": "..."}`.';
    
    // 根据工作区数量生成描述
    let description = 'Write content to one or more files. A Diff preview will be shown for user confirmation regardless of whether the file exists. For new files, a full content diff preview will be shown. Supports auto-save or manual review mode (configured in settings).' + arrayFormatNote;
    let pathDescription = 'File path (relative to workspace root)';
    
    if (isMultiRoot) {
        description += `\n\nMulti-root workspace: Must use "workspace_name/path" format. Available workspaces: ${workspaces.map(w => w.name).join(', ')}`;
        pathDescription = `File path, must use "workspace_name/path" format`;
    }
    
    return {
        declaration: {
            name: 'write_file',
            description,
            category: 'file',
            parameters: {
                type: 'object',
                properties: {
                    files: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                path: {
                                    type: 'string',
                                    description: pathDescription
                                },
                                content: {
                                    type: 'string',
                                    description: 'The content to write to the file'
                                }
                            },
                            required: ['path', 'content']
                        },
                        description: 'Array of files to write, each element containing path and content. MUST be an array even for single file.'
                    }
                },
                required: ['files']
            }
        },
        handler: async (args): Promise<ToolResult> => {
            const fileList = args.files as WriteFileEntry[] | undefined;
            
            if (!fileList || !Array.isArray(fileList) || fileList.length === 0) {
                return { success: false, error: 'files is required' };
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

            for (const entry of fileList) {
                const result = await writeSingleFile(entry, isMultiRoot);
                results.push(result);
                
                if (result.success) {
                    successCount++;
                    if (result.action === 'created') createdCount++;
                    else if (result.action === 'modified') modifiedCount++;
                    else if (result.action === 'unchanged') unchangedCount++;
                } else {
                    failCount++;
                }
            }

            const allSuccess = failCount === 0;
            
            // 简化返回：AI 已经知道写入的内容，只需要知道结果
            return {
                success: allSuccess,
                data: {
                    results,
                    successCount,
                    failCount,
                    totalCount: fileList.length
                },
                error: allSuccess ? undefined : `${failCount} files failed to write`
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