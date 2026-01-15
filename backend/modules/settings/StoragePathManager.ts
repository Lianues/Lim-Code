/**
 * LimCode - 存储路径管理器
 *
 * 负责管理自定义数据存储路径和数据迁移
 * 支持将大文件（对话历史、检查点、依赖等）存储到用户自定义目录
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { SettingsManager } from './SettingsManager';
import type { StorageStats } from './types';

/**
 * 存储路径管理器
 */
export class StoragePathManager {
    private defaultDataPath: string;
    
    constructor(
        private settingsManager: SettingsManager,
        private context: vscode.ExtensionContext
    ) {
        // 默认路径是 globalStorageUri
        this.defaultDataPath = context.globalStorageUri.fsPath;
    }
    
    /**
     * 获取有效的数据存储路径
     * 如果设置了自定义路径且迁移完成，返回自定义路径
     * 否则返回默认路径
     */
    getEffectiveDataPath(): string {
        const config = this.settingsManager.getStoragePathConfig();
        
        // 只有迁移完成后才使用自定义路径
        if (config.customDataPath && config.migrationStatus === 'completed') {
            return config.customDataPath;
        }
        
        return this.defaultDataPath;
    }
    
    /**
     * 获取默认数据存储路径
     */
    getDefaultDataPath(): string {
        return this.defaultDataPath;
    }
    
    /**
     * 获取对话历史存储目录
     */
    getConversationsPath(): string {
        return path.join(this.getEffectiveDataPath(), 'conversations');
    }
    
    /**
     * 获取检查点存储目录
     */
    getCheckpointsPath(): string {
        return path.join(this.getEffectiveDataPath(), 'checkpoints');
    }
    
    /**
     * 获取 MCP 配置存储目录
     */
    getMcpPath(): string {
        return path.join(this.getEffectiveDataPath(), 'mcp');
    }
    
    /**
     * 获取依赖存储目录
     */
    getDependenciesPath(): string {
        return path.join(this.getEffectiveDataPath(), 'dependencies');
    }
    
    /**
     * 获取存储目录的 URI（用于 FileSystemStorageAdapter）
     */
    getEffectiveDataUri(): string {
        return vscode.Uri.file(this.getEffectiveDataPath()).toString();
    }
    
    /**
     * 获取 Diff 存储目录
     */
    getDiffsPath(): string {
        return path.join(this.getEffectiveDataPath(), 'diffs');
    }
    
