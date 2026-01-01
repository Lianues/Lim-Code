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
import { toolRegistry, registerAllTools, checkAllShellsAvailability, onTerminalOutput, killTerminalProcess, getTerminalOutput, cancelImageGeneration, onImageGenOutput, TaskManager } from '../backend/tools';
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

/**
 * Diff 预览内容提供者
 */
class DiffPreviewContentProvider implements vscode.TextDocumentContentProvider {
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
    
    // 流式请求取消控制器（按对话ID索引）
    private streamAbortControllers: Map<string, AbortController> = new Map();
    
    // 终端输出事件取消订阅函数
    private terminalOutputUnsubscribe?: () => void;
    
    // 图像生成输出事件取消订阅函数
    private imageGenOutputUnsubscribe?: () => void;
    
    // 统一任务事件取消订阅函数
    private taskEventUnsubscribe?: () => void;
    
    // 依赖安装进度事件取消订阅函数
    private dependencyProgressUnsubscribe?: () => void;
    
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
        // FileSystemStorageAdapter 会在 baseDir 下创建 conversations 和 snapshots 子目录
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
        // 确保目录存在
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

        // 28. 订阅 Diff 手动保存事件（用户 CTRL+S 保存时通知前端）
        const diffManager = getDiffManager();
        diffManager.addManualSaveListener((diff) => {
            this.handleDiffManualSave(diff);
        });

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
     * 处理 Diff 手动保存事件（用户 CTRL+S 保存），通知前端复用保存按钮逻辑
     */
    private handleDiffManualSave(diff: { id: string; filePath: string; absolutePath: string }): void {
        if (!this._view) return;

        this._view.webview.postMessage({
            type: 'diffManualSaved',
            data: {
                diffId: diff.id,
                filePath: diff.filePath,
                absolutePath: diff.absolutePath
            }
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
                // 直接通过存储适配器创建配置，指定ID
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
                
                // 使用 configManager 的私有 storageAdapter（通过类型断言）
                const storage = (this.configManager as any).storageAdapter;
                await storage.save(config);
                
                // 清除加载状态，强制重新加载
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
     * 处理来自前端的消息
     */
    private async handleMessage(message: any) {
        const { type, data, requestId } = message;

        // 针对 continueWithAnnotation 的详细日志
        if (type === 'continueWithAnnotation') {
            console.log('[handleMessage] received continueWithAnnotation - requestId:', requestId, 'timestamp:', Date.now());
        }

        try {
            // 等待初始化完成
            await this.initPromise;

            switch (type) {
                // ========== 对话管理 ==========
                
                case 'conversation.createConversation': {
                    const { conversationId, title, workspaceUri } = data;
                    // 如果没有传入 workspaceUri，使用当前工作区
                    const wsUri = workspaceUri || this.getCurrentWorkspaceUri();
                    await this.conversationManager.createConversation(conversationId, title, wsUri);
                    this.sendResponse(requestId, { success: true });
                    break;
                }
                
                case 'conversation.listConversations': {
                    const ids = await this.conversationManager.listConversations();
                    this.sendResponse(requestId, ids);
                    break;
                }
                
                case 'conversation.getConversationMetadata': {
                    const { conversationId } = data;
                    const metadata = await this.conversationManager.getMetadata(conversationId);
                    this.sendResponse(requestId, metadata);
                    break;
                }
                
                case 'conversation.setTitle': {
                    const { conversationId, title } = data;
                    await this.conversationManager.setTitle(conversationId, title);
                    this.sendResponse(requestId, { success: true });
                    break;
                }
                
                case 'conversation.setCustomMetadata': {
                    const { conversationId, key, value } = data;
                    await this.conversationManager.setCustomMetadata(conversationId, key, value);
                    this.sendResponse(requestId, { success: true });
                    break;
                }
                
                case 'conversation.deleteConversation': {
                    const { conversationId } = data;
                    // 先删除该对话的所有检查点（包括备份目录）
                    await this.checkpointManager.deleteAllCheckpoints(conversationId);
                    // 再删除对话本身
                    await this.conversationManager.deleteConversation(conversationId);
                    this.sendResponse(requestId, { success: true });
                    break;
                }
                
                case 'conversation.getMessages': {
                    const { conversationId } = data;
                    const messages = await this.conversationManager.getMessages(conversationId);
                    this.sendResponse(requestId, messages);
                    break;
                }
                
                case 'conversation.rejectToolCalls': {
                    const { conversationId, messageIndex, toolCallIds } = data;
                    try {
                        await this.conversationManager.rejectToolCalls(conversationId, messageIndex, toolCallIds);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'REJECT_TOOL_CALLS_ERROR', error.message || t('webview.errors.rejectToolCallsFailed'));
                    }
                    break;
                }
                
                // ========== 聊天功能 ==========
                
                case 'chatStream': {
                    // 不阻塞消息循环，流式处理在后台进行
                    // 内部已有 try-catch 和 sendResponse/sendError
                    void this.handleChatStream(data, requestId);
                    break;
                }
                
                case 'retryStream': {
                    // 不阻塞消息循环，流式处理在后台进行
                    void this.handleRetryStream(data, requestId);
                    break;
                }
                
                case 'editAndRetryStream': {
                    // 不阻塞消息循环，流式处理在后台进行
                    void this.handleEditAndRetryStream(data, requestId);
                    break;
                }
                
                case 'deleteMessage': {
                    const { conversationId, targetIndex } = data;
                    const result = await this.chatHandler.handleDeleteToMessage({
                        conversationId,
                        targetIndex
                    });
                    this.sendResponse(requestId, result);
                    break;
                }
                
                case 'deleteSingleMessage': {
                    const { conversationId, targetIndex } = data;
                    try {
                        // 只删除单条消息，不删除后续消息
                        await this.conversationManager.deleteMessage(conversationId, targetIndex);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'DELETE_SINGLE_MESSAGE_ERROR', error.message || t('webview.errors.deleteMessageFailed'));
                    }
                    break;
                }
                
                case 'cancelStream': {
                    const { conversationId } = data;
                    this.handleCancelStream(conversationId);
                    this.sendResponse(requestId, { success: true });
                    break;
                }
                
                case 'toolConfirmation': {
                    // 不阻塞消息循环，流式处理在后台进行
                    void this.handleToolConfirmationStream(data, requestId);
                    break;
                }

                case 'continueWithAnnotation': {
                    // 工具确认后继续对话（带批注）
                    console.log('[ChatViewProvider] case continueWithAnnotation - requestId:', requestId, 'conversationId:', data.conversationId, 'annotation:', data.annotation);
                    void this.handleContinueWithAnnotationStream(data, requestId);
                    break;
                }

                // ========== 配置管理 ==========
                
                case 'config.listConfigs': {
                    const configs = await this.configManager.listConfigs();
                    const configIds = configs.map(c => c.id);
                    this.sendResponse(requestId, configIds);
                    break;
                }
                
                case 'config.getConfig': {
                    const { configId } = data;
                    const config = await this.configManager.getConfig(configId);
                    this.sendResponse(requestId, config);
                    break;
                }
                
                case 'config.createConfig': {
                    const configId = await this.configManager.createConfig(data);
                    this.sendResponse(requestId, configId);
                    break;
                }
                
                case 'config.updateConfig': {
                    const { configId, updates } = data;
                    await this.configManager.updateConfig(configId, updates);
                    this.sendResponse(requestId, { success: true });
                    break;
                }
                
                case 'config.deleteConfig': {
                    const { configId } = data;
                    await this.configManager.deleteConfig(configId);
                    this.sendResponse(requestId, { success: true });
                    break;
                }
                
                // ========== 模型管理 ==========
                
                case 'models.getModels': {
                    const result = await this.modelsHandler.getModels(data);
                    if (result.success) {
                        this.sendResponse(requestId, result.models);
                    } else {
                        this.sendError(requestId, 'GET_MODELS_ERROR', result.error || t('webview.errors.getModelsFailed'));
                    }
                    break;
                }
                
                case 'models.addModels': {
                    const result = await this.modelsHandler.addModels(data);
                    if (result.success) {
                        this.sendResponse(requestId, { success: true });
                    } else {
                        this.sendError(requestId, 'ADD_MODELS_ERROR', result.error || t('webview.errors.addModelsFailed'));
                    }
                    break;
                }
                
                case 'models.removeModel': {
                    const result = await this.modelsHandler.removeModel(data);
                    if (result.success) {
                        this.sendResponse(requestId, { success: true });
                    } else {
                        this.sendError(requestId, 'REMOVE_MODEL_ERROR', result.error || t('webview.errors.removeModelFailed'));
                    }
                    break;
                }
                
                case 'models.setActiveModel': {
                    const result = await this.modelsHandler.setActiveModel(data);
                    if (result.success) {
                        this.sendResponse(requestId, { success: true });
                    } else {
                        this.sendError(requestId, 'SET_ACTIVE_MODEL_ERROR', result.error || t('webview.errors.setActiveModelFailed'));
                    }
                    break;
                }
                
                // ========== 设置管理 ==========
                
                case 'getSettings': {
                    const result = await this.settingsHandler.getSettings({});
                    this.sendResponse(requestId, result);
                    break;
                }
                
                case 'updateSettings': {
                    const result = await this.settingsHandler.updateSettings(data);
                    this.sendResponse(requestId, result);
                    break;
                }
                
                case 'updateProxySettings': {
                    const result = await this.settingsHandler.updateProxySettings(data);
                    this.sendResponse(requestId, result);
                    break;
                }
                
                case 'updateUISettings': {
                    try {
                        const { ui } = data;
                        await this.settingsManager.updateUISettings(ui);
                        
                        // 如果语言设置变更，同步到后端 i18n
                        if (ui.language) {
                            this.syncLanguageToBackend();
                        }
                        
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_UI_SETTINGS_ERROR', error.message || t('webview.errors.updateUISettingsFailed'));
                    }
                    break;
                }
                
                // ========== 工具管理 ==========
                
                case 'tools.getTools': {
                    const result = await this.settingsHandler.getToolsList({});
                    if (result.success) {
                        this.sendResponse(requestId, { tools: result.tools });
                    } else {
                        const errorResult = result as { success: false; error: { code: string; message: string } };
                        this.sendError(requestId, 'GET_TOOLS_ERROR', errorResult.error?.message || t('webview.errors.getToolsFailed'));
                    }
                    break;
                }
                
                case 'tools.setToolEnabled': {
                    const { toolName, enabled } = data;
                    const result = await this.settingsHandler.setToolEnabled({ toolName, enabled });
                    if (result.success) {
                        this.sendResponse(requestId, { success: true });
                    } else {
                        const errorResult = result as { success: false; error: { code: string; message: string } };
                        this.sendError(requestId, 'SET_TOOL_ENABLED_ERROR', errorResult.error?.message || t('webview.errors.setToolEnabledFailed'));
                    }
                    break;
                }
                
                case 'tools.getToolConfig': {
                    const { toolName } = data;
                    const result = await this.settingsHandler.getToolConfig({ toolName });
                    if (result.success) {
                        this.sendResponse(requestId, { config: result.config });
                    } else {
                        const errorResult = result as { success: false; error: { code: string; message: string } };
                        this.sendError(requestId, 'GET_TOOL_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.getToolConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.updateToolConfig': {
                    const { toolName, config } = data;
                    const result = await this.settingsHandler.updateToolConfig({ toolName, config });
                    if (result.success) {
                        this.sendResponse(requestId, { success: true });
                    } else {
                        const errorResult = result as { success: false; error: { code: string; message: string } };
                        this.sendError(requestId, 'UPDATE_TOOL_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.updateToolConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.getAutoExecConfig': {
                    try {
                        const config = this.settingsManager.getToolAutoExecConfig();
                        this.sendResponse(requestId, { config });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_AUTO_EXEC_CONFIG_ERROR', error.message || t('webview.errors.getAutoExecConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.getMcpTools': {
                    try {
                        // 获取所有已连接 MCP 服务器的工具
                        const allMcpTools = this.mcpManager.getAllTools();
                        const mcpTools: Array<{
                            name: string;
                            description: string;
                            enabled: boolean;
                            category: string;
                            serverId: string;
                            serverName: string;
                        }> = [];
                        
                        for (const serverTools of allMcpTools) {
                            for (const tool of serverTools.tools) {
                                // MCP 工具名称格式：mcp__{serverId}__{toolName}
                                const fullToolName = `mcp__${serverTools.serverId}__${tool.name}`;
                                mcpTools.push({
                                    name: fullToolName,
                                    description: tool.description || '',
                                    enabled: true, // MCP 工具始终启用
                                    category: 'mcp',
                                    serverId: serverTools.serverId,
                                    serverName: serverTools.serverName
                                });
                            }
                        }
                        
                        this.sendResponse(requestId, { tools: mcpTools });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_MCP_TOOLS_ERROR', error.message || t('webview.errors.getMcpToolsFailed'));
                    }
                    break;
                }
                
                case 'tools.setToolAutoExec': {
                    try {
                        const { toolName, autoExec } = data;
                        await this.settingsManager.setToolAutoExec(toolName, autoExec);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'SET_TOOL_AUTO_EXEC_ERROR', error.message || t('webview.errors.setToolAutoExecFailed'));
                    }
                    break;
                }
                
                case 'tools.updateListFilesConfig': {
                    const result = await this.settingsHandler.updateListFilesConfig({ config: data.config });
                    if (result.success) {
                        this.sendResponse(requestId, { success: true });
                    } else {
                        const errorResult = result as { success: false; error: { code: string; message: string } };
                        this.sendError(requestId, 'UPDATE_LIST_FILES_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.updateListFilesConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.getMaxToolIterations': {
                    try {
                        const maxIterations = this.settingsManager.getMaxToolIterations();
                        this.sendResponse(requestId, { maxIterations });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_MAX_TOOL_ITERATIONS_ERROR', error.message || t('webview.errors.getMaxToolIterationsFailed'));
                    }
                    break;
                }
                
                case 'tools.updateMaxToolIterations': {
                    try {
                        const { maxIterations } = data;
                        await this.settingsManager.setMaxToolIterations(maxIterations);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_MAX_TOOL_ITERATIONS_ERROR', error.message || t('webview.errors.updateMaxToolIterationsFailed'));
                    }
                    break;
                }
                
                case 'tools.getFindFilesConfig': {
                    try {
                        const config = this.settingsManager.getFindFilesConfig();
                        this.sendResponse(requestId, { config });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_FIND_FILES_CONFIG_ERROR', error.message || t('webview.errors.getFindFilesConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.updateFindFilesConfig': {
                    try {
                        await this.settingsManager.updateFindFilesConfig(data.config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_FIND_FILES_CONFIG_ERROR', error.message || t('webview.errors.updateFindFilesConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.getSearchInFilesConfig': {
                    try {
                        const config = this.settingsManager.getSearchInFilesConfig();
                        this.sendResponse(requestId, { config });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_SEARCH_IN_FILES_CONFIG_ERROR', error.message || t('webview.errors.getSearchInFilesConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.updateSearchInFilesConfig': {
                    try {
                        await this.settingsManager.updateSearchInFilesConfig(data.config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_SEARCH_IN_FILES_CONFIG_ERROR', error.message || t('webview.errors.updateSearchInFilesConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.updateApplyDiffConfig': {
                    const result = await this.settingsHandler.updateApplyDiffConfig({ config: data.config });
                    if (result.success) {
                        this.sendResponse(requestId, { success: true });
                    } else {
                        const errorResult = result as { success: false; error: { code: string; message: string } };
                        this.sendError(requestId, 'UPDATE_APPLY_DIFF_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.updateApplyDiffConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.getExecuteCommandConfig': {
                    const config = this.settingsManager.getExecuteCommandConfig();
                    
                    // 检测所有 Shell 的可用性
                    const availabilityMap = await checkAllShellsAvailability(
                        config.shells.map(s => ({ type: s.type, path: s.path }))
                    );
                    
                    // 将可用性信息合并到配置中
                    const configWithAvailability = {
                        ...config,
                        shells: config.shells.map(shell => ({
                            ...shell,
                            available: availabilityMap.get(shell.type)?.available ?? false,
                            unavailableReason: availabilityMap.get(shell.type)?.reason
                        }))
                    };
                    
                    this.sendResponse(requestId, { config: configWithAvailability });
                    break;
                }
                
                case 'tools.updateExecuteCommandConfig': {
                    try {
                        // 保存配置（不包含 available 和 unavailableReason，这些是运行时生成的）
                        const configToSave = {
                            ...data.config,
                            shells: data.config.shells.map((shell: any) => ({
                                type: shell.type,
                                enabled: shell.enabled,
                                path: shell.path,
                                displayName: shell.displayName
                            }))
                        };
                        await this.settingsManager.updateExecuteCommandConfig(configToSave);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_EXECUTE_COMMAND_CONFIG_ERROR', error.message || t('webview.errors.updateExecuteCommandConfigFailed'));
                    }
                    break;
                }
                
                case 'tools.checkShellAvailability': {
                    try {
                        const { shellType, path } = data;
                        const { checkShellAvailability } = require('../backend/tools/terminal');
                        const result = await checkShellAvailability(shellType, path);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'CHECK_SHELL_ERROR', error.message || t('webview.errors.checkShellFailed'));
                    }
                    break;
                }
                
                // ========== 终端实时管理 ==========
                
                case 'terminal.kill': {
                    try {
                        const { terminalId } = data;
                        const result = killTerminalProcess(terminalId);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'KILL_TERMINAL_ERROR', error.message || t('webview.errors.killTerminalFailed'));
                    }
                    break;
                }
                
                case 'terminal.getOutput': {
                    try {
                        const { terminalId } = data;
                        const result = getTerminalOutput(terminalId);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_OUTPUT_ERROR', error.message || t('webview.errors.getTerminalOutputFailed'));
                    }
                    break;
                }
                
                // ========== 图像生成管理 ==========
                
                case 'imageGeneration.cancel': {
                    try {
                        const { toolId } = data;
                        const result = cancelImageGeneration(toolId);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'CANCEL_IMAGE_GEN_ERROR', error.message || t('webview.errors.cancelImageGenFailed'));
                    }
                    break;
                }
                
                // ========== 统一任务管理 ==========
                
                case 'task.cancel': {
                    try {
                        const { taskId } = data;
                        const result = TaskManager.cancelTask(taskId);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'CANCEL_TASK_ERROR', error.message || t('webview.errors.cancelTaskFailed'));
                    }
                    break;
                }
                
                case 'task.cancelByType': {
                    try {
                        const { taskType } = data;
                        const count = TaskManager.cancelTasksByType(taskType);
                        this.sendResponse(requestId, { success: true, cancelledCount: count });
                    } catch (error: any) {
                        this.sendError(requestId, 'CANCEL_TASKS_BY_TYPE_ERROR', error.message || t('webview.errors.cancelTaskFailed'));
                    }
                    break;
                }
                
                case 'task.getAll': {
                    try {
                        const tasks = TaskManager.getAllTasks().map(task => ({
                            id: task.id,
                            type: task.type,
                            startTime: task.startTime,
                            metadata: task.metadata
                        }));
                        this.sendResponse(requestId, { tasks });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_ALL_TASKS_ERROR', error.message || t('webview.errors.getTasksFailed'));
                    }
                    break;
                }
                
                case 'task.getByType': {
                    try {
                        const { taskType } = data;
                        const tasks = TaskManager.getTasksByType(taskType).map(task => ({
                            id: task.id,
                            type: task.type,
                            startTime: task.startTime,
                            metadata: task.metadata
                        }));
                        this.sendResponse(requestId, { tasks });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_TASKS_BY_TYPE_ERROR', error.message || t('webview.errors.getTasksFailed'));
                    }
                    break;
                }
                
                // ========== 存档点管理 ==========
                
                case 'checkpoint.getConfig': {
                    const result = await this.settingsHandler.getCheckpointConfig();
                    if (result.success) {
                        this.sendResponse(requestId, { config: result.config });
                    } else {
                        const errorResult = result as { success: false; error: { code: string; message: string } };
                        this.sendError(requestId, 'GET_CHECKPOINT_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.getCheckpointConfigFailed'));
                    }
                    break;
                }
                
                case 'checkpoint.updateConfig': {
                    const result = await this.settingsHandler.updateCheckpointConfig({ config: data.config });
                    if (result.success) {
                        this.sendResponse(requestId, { success: true });
                    } else {
                        const errorResult = result as { success: false; error: { code: string; message: string } };
                        this.sendError(requestId, 'UPDATE_CHECKPOINT_CONFIG_ERROR', errorResult.error?.message || t('webview.errors.updateCheckpointConfigFailed'));
                    }
                    break;
                }
                
                case 'checkpoint.getCheckpoints': {
                    try {
                        const { conversationId } = data;
                        const checkpoints = await this.checkpointManager.getCheckpoints(conversationId);
                        this.sendResponse(requestId, { checkpoints });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_CHECKPOINTS_ERROR', error.message || t('webview.errors.getCheckpointsFailed'));
                    }
                    break;
                }
                
                case 'checkpoint.restore': {
                    try {
                        const { conversationId, checkpointId } = data;
                        const result = await this.checkpointManager.restoreCheckpoint(conversationId, checkpointId);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'RESTORE_CHECKPOINT_ERROR', error.message || t('webview.errors.restoreCheckpointFailed'));
                    }
                    break;
                }
                
                case 'checkpoint.delete': {
                    try {
                        const { conversationId, checkpointId } = data;
                        const success = await this.checkpointManager.deleteCheckpoint(conversationId, checkpointId);
                        this.sendResponse(requestId, { success });
                    } catch (error: any) {
                        this.sendError(requestId, 'DELETE_CHECKPOINT_ERROR', error.message || t('webview.errors.deleteCheckpointFailed'));
                    }
                    break;
                }
                
                case 'checkpoint.deleteAll': {
                    try {
                        const { conversationId } = data;
                        const result = await this.checkpointManager.deleteAllCheckpoints(conversationId);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'DELETE_ALL_CHECKPOINTS_ERROR', error.message || t('webview.errors.deleteAllCheckpointsFailed'));
                    }
                    break;
                }
                
                case 'checkpoint.getAllConversationsWithCheckpoints': {
                    try {
                        const conversations = await this.checkpointManager.getAllConversationsWithCheckpoints();
                        this.sendResponse(requestId, { conversations });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_CONVERSATIONS_WITH_CHECKPOINTS_ERROR', error.message || t('webview.errors.getConversationsWithCheckpointsFailed'));
                    }
                    break;
                }
                
                // ========== Diff 预览 ==========
                
                case 'diff.openPreview': {
                    try {
                        await this.handleOpenDiffPreview(data);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'OPEN_DIFF_PREVIEW_ERROR', error.message || t('webview.errors.openDiffPreviewFailed'));
                    }
                    break;
                }
                
                case 'diff.loadContent': {
                    try {
                        const { diffContentId } = data;
                        const content = await this.diffStorageManager.loadGlobalDiff(diffContentId);
                        if (content) {
                            this.sendResponse(requestId, {
                                success: true,
                                originalContent: content.originalContent,
                                newContent: content.newContent,
                                filePath: content.filePath
                            });
                        } else {
                            this.sendResponse(requestId, {
                                success: false,
                                error: t('webview.errors.diffContentNotFound')
                            });
                        }
                    } catch (error: any) {
                        this.sendError(requestId, 'LOAD_DIFF_CONTENT_ERROR', error.message || t('webview.errors.loadDiffContentFailed'));
                    }
                    break;
                }

                case 'diff.accept': {
                    try {
                        const { diffId, annotation } = data;
                        const diffManager = getDiffManager();
                        // 手动保存模式，isAutoSave = false，会保留用户编辑
                        const success = await diffManager.acceptDiff(diffId, true, false);

                        // 返回成功状态和是否有批注需要发送
                        // 如果有批注，前端会负责调用 continueWithAnnotation
                        const hasAnnotation = !!(annotation && annotation.trim());
                        const fullAnnotation = hasAnnotation ? annotation.trim() : '';

                        this.sendResponse(requestId, {
                            success,
                            hasAnnotation,
                            fullAnnotation
                        });
                    } catch (error: any) {
                        this.sendError(requestId, 'ACCEPT_DIFF_ERROR', error.message || t('webview.errors.acceptDiffFailed'));
                    }
                    break;
                }

                case 'diff.reject': {
                    try {
                        const { diffId, annotation } = data;
                        const diffManager = getDiffManager();
                        const success = await diffManager.rejectDiff(diffId);

                        // 返回成功状态和是否有批注需要发送
                        // 如果有批注，前端会负责调用 continueWithAnnotation
                        const hasAnnotation = !!(annotation && annotation.trim());
                        const fullAnnotation = hasAnnotation ? annotation.trim() : '';

                        this.sendResponse(requestId, {
                            success,
                            hasAnnotation,
                            fullAnnotation
                        });
                    } catch (error: any) {
                        this.sendError(requestId, 'REJECT_DIFF_ERROR', error.message || t('webview.errors.rejectDiffFailed'));
                    }
                    break;
                }

                case 'diff.getPending': {
                    try {
                        const diffManager = getDiffManager();
                        const pendingDiffs = diffManager.getPendingDiffs();
                        this.sendResponse(requestId, {
                            diffs: pendingDiffs.map(d => ({
                                id: d.id,
                                filePath: d.filePath
                            }))
                        });
                    } catch (error: any) {
                        this.sendResponse(requestId, { diffs: [] });
                    }
                    break;
                }

                // ========== 工作区信息 ==========
                
                case 'getWorkspaceUri': {
                    const uri = this.getCurrentWorkspaceUri();
                    this.sendResponse(requestId, uri);
                    break;
                }
                
                case 'getRelativePath': {
                    try {
                        const { absolutePath } = data;
                        const relativePath = this.getRelativePathFromAbsolute(absolutePath);
                        this.sendResponse(requestId, { relativePath });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_RELATIVE_PATH_ERROR', error.message || t('webview.errors.getRelativePathFailed'));
                    }
                    break;
                }
                
                // ========== 附件预览 ==========
                
                case 'previewAttachment': {
                    try {
                        await this.handlePreviewAttachment(data);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'PREVIEW_ATTACHMENT_ERROR', error.message || t('webview.errors.previewAttachmentFailed'));
                    }
                    break;
                }
                
                case 'readWorkspaceImage': {
                    try {
                        const result = await this.handleReadWorkspaceImage(data);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendResponse(requestId, {
                            success: false,
                            error: error.message || t('webview.errors.readImageFailed')
                        });
                    }
                    break;
                }
                
                case 'openWorkspaceFile': {
                    try {
                        await this.handleOpenWorkspaceFile(data);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'OPEN_WORKSPACE_FILE_ERROR', error.message || t('webview.errors.openFileFailed'));
                    }
                    break;
                }
                
                case 'saveImageToPath': {
                    try {
                        await this.handleSaveImageToPath(data);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendResponse(requestId, {
                            success: false,
                            error: error.message || t('webview.errors.saveImageFailed')
                        });
                    }
                    break;
                }
                
                // ========== MCP 配置 ==========
                
                case 'openMcpConfigFile': {
                    try {
                        await this.handleOpenMcpConfigFile();
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'OPEN_MCP_CONFIG_ERROR', error.message || t('webview.errors.openMcpConfigFailed'));
                    }
                    break;
                }
                
                case 'getMcpServers': {
                    try {
                        const servers = await this.handleGetMcpServers();
                        this.sendResponse(requestId, { success: true, servers });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_MCP_SERVERS_ERROR', error.message || t('webview.errors.getMcpServersFailed'));
                    }
                    break;
                }
                
                case 'validateMcpServerId': {
                    try {
                        const { id, excludeId } = data;
                        const result = await this.handleValidateMcpServerId(id, excludeId);
                        this.sendResponse(requestId, { success: true, ...result });
                    } catch (error: any) {
                        this.sendError(requestId, 'VALIDATE_MCP_SERVER_ID_ERROR', error.message || t('webview.errors.validateMcpServerIdFailed'));
                    }
                    break;
                }
                
                case 'createMcpServer': {
                    try {
                        const { input, customId } = data;
                        const serverId = await this.handleCreateMcpServer(input, customId);
                        this.sendResponse(requestId, { success: true, serverId });
                    } catch (error: any) {
                        this.sendError(requestId, 'CREATE_MCP_SERVER_ERROR', error.message || t('webview.errors.createMcpServerFailed'));
                    }
                    break;
                }
                
                case 'updateMcpServer': {
                    try {
                        const { serverId, updates } = data;
                        await this.handleUpdateMcpServer(serverId, updates);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_MCP_SERVER_ERROR', error.message || t('webview.errors.updateMcpServerFailed'));
                    }
                    break;
                }
                
                case 'deleteMcpServer': {
                    try {
                        const { serverId } = data;
                        await this.handleDeleteMcpServer(serverId);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'DELETE_MCP_SERVER_ERROR', error.message || t('webview.errors.deleteMcpServerFailed'));
                    }
                    break;
                }
                
                case 'connectMcpServer': {
                    try {
                        const { serverId } = data;
                        await this.handleConnectMcpServer(serverId);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'CONNECT_MCP_SERVER_ERROR', error.message || t('webview.errors.connectMcpServerFailed'));
                    }
                    break;
                }
                
                case 'disconnectMcpServer': {
                    try {
                        const { serverId } = data;
                        await this.handleDisconnectMcpServer(serverId);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'DISCONNECT_MCP_SERVER_ERROR', error.message || t('webview.errors.disconnectMcpServerFailed'));
                    }
                    break;
                }
                
                case 'setMcpServerEnabled': {
                    try {
                        const { serverId, enabled } = data;
                        await this.handleSetMcpServerEnabled(serverId, enabled);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'SET_MCP_SERVER_ENABLED_ERROR', error.message || t('webview.errors.setMcpServerEnabledFailed'));
                    }
                    break;
                }
                
                // ========== 激活渠道管理 ==========
                
                case 'settings.getActiveChannelId': {
                    const channelId = this.settingsManager.getActiveChannelId();
                    this.sendResponse(requestId, { channelId });
                    break;
                }
                
                case 'settings.setActiveChannelId': {
                    try {
                        const { channelId } = data;
                        await this.settingsManager.setActiveChannelId(channelId);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'SET_ACTIVE_CHANNEL_ERROR', error.message || t('webview.errors.setActiveChannelFailed'));
                    }
                    break;
                }
                
                // ========== 上下文总结 ==========
                
                case 'getSummarizeConfig': {
                    try {
                        const config = this.settingsManager.getSummarizeConfig();
                        this.sendResponse(requestId, config);
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_SUMMARIZE_CONFIG_ERROR', error.message || t('webview.errors.getSummarizeConfigFailed'));
                    }
                    break;
                }
                
                case 'updateSummarizeConfig': {
                    try {
                        const { config } = data;
                        await this.settingsManager.updateSummarizeConfig(config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_SUMMARIZE_CONFIG_ERROR', error.message || t('webview.errors.updateSummarizeConfigFailed'));
                    }
                    break;
                }
                
                // ========== 图像生成配置 ==========
                
                case 'getGenerateImageConfig': {
                    try {
                        const config = this.settingsManager.getGenerateImageConfig();
                        this.sendResponse(requestId, config);
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_GENERATE_IMAGE_CONFIG_ERROR', error.message || t('webview.errors.getGenerateImageConfigFailed'));
                    }
                    break;
                }
                
                case 'updateGenerateImageConfig': {
                    try {
                        const { config } = data;
                        await this.settingsManager.updateGenerateImageConfig(config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_GENERATE_IMAGE_CONFIG_ERROR', error.message || t('webview.errors.updateGenerateImageConfigFailed'));
                    }
                    break;
                }
                
                // ========== Google 搜索配置 ==========
                
                case 'getGoogleSearchConfig': {
                    try {
                        const config = this.settingsManager.getGoogleSearchConfig();
                        this.sendResponse(requestId, config);
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_GOOGLE_SEARCH_CONFIG_ERROR', error.message || t('webview.errors.getGoogleSearchConfigFailed'));
                    }
                    break;
                }
                
                case 'updateGoogleSearchConfig': {
                    try {
                        const { config } = data;
                        await this.settingsManager.updateGoogleSearchConfig(config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_GOOGLE_SEARCH_CONFIG_ERROR', error.message || t('webview.errors.updateGoogleSearchConfigFailed'));
                    }
                    break;
                }
                
                // ========== 上下文感知配置 ==========
                
                case 'getContextAwarenessConfig': {
                    try {
                        const config = this.settingsManager.getContextAwarenessConfig();
                        this.sendResponse(requestId, config);
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_CONTEXT_AWARENESS_CONFIG_ERROR', error.message || t('webview.errors.getContextAwarenessConfigFailed'));
                    }
                    break;
                }
                
                case 'updateContextAwarenessConfig': {
                    try {
                        const { config } = data;
                        await this.settingsManager.updateContextAwarenessConfig(config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_CONTEXT_AWARENESS_CONFIG_ERROR', error.message || t('webview.errors.updateContextAwarenessConfigFailed'));
                    }
                    break;
                }
                
                case 'getOpenTabs': {
                    try {
                        const tabs = await this.getOpenTabsInWorkspace();
                        this.sendResponse(requestId, { tabs });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_OPEN_TABS_ERROR', error.message || t('webview.errors.getOpenTabsFailed'));
                    }
                    break;
                }
                
                case 'getActiveEditor': {
                    try {
                        const activeEditor = this.getActiveEditorPath();
                        this.sendResponse(requestId, { path: activeEditor });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_ACTIVE_EDITOR_ERROR', error.message || t('webview.errors.getActiveEditorFailed'));
                    }
                    break;
                }
                
                case 'getDiagnosticsConfig': {
                    try {
                        const config = this.settingsManager.getDiagnosticsConfig();
                        this.sendResponse(requestId, config);
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_DIAGNOSTICS_CONFIG_ERROR', error.message || t('webview.errors.getDiagnosticsConfigFailed'));
                    }
                    break;
                }
                
                case 'updateDiagnosticsConfig': {
                    try {
                        const { config } = data;
                        await this.settingsManager.updateDiagnosticsConfig(config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_DIAGNOSTICS_CONFIG_ERROR', error.message || t('webview.errors.updateDiagnosticsConfigFailed'));
                    }
                    break;
                }
                
                case 'getWorkspaceDiagnostics': {
                    try {
                        const diagnostics = await this.getWorkspaceDiagnostics();
                        this.sendResponse(requestId, { diagnostics });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_WORKSPACE_DIAGNOSTICS_ERROR', error.message || t('webview.errors.getWorkspaceDiagnosticsFailed'));
                    }
                    break;
                }
                
                // ========== 系统提示词配置 ==========
                
                case 'getSystemPromptConfig': {
                    try {
                        const config = this.settingsManager.getSystemPromptConfig();
                        this.sendResponse(requestId, config);
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_SYSTEM_PROMPT_CONFIG_ERROR', error.message || t('webview.errors.getSystemPromptConfigFailed'));
                    }
                    break;
                }
                
                case 'updateSystemPromptConfig': {
                    try {
                        const { config } = data;
                        await this.settingsManager.updateSystemPromptConfig(config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_SYSTEM_PROMPT_CONFIG_ERROR', error.message || t('webview.errors.updateSystemPromptConfigFailed'));
                    }
                    break;
                }
                
                case 'countSystemPromptTokens': {
                    try {
                        const { text, channelType } = data;
                        const result = await this.settingsHandler.countSystemPromptTokens({ text, channelType });
                        if (result.success) {
                            this.sendResponse(requestId, { success: true, totalTokens: result.totalTokens });
                        } else {
                            this.sendResponse(requestId, { success: false, error: result.error?.message });
                        }
                    } catch (error: any) {
                        this.sendResponse(requestId, { success: false, error: error.message || 'Token count failed' });
                    }
                    break;
                }
                
                // ========== 固定文件配置 ==========
                
                case 'getPinnedFilesConfig': {
                    try {
                        const workspaceUri = this.getCurrentWorkspaceUri();
                        if (!workspaceUri) {
                            // 没有工作区时返回空配置
                            this.sendResponse(requestId, { files: [], sectionTitle: 'PINNED FILES CONTENT' });
                            break;
                        }
                        
                        // 只返回当前工作区的固定文件
                        const allConfig = this.settingsManager.getPinnedFilesConfig();
                        const workspaceFiles = allConfig.files.filter(f => f.workspaceUri === workspaceUri);
                        
                        this.sendResponse(requestId, {
                            ...allConfig,
                            files: workspaceFiles
                        });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_PINNED_FILES_CONFIG_ERROR', error.message || t('webview.errors.getPinnedFilesConfigFailed'));
                    }
                    break;
                }
                
                case 'checkPinnedFilesExistence': {
                    try {
                        const { files } = data;
                        const workspaceUri = this.getCurrentWorkspaceUri();
                        
                        if (!workspaceUri || !files) {
                            this.sendResponse(requestId, { files: [] });
                            break;
                        }
                        
                        // 检查每个文件是否存在
                        const filesWithExistence = await Promise.all(
                            files.map(async (file: { id: string; path: string }) => {
                                const exists = await this.checkFileExists(file.path, workspaceUri);
                                return { id: file.id, exists };
                            })
                        );
                        
                        this.sendResponse(requestId, { files: filesWithExistence });
                    } catch (error: any) {
                        this.sendError(requestId, 'CHECK_PINNED_FILES_EXISTENCE_ERROR', error.message || t('webview.errors.checkPinnedFilesExistenceFailed'));
                    }
                    break;
                }
                
                case 'updatePinnedFilesConfig': {
                    try {
                        const { config } = data;
                        await this.settingsManager.updatePinnedFilesConfig(config);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'UPDATE_PINNED_FILES_CONFIG_ERROR', error.message || t('webview.errors.updatePinnedFilesConfigFailed'));
                    }
                    break;
                }
                
                case 'addPinnedFile': {
                    try {
                        const { path: filePath, workspaceUri: providedWorkspaceUri } = data;
                        const currentWorkspaceUri = this.getCurrentWorkspaceUri();
                        
                        if (!currentWorkspaceUri) {
                            this.sendError(requestId, 'ADD_PINNED_FILE_ERROR', t('webview.errors.noWorkspaceOpen'));
                            break;
                        }
                        
                        // 验证文件，优先使用提供的工作区 URI，否则使用当前工作区
                        const targetWorkspaceUri = providedWorkspaceUri || currentWorkspaceUri;
                        const validation = await this.validateFileInWorkspace(filePath, targetWorkspaceUri);
                        
                        if (!validation.valid) {
                            // 返回详细的错误信息和错误码
                            this.sendResponse(requestId, {
                                success: false,
                                error: validation.error,
                                errorCode: validation.errorCode
                            });
                            break;
                        }
                        
                        // 使用文件实际所属的工作区 URI
                        const actualWorkspaceUri = validation.workspaceUri || targetWorkspaceUri;
                        const file = await this.settingsManager.addPinnedFile(validation.relativePath!, actualWorkspaceUri);
                        this.sendResponse(requestId, { success: true, file });
                    } catch (error: any) {
                        this.sendError(requestId, 'ADD_PINNED_FILE_ERROR', error.message || t('webview.errors.addPinnedFileFailed'));
                    }
                    break;
                }
                
                case 'removePinnedFile': {
                    try {
                        const { id } = data;
                        await this.settingsManager.removePinnedFile(id);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'REMOVE_PINNED_FILE_ERROR', error.message || t('webview.errors.removePinnedFileFailed'));
                    }
                    break;
                }
                
                case 'setPinnedFileEnabled': {
                    try {
                        const { id, enabled } = data;
                        await this.settingsManager.setPinnedFileEnabled(id, enabled);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'SET_PINNED_FILE_ENABLED_ERROR', error.message || t('webview.errors.setPinnedFileEnabledFailed'));
                    }
                    break;
                }
                
                case 'validatePinnedFile': {
                    try {
                        const { path: filePath, workspaceUri: providedWorkspaceUri } = data;
                        const currentWorkspaceUri = this.getCurrentWorkspaceUri();
                        
                        // 如果没有任何工作区打开
                        if (!currentWorkspaceUri) {
                            this.sendResponse(requestId, {
                                valid: false,
                                error: t('webview.errors.noWorkspaceOpen'),
                                errorCode: 'NO_WORKSPACE'
                            });
                            break;
                        }
                        
                        // 验证文件，传入当前工作区 URI
                        const result = await this.validateFileInWorkspace(filePath, providedWorkspaceUri || currentWorkspaceUri);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendResponse(requestId, { valid: false, error: error.message, errorCode: 'UNKNOWN' });
                    }
                    break;
                }
                
                // ========== 依赖管理 ==========
                
                case 'dependencies.list': {
                    try {
                        const dependencies = await this.dependencyManager.listDependencies();
                        this.sendResponse(requestId, { dependencies });
                    } catch (error: any) {
                        this.sendError(requestId, 'LIST_DEPENDENCIES_ERROR', error.message || t('webview.errors.listDependenciesFailed'));
                    }
                    break;
                }
                
                case 'dependencies.install': {
                    try {
                        const { name } = data;
                        const success = await this.dependencyManager.install(name);
                        this.sendResponse(requestId, { success });
                    } catch (error: any) {
                        this.sendError(requestId, 'INSTALL_DEPENDENCY_ERROR', error.message || t('webview.errors.installDependencyFailed'));
                    }
                    break;
                }
                
                case 'dependencies.uninstall': {
                    try {
                        const { name } = data;
                        const success = await this.dependencyManager.uninstall(name);
                        this.sendResponse(requestId, { success });
                    } catch (error: any) {
                        this.sendError(requestId, 'UNINSTALL_DEPENDENCY_ERROR', error.message || t('webview.errors.uninstallDependencyFailed'));
                    }
                    break;
                }
                
                case 'dependencies.getInstallPath': {
                    try {
                        const path = this.dependencyManager.getInstallPath();
                        this.sendResponse(requestId, { path });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_INSTALL_PATH_ERROR', error.message || t('webview.errors.getInstallPathFailed'));
                    }
                    break;
                }
                
                case 'summarizeContext': {
                    try {
                        const result = await this.chatHandler.handleSummarizeContext({
                            conversationId: data.conversationId,
                            configId: data.configId
                        });
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'SUMMARIZE_ERROR', error.message || t('webview.errors.summarizeFailed'));
                    }
                    break;
                }
                
                // ========== 对话文件管理 ==========
                
                case 'conversation.revealInExplorer': {
                    try {
                        const { conversationId } = data;
                        await this.handleRevealConversationInExplorer(conversationId);
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'REVEAL_IN_EXPLORER_ERROR', error.message || t('webview.errors.cannotRevealInExplorer'));
                    }
                    break;
                }
                
                // ========== 存储路径管理 ==========
                
                case 'storagePath.getConfig': {
                    try {
                        const config = this.settingsManager.getStoragePathConfig();
                        const defaultPath = this.storagePathManager.getDefaultDataPath();
                        const effectivePath = this.storagePathManager.getEffectiveDataPath();
                        this.sendResponse(requestId, {
                            config,
                            defaultPath,
                            effectivePath
                        });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_STORAGE_PATH_CONFIG_ERROR', error.message || t('webview.errors.getStoragePathConfigFailed'));
                    }
                    break;
                }
                
                case 'storagePath.getStats': {
                    try {
                        const { path: targetPath } = data;
                        const stats = await this.storagePathManager.getStorageStats(targetPath);
                        this.sendResponse(requestId, { stats });
                    } catch (error: any) {
                        this.sendError(requestId, 'GET_STORAGE_STATS_ERROR', error.message || t('webview.errors.getStorageStatsFailed'));
                    }
                    break;
                }
                
                case 'storagePath.validate': {
                    try {
                        const { path: targetPath } = data;
                        const result = await this.storagePathManager.validatePath(targetPath);
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'VALIDATE_STORAGE_PATH_ERROR', error.message || t('webview.errors.validateStoragePathFailed'));
                    }
                    break;
                }
                
                case 'storagePath.migrate': {
                    try {
                        const { path: newPath } = data;
                        const result = await this.storagePathManager.migrateData(newPath, (status) => {
                            // 发送迁移进度到前端
                            this._view?.webview.postMessage({
                                type: 'storageMigrationProgress',
                                data: status
                            });
                        });
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'MIGRATE_STORAGE_ERROR', error.message || t('webview.errors.migrateStorageFailed'));
                    }
                    break;
                }
                
                case 'storagePath.cleanup': {
                    try {
                        const result = await this.storagePathManager.cleanupOldStorage();
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'CLEANUP_STORAGE_ERROR', error.message || t('webview.errors.cleanupStorageFailed'));
                    }
                    break;
                }
                
                case 'storagePath.reset': {
                    try {
                        const result = await this.storagePathManager.resetToDefault((status) => {
                            // 发送迁移进度到前端
                            this._view?.webview.postMessage({
                                type: 'storageMigrationProgress',
                                data: status
                            });
                        });
                        this.sendResponse(requestId, result);
                    } catch (error: any) {
                        this.sendError(requestId, 'RESET_STORAGE_PATH_ERROR', error.message || t('webview.errors.resetStoragePathFailed'));
                    }
                    break;
                }
                
                case 'storagePath.selectFolder': {
                    try {
                        const result = await vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true,
                            canSelectMany: false,
                            title: t('webview.dialogs.selectStorageFolder'),
                            openLabel: t('webview.dialogs.selectFolder')
                        });
                        
                        if (result && result.length > 0) {
                            this.sendResponse(requestId, { path: result[0].fsPath });
                        } else {
                            this.sendResponse(requestId, { path: null });
                        }
                    } catch (error: any) {
                        this.sendError(requestId, 'SELECT_FOLDER_ERROR', error.message || t('webview.errors.selectFolderFailed'));
                    }
                    break;
                }
                
                case 'storagePath.openInExplorer': {
                    try {
                        const { path: targetPath } = data;
                        const pathToOpen = targetPath || this.storagePathManager.getEffectiveDataPath();
                        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pathToOpen));
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'OPEN_IN_EXPLORER_ERROR', error.message || t('webview.errors.openInExplorerFailed'));
                    }
                    break;
                }
                
                case 'reloadWindow': {
                    // 重新加载 VSCode 窗口
                    await vscode.commands.executeCommand('workbench.action.reloadWindow');
                    // 这个响应不会真正发送，因为窗口会重新加载
                    this.sendResponse(requestId, { success: true });
                    break;
                }
                
                // ========== 通知 ==========
                
                case 'showNotification': {
                    try {
                        const { message, type } = data;
                        
                        switch (type) {
                            case 'error':
                                vscode.window.showErrorMessage(message);
                                break;
                            case 'warning':
                                vscode.window.showWarningMessage(message);
                                break;
                            case 'info':
                            default:
                                vscode.window.showInformationMessage(message);
                                break;
                        }
                        
                        this.sendResponse(requestId, { success: true });
                    } catch (error: any) {
                        this.sendError(requestId, 'SHOW_NOTIFICATION_ERROR', error.message || t('webview.errors.showNotificationFailed'));
                    }
                    break;
                }

                default:
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
     * 获取工作区中打开的标签页文件路径
     * 只返回在当前工作区内的文件
     */
    private async getOpenTabsInWorkspace(): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }
        
        const tabs: string[] = [];
        const ignorePatterns = this.settingsManager.getContextIgnorePatterns();
        
        // 遍历所有 tab groups
        for (const tabGroup of vscode.window.tabGroups.all) {
            for (const tab of tabGroup.tabs) {
                // 只处理文件类型的 tab
                if (tab.input instanceof vscode.TabInputText) {
                    const uri = tab.input.uri;
                    
                    // 检查是否在工作区内
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
                    if (workspaceFolder) {
                        // 获取相对路径
                        const relativePath = vscode.workspace.asRelativePath(uri, false);
                        
                        // 检查是否应该被忽略
                        if (!this.shouldIgnorePath(relativePath, ignorePatterns)) {
                            tabs.push(relativePath);
                        }
                    }
                }
            }
        }
        
        // 去重
        return [...new Set(tabs)];
    }
    
    /**
     * 获取当前活动编辑器的文件路径
     * 只返回在工作区内的文件
     */
    private getActiveEditorPath(): string | null {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return null;
        }
        
        const uri = activeEditor.document.uri;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        
        if (!workspaceFolder) {
            return null;
        }
        
        const relativePath = vscode.workspace.asRelativePath(uri, false);
        const ignorePatterns = this.settingsManager.getContextIgnorePatterns();
        
        if (this.shouldIgnorePath(relativePath, ignorePatterns)) {
            return null;
        }
        
        return relativePath;
    }
    
    /**
     * 获取工作区的诊断信息（错误、警告等）
     *
     * 使用 VSCode 的 languages.getDiagnostics API 获取诊断信息
     * 根据配置过滤严重程度、工作区范围等
     */
    private async getWorkspaceDiagnostics(): Promise<Array<{
        file: string;
        diagnostics: Array<{
            line: number;
            column: number;
            severity: 'error' | 'warning' | 'information' | 'hint';
            message: string;
            source?: string;
            code?: string | number;
        }>;
    }>> {
        const config = this.settingsManager.getDiagnosticsConfig();
        
        // 如果功能未启用，返回空数组
        if (!config.enabled) {
            return [];
        }
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }
        
        // 获取所有诊断信息
        const allDiagnostics = vscode.languages.getDiagnostics();
        
        // 严重程度映射
        const severityMap: Record<vscode.DiagnosticSeverity, 'error' | 'warning' | 'information' | 'hint'> = {
            [vscode.DiagnosticSeverity.Error]: 'error',
            [vscode.DiagnosticSeverity.Warning]: 'warning',
            [vscode.DiagnosticSeverity.Information]: 'information',
            [vscode.DiagnosticSeverity.Hint]: 'hint'
        };
        
        // 获取打开的文件 URI 列表（如果需要只显示打开文件的诊断）
        const openFileUris = new Set<string>();
        if (config.openFilesOnly) {
            for (const tabGroup of vscode.window.tabGroups.all) {
                for (const tab of tabGroup.tabs) {
                    if (tab.input instanceof vscode.TabInputText) {
                        openFileUris.add(tab.input.uri.toString());
                    }
                }
            }
        }
        
        const result: Array<{
            file: string;
            diagnostics: Array<{
                line: number;
                column: number;
                severity: 'error' | 'warning' | 'information' | 'hint';
                message: string;
                source?: string;
                code?: string | number;
            }>;
        }> = [];
        
        let fileCount = 0;
        
        for (const [uri, diagnostics] of allDiagnostics) {
            // 检查文件数量限制
            if (config.maxFiles !== -1 && fileCount >= config.maxFiles) {
                break;
            }
            
            // 检查是否在工作区内
            if (config.workspaceOnly) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
                if (!workspaceFolder) {
                    continue;
                }
            }
            
            // 如果只显示打开文件的诊断
            if (config.openFilesOnly && !openFileUris.has(uri.toString())) {
                continue;
            }
            
            // 过滤诊断信息
            const filteredDiagnostics = diagnostics
                .filter(d => {
                    const severity = severityMap[d.severity];
                    return config.includeSeverities.includes(severity);
                })
                .slice(0, config.maxDiagnosticsPerFile === -1 ? undefined : config.maxDiagnosticsPerFile)
                .map(d => ({
                    line: d.range.start.line + 1, // 转为 1-based 行号
                    column: d.range.start.character + 1, // 转为 1-based 列号
                    severity: severityMap[d.severity],
                    message: d.message,
                    source: d.source,
                    code: typeof d.code === 'object' ? d.code.value : d.code
                }));
            
            if (filteredDiagnostics.length > 0) {
                const relativePath = vscode.workspace.asRelativePath(uri, false);
                result.push({
                    file: relativePath,
                    diagnostics: filteredDiagnostics
                });
                fileCount++;
            }
        }
        
        return result;
    }
    
    /**
     * 检查路径是否应该被忽略（根据配置的忽略模式）
     */
    private shouldIgnorePath(relativePath: string, ignorePatterns: string[]): boolean {
        for (const pattern of ignorePatterns) {
            if (this.matchGlobPattern(relativePath, pattern)) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * 简单的 glob 模式匹配
     * 支持 * 和 ** 通配符
     */
    private matchGlobPattern(path: string, pattern: string): boolean {
        // 将 glob 模式转换为正则表达式
        const regexPattern = pattern
            .replace(/\\/g, '/')  // 统一路径分隔符
            .replace(/\./g, '\\.')  // 转义点
            .replace(/\*\*/g, '<<<GLOBSTAR>>>')  // 临时替换 **
            .replace(/\*/g, '[^/]*')  // * 匹配除 / 外的任意字符
            .replace(/<<<GLOBSTAR>>>/g, '.*')  // ** 匹配任意字符包括 /
            .replace(/\//g, '[/\\\\]');  // 匹配 / 或 \
        
        const regex = new RegExp(`^${regexPattern}$|[/\\\\]${regexPattern}$|^${regexPattern}[/\\\\]|[/\\\\]${regexPattern}[/\\\\]`, 'i');
        return regex.test(path.replace(/\\/g, '/'));
    }
    
    /**
     * 将绝对路径转换为相对于工作区的路径
     *
     * @param absolutePath 绝对路径（可以是 file:// URI 或普通路径）
     * @returns 相对路径
     */
    private getRelativePathFromAbsolute(absolutePath: string): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error(t('webview.errors.noWorkspaceOpen'));
        }
        
        // 处理 file:// URI
        let filePath = absolutePath;
        if (absolutePath.startsWith('file://')) {
            // 解析 URI 获取本地路径
            const uri = vscode.Uri.parse(absolutePath);
            filePath = uri.fsPath;
        }
        
        // 获取工作区根目录
        const workspaceRoot = workspaceFolder.uri.fsPath;
        
        // 计算相对路径
        const relativePath = path.relative(workspaceRoot, filePath);
        
        // 如果是工作区外的路径，relative 会返回带 .. 的路径
        // 我们需要检查是否在工作区内
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            // 如果不在工作区内，返回绝对路径
            return filePath;
        }
        
        // 统一使用正斜杠
        return relativePath.replace(/\\/g, '/');
    }
    
    /**
     * 处理取消流式请求
     */
    private handleCancelStream(conversationId: string) {
        const controller = this.streamAbortControllers.get(conversationId);
        if (controller) {
            controller.abort();
            this.streamAbortControllers.delete(conversationId);
            // 注意：不再在这里发送 cancelled 消息
            // cancelled 消息会由后端 ChatHandler 在 yield 时发送
            // 这样可以确保 content（包含 thinkingDuration）被正确传递
        }
    }
    
    /**
     * 取消所有活跃的流式请求
     *
     * 在扩展停用、webview 销毁等场景调用
     */
    public cancelAllStreams(): void {
        for (const [conversationId, controller] of this.streamAbortControllers) {
            controller.abort();
            // 尝试发送取消消息（webview 可能已销毁）
            try {
                this._view?.webview.postMessage({
                    type: 'streamChunk',
                    data: {
                        conversationId,
                        type: 'cancelled'
                    }
                });
            } catch {
                // 忽略发送失败
            }
        }
        this.streamAbortControllers.clear();
        console.log('All active streams cancelled');
    }
    
    /**
     * 清理资源
     *
     * 在扩展停用时调用
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
        
        console.log('ChatViewProvider disposed');
    }
    
    /**
     * 处理流式聊天请求
     */
    private async handleChatStream(data: any, requestId: string) {
        let hasError = false;
        const conversationId = data.conversationId;
        
        // 创建取消控制器
        const abortController = new AbortController();
        this.streamAbortControllers.set(conversationId, abortController);

        try {
            const stream = this.chatHandler.handleChatStream({
                ...data,
                abortSignal: abortController.signal
            });

            for await (const chunk of stream) {
                // 不在这里检查 abortController.signal.aborted
                // 让 ChatHandler 检测到取消后 yield cancelled 消息
                // 这样前端可以接收到带有计时信息的 cancelled 消息

                // 根据不同类型处理chunk
                if ('checkpointOnly' in chunk && chunk.checkpointOnly) {
                    // ChatStreamCheckpointsData - 立即发送检查点
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'checkpoints',
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('chunk' in chunk && chunk.chunk) {
                    // ChatStreamChunkData
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'chunk',
                            chunk: chunk.chunk
                        }
                    });
                } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
                    // ChatStreamToolsExecutingData - 工具即将开始执行（不需要确认的工具）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolsExecuting',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls,
                            toolsExecuting: true
                        }
                    });
                } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
                    // ChatStreamToolConfirmationData - 等待用户确认工具执行
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'awaitingConfirmation',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls
                        }
                    });
                } else if ('toolIteration' in chunk && chunk.toolIteration) {
                    // ChatStreamToolIterationData - 工具调用迭代完成
                    // 【重要】新增字段时必须在此处同步添加，否则前端无法接收！
                    // 曾因遗漏 pendingAnnotation/annotationUsed 导致工具确认批注丢失
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolIteration',
                            content: chunk.content,
                            toolIteration: true,
                            toolResults: (chunk as any).toolResults,
                            checkpoints: (chunk as any).checkpoints,
                            needAnnotation: (chunk as any).needAnnotation,
                            pendingDiffToolIds: (chunk as any).pendingDiffToolIds,
                            pendingAnnotation: (chunk as any).pendingAnnotation,
                            annotationUsed: (chunk as any).annotationUsed
                        }
                    });
                } else if ('content' in chunk && chunk.content) {
                    // ChatStreamCompleteData
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'complete',
                            content: chunk.content,
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('cancelled' in chunk && (chunk as any).cancelled) {
                    // 取消消息（带 content，用于更新计时信息）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'cancelled',
                            content: (chunk as any).content
                        }
                    });
                } else if ('error' in chunk && chunk.error) {
                    // ChatStreamErrorData
                    hasError = true;
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'error',
                            error: chunk.error
                        }
                    });
                    // 同时响应原始请求以清除超时计时器
                    this.sendError(requestId, chunk.error.code || 'STREAM_ERROR', chunk.error.message);
                }
            }
            
            // 流式处理完成后响应原始请求（如果没有错误）
            if (!hasError) {
                this.sendResponse(requestId, { success: true });
            }
        } catch (error: any) {
            // 如果是取消导致的错误，忽略
            if (abortController.signal.aborted) {
                return;
            }
            
            this._view?.webview.postMessage({
                type: 'streamChunk',
                data: {
                    conversationId,
                    type: 'error',
                    error: {
                        code: error.code || 'STREAM_ERROR',
                        message: error.message
                    }
                }
            });
            // 同时响应原始请求以清除超时计时器
            this.sendError(requestId, error.code || 'STREAM_ERROR', error.message);
        } finally {
            // 清理取消控制器
            this.streamAbortControllers.delete(conversationId);
        }
    }

    /**
     * 处理重试流式请求
     */
    private async handleRetryStream(data: any, requestId: string) {
        let hasError = false;
        const conversationId = data.conversationId;
        
        // 创建取消控制器
        const abortController = new AbortController();
        this.streamAbortControllers.set(conversationId, abortController);
        
        try {
            const stream = this.chatHandler.handleRetryStream({
                ...data,
                abortSignal: abortController.signal
            });
            
            for await (const chunk of stream) {
                // 不在这里检查 abortController.signal.aborted
                // 让 ChatHandler 检测到取消后 yield cancelled 消息
                
                if ('checkpointOnly' in chunk && chunk.checkpointOnly) {
                    // ChatStreamCheckpointsData - 立即发送检查点
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'checkpoints',
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
                    // ChatStreamToolsExecutingData - 工具即将开始执行（不需要确认的工具）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolsExecuting',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls,
                            toolsExecuting: true
                        }
                    });
                } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
                    // ChatStreamToolConfirmationData - 等待用户确认工具执行
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'awaitingConfirmation',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls
                        }
                    });
                } else if ('chunk' in chunk && chunk.chunk) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'chunk',
                            chunk: chunk.chunk
                        }
                    });
                } else if ('toolIteration' in chunk && chunk.toolIteration) {
                    // ChatStreamToolIterationData - 工具调用迭代完成
                    // 【重要】新增字段时必须在此处同步添加，否则前端无法接收！
                    // 曾因遗漏 pendingAnnotation/annotationUsed 导致工具确认批注丢失
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolIteration',
                            content: chunk.content,
                            toolIteration: true,
                            toolResults: (chunk as any).toolResults,
                            checkpoints: (chunk as any).checkpoints,
                            needAnnotation: (chunk as any).needAnnotation,
                            pendingDiffToolIds: (chunk as any).pendingDiffToolIds,
                            pendingAnnotation: (chunk as any).pendingAnnotation,
                            annotationUsed: (chunk as any).annotationUsed
                        }
                    });
                } else if ('content' in chunk && chunk.content) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'complete',
                            content: chunk.content,
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('cancelled' in chunk && (chunk as any).cancelled) {
                    // 取消消息（带 content，用于更新计时信息）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'cancelled',
                            content: (chunk as any).content
                        }
                    });
                } else if ('error' in chunk && chunk.error) {
                    hasError = true;
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'error',
                            error: chunk.error
                        }
                    });
                    // 同时响应原始请求以清除超时计时器
                    this.sendError(requestId, chunk.error.code || 'RETRY_ERROR', chunk.error.message);
                }
            }
            
            // 流式处理完成后响应原始请求（如果没有错误）
            if (!hasError) {
                this.sendResponse(requestId, { success: true });
            }
        } catch (error: any) {
            // 如果是取消导致的错误，忽略
            if (abortController.signal.aborted) {
                return;
            }
            
            this._view?.webview.postMessage({
                type: 'streamChunk',
                data: {
                    conversationId,
                    type: 'error',
                    error: {
                        code: error.code || 'RETRY_ERROR',
                        message: error.message
                    }
                }
            });
            // 同时响应原始请求以清除超时计时器
            this.sendError(requestId, error.code || 'RETRY_ERROR', error.message);
        } finally {
            // 清理取消控制器
            this.streamAbortControllers.delete(conversationId);
        }
    }

    /**
     * 处理工具确认响应流式请求
     */
    private async handleToolConfirmationStream(data: any, requestId: string) {
        let hasError = false;
        const conversationId = data.conversationId;
        
        // 创建取消控制器
        const abortController = new AbortController();
        this.streamAbortControllers.set(conversationId, abortController);
        
        try {
            const stream = this.chatHandler.handleToolConfirmation({
                ...data,
                abortSignal: abortController.signal
            });
            
            for await (const chunk of stream) {
                // 不在这里检查 abortController.signal.aborted
                // 让 ChatHandler 检测到取消后 yield cancelled 消息
                
                if ('checkpointOnly' in chunk && chunk.checkpointOnly) {
                    // ChatStreamCheckpointsData - 立即发送检查点
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'checkpoints',
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
                    // ChatStreamToolsExecutingData - 工具即将开始执行（不需要确认的工具）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolsExecuting',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls,
                            toolsExecuting: true
                        }
                    });
                } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
                    // 需要再次确认（连续工具调用）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'awaitingConfirmation',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls
                        }
                    });
                } else if ('chunk' in chunk && chunk.chunk) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'chunk',
                            chunk: chunk.chunk
                        }
                    });
                } else if ('toolIteration' in chunk && chunk.toolIteration) {
                    // ChatStreamToolIterationData - 工具调用迭代完成
                    // 【重要】新增字段时必须在此处同步添加，否则前端无法接收！
                    // 曾因遗漏 pendingAnnotation/annotationUsed 导致工具确认批注丢失
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolIteration',
                            content: chunk.content,
                            toolIteration: true,
                            toolResults: (chunk as any).toolResults,
                            checkpoints: (chunk as any).checkpoints,
                            needAnnotation: (chunk as any).needAnnotation,
                            pendingDiffToolIds: (chunk as any).pendingDiffToolIds,
                            pendingAnnotation: (chunk as any).pendingAnnotation,
                            annotationUsed: (chunk as any).annotationUsed
                        }
                    });
                } else if ('content' in chunk && chunk.content) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'complete',
                            content: chunk.content,
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('cancelled' in chunk && (chunk as any).cancelled) {
                    // 取消消息（带 content，用于更新计时信息）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'cancelled',
                            content: (chunk as any).content
                        }
                    });
                } else if ('error' in chunk && chunk.error) {
                    hasError = true;
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'error',
                            error: chunk.error
                        }
                    });
                    // 同时响应原始请求以清除超时计时器
                    this.sendError(requestId, chunk.error.code || 'TOOL_CONFIRMATION_ERROR', chunk.error.message);
                }
            }
            
            // 流式处理完成后响应原始请求（如果没有错误）
            if (!hasError) {
                this.sendResponse(requestId, { success: true });
            }
        } catch (error: any) {
            // 如果是取消导致的错误，忽略
            if (abortController.signal.aborted) {
                return;
            }
            
            this._view?.webview.postMessage({
                type: 'streamChunk',
                data: {
                    conversationId,
                    type: 'error',
                    error: {
                        code: error.code || 'TOOL_CONFIRMATION_ERROR',
                        message: error.message
                    }
                }
            });
            // 同时响应原始请求以清除超时计时器
            this.sendError(requestId, error.code || 'TOOL_CONFIRMATION_ERROR', error.message);
        } finally {
            // 清理取消控制器
            this.streamAbortControllers.delete(conversationId);
        }
    }

    /**
     * 处理继续对话（带批注）流式请求
     */
    private async handleContinueWithAnnotationStream(data: any, requestId: string) {
        console.log('[handleContinueWithAnnotationStream] ENTRY - requestId:', requestId, 'conversationId:', data.conversationId, 'annotation:', data.annotation);
        let hasError = false;
        const conversationId = data.conversationId;

        // 创建取消控制器
        const abortController = new AbortController();
        this.streamAbortControllers.set(conversationId, abortController);

        try {
            console.log('[handleContinueWithAnnotationStream] calling chatHandler.continueWithAnnotation');
            const stream = this.chatHandler.continueWithAnnotation({
                ...data,
                abortSignal: abortController.signal
            });

            for await (const chunk of stream) {
                if ('checkpointOnly' in chunk && chunk.checkpointOnly) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'checkpoints',
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolsExecuting',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls,
                            toolsExecuting: true
                        }
                    });
                } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'awaitingConfirmation',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls
                        }
                    });
                } else if ('chunk' in chunk && chunk.chunk) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'chunk',
                            chunk: chunk.chunk
                        }
                    });
                } else if ('toolIteration' in chunk && chunk.toolIteration) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolIteration',
                            content: chunk.content,
                            toolIteration: true,
                            toolResults: (chunk as any).toolResults,
                            checkpoints: (chunk as any).checkpoints,
                            needAnnotation: (chunk as any).needAnnotation,
                            pendingDiffToolIds: (chunk as any).pendingDiffToolIds
                        }
                    });
                } else if ('content' in chunk && chunk.content) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'complete',
                            content: chunk.content,
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('cancelled' in chunk && (chunk as any).cancelled) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'cancelled',
                            content: (chunk as any).content
                        }
                    });
                } else if ('error' in chunk && chunk.error) {
                    hasError = true;
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'error',
                            error: chunk.error
                        }
                    });
                    this.sendError(requestId, chunk.error.code || 'CONTINUE_ANNOTATION_ERROR', chunk.error.message);
                }
            }

            if (!hasError) {
                this.sendResponse(requestId, { success: true });
            }
        } catch (error: any) {
            if (abortController.signal.aborted) {
                return;
            }

            this._view?.webview.postMessage({
                type: 'streamChunk',
                data: {
                    conversationId,
                    type: 'error',
                    error: {
                        code: error.code || 'CONTINUE_ANNOTATION_ERROR',
                        message: error.message
                    }
                }
            });
            this.sendError(requestId, error.code || 'CONTINUE_ANNOTATION_ERROR', error.message);
        } finally {
            this.streamAbortControllers.delete(conversationId);
        }
    }

    /**
     * 处理编辑并重试流式请求
     */
    private async handleEditAndRetryStream(data: any, requestId: string) {
        let hasError = false;
        const conversationId = data.conversationId;

        // 创建取消控制器
        const abortController = new AbortController();
        this.streamAbortControllers.set(conversationId, abortController);
        
        try {
            const stream = this.chatHandler.handleEditAndRetryStream({
                ...data,
                abortSignal: abortController.signal
            });
            
            for await (const chunk of stream) {
                // 不在这里检查 abortController.signal.aborted
                // 让 ChatHandler 检测到取消后 yield cancelled 消息
                
                if ('checkpointOnly' in chunk && chunk.checkpointOnly) {
                    // ChatStreamCheckpointsData - 立即发送检查点
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'checkpoints',
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('toolsExecuting' in chunk && chunk.toolsExecuting) {
                    // ChatStreamToolsExecutingData - 工具即将开始执行（不需要确认的工具）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolsExecuting',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls,
                            toolsExecuting: true
                        }
                    });
                } else if ('awaitingConfirmation' in chunk && chunk.awaitingConfirmation) {
                    // ChatStreamToolConfirmationData - 等待用户确认工具执行
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'awaitingConfirmation',
                            content: (chunk as any).content,
                            pendingToolCalls: (chunk as any).pendingToolCalls
                        }
                    });
                } else if ('chunk' in chunk && chunk.chunk) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'chunk',
                            chunk: chunk.chunk
                        }
                    });
                } else if ('toolIteration' in chunk && chunk.toolIteration) {
                    // ChatStreamToolIterationData - 工具调用迭代完成
                    // 【重要】新增字段时必须在此处同步添加，否则前端无法接收！
                    // 曾因遗漏 pendingAnnotation/annotationUsed 导致工具确认批注丢失
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'toolIteration',
                            content: chunk.content,
                            toolIteration: true,
                            toolResults: (chunk as any).toolResults,
                            checkpoints: (chunk as any).checkpoints,
                            needAnnotation: (chunk as any).needAnnotation,
                            pendingDiffToolIds: (chunk as any).pendingDiffToolIds,
                            pendingAnnotation: (chunk as any).pendingAnnotation,
                            annotationUsed: (chunk as any).annotationUsed
                        }
                    });
                } else if ('content' in chunk && chunk.content) {
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'complete',
                            content: chunk.content,
                            checkpoints: (chunk as any).checkpoints
                        }
                    });
                } else if ('cancelled' in chunk && (chunk as any).cancelled) {
                    // 取消消息（带 content，用于更新计时信息）
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'cancelled',
                            content: (chunk as any).content
                        }
                    });
                } else if ('error' in chunk && chunk.error) {
                    hasError = true;
                    this._view?.webview.postMessage({
                        type: 'streamChunk',
                        data: {
                            conversationId: data.conversationId,
                            type: 'error',
                            error: chunk.error
                        }
                    });
                    // 同时响应原始请求以清除超时计时器
                    this.sendError(requestId, chunk.error.code || 'EDIT_RETRY_ERROR', chunk.error.message);
                }
            }
            
            // 流式处理完成后响应原始请求（如果没有错误）
            if (!hasError) {
                this.sendResponse(requestId, { success: true });
            }
        } catch (error: any) {
            // 如果是取消导致的错误，忽略
            if (abortController.signal.aborted) {
                return;
            }
            
            this._view?.webview.postMessage({
                type: 'streamChunk',
                data: {
                    conversationId,
                    type: 'error',
                    error: {
                        code: error.code || 'EDIT_RETRY_ERROR',
                        message: error.message
                    }
                }
            });
            // 同时响应原始请求以清除超时计时器
            this.sendError(requestId, error.code || 'EDIT_RETRY_ERROR', error.message);
        } finally {
            // 清理取消控制器
            this.streamAbortControllers.delete(conversationId);
        }
    }

    /**
     * 处理打开 MCP 配置文件
     */
    private async handleOpenMcpConfigFile(): Promise<void> {
        // MCP 配置文件路径（使用 storagePathManager 支持自定义存储路径）
        const mcpConfigDir = this.storagePathManager.getMcpPath();
        const mcpConfigFile = path.join(mcpConfigDir, 'servers.json');
        
        // 确保目录存在
        const configDirUri = vscode.Uri.file(mcpConfigDir);
        try {
            await vscode.workspace.fs.stat(configDirUri);
        } catch {
            await vscode.workspace.fs.createDirectory(configDirUri);
        }
        
        // 确保配置文件存在
        const configUri = vscode.Uri.file(mcpConfigFile);
        try {
            await vscode.workspace.fs.stat(configUri);
        } catch {
            // 创建空的配置文件（使用对象格式，以 ID 为键）
            const defaultConfig = {
                mcpServers: {}
            };
            await vscode.workspace.fs.writeFile(
                configUri,
                Buffer.from(JSON.stringify(defaultConfig, null, 2), 'utf-8')
            );
        }
        
        // 在 VSCode 编辑器中打开配置文件
        const document = await vscode.workspace.openTextDocument(configUri);
        await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.One
        });
    }
    
    /**
     * 获取所有 MCP 服务器
     */
    private async handleGetMcpServers(): Promise<McpServerInfo[]> {
        return await this.mcpManager.listServers();
    }
    
    /**
     * 验证 MCP 服务器 ID
     */
    private async handleValidateMcpServerId(id: string, excludeId?: string): Promise<{ valid: boolean; error?: string }> {
        return await this.mcpManager.validateServerId(id, excludeId);
    }
    
    /**
     * 创建 MCP 服务器
     */
    private async handleCreateMcpServer(input: CreateMcpServerInput, customId?: string): Promise<string> {
        return await this.mcpManager.createServer(input, customId);
    }
    
    /**
     * 更新 MCP 服务器
     */
    private async handleUpdateMcpServer(serverId: string, updates: UpdateMcpServerInput): Promise<void> {
        await this.mcpManager.updateServer(serverId, updates);
    }
    
    /**
     * 删除 MCP 服务器
     */
    private async handleDeleteMcpServer(serverId: string): Promise<void> {
        await this.mcpManager.deleteServer(serverId);
    }
    
    /**
     * 连接 MCP 服务器
     */
    private async handleConnectMcpServer(serverId: string): Promise<void> {
        await this.mcpManager.connect(serverId);
    }
    
    /**
     * 断开 MCP 服务器
     */
    private async handleDisconnectMcpServer(serverId: string): Promise<void> {
        await this.mcpManager.disconnect(serverId);
    }
    
    /**
     * 设置 MCP 服务器启用状态
     */
    private async handleSetMcpServerEnabled(serverId: string, enabled: boolean): Promise<void> {
        await this.mcpManager.setServerEnabled(serverId, enabled);
    }
    
    /**
     * 检查文件是否存在
     * @param relativePath 相对路径
     * @param workspaceUri 工作区 URI
     */
    private async checkFileExists(relativePath: string, workspaceUri: string): Promise<boolean> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return false;
            }
            
            const workspaceFolder = workspaceFolders.find(f => f.uri.toString() === workspaceUri);
            if (!workspaceFolder) {
                return false;
            }
            
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
            
            try {
                const stat = await vscode.workspace.fs.stat(fileUri);
                return stat.type === vscode.FileType.File;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
    
    /**
     * 验证文件是否在工作区内，并返回相对路径
     * @param filePath 文件路径（可以是 file:// URI、绝对路径或相对路径）
     * @param workspaceUri 工作区 URI（可选，如果不传则自动检测文件所属的工作区）
     */
    private async validateFileInWorkspace(filePath: string, workspaceUri?: string): Promise<{
        valid: boolean;
        relativePath?: string;
        workspaceUri?: string;
        error?: string;
        errorCode?: 'NO_WORKSPACE' | 'WORKSPACE_NOT_FOUND' | 'INVALID_URI' | 'NOT_FILE' | 'FILE_NOT_EXISTS' | 'NOT_IN_ANY_WORKSPACE' | 'NOT_IN_CURRENT_WORKSPACE' | 'UNKNOWN';
    }> {
        try {
            // 查找匹配的工作区文件夹
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return { valid: false, error: t('webview.errors.noWorkspaceOpen'), errorCode: 'NO_WORKSPACE' };
            }
            
            // 判断路径类型并创建 URI
            let fileUri: vscode.Uri;
            
            if (filePath.startsWith('file://')) {
                // file:// URI 格式（从资源管理器或标签页拖拽）
                try {
                    fileUri = vscode.Uri.parse(filePath);
                } catch {
                    return { valid: false, error: t('webview.errors.invalidFileUri'), errorCode: 'INVALID_URI' };
                }
            } else if (path.isAbsolute(filePath)) {
                // 绝对路径
                fileUri = vscode.Uri.file(filePath);
            } else {
                // 相对路径，基于指定的工作区根目录（如果提供）或当前工作区
                const targetWorkspace = workspaceUri
                    ? workspaceFolders.find(f => f.uri.toString() === workspaceUri)
                    : workspaceFolders[0];
                if (!targetWorkspace) {
                    return { valid: false, error: t('webview.errors.workspaceNotFound'), errorCode: 'WORKSPACE_NOT_FOUND' };
                }
                fileUri = vscode.Uri.joinPath(targetWorkspace.uri, filePath);
            }
            
            // 检查文件是否存在
            try {
                const stat = await vscode.workspace.fs.stat(fileUri);
                if (stat.type !== vscode.FileType.File) {
                    return { valid: false, error: t('webview.errors.pathNotFile'), errorCode: 'NOT_FILE' };
                }
            } catch {
                return { valid: false, error: t('webview.errors.fileNotExists'), errorCode: 'FILE_NOT_EXISTS' };
            }
            
            // 检查文件属于哪个工作区
            const belongingWorkspace = vscode.workspace.getWorkspaceFolder(fileUri);
            
            if (!belongingWorkspace) {
                // 文件不在任何打开的工作区内
                return {
                    valid: false,
                    error: t('webview.errors.fileNotInAnyWorkspace'),
                    errorCode: 'NOT_IN_ANY_WORKSPACE'
                };
            }
            
            // 如果指定了目标工作区，检查文件是否在该工作区内
            if (workspaceUri && belongingWorkspace.uri.toString() !== workspaceUri) {
                // 文件在其他工作区内，而不是当前指定的工作区
                const belongingWorkspaceName = belongingWorkspace.name;
                return {
                    valid: false,
                    error: t('webview.errors.fileInOtherWorkspace', { workspaceName: belongingWorkspaceName }),
                    errorCode: 'NOT_IN_CURRENT_WORKSPACE'
                };
            }
            
            // 获取相对路径
            const relativePath = vscode.workspace.asRelativePath(fileUri, false);
            
            return {
                valid: true,
                relativePath,
                workspaceUri: belongingWorkspace.uri.toString()
            };
        } catch (error: any) {
            return { valid: false, error: error.message, errorCode: 'UNKNOWN' };
        }
    }
    
    /**
     * 在文件管理器中显示对话文件
     */
    private async handleRevealConversationInExplorer(conversationId: string): Promise<void> {
        // 构建对话文件路径
        // 使用 storagePathManager 获取正确的对话目录（支持自定义存储路径）
        const conversationsDir = this.storagePathManager.getConversationsPath();
        const conversationFile = vscode.Uri.file(path.join(conversationsDir, `${conversationId}.json`));
        
        // 检查文件是否存在
        try {
            await vscode.workspace.fs.stat(conversationFile);
        } catch {
            throw new Error(t('webview.errors.conversationFileNotExists'));
        }
        
        // 使用 VSCode 命令在文件管理器中显示并选中文件
        await vscode.commands.executeCommand('revealFileInOS', conversationFile);
    }
    
    /**
     * 处理打开 diff 预览（用于查看历史中的修改）
     */
    private async handleOpenDiffPreview(data: {
        toolId: string;
        toolName: string;
        filePaths: string[];
        args: Record<string, unknown>;
        result?: Record<string, unknown>;
    }): Promise<void> {
        const { toolName, filePaths, args, result } = data;
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error(t('webview.errors.noWorkspaceOpen'));
        }
        
        if (toolName === 'apply_diff') {
            // 对于 apply_diff，显示完整文件的差异
            const filePath = args.path as string;
            const diffs = args.diffs as Array<{ search: string; replace: string; start_line?: number }>;
            
            if (!filePath || !diffs || diffs.length === 0) {
                throw new Error(t('webview.errors.invalidDiffData'));
            }
            
            // 优先使用 result 中的完整文件内容（如果有）
            const resultData = result?.data as Record<string, unknown> | undefined;
            let fullOriginalContent = resultData?.originalContent as string | undefined;
            let fullNewContent = resultData?.newContent as string | undefined;
            
            // 如果有 diffContentId，按需加载 diff 内容
            const diffContentId = resultData?.diffContentId as string | undefined;
            if (diffContentId && (!fullOriginalContent || !fullNewContent)) {
                try {
                    const loadedContent = await this.diffStorageManager.loadGlobalDiff(diffContentId);
                    if (loadedContent) {
                        fullOriginalContent = loadedContent.originalContent;
                        fullNewContent = loadedContent.newContent;
                    }
                } catch (e) {
                    console.warn('Failed to load diff content:', e);
                }
            }
            
            let originalContent: string;
            let newContent: string;
            let diffTitle: string;
            
            if (fullOriginalContent && fullNewContent) {
                // 使用完整文件内容进行差异对比
                originalContent = fullOriginalContent;
                newContent = fullNewContent;
                diffTitle = t('webview.messages.fullFileDiffPreview', { filePath });
            } else {
                // 回退：只显示 search/replace 块
                originalContent = diffs.map((d, i) => `// === Diff #${i + 1}${d.start_line ? ` (Line ${d.start_line})` : ''} ===\n${d.search}`).join('\n\n');
                newContent = diffs.map((d, i) => `// === Diff #${i + 1}${d.start_line ? ` (Line ${d.start_line})` : ''} ===\n${d.replace}`).join('\n\n');
                diffTitle = t('webview.messages.historyDiffPreview', { filePath });
            }
            
            // 创建虚拟文档 URI
            const originalUri = vscode.Uri.parse(`limcode-diff-preview:original/${encodeURIComponent(filePath)}`);
            const newUri = vscode.Uri.parse(`limcode-diff-preview:modified/${encodeURIComponent(filePath)}`);
            
            // 注册内容到提供者
            this.diffPreviewProvider.setContent(originalUri.toString(), originalContent);
            this.diffPreviewProvider.setContent(newUri.toString(), newContent);
            
            // 打开 diff 视图（使用 preview: false 确保即使多次点击也能保留独立的标签页）
            await vscode.commands.executeCommand('vscode.diff', originalUri, newUri, diffTitle, {
                preview: false
            });
            
        } else if (toolName === 'search_in_files') {
            // 对于 search_in_files 的替换模式，显示每个文件的差异
            const resultData = result?.data as Record<string, unknown> | undefined;
            const isReplaceMode = resultData?.isReplaceMode as boolean | undefined;
            
            if (!isReplaceMode) {
                throw new Error(t('webview.errors.searchNotReplaceMode'));
            }
            
            const replaceResults = resultData?.results as Array<{
                file: string;
                replacements: number;
                diffContentId?: string;
            }> | undefined;
            
            if (!replaceResults || replaceResults.length === 0) {
                throw new Error(t('webview.errors.noReplaceResults'));
            }
            
            // 为每个文件打开 diff 视图
            for (const replaceResult of replaceResults) {
                if (!replaceResult.diffContentId) {
                    continue;
                }
                
                try {
                    const loadedContent = await this.diffStorageManager.loadGlobalDiff(replaceResult.diffContentId);
                    if (loadedContent) {
                        const originalContent = loadedContent.originalContent;
                        const newContent = loadedContent.newContent;
                        const diffTitle = t('webview.messages.searchReplaceDiffPreview', { filePath: replaceResult.file });
                        
                        // 创建虚拟文档 URI
                        const originalUri = vscode.Uri.parse(`limcode-diff-preview:original/${encodeURIComponent(replaceResult.file)}`);
                        const newUri = vscode.Uri.parse(`limcode-diff-preview:modified/${encodeURIComponent(replaceResult.file)}`);
                        
                        // 注册内容到提供者
                        this.diffPreviewProvider.setContent(originalUri.toString(), originalContent);
                        this.diffPreviewProvider.setContent(newUri.toString(), newContent);
                        
                        // 打开 diff 视图（使用 preview: false 确保每个文件都有独立的标签页）
                        await vscode.commands.executeCommand('vscode.diff', originalUri, newUri, diffTitle, {
                            preview: false
                        });
                    }
                } catch (e) {
                    console.warn('Failed to load diff content for search_in_files:', e);
                }
            }
            
        } else if (toolName === 'write_file') {
            // 对于 write_file，显示写入的内容差异
            const files = args.files as Array<{ path: string; content: string }>;
            
            if (!files || files.length === 0) {
                throw new Error(t('webview.errors.noFileContent'));
            }
            
            // 从 result 中获取每个文件的 diffContentId
            const resultData = result?.data as Record<string, unknown> | undefined;
            const writeResults = resultData?.results as Array<{
                path: string;
                diffContentId?: string;
                action?: 'created' | 'modified' | 'unchanged';
            }> | undefined;
            
            // 创建路径到 diffContentId 的映射
            const diffContentIdMap = new Map<string, string>();
            if (writeResults) {
                for (const r of writeResults) {
                    if (r.diffContentId) {
                        diffContentIdMap.set(r.path, r.diffContentId);
                    }
                }
            }
            
            // 处理每个文件
            for (const file of files) {
                let originalContent = '';
                let newContent = file.content;
                let diffTitle: string;
                
                // 尝试使用 diffContentId 加载完整的 diff 内容
                const diffContentId = diffContentIdMap.get(file.path);
                if (diffContentId) {
                    try {
                        const loadedContent = await this.diffStorageManager.loadGlobalDiff(diffContentId);
                        if (loadedContent) {
                            originalContent = loadedContent.originalContent;
                            newContent = loadedContent.newContent;
                            diffTitle = t('webview.messages.fullFileDiffPreview', { filePath: file.path });
                        } else {
                            // 加载失败，作为新建文件预览
                            diffTitle = t('webview.messages.newFileContentPreview', { filePath: file.path });
                        }
                    } catch (e) {
                        console.warn('Failed to load diff content for write_file:', e);
                        diffTitle = t('webview.messages.newFileContentPreview', { filePath: file.path });
                    }
                } else {
                    // 没有 diffContentId，作为新建文件预览
                    diffTitle = t('webview.messages.newFileContentPreview', { filePath: file.path });
                }
                
                // 创建虚拟文档 URI
                const originalUri = vscode.Uri.parse(`limcode-diff-preview:original/${encodeURIComponent(file.path)}`);
                const newUri = vscode.Uri.parse(`limcode-diff-preview:modified/${encodeURIComponent(file.path)}`);
                
                // 注册内容到提供者
                this.diffPreviewProvider.setContent(originalUri.toString(), originalContent);
                this.diffPreviewProvider.setContent(newUri.toString(), newContent);
                
                // 打开 diff 视图（使用 preview: false 确保每个文件都有独立的标签页）
                await vscode.commands.executeCommand('vscode.diff', originalUri, newUri, diffTitle, {
                    preview: false
                });
            }
        } else {
            throw new Error(t('webview.errors.unsupportedToolType', { toolName }));
        }
    }
    
    /**
     * 保存图片到指定路径（覆盖保存）
     */
    private async handleSaveImageToPath(data: {
        data: string;
        mimeType: string;
        path: string;
    }): Promise<void> {
        const { data: base64Data, path: imgPath } = data;
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error(t('webview.errors.noWorkspaceOpen'));
        }
        
        // 构建完整的文件 URI
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, imgPath);
        
        // 确保目录存在
        const dirUri = vscode.Uri.joinPath(fileUri, '..');
        try {
            await vscode.workspace.fs.createDirectory(dirUri);
        } catch {
            // 目录可能已存在
        }
        
        // 将 base64 转换为 Buffer 并写入文件
        const buffer = Buffer.from(base64Data, 'base64');
        await vscode.workspace.fs.writeFile(fileUri, buffer);
    }
    
    /**
     * 在 VSCode 中打开工作区文件
     * 用于点击图片时在编辑器中预览
     */
    private async handleOpenWorkspaceFile(data: { path: string }): Promise<void> {
        const { path: filePath } = data;
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error(t('webview.errors.noWorkspaceOpen'));
        }
        
        // 构建完整的文件 URI
        const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
        
        // 检查文件是否存在
        try {
            await vscode.workspace.fs.stat(fileUri);
        } catch {
            throw new Error(t('webview.errors.fileNotExists'));
        }
        
        // 使用 VSCode 打开文件
        await vscode.commands.executeCommand('vscode.open', fileUri);
    }
    
    /**
     * 读取工作区中的图片文件
     * 用于在 Markdown 中显示相对路径的图片
     */
    private async handleReadWorkspaceImage(data: { path: string }): Promise<{
        success: boolean;
        data?: string;
        mimeType?: string;
        error?: string;
    }> {
        const { path: imgPath } = data;
        
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return { success: false, error: t('webview.errors.noWorkspaceOpen') };
        }
        
        try {
            // 构建完整的文件 URI
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, imgPath);
            
            // 读取文件内容
            const content = await vscode.workspace.fs.readFile(fileUri);
            
            // 根据扩展名确定 MIME 类型
            const ext = path.extname(imgPath).toLowerCase();
            let mimeType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') {
                mimeType = 'image/jpeg';
            } else if (ext === '.gif') {
                mimeType = 'image/gif';
            } else if (ext === '.webp') {
                mimeType = 'image/webp';
            } else if (ext === '.svg') {
                mimeType = 'image/svg+xml';
            } else if (ext === '.bmp') {
                mimeType = 'image/bmp';
            }
            
            // 转换为 base64
            const base64 = Buffer.from(content).toString('base64');
            
            return {
                success: true,
                data: base64,
                mimeType
            };
        } catch (error: any) {
            return {
                success: false,
                error: `无法读取图片: ${error.message}`
            };
        }
    }
    
    /**
     * 处理附件预览（将 base64 写入临时文件并用 VSCode 打开）
     */
    private async handlePreviewAttachment(data: {
        name: string;
        mimeType: string;
        data: string;
    }): Promise<void> {
        const { name, mimeType, data: base64Data } = data;
        
        // 创建临时目录
        const tempDir = path.join(os.tmpdir(), 'limcode-preview');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // 生成唯一文件名避免冲突
        const timestamp = Date.now();
        const safeFileName = name.replace(/[<>:"/\\|?*]/g, '_');
        const tempFilePath = path.join(tempDir, `${timestamp}_${safeFileName}`);
        
        // 将 base64 转换为 Buffer 并写入文件
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(tempFilePath, buffer);
        
        // 使用 VSCode 打开文件（VSCode 会根据文件类型自动选择打开方式）
        const uri = vscode.Uri.file(tempFilePath);
        await vscode.commands.executeCommand('vscode.open', uri);
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