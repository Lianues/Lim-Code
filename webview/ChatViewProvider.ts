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
import { SettingsManager, VSCodeSettingsStorage, StoragePathManager } from '../backend/modules/settings';
import type { StoragePathConfig, StorageStats, SettingsChangeEvent } from '../backend/modules/settings';
import { SettingsHandler } from '../backend/modules/api/settings';
import { CheckpointManager } from '../backend/modules/checkpoint';
import { McpManager, VSCodeFileSystemMcpStorageAdapter } from '../backend/modules/mcp';
import type { CreateMcpServerInput, UpdateMcpServerInput, McpServerInfo } from '../backend/modules/mcp';
import { DependencyManager, type InstallProgressEvent } from '../backend/modules/dependencies';
import { toolRegistry, registerAllTools, onTerminalOutput, onImageGenOutput, TaskManager, setSubAgentExecutorContext } from '../backend/tools';
import type { TerminalOutputEvent, ImageGenOutputEvent, TaskEvent } from '../backend/tools';
import { createSkillsManager, getSkillsManager } from '../backend/modules/skills';
import {
    setGlobalSettingsManager,
    setGlobalConfigManager,
    setGlobalChannelManager,
    setGlobalToolRegistry,
    setGlobalDiffStorageManager,
    setGlobalMcpManager
} from '../backend/core/settingsContext';
import { DiffStorageManager } from '../backend/modules/conversation';
import { getDiffManager } from '../backend/tools/file/diffManager';
import { MessageRouter } from './MessageRouter';
import { WEBVIEW_CLIENT_IDS, WebviewClientRegistry } from './runtime/WebviewClientRegistry';
import type { RunScope } from '../backend/core/RunController';
import { initializeSubAgentsFromSettings } from './handlers/SubAgentsHandlers';
import type { HandlerContext, DiffPreviewContentProvider as IDiffPreviewContentProvider } from './types';
import { WindowsAgentStopNotificationService } from '../backend/modules/notifications/WindowsAgentStopNotificationService';
import { SubAgentMonitorPanel } from './SubAgentMonitorPanel';
import { subAgentRuntimeLedgerBridge } from '../backend/tools/subagents/runtimeLedgerBridge';
import { chatStreamRuntimeLedgerBridge } from './stream/runtimeLedgerBridge';
import { TerminalOutputProjectionStore } from './terminalOutputProjection';

/**
 * Diff 预览内容提供者
 */
class DiffPreviewContentProvider implements vscode.TextDocumentContentProvider, IDiffPreviewContentProvider {
    private contents: Map<string, string> = new Map();
    private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    
    public onDidChange = this.onDidChangeEmitter.event;
    
    public setContent(uri: string, content: string): void {
        const prev = this.contents.get(uri);
        this.contents.set(uri, content);

        // 关键：当同一个 diff 预览标签已打开时，必须主动触发 onDidChange，
        // 否则 VSCode 不会重新拉取 provideTextDocumentContent，看起来像“按钮没反应”。
        if (prev !== content) {
            this.onDidChangeEmitter.fire(vscode.Uri.parse(uri));
        }
    }
    
    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.contents.get(uri.toString()) || '';
    }
    
    public dispose(): void {
        this.contents.clear();
        this.onDidChangeEmitter.dispose();
    }
}

interface HiddenWebviewPush {
    message: Record<string, any>;
    count: number;
    firstHiddenAt: number;
    lastHiddenAt: number;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    // Commands may be sent before the webview JS is ready. Queue them until we get a ready handshake.
    private webviewReady = false;
    private pendingCommands: Array<{ command: string; data?: any }> = [];
    
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
    private conversationStorageAdapter?: FileSystemStorageAdapter;
    private windowsAgentStopNotificationService?: WindowsAgentStopNotificationService;
    private subAgentMonitorPanel?: SubAgentMonitorPanel;
    private mainChatClientDisposable?: vscode.Disposable;
    private mainChatVisibilityDisposable?: vscode.Disposable;
    private readonly webviewClientRegistry = new WebviewClientRegistry();
    private readonly hiddenMainChatPushes = new Map<string, HiddenWebviewPush>();
    private readonly terminalOutputProjectionStore = new TerminalOutputProjectionStore();
    
    // 消息路由器
    private messageRouter!: MessageRouter;
    
    // 事件取消订阅函数
    private terminalOutputUnsubscribe?: () => void;
    private imageGenOutputUnsubscribe?: () => void;
    private taskEventUnsubscribe?: () => void;
    private dependencyProgressUnsubscribe?: () => void;
    
    // 初始化状态
    private initPromise: Promise<void>;

    // 消息处理队列，用于确保消息按顺序处理（解决技能切换与对话请求的竞态问题）
    private messageHandlingQueue: Promise<void> = Promise.resolve();

    // 本地开发模式：前端 Vite 开发服务器地址（仅在 ExtensionMode.Development 生效）
    private readonly webviewDevServerUrl?: string;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.webviewDevServerUrl = this.resolveWebviewDevServerUrl();
        const startupMode = this.getExtensionModeLabel();
        const webviewAssetsSource = this.webviewDevServerUrl
            ? `vite-dev-server(${this.webviewDevServerUrl})`
            : 'frontend/dist';
        console.log(
            `[LimCode][Startup] mode=${startupMode}, extensionPath=${this.context.extensionPath}, webviewAssets=${webviewAssetsSource}`
        );

