/**
 * LimCode - 完整的聊天视图提供者
 * 
 * 集成后端API模块，提供完整功能
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { t, setLanguage as setBackendLanguage } from '../backend/i18n';
import type { SupportedLanguage } from '../backend/i18n';
import {
    ConversationManager,
    FileSystemStorageAdapter
} from '../backend/modules/conversation';
import { ConfigManager, MementoStorageAdapter } from '../backend/modules/config';
import { ChannelManager } from '../backend/modules/channel';
import { ChatHandler } from '../backend/modules/api/chat';
import { ModelsHandler } from '../backend/modules/api/models';
import { SettingsManager, FileSettingsStorage, StoragePathManager } from '../backend/modules/settings';
import type { StoragePathConfig, StorageStats } from '../backend/modules/settings';
import { SettingsHandler } from '../backend/modules/api/settings';
import { CheckpointManager } from '../backend/modules/checkpoint';
import { McpManager, VSCodeFileSystemMcpStorageAdapter } from '../backend/modules/mcp';
import type { CreateMcpServerInput, UpdateMcpServerInput, McpServerInfo } from '../backend/modules/mcp';
import { DependencyManager, type InstallProgressEvent } from '../backend/modules/dependencies';
import { toolRegistry, registerAllTools, onTerminalOutput, onImageGenOutput, TaskManager } from '../backend/tools';
import type { TerminalOutputEvent, ImageGenOutputEvent, TaskEvent } from '../backend/tools';
import {
    setGlobalSettingsManager,
    setGlobalConfigManager,
    setGlobalChannelManager,
    setGlobalToolRegistry,
    setGlobalDiffStorageManager
} from '../backend/core/settingsContext';
import { DiffStorageManager } from '../backend/modules/conversation';
import { getDiffManager } from '../backend/tools/file/diffManager';
import { MessageRouter } from './MessageRouter';
import type { HandlerContext, DiffPreviewContentProvider as IDiffPreviewContentProvider } from './types';

/**
 * Diff 预览内容提供者
 */
class DiffPreviewContentProvider implements vscode.TextDocumentContentProvider, IDiffPreviewContentProvider {
    private contents: Map<string, string> = new Map();
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    
    public onDidChange = this.onDidChangeEmitter.event;
    