    /**
     * 确保所有存储目录存在
     * 注意：settings 目录只在默认路径创建，不在自定义路径创建
     */
    async ensureDirectories(): Promise<void> {
        const basePath = this.getEffectiveDataPath();
        const dirs = [
            basePath,
            path.join(basePath, 'conversations'),
            path.join(basePath, 'snapshots'),
            path.join(basePath, 'checkpoints'),
            path.join(basePath, 'mcp'),
            path.join(basePath, 'dependencies'),
            path.join(basePath, 'diffs')
        ];
        
        // settings 目录只在默认路径创建
        if (basePath === this.defaultDataPath) {
            dirs.push(path.join(basePath, 'settings'));
        }
        
        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }
    }
    
    /**
     * 验证路径是否可用（可写入）
     */
    async validatePath(targetPath: string): Promise<{ valid: boolean; error?: string }> {
        try {
            // 检查路径是否存在
            try {
                await fs.access(targetPath);
            } catch {
                // 路径不存在，尝试创建
                await fs.mkdir(targetPath, { recursive: true });
            }
            
            // 检查是否可写
            const testFile = path.join(targetPath, '.limcode-test');
            await fs.writeFile(testFile, 'test');
            await fs.unlink(testFile);
            
            return { valid: true };
        } catch (error: any) {
            return {
                valid: false,
                error: error.message || 'Path is not writable'
            };
        }
    }
    
    /**
     * 计算目录大小
     */
    private async getDirectorySize(dirPath: string): Promise<{ size: number; count: number }> {
        let totalSize = 0;
        let fileCount = 0;
        
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                
                if (entry.isDirectory()) {
                    const subResult = await this.getDirectorySize(fullPath);
                    totalSize += subResult.size;
                    fileCount += subResult.count;
                } else if (entry.isFile()) {
                    try {
                        const stat = await fs.stat(fullPath);
                        totalSize += stat.size;
                        fileCount++;
                    } catch {
                        // 忽略无法访问的文件
                    }
                }
            }
        } catch {
            // 目录不存在或无法访问
        }
        
        return { size: totalSize, count: fileCount };
    }
    
    /**
     * 获取存储统计信息
     */
    async getStorageStats(targetPath?: string): Promise<StorageStats> {
        const basePath = targetPath || this.getEffectiveDataPath();
        
        const [conversations, checkpoints, mcp, dependencies, diffs] = await Promise.all([
            this.getDirectorySize(path.join(basePath, 'conversations')),
            this.getDirectorySize(path.join(basePath, 'checkpoints')),
            this.getDirectorySize(path.join(basePath, 'mcp')),
            this.getDirectorySize(path.join(basePath, 'dependencies')),
            this.getDirectorySize(path.join(basePath, 'diffs'))
        ]);
        
        const totalSize = conversations.size + checkpoints.size + mcp.size + dependencies.size + diffs.size;
        const fileCount = conversations.count + checkpoints.count + mcp.count + dependencies.count + diffs.count;
        
        return {
            path: basePath,
            totalSize,
            fileCount,
            subDirs: {
                conversations: conversations,
                checkpoints: checkpoints,
                mcp: mcp,
                dependencies: dependencies,
                diffs: diffs
            }
        };
    }
    
    /**
     * 复制目录（递归）
     */
    private async copyDirectory(src: string, dest: string, onProgress?: (copied: number, total: number) => void): Promise<number> {
        let copiedCount = 0;
        
        try {
            await fs.mkdir(dest, { recursive: true });
            const entries = await fs.readdir(src, { withFileTypes: true });
            
            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                
                if (entry.isDirectory()) {
                    copiedCount += await this.copyDirectory(srcPath, destPath, onProgress);
                } else if (entry.isFile()) {
                    await fs.copyFile(srcPath, destPath);
                    copiedCount++;
                    if (onProgress) {
                        onProgress(copiedCount, -1); // total unknown
                    }
                }
            }
        } catch (error) {
            console.warn(`[StoragePathManager] Failed to copy ${src}:`, error);
        }
        
        return copiedCount;
    }
    
    /**
     * 删除目录（递归）
     */
    private async removeDirectory(dirPath: string): Promise<void> {
        try {
            await fs.rm(dirPath, { recursive: true, force: true });
        } catch (error) {
            console.warn(`[StoragePathManager] Failed to remove ${dirPath}:`, error);
        }
    }
    
    /**
     * 迁移数据到新路径
     *
     * @param newPath 新的存储路径
     * @param onProgress 进度回调
     * @returns 迁移结果
     */
    async migrateData(
        newPath: string,
        onProgress?: (status: { phase: string; current: number; total: number }) => void
    ): Promise<{ success: boolean; error?: string; copiedFiles: number }> {
        const sourcePath = this.getEffectiveDataPath();
        
        // 如果源路径和目标路径相同，无需迁移
        if (path.normalize(sourcePath) === path.normalize(newPath)) {
            return { success: true, copiedFiles: 0 };
        }
        
        try {
            // 标记迁移开始
            await this.settingsManager.markMigrationStarted();
            
            // 验证目标路径
            const validation = await this.validatePath(newPath);
            if (!validation.valid) {
                await this.settingsManager.markMigrationFailed(validation.error || 'Path validation failed');
                return { success: false, error: validation.error, copiedFiles: 0 };
            }
            
            // 获取源目录统计
            const stats = await this.getStorageStats(sourcePath);
            const totalFiles = stats.fileCount;
            let copiedFiles = 0;
            
            // 要迁移的子目录
            const subDirs = ['conversations', 'snapshots', 'checkpoints', 'mcp', 'dependencies', 'diffs', 'skills'];
            
            for (let i = 0; i < subDirs.length; i++) {
                const subDir = subDirs[i];
                const srcDir = path.join(sourcePath, subDir);
                const destDir = path.join(newPath, subDir);
                
                if (onProgress) {
                    onProgress({
                        phase: `Copying ${subDir}...`,
                        current: copiedFiles,
                        total: totalFiles
                    });
                }
                
                // 检查源目录是否存在
                try {
                    await fs.access(srcDir);
                    const count = await this.copyDirectory(srcDir, destDir, (copied) => {
                        if (onProgress) {
                            onProgress({
                                phase: `Copying ${subDir}...`,
                                current: copiedFiles + copied,
                                total: totalFiles
                            });
                        }
                    });
                    copiedFiles += count;
                } catch {
                    // 源目录不存在，跳过
                }
            }
            
            // 更新配置：设置新路径并标记迁移完成
            await this.settingsManager.updateStoragePathConfig({
                customDataPath: newPath,
                migrationStatus: 'completed',
                lastMigrationAt: Date.now(),
                migrationError: undefined
            });
            
            if (onProgress) {
                onProgress({
                    phase: 'Cleaning up old storage...',
                    current: copiedFiles,
                    total: copiedFiles
                });
            }
            
            // 自动清理旧目录（只清理子目录，保留根目录和设置）
            await this.cleanupOldStorageInternal(sourcePath);
            
            if (onProgress) {
                onProgress({
                    phase: 'Migration completed',
                    current: copiedFiles,
                    total: copiedFiles
                });
            }
            
            return { success: true, copiedFiles };
            
        } catch (error: any) {
            const errorMessage = error.message || 'Unknown error during migration';
            await this.settingsManager.markMigrationFailed(errorMessage);
            return { success: false, error: errorMessage, copiedFiles: 0 };
        }
    }
    
    /**
     * 内部清理方法（指定路径）
     * 注意：只清理数据目录，不清理 settings 目录
     */
    private async cleanupOldStorageInternal(oldPath: string): Promise<{ success: boolean; freedBytes: number }> {
        try {
            const stats = await this.getStorageStats(oldPath);
            
            // 要清理的子目录（不包括 settings，settings 只在默认路径存在）
            const subDirs = ['conversations', 'snapshots', 'checkpoints', 'mcp', 'dependencies', 'diffs'];
            
            for (const subDir of subDirs) {
                await this.removeDirectory(path.join(oldPath, subDir));
            }
            
            return { success: true, freedBytes: stats.totalSize };
        } catch (error) {
            console.error('[StoragePathManager] Failed to cleanup old storage:', error);
            return { success: false, freedBytes: 0 };
        }
    }
    
    /**
     * 清理旧的存储目录（手动调用）
     * 只删除数据子目录，保留设置目录
     */
    async cleanupOldStorage(): Promise<{ success: boolean; freedBytes: number }> {
        const config = this.settingsManager.getStoragePathConfig();
        
        // 只有迁移完成且有自定义路径时才清理默认路径
        if (config.migrationStatus !== 'completed' || !config.customDataPath) {
            return { success: false, freedBytes: 0 };
        }
        
        return await this.cleanupOldStorageInternal(this.defaultDataPath);
    }
    
    /**
     * 重置为默认存储路径
     * 会将数据迁移回默认路径，并清理自定义路径中的数据
     */
    async resetToDefault(onProgress?: (status: { phase: string; current: number; total: number }) => void): Promise<{ success: boolean; error?: string }> {
        const config = this.settingsManager.getStoragePathConfig();
        
        if (!config.customDataPath) {
            // 已经是默认路径
            return { success: true };
        }
        
        const customPath = config.customDataPath;
        
        try {
            // 将数据从自定义路径迁移回默认路径
            const subDirs = ['conversations', 'snapshots', 'checkpoints', 'mcp', 'dependencies', 'diffs'];
            const stats = await this.getStorageStats(customPath);
            let copiedFiles = 0;
            
            for (const subDir of subDirs) {
                const srcDir = path.join(customPath, subDir);
                const destDir = path.join(this.defaultDataPath, subDir);
                
                if (onProgress) {
                    onProgress({
                        phase: `Restoring ${subDir}...`,
                        current: copiedFiles,
                        total: stats.fileCount
                    });
                }
                
                try {
                    await fs.access(srcDir);
                    const count = await this.copyDirectory(srcDir, destDir);
                    copiedFiles += count;
                } catch {
                    // 源目录不存在，跳过
                }
            }
            
            if (onProgress) {
                onProgress({
                    phase: 'Cleaning up custom storage...',
                    current: copiedFiles,
                    total: copiedFiles
                });
            }
            
            // 清理自定义路径中的数据子目录
            await this.cleanupOldStorageInternal(customPath);
            
            // 清除自定义路径配置
            await this.settingsManager.updateStoragePathConfig({
                customDataPath: undefined,
                migrationStatus: 'none',
                lastMigrationAt: undefined,
                migrationError: undefined
            });
            
            return { success: true };
            
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }
}