        // 初始化 Diff 预览内容提供者
        this.diffPreviewProvider = new DiffPreviewContentProvider();
        this.diffPreviewProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
            'limcode-diff-preview',
            this.diffPreviewProvider
        );
        context.subscriptions.push(this.diffPreviewProviderDisposable);
        
        // 初始时拒绝所有之前的 diff（例如重载窗口）
        getDiffManager().rejectAll().catch(() => {});
        
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
        const legacySettingsDir = path.join(this.context.globalStorageUri.fsPath, 'settings');
        const settingsStorage = new VSCodeSettingsStorage({
            legacySettingsDir
        });
        this.settingsManager = new SettingsManager(settingsStorage);
        await this.settingsManager.initialize();
        this.windowsAgentStopNotificationService = new WindowsAgentStopNotificationService({ settingsManager: this.settingsManager });
        
        // 2. 初始化存储路径管理器
        this.storagePathManager = new StoragePathManager(this.settingsManager, this.context);
        await this.storagePathManager.ensureDirectories();
        
        // 3. 获取有效的数据存储路径（可能是自定义路径）
        const effectiveDataUri = this.storagePathManager.getEffectiveDataUri();
        
        // 4. 初始化存储适配器（使用文件系统存储，避免 globalState 过大）
        const storageAdapter = new FileSystemStorageAdapter(vscode, effectiveDataUri);
        this.conversationStorageAdapter = storageAdapter;
        
        // 5. 初始化 Diff 存储管理器（用于 apply_diff 的大文件内容抽离）
        this.diffStorageManager = DiffStorageManager.initialize(this.storagePathManager.getEffectiveDataPath());
        setGlobalDiffStorageManager(this.diffStorageManager);

        const runtimeLedgerPath = path.join(this.storagePathManager.getEffectiveDataPath(), 'runtime-ledger');
        subAgentRuntimeLedgerBridge.configureDurableStore(path.join(runtimeLedgerPath, 'subagent-events.jsonl'));
        chatStreamRuntimeLedgerBridge.configureDurableStore(path.join(runtimeLedgerPath, 'chat-stream-events.jsonl'));
        
        // 6. 初始化对话管理器
        this.conversationManager = new ConversationManager(storageAdapter);

        // 6.1 后台迁移旧版单文件历史到分段存储格式，不阻塞主初始化链路
        void storageAdapter.migrateLegacyConversationsToSegmented().then(result => {
            console.log(`[LimCode][ConversationMigration] migrated=${result.migrated}, skipped=${result.skipped}, failed=${result.failed.length}`);
            if (result.failed.length > 0) {
                console.warn('[LimCode][ConversationMigration] failed conversations:', result.failed);
            }
        }).catch(error => {
            console.warn('[LimCode][ConversationMigration] background migration failed:', error);
        });
        
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

        // 10.1 监听设置变更：apply_diff 自动应用开关/延迟变更时，让现有 pending diff 立即生效
        const settingsChangeListener = (event: SettingsChangeEvent) => {
            if (event.type === 'tools' && event.path === 'toolsConfig.apply_diff') {
                try {
                    // 对已存在的 pending diff 重新调度/取消自动保存
                    getDiffManager().refreshAutoSaveTimers();
                } catch (e) {
                    console.warn('[ChatViewProvider] Failed to refresh diff autoSave timers:', e);
                }

                // 推送最新配置到前端（用于更新倒计时/自动确认 UI）
                try {
                    const config = event.settings?.toolsConfig?.apply_diff || this.settingsManager.getApplyDiffConfig();
                    this.sendCommand('tools.applyDiffConfigChanged', { config });
                } catch {
                    // ignore
                }
            }
        };
        this.settingsManager.addChangeListener(settingsChangeListener);
        this.context.subscriptions.push({
            dispose: () => this.settingsManager.removeChangeListener(settingsChangeListener)
        });
        
        // 11. 初始化 Skills 管理器（必须在注册工具之前，因为 skills 工具需要它）
        await createSkillsManager({
            workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            globalStoragePath: this.storagePathManager.getEffectiveDataPath(),
            // 为什么要改：using-subagents、write-a-skill 以及未来内置 Skill 都应作为通用 builtin 来源进入现有 Skill 系统。
            // 怎么改：由 VS Code 宿主把扩展安装目录下的 resources/skills 路径传给 SkillsManager，而不是在 loader 里硬编码插件路径。
            // 目的：内置 Skill 复用 read_skill、manifest、启停设置和诊断链路，新增内置 Skill 时无需再改业务逻辑。
            builtinSkillsPath: typeof this.context.asAbsolutePath === 'function'
                ? this.context.asAbsolutePath(path.join('resources', 'skills'))
                : path.join(this.context.extensionPath, 'resources', 'skills'),
        });
        
        // 11.1 从 settingsManager 同步 skills 状态到 SkillsManager
        await this.syncSkillsState();
        
        // 12. 注册所有工具到工具注册器（必须在 ChannelManager 之前）
        registerAllTools(toolRegistry);
        
        // 13. 初始化渠道管理器（传入工具注册器和设置管理器）
        this.channelManager = new ChannelManager(this.configManager, toolRegistry, this.settingsManager);
        
        // 14. 设置重试状态回调
        this.channelManager.setRetryStatusCallback((status) => {
            this.handleRetryStatus(status);
        });
        
        // 15. 设置全局渠道管理器引用
        setGlobalChannelManager(this.channelManager);
        
        // 16. 初始化检查点管理器（使用自定义路径）
        this.checkpointManager = new CheckpointManager(
            this.settingsManager,
            this.conversationManager,
            this.context,
            this.storagePathManager.getEffectiveDataPath()
        );
        await this.checkpointManager.initialize();
        
        // 17. 初始化聊天处理器（传入工具注册器和检查点管理器）
        this.chatHandler = new ChatHandler(
            this.configManager,
            this.channelManager,
            this.conversationManager,
            toolRegistry
        );
        this.chatHandler.setCheckpointManager(this.checkpointManager);
        this.chatHandler.setSettingsManager(this.settingsManager);
        this.chatHandler.setDiffStorageManager(this.diffStorageManager);
        
        // 18. 初始化模型管理处理器
        this.modelsHandler = new ModelsHandler(this.configManager, this.settingsManager);
        
        // 19. 初始化设置处理器（传入工具注册器）
        this.settingsHandler = new SettingsHandler(this.settingsManager, toolRegistry);
        this.settingsHandler.setConversationManager(this.conversationManager);
        
        // 20. 订阅终端输出事件
        this.terminalOutputUnsubscribe = onTerminalOutput((event) => {
            this.handleTerminalOutputEvent(event);
        });
        
        // 21. 订阅图像生成输出事件
        this.imageGenOutputUnsubscribe = onImageGenOutput((event) => {
            this.handleImageGenOutputEvent(event);
        });
        
        // 22. 订阅统一任务事件（用于未来扩展）
        this.taskEventUnsubscribe = TaskManager.onTaskEvent((event) => {
            this.handleTaskEvent(event);
        });
        
        // 23. 初始化 MCP 管理器（使用自定义路径下的 mcp 目录）
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
        
        // 24. 将 MCP 管理器连接到 ChannelManager（用于工具声明）
        this.channelManager.setMcpManager(this.mcpManager);
        
        // 25. 将 MCP 管理器连接到 ChatHandler（用于工具调用）
        this.chatHandler.setMcpManager(this.mcpManager);
        
        // 25.5. 设置全局 MCP 管理器（用于 subagents 工具描述）
        setGlobalMcpManager(this.mcpManager);
        
        // 25.6. 设置 SubAgent 执行器上下文
        setSubAgentExecutorContext({
            channelManager: this.channelManager,
            toolRegistry: toolRegistry,
            mcpManager: this.mcpManager,
            settingsManager: this.settingsManager,
            // SubAgent 使用自己的 provider 配置，但工具执行复用主流程 ToolExecutionService，避免复制工具调用语义。
            configManager: this.configManager,
            toolExecutionService: this.chatHandler.getToolExecutionService()
        });
        
        // 26. 初始化依赖管理器（使用自定义路径）
        this.dependencyManager = DependencyManager.getInstance(
            this.context,
            this.storagePathManager.getDependenciesPath()
        );
        await this.dependencyManager.initialize();
        
        // 27. 设置依赖检查器到工具注册器（用于过滤未安装依赖的工具）
        toolRegistry.setDependencyChecker({
            isInstalled: (name: string) => this.dependencyManager.isInstalledSync(name)
        });
        
        // 28. 订阅依赖安装进度事件
        this.dependencyProgressUnsubscribe = this.dependencyManager.onProgress((event) => {
            this.handleDependencyProgressEvent(event);
        });
        
        // 29. 初始化消息路由器
        this.messageRouter = new MessageRouter(
            this.chatHandler,
            this.conversationManager,
            this.settingsManager,
            () => this._view,
            this.sendResponse.bind(this),
            this.sendError.bind(this),
            this.webviewClientRegistry
        );
        
        // 30. 初始化子代理（从持久化存储加载）
        this.initializeSubAgents();
        
        // 30.5. 初始化 SubAgent Monitor 编辑器页管理器：内部过程进独立 WebviewPanel，不污染主聊天时间线。
        this.subAgentMonitorPanel = new SubAgentMonitorPanel(
            this.context,
            this.webviewDevServerUrl,
            this.routeSubAgentMonitorMessage.bind(this),
            this.registerWebviewClient.bind(this),
            // 修改原因：Monitor 直接处理 monitorReady/getRunWindow，不经过 MessageRouter，历史 run 恢复仍需要 conversation metadata seam。
            // 修改方式：把现有 ConversationManager 以 SubAgentRunConversationStore 接口注入面板，而不是在路由器里按 endpoint 写特判。
            // 修改目的：遵守 clientId 路由边界，同时让 Monitor 首屏 manifest 可覆盖历史子对话。
            this.conversationManager,
            (clientId, visible, source, reason) => this.updateWebviewVisibility(clientId, visible, source, reason)
        );
        

        console.log('LimCode backend initialized with global context');
        console.log('Effective data path:', this.storagePathManager.getEffectiveDataPath());
    }
    
    /**
     * 处理终端输出事件，推送到前端
     */
    private handleTerminalOutputEvent(event: TerminalOutputEvent): void {
        this.postMainChatPushMessage('terminalOutput', this.terminalOutputProjectionStore.project(event));
    }
    
    /**
     * 处理图像生成输出事件，推送到前端
     */
    private handleImageGenOutputEvent(event: ImageGenOutputEvent): void {
        this.postMainChatPushMessage('imageGenOutput', event);
    }
    
    /**
     * 处理统一任务事件，推送到前端
     */
    private handleTaskEvent(event: TaskEvent): void {
        this.postMainChatPushMessage('taskEvent', event);
    }
    
    /**
     * 处理依赖安装进度事件，推送到前端
     */
    private handleDependencyProgressEvent(event: InstallProgressEvent): void {
        this.postMainChatPushMessage('dependencyProgress', event);
    }
    
    /** 打开或聚焦 SubAgent Monitor；主聊天只保留摘要，完整内部过程放在编辑器区域。 */
    private openSubAgentMonitor(runId?: string, conversationId?: string): void {
        if (!this.subAgentMonitorPanel) {
            this.subAgentMonitorPanel = new SubAgentMonitorPanel(
                this.context,
                this.webviewDevServerUrl,
                this.routeSubAgentMonitorMessage.bind(this),
                this.registerWebviewClient.bind(this),
                // 修改原因：懒创建 Monitor 面板也必须具备历史 run manifest/window 加载能力。
                // 修改方式：传入同一个 ConversationManager seam，避免面板自行寻找全局状态。
                // 修改目的：保持 SubAgentTranscriptRepository/RunController 语义单一。
                this.conversationManager,
                (clientId, visible, source, reason) => this.updateWebviewVisibility(clientId, visible, source, reason)
            );
        }
        this.subAgentMonitorPanel.open(runId, conversationId);
    }


    /**
     * 从 SubAgent Monitor WebviewPanel 路由业务请求。
     * Monitor 复用主聊天 MessageRouter/HandlerContext，响应按 clientId 回到发起的 panel，避免复制 handler。
     */
    private normalizeClientId(clientId: unknown, fallback: string): string {
        return typeof clientId === 'string' && clientId.trim() ? clientId.trim() : fallback;
    }

    private postRoutedWebviewMessage(clientId: string, message: Record<string, any>, fallbackWebview?: vscode.Webview): void {
        // 保持 response/error/command 旧 shape，仅追加 clientId；registry 未命中时回退旧 webview。
        const routedMessage = { ...message, clientId };
        if (this.webviewClientRegistry.postMessage(clientId, routedMessage)) {
            return;
        }
        fallbackWebview?.postMessage(routedMessage);
    }

    private registerWebviewClient(clientId: string, webview: vscode.Webview, runScope?: RunScope): vscode.Disposable {
        return this.webviewClientRegistry.register({
            clientId,
            runScope,
            webviewHost: { webview },
            postMessage: (message) => webview.postMessage(message)
        });
    }

    private updateWebviewVisibility(clientId: string, visible: boolean, source: 'vscode' | 'frontend', reason?: string): void {
        this.webviewClientRegistry.setVisibility(clientId, visible, source, reason);
        if (clientId === WEBVIEW_CLIENT_IDS.mainChat && visible) {
            this.messageRouter?.flushHiddenStreamTransports();
            this.flushHiddenMainChatPushes();
        }
    }

    private handleVisibilityChangedMessage(
        clientId: string,
        data: any,
        requestId?: string,
        fallbackWebview?: vscode.Webview
    ): void {
        const visible = typeof data?.visible === 'boolean'
            ? data.visible
            : data?.hidden === true
                ? false
                : true;
        const reason = typeof data?.visibilityState === 'string'
            ? data.visibilityState
            : typeof data?.source === 'string'
                ? data.source
                : undefined;

        this.updateWebviewVisibility(clientId, visible, 'frontend', reason);

        if (requestId) {
            this.postRoutedWebviewMessage(clientId, {
                type: 'response',
                requestId,
                success: true,
                data: {
                    success: true,
                    visible
                }
            }, fallbackWebview);
        }
    }

    private handleRuntimeLedgerTerminalContentWindowMessage(
        clientId: string,
        data: any,
        requestId?: string,
        fallbackWebview?: vscode.Webview
    ): void {
        if (!requestId) return;

        const refId = typeof data?.refId === 'string' ? data.refId.trim() : '';
        if (!refId) {
            this.postRoutedWebviewMessage(clientId, {
                type: 'error',
                requestId,
                success: false,
                error: { code: 'INVALID_RUNTIME_LEDGER_REF', message: 'Missing Runtime Ledger terminal content refId' }
            }, fallbackWebview);
            return;
        }

        const window = chatStreamRuntimeLedgerBridge.getTerminalContentWindow(refId, {
            startBytes: typeof data?.startBytes === 'number' ? data.startBytes : undefined,
            maxBytes: typeof data?.maxBytes === 'number' ? data.maxBytes : undefined,
            includePayload: typeof data?.includePayload === 'boolean' ? data.includePayload : undefined
        });
        if (!window) {
            this.postRoutedWebviewMessage(clientId, {
                type: 'error',
                requestId,
                success: false,
                error: { code: 'RUNTIME_LEDGER_REF_NOT_FOUND', message: `Runtime Ledger terminal content ref not found: ${refId}` }
            }, fallbackWebview);
            return;
        }

        this.postRoutedWebviewMessage(clientId, {
            type: 'response',
            requestId,
            success: true,
            data: window
        }, fallbackWebview);
    }

    private handleTerminalOutputWindowMessage(
        clientId: string,
        data: any,
        requestId?: string,
        fallbackWebview?: vscode.Webview
    ): void {
        if (!requestId) return;

        const refId = typeof data?.refId === 'string' ? data.refId.trim() : '';
        if (!refId) {
            this.postRoutedWebviewMessage(clientId, {
                type: 'error',
                requestId,
                success: false,
                error: { code: 'INVALID_TERMINAL_OUTPUT_REF', message: 'Missing terminal output refId' }
            }, fallbackWebview);
            return;
        }

        const window = this.terminalOutputProjectionStore.getWindow(refId, {
            startBytes: typeof data?.startBytes === 'number' ? data.startBytes : undefined,
            maxBytes: typeof data?.maxBytes === 'number' ? data.maxBytes : undefined,
            includePayload: typeof data?.includePayload === 'boolean' ? data.includePayload : undefined
        });
        if (!window) {
            this.postRoutedWebviewMessage(clientId, {
                type: 'error',
                requestId,
                success: false,
                error: { code: 'TERMINAL_OUTPUT_REF_NOT_FOUND', message: `Terminal output ref not found: ${refId}` }
            }, fallbackWebview);
            return;
        }

        this.postRoutedWebviewMessage(clientId, {
            type: 'response',
            requestId,
            success: true,
            data: window
        }, fallbackWebview);
    }

    private postMainChatPushMessage(type: string, data: any): void {
        if (!this._view) return;

        const message = { type, data };
        if (!this.webviewClientRegistry.isVisible(WEBVIEW_CLIENT_IDS.mainChat)) {
            this.coalesceHiddenMainChatPush(message);
            return;
        }

        this.flushHiddenMainChatPushes();
        this.postRoutedWebviewMessage(WEBVIEW_CLIENT_IDS.mainChat, message, this._view.webview);
    }

    private coalesceHiddenMainChatPush(message: Record<string, any>): void {
        const type = typeof message.type === 'string' && message.type ? message.type : '__unknown__';
        const now = Date.now();
        const existing = this.hiddenMainChatPushes.get(type);
        this.hiddenMainChatPushes.set(type, {
            message,
            count: (existing?.count ?? 0) + 1,
            firstHiddenAt: existing?.firstHiddenAt ?? now,
            lastHiddenAt: now
        });
    }

    private flushHiddenMainChatPushes(): void {
        if (!this._view || this.hiddenMainChatPushes.size === 0) {
            return;
        }

        const entries = Array.from(this.hiddenMainChatPushes.entries());
        this.hiddenMainChatPushes.clear();

        for (const [originalType, entry] of entries) {
            this.postRoutedWebviewMessage(WEBVIEW_CLIENT_IDS.mainChat, {
                type: 'webview.hiddenDeliverySummary',
                data: {
                    originalType,
                    coalescedCount: entry.count,
                    firstHiddenAt: entry.firstHiddenAt,
                    lastHiddenAt: entry.lastHiddenAt
                }
            }, this._view.webview);
            this.postRoutedWebviewMessage(WEBVIEW_CLIENT_IDS.mainChat, entry.message, this._view.webview);
        }
    }

    private async routeSubAgentMonitorMessage(message: any, webview: vscode.Webview): Promise<boolean> {
        await this.initPromise;
        const { type, data, requestId, clientId } = message;
        const routedClientId = this.normalizeClientId(clientId, WEBVIEW_CLIENT_IDS.subagentMonitor);
        if (type === 'webview.visibilityChanged') {
            this.handleVisibilityChangedMessage(routedClientId, data, requestId, webview);
            return true;
        }
        if (type === 'runtimeLedger.getTerminalContentWindow') {
            this.handleRuntimeLedgerTerminalContentWindowMessage(routedClientId, data, requestId, webview);
            return true;
        }
        if (type === 'terminal.getOutputWindow') {
            this.handleTerminalOutputWindowMessage(routedClientId, data, requestId, webview);
            return true;
        }
        const sendResponse = (id: string, responseData: any) => {
            this.postRoutedWebviewMessage(routedClientId, {
                type: 'response',
                requestId: id,
                success: true,
                data: responseData
            }, webview);
        };
        const sendError = (id: string, code: string, errorMessage: string) => {
            this.postRoutedWebviewMessage(routedClientId, {
                type: 'error',
                requestId: id,
                success: false,
                error: { code, message: errorMessage }
            }, webview);
        };

        const ctx: HandlerContext = {
            ...this.createHandlerContext(requestId),
            clientId: routedClientId,
            view: undefined,
            sendResponse,
            sendError,
            postMessage: (outgoing: any) => this.postRoutedWebviewMessage(routedClientId, outgoing, webview)
        };

        try {
            return await this.messageRouter.route(type, data, requestId, ctx, routedClientId);
        } catch (error: any) {
            sendError(requestId, error.code || 'HANDLER_ERROR', error.message || String(error));
            return true;
        }
    }

    /**
     * 初始化子代理（从持久化存储加载到内存 registry）
     */
    private initializeSubAgents(): void {
        const ctx: HandlerContext = {
            clientId: WEBVIEW_CLIENT_IDS.mainChat,
            settingsManager: this.settingsManager,
            configManager: this.configManager,
            channelManager: this.channelManager,
            toolRegistry: toolRegistry,
            settingsHandler: this.settingsHandler,
            conversationManager: this.conversationManager,
            mcpManager: this.mcpManager,
            dependencyManager: this.dependencyManager,
            storagePathManager: this.storagePathManager,
            diffStorageManager: this.diffStorageManager,
            streamAbortControllers: this.messageRouter.getAbortManager() as any,
            diffPreviewProvider: this.diffPreviewProvider,
            sendResponse: this.sendResponse.bind(this),
            sendError: this.sendError.bind(this),
            postMessage: (message: any) => {
                this.postRoutedWebviewMessage(WEBVIEW_CLIENT_IDS.mainChat, message, this._view?.webview);
            },
            openSubAgentMonitor: this.openSubAgentMonitor.bind(this)
        };
        
        initializeSubAgentsFromSettings(ctx);
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
        conversationId?: string;
    }): void {
        this.postMainChatPushMessage('retryStatus', { ...status });
    }
    
    /**
     * 同步 skills 状态到 SkillsManager
     * 从 settingsManager 加载已保存的启用状态
     * 对于 settings 中没有记录的新 Skill，默认设为启用
     */
    private async syncSkillsState(): Promise<void> {
        try {
            const { getSkillsManager } = await import('../backend/modules/skills');
            const skillsManager = getSkillsManager();
            
            if (!skillsManager) {
                return;
            }
            
            // 从 settingsManager 获取已保存的 skills 配置
            const savedConfig = this.settingsManager.getSkillsConfig() || { skills: [] };
            const savedSkillIds = new Set(savedConfig.skills.map(s => s.id));
            
            // 同步已保存的 Skill 状态
            for (const savedSkill of savedConfig.skills) {
                if (savedSkill.enabled) {
                    skillsManager.enableSkill(savedSkill.id);
                } else {
                    skillsManager.disableSkill(savedSkill.id);
                }
            }

            // 对于 settings 中没有记录的新 Skill，默认启用。
            // 否则新扫到的 Skill 在 read_skill 工具注册时不会出现在列表中，
            // 直到前端 getSkillsConfig 被调用才会被默认启用。
            for (const skill of skillsManager.getAllSkills()) {
                if (!savedSkillIds.has(skill.id)) {
                    skillsManager.enableSkill(skill.id);
                }
            }
        } catch (error) {
            console.error('[ChatViewProvider] Failed to sync skills state:', error);
        }
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
        this.webviewReady = false;
        this.mainChatClientDisposable?.dispose();
        this.mainChatClientDisposable = this.registerWebviewClient(WEBVIEW_CLIENT_IDS.mainChat, webviewView.webview, {
            type: 'conversation',
            conversationId: 'main-chat'
        });
        this.mainChatVisibilityDisposable?.dispose();
        this.updateWebviewVisibility(WEBVIEW_CLIENT_IDS.mainChat, webviewView.visible !== false, 'vscode', 'resolveWebviewView');
        this.mainChatVisibilityDisposable = webviewView.onDidChangeVisibility?.(() => {
            this.updateWebviewVisibility(WEBVIEW_CLIENT_IDS.mainChat, webviewView.visible !== false, 'vscode', 'onDidChangeVisibility');
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'frontend', 'dist')),
                vscode.Uri.file(path.join(this.context.extensionPath, 'node_modules', '@vscode', 'codicons', 'dist')),
                // 内置资源（例如默认提示音）
                vscode.Uri.file(path.join(this.context.extensionPath, 'resources'))
            ]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // 监听来自 webview 的消息
        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                // 将消息处理包装在队列中，确保按顺序执行
                this.messageHandlingQueue = this.messageHandlingQueue.then(() => 
                    this.handleMessage(message)
                ).catch(err => {
                    console.error('[ChatViewProvider] Error in message handling queue:', err);
                });
            },
            undefined,
            this.context.subscriptions
        );

        // 监听 Diff 状态变化并同步到前端
        const diffManager = getDiffManager();
        const diffStatusListener = (pending: any[], allProcessed: boolean) => {
            // 我们只同步最近一次状态变化
            // 如果所有都处理完了，可能意味着有接受/拒绝发生
            // 找出所有已处理但还未通知前端的 diff 可能比较复杂，
            // 简单的办法是发送所有 pending 的 ID 及其状态，或者直接通知整个列表。
            
            // 发送 diff 状态变化消息
            this.sendCommand('diff.statusChanged', {
                pendingDiffs: pending.map(d => ({
                    id: d.id,
                    status: d.status,
                    filePath: d.filePath,
                    toolId: d.toolId,
                    diffGuardWarning: d.diffGuardWarning,
                    diffGuardDeletePercent: d.diffGuardDeletePercent
                })),
                allProcessed
            });
        };
        diffManager.addStatusListener(diffStatusListener);
        this.context.subscriptions.push({
            dispose: () => diffManager.removeStatusListener(diffStatusListener)
        });

        // 立即发送一次当前状态
        diffStatusListener(diffManager.getPendingDiffs(), diffManager.areAllProcessed());
    }

    /**
     * 创建处理器上下文
     */
    private createHandlerContext(requestId: string): HandlerContext {
        return {
            context: this.context,
            view: this._view,
            clientId: WEBVIEW_CLIENT_IDS.mainChat,
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
            windowsAgentStopNotificationService: this.windowsAgentStopNotificationService,
            streamAbortControllers: this.messageRouter.getAbortManager() as any,
            diffPreviewProvider: this.diffPreviewProvider,
            sendResponse: this.sendResponse.bind(this),
            sendError: this.sendError.bind(this),
            getCurrentWorkspaceUri: this.getCurrentWorkspaceUri.bind(this),
            syncLanguageToBackend: this.syncLanguageToBackend.bind(this),
            openSubAgentMonitor: this.openSubAgentMonitor.bind(this)
        };
    }

    /**
     * 处理来自前端的消息
     */
    private async handleMessage(message: any) {
        const { type, data, requestId, clientId } = message;
        const routedClientId = this.normalizeClientId(clientId, WEBVIEW_CLIENT_IDS.mainChat);

        // The frontend sends this as soon as its JS is ready to receive commands.
        // Handle it even if backend init is still running.
        if (type === 'webviewReady') {
            this.webviewReady = true;
            // Flush any queued commands.
            for (const cmd of this.pendingCommands) {
                this.postRoutedWebviewMessage(routedClientId, {
                    type: 'command',
                    command: cmd.command,
                    data: cmd.data
                }, this._view?.webview);
            }
            this.pendingCommands = [];

            if (requestId) {
                this.postRoutedWebviewMessage(routedClientId, {
                    type: 'response',
                    requestId,
                    success: true,
                    data: { success: true }
                }, this._view?.webview);
            }
            return;
        }

        if (type === 'webview.visibilityChanged') {
            this.handleVisibilityChangedMessage(routedClientId, data, requestId, this._view?.webview);
            return;
        }

        if (type === 'runtimeLedger.getTerminalContentWindow') {
            this.handleRuntimeLedgerTerminalContentWindowMessage(routedClientId, data, requestId, this._view?.webview);
            return;
        }

        if (type === 'terminal.getOutputWindow') {
            this.handleTerminalOutputWindowMessage(routedClientId, data, requestId, this._view?.webview);
            return;
        }

        try {
            // 等待初始化完成
            await this.initPromise;
            
            // 创建处理器上下文
            const ctx = {
                ...this.createHandlerContext(requestId),
                clientId: routedClientId
            };
            
            // 使用消息路由器处理消息
            const handled = await this.messageRouter.route(type, data, requestId, ctx, routedClientId);
            
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

        // Drop queued commands.
        this.pendingCommands = [];
        this.webviewReady = false;
        
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

        // 释放 Skills 管理器资源
        getSkillsManager()?.dispose();
        this.windowsAgentStopNotificationService?.dispose();
        this.subAgentMonitorPanel?.dispose();
        this.subAgentMonitorPanel = undefined;
        this.mainChatVisibilityDisposable?.dispose();
        this.mainChatVisibilityDisposable = undefined;
        this.mainChatClientDisposable?.dispose();
        this.mainChatClientDisposable = undefined;
        this.webviewClientRegistry.setVisibility(WEBVIEW_CLIENT_IDS.mainChat, false, 'dispose', 'provider disposed');
        this.hiddenMainChatPushes.clear();
        this.terminalOutputProjectionStore.clear();

        console.log('ChatViewProvider disposed');
    }
    
    /**
     * 发送响应到前端
     */
    private sendResponse(requestId: string, data: any) {
        this.postRoutedWebviewMessage(WEBVIEW_CLIENT_IDS.mainChat, {
            type: 'response',
            requestId,
            success: true,
            data
        }, this._view?.webview);
    }

    /**
     * 发送错误到前端
     */
    private sendError(requestId: string, code: string, message: string) {
        this.postRoutedWebviewMessage(WEBVIEW_CLIENT_IDS.mainChat, {
            type: 'error',
            requestId,
            success: false,
            error: {
                code,
                message
            }
        }, this._view?.webview);
    }

    /**
     * 发送命令到 Webview
     */
    public sendCommand(command: string, data?: any): void {
        if (!this._view || !this.webviewReady) {
            // Queue until webview is ready (or view exists).
            this.pendingCommands.push({ command, data });
            return;
        }

        this.postRoutedWebviewMessage(WEBVIEW_CLIENT_IDS.mainChat, {
            type: 'command',
            command,
            data
        }, this._view.webview);
    }

    /**
     * 手动迁移旧版对话历史到分段存储格式
     */
    public async migrateConversationHistories(progressCallback?: (status: { current: number; total: number; conversationId?: string }) => void): Promise<{
        migrated: number;
        skipped: number;
        failed: Array<{ conversationId: string; error: string }>;
    }> {
        await this.initPromise;

        if (!this.conversationStorageAdapter) {
            throw new Error('Conversation storage adapter is not initialized.');
        }

        return await this.conversationStorageAdapter.migrateLegacyConversationsToSegmented(progressCallback);
    }

    public getEffectiveConversationDataPath(): string {
        if (!this.storagePathManager) {
            throw new Error('StoragePathManager is not initialized.');
        }
        return this.storagePathManager.getEffectiveDataPath();
    }

    /**
     * 生成webview的HTML
     */
    private getExtensionModeLabel(): string {
        switch (this.context.extensionMode) {
            case vscode.ExtensionMode.Development:
                return 'development';
            case vscode.ExtensionMode.Test:
                return 'test';
            case vscode.ExtensionMode.Production:
            default:
                return 'production';
        }
    }

    private resolveWebviewDevServerUrl(): string | undefined {
        const raw = process.env.LIMCODE_WEBVIEW_DEV_SERVER_URL?.trim();
        if (!raw) {
            return undefined;
        }

        if (this.context.extensionMode !== vscode.ExtensionMode.Development) {
            console.warn('[ChatViewProvider] LIMCODE_WEBVIEW_DEV_SERVER_URL 仅在开发模式下生效，当前已忽略。');
            return undefined;
        }

        try {
            const parsed = new URL(raw);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new Error(`Unsupported protocol: ${parsed.protocol}`);
            }

            return parsed.toString().replace(/\/$/, '');
        } catch (error) {
            console.warn('[ChatViewProvider] 无效的 LIMCODE_WEBVIEW_DEV_SERVER_URL:', raw, error);
            return undefined;
        }
    }

    private buildBuiltinSoundAssets(webview: vscode.Webview): Record<string, { url: string; name: string }> {
        try {
            const soundDir = path.join(this.context.extensionPath, 'resources', 'sound');
            if (!fs.existsSync(soundDir)) {
                return {};
            }

            const files = fs.readdirSync(soundDir).filter(f => f.toLowerCase().endsWith('.mp3'));
            if (files.length === 0) {
                return {};
            }

            const normalizeMap = new Map(files.map(f => [f.toLowerCase(), f] as const));
            const byName = (name: string): string | undefined => normalizeMap.get(name.toLowerCase());

            // 严格使用默认资源命名：warning.mp3 / error.mp3 / taskComplete.mp3 / taskError.mp3
            const warningFile = byName('warning.mp3');
            const errorFile = byName('error.mp3');
            const taskCompleteFile = byName('taskComplete.mp3');
            const taskErrorFile = byName('taskError.mp3');

            const toEntry = (filename: string) => {
                const uri = webview.asWebviewUri(vscode.Uri.file(path.join(soundDir, filename)));
                return { url: uri.toString(), name: filename };
            };

            const assets: Record<string, { url: string; name: string }> = {};
            if (warningFile) {
                assets.warning = toEntry(warningFile);
            }
            if (errorFile) {
                assets.error = toEntry(errorFile);
            }
            if (taskCompleteFile) {
                assets.taskComplete = toEntry(taskCompleteFile);
            }
            if (taskErrorFile) {
                assets.taskError = toEntry(taskErrorFile);
            }

            return assets;
        } catch (error) {
            console.warn('[ChatViewProvider] Failed to build builtin sound assets:', error);
            return {};
        }
    }

    private buildCsp(webview: vscode.Webview, devServerOrigin?: string): string {
        const scriptSrc = [webview.cspSource, "'unsafe-inline'"];
        const styleSrc = [webview.cspSource, "'unsafe-inline'"];
        const imgSrc = [webview.cspSource, 'data:', 'blob:'];
        const mediaSrc = [webview.cspSource, 'data:', 'blob:'];
        const fontSrc = [webview.cspSource];
        const connectSrc = [webview.cspSource];

        if (devServerOrigin) {
            scriptSrc.push(devServerOrigin, "'unsafe-eval'");
            styleSrc.push(devServerOrigin);
            imgSrc.push(devServerOrigin);
            mediaSrc.push(devServerOrigin);
            fontSrc.push(devServerOrigin, 'data:');
            connectSrc.push(devServerOrigin, 'ws:', 'wss:');
        }

        return [
            "default-src 'none'",
            `script-src ${scriptSrc.join(' ')}`,
            `style-src ${styleSrc.join(' ')}`,
            `img-src ${imgSrc.join(' ')}`,
            `media-src ${mediaSrc.join(' ')}`,
            `font-src ${fontSrc.join(' ')}`,
            `connect-src ${connectSrc.join(' ')}`
        ].join('; ');
    }

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

        const devServerUrl = this.webviewDevServerUrl;
        const devServerOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined;
        const cspContent = this.buildCsp(webview, devServerOrigin);
        const builtinSoundAssetsScript = `<script>window.__LIMCODE_BUILTIN_SOUND_ASSETS = ${JSON.stringify(this.buildBuiltinSoundAssets(webview))};</script>`;

        if (devServerUrl) {
            console.log(`[LimCode][Webview] load source=vite-dev-server, url=${devServerUrl}`);
            return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${cspContent}">
    <link href="${codiconsUri}" rel="stylesheet">
    ${builtinSoundAssetsScript}
    <title>LimCode Chat (Dev)</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="${devServerUrl}/@vite/client"></script>
    <script type="module" src="${devServerUrl}/src/main.ts"></script>
</body>
</html>`;
        }

        console.log('[LimCode][Webview] load source=frontend/dist');
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${cspContent}">
    <link href="${codiconsUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    ${builtinSoundAssetsScript}
    <title>LimCode Chat</title>
</head>
<body>
    <div id="app"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