    public setContent(uri: string, content: string): void {
        this.contents.set(uri, content);
    }
    
    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) || '';
    }
    
    public dispose(): void {
        this.contents.clear();
        this.onDidChangeEmitter.dispose();
    }
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    
    // Diff 预览内容提供者
    private diffPreviewProvider: DiffPreviewContentProvider;
    private diffPreviewProviderDisposable: vscode.Disposable;
    
    // 后端模块
    private configManager!: ConfigManager;
    private channelManager!: ChannelManager;
    private conversationManager!: ConversationManager;
    private chatHandler!: ChatHandler;
    private modelsHandler!: ModelsHandler;
    private settingsManager!: SettingsManager;
    private settingsHandler!: SettingsHandler;
    private checkpointManager!: CheckpointManager;
    private mcpManager!: McpManager;
    private dependencyManager!: DependencyManager;
    private storagePathManager!: StoragePathManager;
    private diffStorageManager!: DiffStorageManager;
    
    // 消息路由器
    private messageRouter!: MessageRouter;
    
    // 事件取消订阅函数
    private terminalOutputUnsubscribe?: () => void;
    private imageGenOutputUnsubscribe?: () => void;
    private taskEventUnsubscribe?: () => void;
    private dependencyProgressUnsubscribe?: () => void;

    // Diff 手动保存事件监听（用于 apply_diff / write_file 的确认按钮状态同步）
    private diffManualSaveListener?: (diff: any) => void;
    
    // 初始化状态
    private initPromise: Promise<void>;

    constructor(private readonly context: vscode.ExtensionContext) {
        // 初始化 Diff 预览内容提供者
        this.diffPreviewProvider = new DiffPreviewContentProvider();
        this.diffPreviewProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
            'limcode-diff-preview',
            this.diffPreviewProvider
        );
        context.subscriptions.push(this.diffPreviewProviderDisposable);
        
        // 异步初始化后端
        this.initPromise = this.initializeBackend().catch(err => {
            console.error('Failed to initialize backend:', err);
            throw err;
        });
    }

    /**
     * 初始化后端模块
     */
    private async initializeBackend() {
        // 1. 初始化设置管理器（需要最先初始化以获取存储路径配置）
        const settingsStorageDir = path.join(this.context.globalStorageUri.fsPath, 'settings');
        const settingsStorage = new FileSettingsStorage(settingsStorageDir);
        this.settingsManager = new SettingsManager(settingsStorage);
        await this.settingsManager.initialize();
        
        // 2. 初始化存储路径管理器
        this.storagePathManager = new StoragePathManager(this.settingsManager, this.context);
        await this.storagePathManager.ensureDirectories();
        
        // 3. 获取有效的数据存储路径（可能是自定义路径）
        const effectiveDataUri = this.storagePathManager.getEffectiveDataUri();
        
        // 4. 初始化存储适配器（使用文件系统存储，避免 globalState 过大）
        const storageAdapter = new FileSystemStorageAdapter(vscode, effectiveDataUri);
        
        // 5. 初始化 Diff 存储管理器（用于 apply_diff 的大文件内容抽离）
        this.diffStorageManager = DiffStorageManager.initialize(this.storagePathManager.getEffectiveDataPath());
        setGlobalDiffStorageManager(this.diffStorageManager);
        
        // 6. 初始化对话管理器
        this.conversationManager = new ConversationManager(storageAdapter);
        
        // 7. 初始化配置管理器（使用Memento存储）
        const configStorage = new MementoStorageAdapter(
            this.context.globalState,
            'limcode.configs'
        );
        this.configManager = new ConfigManager(configStorage);
        
        // 8. 创建默认配置（如果不存在）
        await this.ensureDefaultConfig();
        
        // 9. 同步语言设置到后端 i18n
        this.syncLanguageToBackend();
        
        // 10. 设置全局上下文引用（供工具和其他模块访问）
        setGlobalSettingsManager(this.settingsManager);
        setGlobalConfigManager(this.configManager);
        setGlobalToolRegistry(toolRegistry);
        
        // 11. 注册所有工具到工具注册器（必须在 ChannelManager 之前）
        registerAllTools(toolRegistry);
        
        // 12. 初始化渠道管理器（传入工具注册器和设置管理器）
        this.channelManager = new ChannelManager(this.configManager, toolRegistry, this.settingsManager);
        
        // 13. 设置重试状态回调
        this.channelManager.setRetryStatusCallback((status) => {
            this.handleRetryStatus(status);
        });
        
        // 14. 设置全局渠道管理器引用
        setGlobalChannelManager(this.channelManager);
        
        // 15. 初始化检查点管理器（使用自定义路径）
        this.checkpointManager = new CheckpointManager(
            this.settingsManager,
            this.conversationManager,
            this.context,
            this.storagePathManager.getEffectiveDataPath()
        );
        await this.checkpointManager.initialize();
        
        // 16. 初始化聊天处理器（传入工具注册器和检查点管理器）
        this.chatHandler = new ChatHandler(
            this.configManager,
            this.channelManager,
            this.conversationManager,
            toolRegistry
        );
        this.chatHandler.setCheckpointManager(this.checkpointManager);
        this.chatHandler.setSettingsManager(this.settingsManager);
        this.chatHandler.setDiffStorageManager(this.diffStorageManager);
        
        // 17. 初始化模型管理处理器
        this.modelsHandler = new ModelsHandler(this.configManager);
        
        // 18. 初始化设置处理器（传入工具注册器）
        this.settingsHandler = new SettingsHandler(this.settingsManager, toolRegistry);
        
        // 19. 订阅终端输出事件
        this.terminalOutputUnsubscribe = onTerminalOutput((event) => {
            this.handleTerminalOutputEvent(event);
        });
        
        // 20. 订阅图像生成输出事件
        this.imageGenOutputUnsubscribe = onImageGenOutput((event) => {
            this.handleImageGenOutputEvent(event);
        });
        
        // 21. 订阅统一任务事件（用于未来扩展）
        this.taskEventUnsubscribe = TaskManager.onTaskEvent((event) => {
            this.handleTaskEvent(event);
        });
        
        // 22. 初始化 MCP 管理器（使用自定义路径下的 mcp 目录）
        const mcpConfigDir = vscode.Uri.file(this.storagePathManager.getMcpPath());
        try {
            await vscode.workspace.fs.stat(mcpConfigDir);
        } catch {
            await vscode.workspace.fs.createDirectory(mcpConfigDir);
        }
        const mcpConfigFile = vscode.Uri.joinPath(mcpConfigDir, 'servers.json');
        const mcpStorage = new VSCodeFileSystemMcpStorageAdapter(mcpConfigFile, vscode.workspace.fs);
        this.mcpManager = new McpManager(mcpStorage);
        await this.mcpManager.initialize();
        
        // 23. 将 MCP 管理器连接到 ChannelManager（用于工具声明）
        this.channelManager.setMcpManager(this.mcpManager);
        
        // 24. 将 MCP 管理器连接到 ChatHandler（用于工具调用）
        this.chatHandler.setMcpManager(this.mcpManager);
        
        // 25. 初始化依赖管理器（使用自定义路径）
        this.dependencyManager = DependencyManager.getInstance(
            this.context,
            this.storagePathManager.getDependenciesPath()
        );
        await this.dependencyManager.initialize();
        
        // 26. 设置依赖检查器到工具注册器（用于过滤未安装依赖的工具）
        toolRegistry.setDependencyChecker({
            isInstalled: (name: string) => this.dependencyManager.isInstalledSync(name)
        });
        
        // 27. 订阅依赖安装进度事件
        this.dependencyProgressUnsubscribe = this.dependencyManager.onProgress((event) => {
            this.handleDependencyProgressEvent(event);
        });
        
        // 28. 初始化消息路由器
        this.messageRouter = new MessageRouter(
            this.chatHandler,
            () => this._view,
            this.sendResponse.bind(this),
            this.sendError.bind(this)
        );

        // 29. 监听 diff 手动保存事件（用户在 VSCode diff 视图中 Ctrl+S）
        // 兼容旧版 ToolMessage.vue 的 diffManualSaved 推送
        const diffManager = getDiffManager();
        this.diffManualSaveListener = (diff: any) => {
            if (!this._view) return;
            this._view.webview.postMessage({
                type: 'diffManualSaved',
                data: {
                    diffId: diff.id,
                    filePath: diff.filePath,
                    absolutePath: diff.absolutePath
                }
            });
        };
        diffManager.addManualSaveListener(this.diffManualSaveListener);
        
        console.log('LimCode backend initialized with global context');
        console.log('Effective data path:', this.storagePathManager.getEffectiveDataPath());
    }
    
    /**
     * 处理终端输出事件，推送到前端
     */
    private handleTerminalOutputEvent(event: TerminalOutputEvent): void {
        if (!this._view) return;
        
        this._view.webview.postMessage({
            type: 'terminalOutput',
            data: event
        });
    }
    
    /**
     * 处理图像生成输出事件，推送到前端
     */
    private handleImageGenOutputEvent(event: ImageGenOutputEvent): void {
        if (!this._view) return;
        
        this._view.webview.postMessage({
            type: 'imageGenOutput',
            data: event
        });
    }
    
    /**
     * 处理统一任务事件，推送到前端
     */
    private handleTaskEvent(event: TaskEvent): void {
        if (!this._view) return;
        
        this._view.webview.postMessage({
            type: 'taskEvent',
            data: event
        });
    }
    
    /**
     * 处理依赖安装进度事件，推送到前端
     */
    private handleDependencyProgressEvent(event: InstallProgressEvent): void {
        if (!this._view) return;
        
        this._view.webview.postMessage({
            type: 'dependencyProgress',
            data: event
        });
    }
    
    /**
     * 处理重试状态，推送到前端
     */
    private handleRetryStatus(status: {
        type: 'retrying' | 'retrySuccess' | 'retryFailed';
        attempt: number;
        maxAttempts: number;
        error?: string;
        nextRetryIn?: number;
    }): void {
        if (!this._view) return;
        
        this._view.webview.postMessage({
            type: 'retryStatus',
            data: status
        });
    }
    
    /**
     * 确保存在默认配置
     */
    private async ensureDefaultConfig() {
        try {
            const existingConfig = await this.configManager.getConfig('gemini-pro');
            if (!existingConfig) {
                const config = {
                    id: 'gemini-default',
                    type: 'gemini' as const,
                    name: 'Gemini(Default)',
                    apiKey: process.env.GEMINI_API_KEY || 'YOUR_API_KEY_HERE',
                    url: 'https://generativelanguage.googleapis.com/v1beta',
                    model: 'gemini-3-pro-preview',
                    timeout: 120000,
                    enabled: true,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                
                const storage = (this.configManager as any).storageAdapter;
                await storage.save(config);
                
                (this.configManager as any).loaded = false;
            }
        } catch (error) {
            console.error('Failed to create default config:', error);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'frontend', 'dist')),
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', '@vscode', 'codicons', 'dist'))
            ]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // 监听来自 webview 的消息
        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleMessage(message);
            },
            undefined,
            this.context.subscriptions
        );
    }

    /**
     * 创建处理器上下文
     */
    private createHandlerContext(requestId: string): HandlerContext {
        return {
            context: this.context,
            view: this._view,
            configManager: this.configManager,
            channelManager: this.channelManager,
            conversationManager: this.conversationManager,
            chatHandler: this.chatHandler,
            modelsHandler: this.modelsHandler,
            settingsManager: this.settingsManager,
            settingsHandler: this.settingsHandler,
            checkpointManager: this.checkpointManager,
            mcpManager: this.mcpManager,
            dependencyManager: this.dependencyManager,
            storagePathManager: this.storagePathManager,
            diffStorageManager: this.diffStorageManager,
            streamAbortControllers: this.messageRouter.getAbortManager() as any,
            diffPreviewProvider: this.diffPreviewProvider,
            sendResponse: this.sendResponse.bind(this),
            sendError: this.sendError.bind(this),
            getCurrentWorkspaceUri: this.getCurrentWorkspaceUri.bind(this),
            syncLanguageToBackend: this.syncLanguageToBackend.bind(this)
        };
    }

    /**
     * 处理来自前端的消息
     */
    private async handleMessage(message: any) {
        const { type, data, requestId } = message;

        try {
            // 等待初始化完成
            await this.initPromise;
            
            // 创建处理器上下文
            const ctx = this.createHandlerContext(requestId);
            
            // 使用消息路由器处理消息
            const handled = await this.messageRouter.route(type, data, requestId, ctx);
            
            if (!handled) {
                console.warn('Unknown message type:', type);
                this.sendError(requestId, 'UNKNOWN_TYPE', `Unknown message type: ${type}`);
            }
        } catch (error: any) {
            console.error('Error handling message:', error);
            this.sendError(requestId, error.code || 'HANDLER_ERROR', error.message);
        }
    }

    /**
     * 同步语言设置到后端 i18n
     */
    private syncLanguageToBackend(): void {
        try {
            const settings = this.settingsManager.getSettings();
            const language = settings.ui?.language || 'zh-CN';
            setBackendLanguage(language as SupportedLanguage);
        } catch (error) {
            console.error('Failed to sync language to backend:', error);
        }
    }
    
    /**
     * 获取当前工作区 URI
     */
    private getCurrentWorkspaceUri(): string | null {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder ? workspaceFolder.uri.toString() : null;
    }
    
    /**
     * 取消所有活跃的流式请求
     */
    public cancelAllStreams(): void {
        this.messageRouter?.cancelAllStreams();
        console.log('All active streams cancelled');
    }
    
    /**
     * 清理资源
     */
    public dispose(): void {
        // 取消所有活跃的流式请求
        this.cancelAllStreams();
        
        // 取消终端输出订阅
        if (this.terminalOutputUnsubscribe) {
            this.terminalOutputUnsubscribe();
        }
        
        // 取消图像生成输出订阅
        if (this.imageGenOutputUnsubscribe) {
            this.imageGenOutputUnsubscribe();
        }
        
        // 取消统一任务事件订阅
        if (this.taskEventUnsubscribe) {
            this.taskEventUnsubscribe();
        }
        
        // 取消依赖安装进度订阅
        if (this.dependencyProgressUnsubscribe) {
            this.dependencyProgressUnsubscribe();
        }
        
        // 取消所有活跃任务
        TaskManager.cancelAllTasks();
        
        // 释放 MCP 管理器资源（断开所有连接）
        this.mcpManager?.dispose();

        // 移除 diff 手动保存监听
        if (this.diffManualSaveListener) {
            try {
                getDiffManager().removeManualSaveListener(this.diffManualSaveListener);
            } catch {
                // ignore
            }
            this.diffManualSaveListener = undefined;
        }

        console.log('ChatViewProvider disposed');
    }
    
    /**
     * 发送响应到前端
     */
    private sendResponse(requestId: string, data: any) {
        this._view?.webview.postMessage({
            type: 'response',
            requestId,
            success: true,
            data
        });
    }

    /**
     * 发送错误到前端
     */
    private sendError(requestId: string, code: string, message: string) {
        this._view?.webview.postMessage({
            type: 'error',
            requestId,
            success: false,
            error: {
                code,
                message
            }
        });
    }

    /**
     * 发送命令到 Webview
     */
    public sendCommand(command: string): void {
        this._view?.webview.postMessage({
            type: 'command',
            command
        });
    }

    /**
     * 生成webview的HTML
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'frontend', 'dist', 'index.js'))
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'frontend', 'dist', 'index.css'))
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'))
        );

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data: blob:; media-src ${webview.cspSource} data: blob:;">
    <link href="${codiconsUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>LimCode Chat</title>
</head>
<body>
    <div id="app"></div>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
