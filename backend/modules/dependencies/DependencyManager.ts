/**
 * 动态依赖管理器
 *
 * 用于管理可选的原生依赖（如 sharp），支持：
 * - 检查依赖是否已安装
 * - 在本地文件系统中安装依赖（默认 ~/.limcode/node_modules）
 * - 动态加载已安装的依赖
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { promisify } from 'util';
import { t } from '../../i18n';

const exec = promisify(childProcess.exec);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const rm = promisify(fs.rm);
const copyFile = promisify(fs.copyFile);

/**
 * 依赖信息
 */
export interface DependencyInfo {
    /** 依赖名称 */
    name: string;
    /** 版本要求 */
    version: string;
    /** 描述 */
    description: string;
    /** 是否已安装 */
    installed: boolean;
    /** 已安装的版本 */
    installedVersion?: string;
    /** 安装大小（估算，MB） */
    estimatedSize?: number;
}

/**
 * 安装进度事件
 */
export interface InstallProgressEvent {
    type: 'start' | 'progress' | 'complete' | 'error';
    dependency: string;
    message?: string;
    error?: string;
}

/**
 * 依赖管理器
 */
export class DependencyManager {
    private static instance: DependencyManager;
    
    /** LimCode 根目录（默认 ~/.limcode 或自定义路径下的 dependencies） */
    private limcodeDir: string;
    
    /** 依赖安装目录（limcodeDir/node_modules） */
    private depsDir: string;
    
    /** 进度事件监听器 */
    private progressListeners: Set<(event: InstallProgressEvent) => void> = new Set();
    
    /** 已加载的模块缓存 */
    private loadedModules: Map<string, any> = new Map();
    
    /** 依赖安装状态缓存（用于同步检查） */
    private installedCache: Map<string, boolean> = new Map();
    
    /** 支持的可选依赖配置 */
    private readonly optionalDependencies: Record<string, { version: string; descriptionKey: string; estimatedSize: number }> = {
        'sharp': {
            version: '^0.33.5',
            descriptionKey: 'modules.dependencies.descriptions.sharp',
            estimatedSize: 30  // MB
        }
    };
    
    private constructor(private context: vscode.ExtensionContext, customDepsPath?: string) {
        // 如果提供了自定义路径，使用自定义路径
        // 否则使用用户主目录下的 .limcode 文件夹
        this.limcodeDir = customDepsPath || path.join(os.homedir(), '.limcode');
        this.depsDir = path.join(this.limcodeDir, 'node_modules');
    }
    
    /**
     * 获取单例实例
     *
     * @param context VSCode 扩展上下文（首次调用时必须提供）
     * @param customDepsPath 自定义依赖安装目录（可选）
     */
    static getInstance(context?: vscode.ExtensionContext, customDepsPath?: string): DependencyManager {
        if (!DependencyManager.instance) {
            if (!context) {
                throw new Error(t('modules.dependencies.errors.requiresContext'));
            }
            DependencyManager.instance = new DependencyManager(context, customDepsPath);
        }
        return DependencyManager.instance;
    }
    
    /**
     * 获取安装目录路径
     */
    getInstallPath(): string {
        return this.limcodeDir;
    }
    
    /**
     * 初始化依赖管理器（确保目录存在并刷新缓存）
     */
    async initialize(): Promise<void> {
        try {
            await mkdir(this.limcodeDir, { recursive: true });
            await mkdir(this.depsDir, { recursive: true });
        } catch {
            // 目录可能已存在
        }
        
        // 刷新安装状态缓存
        await this.refreshInstalledCache();
    }
    
    /**
     * 刷新依赖安装状态缓存
     */
    async refreshInstalledCache(): Promise<void> {
        for (const name of Object.keys(this.optionalDependencies)) {
            const installed = await this.isInstalled(name);
            this.installedCache.set(name, installed);
        }
    }
    
    /**
     * 同步检查依赖是否已安装（基于缓存）
     *
     * 注意：此方法返回的是缓存状态，可能不是最新的
     * 在安装/卸载后需要调用 refreshInstalledCache() 刷新
     */
    isInstalledSync(name: string): boolean {
        return this.installedCache.get(name) ?? false;
    }
    
    /**
     * 获取所有可选依赖的状态
     */
    async listDependencies(): Promise<DependencyInfo[]> {
        const result: DependencyInfo[] = [];
        
        for (const [name, config] of Object.entries(this.optionalDependencies)) {
            const installed = await this.isInstalled(name);
            let installedVersion: string | undefined;
            
            if (installed) {
                installedVersion = await this.getInstalledVersion(name);
            }
            
            result.push({
                name,
                version: config.version,
                description: t(config.descriptionKey as any),
                installed,
                installedVersion,
                estimatedSize: config.estimatedSize
            });
        }
        
        return result;
    }
    
    /**
     * 检查依赖是否已安装
     */
    async isInstalled(name: string): Promise<boolean> {
        try {
            const packageJsonPath = path.join(this.depsDir, name, 'package.json');
            await statAsync(packageJsonPath);
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * 获取已安装依赖的版本
     */
    async getInstalledVersion(name: string): Promise<string | undefined> {
        try {
            const packageJsonPath = path.join(this.depsDir, name, 'package.json');
            const content = await readFile(packageJsonPath, 'utf-8');
            const pkg = JSON.parse(content);
            return pkg.version;
        } catch {
            return undefined;
        }
    }
    
    /**
     * 安装依赖
     */
    async install(name: string): Promise<boolean> {
        const config = this.optionalDependencies[name];
        if (!config) {
            this.emitProgress({
                type: 'error',
                dependency: name,
                error: t('modules.dependencies.errors.unknownDependency', { name })
            });
            return false;
        }
        
        this.emitProgress({
            type: 'start',
            dependency: name,
            message: t('modules.dependencies.progress.installing', { name })
        });
        
        try {
            // 确保目录存在
            await this.initialize();
            
            // 创建临时 package.json
            const tempPackageJson = {
                name: 'limcode-deps',
                // 为什么同步临时依赖包版本：依赖安装目录里的 package.json 也属于 LimCode 运行时元数据。
                // 怎么改：随 1.1.28 发布同步临时 package 版本，不改第三方依赖版本。
                // 目的：清理“LimCode 自身版本仍停在 1.0.5”的诊断噪音。
                version: '1.1.28',
                dependencies: {
                    [name]: config.version
                }
            };
            
            const tempDir = path.join(this.limcodeDir, 'deps-temp');
            const packageJsonPath = path.join(tempDir, 'package.json');
            
            // 创建临时目录
            await mkdir(tempDir, { recursive: true });
            await writeFile(packageJsonPath, JSON.stringify(tempPackageJson, null, 2));
            
            this.emitProgress({
                type: 'progress',
                dependency: name,
                message: t('modules.dependencies.progress.downloading', { name })
            });
            
            // 使用 npm 安装
            const { stdout, stderr } = await exec(
                `npm install --prefix "${tempDir}" --no-save`,
                {
                    cwd: tempDir,
                    timeout: 300000  // 5分钟超时
                }
            );
            
            console.log('npm install stdout:', stdout);
            if (stderr) {
                console.log('npm install stderr:', stderr);
            }
            
            // 移动安装的依赖到目标目录
            // 需要复制整个 node_modules 目录，因为 sharp 等原生模块有平台依赖包
            const sourceNodeModules = path.join(tempDir, 'node_modules');
            
            // 检查源目录是否存在
            try {
                await statAsync(sourceNodeModules);
            } catch {
                throw new Error(t('modules.dependencies.errors.nodeModulesNotFound'));
            }
            
            // 检查主包是否存在
            const mainPackageDir = path.join(sourceNodeModules, name);
            try {
                await statAsync(mainPackageDir);
            } catch {
                throw new Error(t('modules.dependencies.errors.moduleNotFound', { name }));
            }
            
            // 获取 node_modules 下所有目录（包括主包和依赖包）
            const entries = await readdir(sourceNodeModules, { withFileTypes: true });
            
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                
                const sourcePath = path.join(sourceNodeModules, entry.name);
                const targetPath = path.join(this.depsDir, entry.name);
                
                // 删除旧的目标目录（如果存在）
                try {
                    await rm(targetPath, { recursive: true, force: true });
                } catch {
                    // 目录可能不存在
                }
                
                // 递归复制整个目录
                await this.copyDirectory(sourcePath, targetPath);
            }
            
            // 清理临时目录
            try {
                await rm(tempDir, { recursive: true, force: true });
            } catch {
                // 忽略清理错误
            }
            
            // 清除缓存并更新安装状态
            this.loadedModules.delete(name);
            this.installedCache.set(name, true);
            
            this.emitProgress({
                type: 'complete',
                dependency: name,
                message: t('modules.dependencies.progress.installSuccess', { name })
            });
            
            return true;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            this.emitProgress({
                type: 'error',
                dependency: name,
                error: t('modules.dependencies.errors.installFailed', { error: errorMessage })
            });
            
            return false;
        }
    }
    
    /**
     * 卸载依赖
     */
    async uninstall(name: string): Promise<boolean> {
        try {
            const targetDir = path.join(this.depsDir, name);
            await rm(targetDir, { recursive: true, force: true });
            
            // 清除缓存并更新安装状态
            this.loadedModules.delete(name);
            this.installedCache.set(name, false);
            
            return true;
        } catch (error) {
            console.error(t('modules.dependencies.errors.uninstallFailed', { name }), error);
            return false;
        }
    }
    
    /**
     * 动态加载依赖
     * 
     * @param name 依赖名称
     * @returns 加载的模块，如果未安装则返回 null
     */
    async load<T = any>(name: string): Promise<T | null> {
        // 检查缓存
        if (this.loadedModules.has(name)) {
            return this.loadedModules.get(name);
        }
        
        // 检查是否已安装
        if (!await this.isInstalled(name)) {
            return null;
        }
        
        try {
            const modulePath = path.join(this.depsDir, name);
            // 使用 require 加载
            const mod = require(modulePath);
            this.loadedModules.set(name, mod);
            return mod;
        } catch (error) {
            console.error(t('modules.dependencies.errors.loadFailed', { name }), error);
            return null;
        }
    }
    
    /**
     * 订阅安装进度事件
     */
    onProgress(listener: (event: InstallProgressEvent) => void): () => void {
        this.progressListeners.add(listener);
        return () => {
            this.progressListeners.delete(listener);
        };
    }
    
    /**
     * 发送进度事件
     */
    private emitProgress(event: InstallProgressEvent): void {
        for (const listener of this.progressListeners) {
            try {
                listener(event);
            } catch (e) {
                console.error('Progress listener error:', e);
            }
        }
    }
    
    /**
     * 递归复制目录
     */
    private async copyDirectory(source: string, target: string): Promise<void> {
        // 创建目标目录
        await mkdir(target, { recursive: true });
        
        // 读取源目录内容
        const entries = await readdir(source, { withFileTypes: true });
        
        for (const entry of entries) {
            const sourcePath = path.join(source, entry.name);
            const targetPath = path.join(target, entry.name);
            
            if (entry.isDirectory()) {
                await this.copyDirectory(sourcePath, targetPath);
            } else {
                await copyFile(sourcePath, targetPath);
            }
        }
    }
}

/**
 * 获取 sharp 模块（如果已安装）
 */
export async function getSharp(): Promise<any | null> {
    try {
        const manager = DependencyManager.getInstance();
        return await manager.load('sharp');
    } catch {
        // 如果 DependencyManager 未初始化，返回 null
        return null;
    }
}