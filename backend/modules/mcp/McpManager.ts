/**
 * LimCode MCP (Model Context Protocol) 模块 - 客户端管理器
 *
 * 管理 MCP 服务器配置和客户端连接
 */

import { t } from '../../i18n';
import type {
    McpServerConfig,
    McpServerInfo,
    McpServerStatus,
    McpServerCapabilities,
    McpStorageAdapter,
    CreateMcpServerInput,
    UpdateMcpServerInput,
    McpToolCallRequest,
    McpToolCallResult,
    McpResourceReadRequest,
    McpResourceContent,
    McpPromptGetRequest,
    McpPromptMessage,
    McpEvent,
    McpEventListener,
    McpEventType
} from './types';
import { StdioMcpClient } from './StdioClient';
import { HttpMcpClient } from './HttpClient';

/**
 * 生成唯一 ID
 */
function generateId(): string {
    return `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * MCP 管理器
 * 
 * 负责：
 * - 管理服务器配置（CRUD）
 * - 管理服务器连接状态
 * - 提供工具调用、资源读取等功能
 */
export class McpManager {
    /** 存储适配器 */
    private storageAdapter: McpStorageAdapter;
    
    /** 服务器运行时信息 */
    private servers: Map<string, McpServerInfo> = new Map();
    
    /** 活跃的客户端连接 */
    private clients: Map<string, StdioMcpClient | HttpMcpClient> = new Map();
    
    /** 事件监听器 */
    private listeners: Map<McpEventType, Set<McpEventListener>> = new Map();
    
    /** 是否已初始化 */
    private initialized: boolean = false;

    constructor(storageAdapter: McpStorageAdapter) {
        this.storageAdapter = storageAdapter;
    }

    /**
     * 初始化管理器
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        
        // 从文件加载配置并初始化运行时状态
        await this.reloadFromStorage();

        this.initialized = true;

        // 触发自动连接
        const serversToConnect = this.getServersToAutoConnect();
        for (const serverId of serversToConnect) {
            // 异步连接，不阻塞初始化流程
            this.connect(serverId).catch(e => {
                console.error(`[MCP] Auto-connect failed for ${serverId}:`, e);
            });
        }
    }
    
    /**
     * 获取需要自动连接的服务器列表
     */
    getServersToAutoConnect(): string[] {
        const serverIds: string[] = [];
        for (const [serverId, info] of this.servers) {
            if (info.config.enabled && info.config.autoConnect && info.status === 'disconnected') {
                serverIds.push(serverId);
            }
        }
        return serverIds;
    }

    /**
     * 从存储重新加载配置
     * 保留运行时状态（连接状态等）
     */
    private async reloadFromStorage(): Promise<void> {
        const configs = await this.storageAdapter.getAllConfigs();
        const configMap = new Map(configs.map(c => [c.id, c]));
        
        // 更新已存在的服务器配置
        for (const [serverId, info] of this.servers) {
            const newConfig = configMap.get(serverId);
            if (newConfig) {
                info.config = newConfig;
                configMap.delete(serverId);
            } else {
                // 服务器已被删除，断开连接
                if (info.status === 'connected' || info.status === 'connecting') {
                    await this.disconnect(serverId).catch(() => {});
                }
                this.servers.delete(serverId);
            }
        }
        
        // 添加新服务器
        for (const [serverId, config] of configMap) {
            this.servers.set(serverId, {
                config,
                status: 'disconnected'
            });
        }
    }

    /**
     * 释放资源
     */
    async dispose(): Promise<void> {
        // 断开所有连接
        for (const [serverId] of this.servers) {
            try {
                await this.disconnect(serverId);
            } catch {
                // 忽略断开失败
            }
        }

        this.servers.clear();
        this.listeners.clear();
        this.initialized = false;
    }

    // ==================== 服务器配置管理 ====================

    /**
     * 验证服务器 ID 是否可用（不重复）
     * @param id 要验证的 ID
     * @param excludeId 排除的 ID（用于更新时排除自身）
     */
    async validateServerId(id: string, excludeId?: string): Promise<{ valid: boolean; error?: string }> {
        // 验证 ID 格式（只允许字母、数字、下划线、中划线）
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            return { valid: false, error: t('modules.mcp.errors.invalidServerId') };
        }
        
        // 检查是否与其他 MCP 服务器 ID 重复
        const configs = await this.storageAdapter.getAllConfigs();
        for (const config of configs) {
            if (config.id === id && config.id !== excludeId) {
                return { valid: false, error: t('modules.mcp.errors.serverIdExists', { serverId: id }) };
            }
        }
        
        return { valid: true };
    }
    
    /**
     * 创建服务器配置
     * @param input 服务器配置输入
     * @param customId 自定义 ID（可选，不提供则自动生成）
     */
    async createServer(input: CreateMcpServerInput, customId?: string): Promise<string> {
        const id = customId || generateId();
        
        // 验证 ID 是否可用
        const validation = await this.validateServerId(id);
        if (!validation.valid) {
            throw new Error(validation.error);
        }
        
        const now = Date.now();
        const config: McpServerConfig = {
            ...input,
            id,
            createdAt: now,
            updatedAt: now
        };

        await this.storageAdapter.saveConfig(config);
        
        this.servers.set(config.id, {
            config,
            status: 'disconnected'
        });
        
        // 如果启用了自动连接，立即尝试连接
        if (config.enabled && config.autoConnect) {
            // 异步连接，不阻塞创建流程
            this.connect(config.id).catch(() => {
                // 忽略自动连接失败
            });
        }
        
        return config.id;
    }

    /**
     * 获取服务器配置（从文件读取）
     */
    async getServer(serverId: string): Promise<McpServerConfig | null> {
        // 直接从文件读取，确保获取最新配置
        return await this.storageAdapter.getConfig(serverId);
    }

    /**
     * 获取服务器运行时信息（包含连接状态）
     * 配置从文件读取，运行时状态从内存获取
     */
    async getServerInfo(serverId: string): Promise<McpServerInfo | null> {
        const config = await this.storageAdapter.getConfig(serverId);
        if (!config) {
            return null;
        }
        
        const runtimeInfo = this.servers.get(serverId);
        return {
            config,
            status: runtimeInfo?.status ?? 'disconnected',
            capabilities: runtimeInfo?.capabilities,
            protocolVersion: runtimeInfo?.protocolVersion,
            serverVersion: runtimeInfo?.serverVersion,
            serverDescription: runtimeInfo?.serverDescription,
            lastError: runtimeInfo?.lastError,
            connectedAt: runtimeInfo?.connectedAt
        };
    }

    /**
     * 更新服务器配置
     */
    async updateServer(serverId: string, updates: UpdateMcpServerInput): Promise<void> {
        const info = this.servers.get(serverId);
        if (!info) {
            throw new Error(t('modules.mcp.errors.serverNotFound', { serverId }));
        }

        const updatedConfig: McpServerConfig = {
            ...info.config,
            ...updates,
            updatedAt: Date.now()
        };

        await this.storageAdapter.saveConfig(updatedConfig);
        info.config = updatedConfig;
    }

    /**
     * 删除服务器配置
     */
    async deleteServer(serverId: string): Promise<void> {
        const info = this.servers.get(serverId);
        if (!info) {
            throw new Error(t('modules.mcp.errors.serverNotFound', { serverId }));
        }

        // 先断开连接
        if (info.status === 'connected' || info.status === 'connecting') {
            await this.disconnect(serverId);
        }

        await this.storageAdapter.deleteConfig(serverId);
        this.servers.delete(serverId);
    }

    /**
     * 列出所有服务器（从文件读取配置，合并运行时状态）
     */
    async listServers(): Promise<McpServerInfo[]> {
        const configs = await this.storageAdapter.getAllConfigs();
        
        return configs.map(config => {
            const runtimeInfo = this.servers.get(config.id);
            return {
                config,
                status: runtimeInfo?.status ?? 'disconnected',
                capabilities: runtimeInfo?.capabilities,
                protocolVersion: runtimeInfo?.protocolVersion,
                serverVersion: runtimeInfo?.serverVersion,
                serverDescription: runtimeInfo?.serverDescription,
                lastError: runtimeInfo?.lastError,
                connectedAt: runtimeInfo?.connectedAt
            };
        });
    }

    /**
     * 列出所有服务器配置（直接从文件读取）
     */
    async listServerConfigs(): Promise<McpServerConfig[]> {
        return await this.storageAdapter.getAllConfigs();
    }

    /**
     * 设置服务器启用状态
     */
    async setServerEnabled(serverId: string, enabled: boolean): Promise<void> {
        await this.updateServer(serverId, { enabled });
        
        // 如果禁用，断开连接
        if (!enabled) {
            const info = this.servers.get(serverId);
            if (info && (info.status === 'connected' || info.status === 'connecting')) {
                await this.disconnect(serverId);
            }
        }
    }

    // ==================== 连接管理 ====================

    /**
     * 连接到服务器
     */
    async connect(serverId: string): Promise<void> {
        // 先尝试从存储重新加载（支持手动编辑配置文件的情况）
        await this.reloadFromStorage();
        
        let info = this.servers.get(serverId);
        if (!info) {
            // 列出所有可用的服务器 ID
            const availableIds = Array.from(this.servers.keys());
            throw new Error(t('modules.mcp.errors.serverNotFoundWithAvailable', {
                serverId,
                available: availableIds.join(', ') || 'none'
            }));
        }

        if (!info.config.enabled) {
            throw new Error(t('modules.mcp.errors.serverDisabled', { serverId }));
        }

        if (info.status === 'connected') {
            return;
        }

        if (info.status === 'connecting') {
            return;
        }

        this.updateServerStatus(serverId, 'connecting');

        try {
            // 根据 transport 类型创建不同的客户端并连接
            await this.performConnect(info);
            
            this.updateServerStatus(serverId, 'connected');
            info.connectedAt = Date.now();
            
            this.emitEvent({
                type: 'server:connected',
                serverId,
                timestamp: Date.now()
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            info.lastError = errorMessage;
            this.updateServerStatus(serverId, 'error');
            
            this.emitEvent({
                type: 'server:error',
                serverId,
                data: { error: errorMessage },
                timestamp: Date.now()
            });

            throw error;
        }
    }

    /**
     * 断开服务器连接
     */
    async disconnect(serverId: string): Promise<void> {
        const info = this.servers.get(serverId);
        if (!info) {
            throw new Error(t('modules.mcp.errors.serverNotFound', { serverId }));
        }

        if (info.status === 'disconnected') {
            return;
        }

        try {
            await this.performDisconnect(info);
        } catch {
            // 忽略断开连接错误
        }

        this.updateServerStatus(serverId, 'disconnected');
        info.connectedAt = undefined;
        info.capabilities = undefined;
        
        this.emitEvent({
            type: 'server:disconnected',
            serverId,
            timestamp: Date.now()
        });
    }

    /**
     * 重新连接服务器
     */
    async reconnect(serverId: string): Promise<void> {
        await this.disconnect(serverId);
        await this.connect(serverId);
    }

    /**
     * 获取服务器状态
     */
    getServerStatus(serverId: string): McpServerStatus | null {
        const info = this.servers.get(serverId);
        return info?.status ?? null;
    }

    // ==================== MCP 操作 ====================

    /**
     * 调用工具
     */
    async callTool(request: McpToolCallRequest): Promise<McpToolCallResult> {
        const info = this.servers.get(request.serverId);
        if (!info) {
            return {
                success: false,
                error: t('modules.mcp.errors.serverNotFound', { serverId: request.serverId })
            };
        }

        if (info.status !== 'connected') {
            return {
                success: false,
                error: t('modules.mcp.errors.serverNotConnected', { serverName: info.config.name })
            };
        }

        try {
            const result = await this.performToolCall(info, request);
            
            this.emitEvent({
                type: 'tool:result',
                serverId: request.serverId,
                data: { toolName: request.toolName, result },
                timestamp: Date.now()
            });

            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: errorMessage,
                isError: true
            };
        }
    }

    /**
     * 读取资源
     */
    async readResource(request: McpResourceReadRequest): Promise<McpResourceContent | null> {
        const info = this.servers.get(request.serverId);
        if (!info) {
            throw new Error(t('modules.mcp.errors.serverNotFound', { serverId: request.serverId }));
        }

        if (info.status !== 'connected') {
            throw new Error(t('modules.mcp.errors.serverNotConnected', { serverName: info.config.name }));
        }

        return await this.performResourceRead(info, request);
    }

    /**
     * 获取提示
     */
    async getPrompt(request: McpPromptGetRequest): Promise<McpPromptMessage[]> {
        const info = this.servers.get(request.serverId);
        if (!info) {
            throw new Error(t('modules.mcp.errors.serverNotFound', { serverId: request.serverId }));
        }

        if (info.status !== 'connected') {
            throw new Error(t('modules.mcp.errors.serverNotConnected', { serverName: info.config.name }));
        }

        return await this.performPromptGet(info, request);
    }

    /**
     * 获取所有已连接服务器的工具列表
     */
    getAllTools(): Array<{ serverId: string; serverName: string; tools: McpServerCapabilities['tools']; cleanSchema: boolean }> {
        const result: Array<{ serverId: string; serverName: string; tools: McpServerCapabilities['tools']; cleanSchema: boolean }> = [];

        for (const [serverId, info] of this.servers) {
            if (info.status === 'connected' && info.capabilities?.tools) {
                result.push({
                    serverId,
                    serverName: info.config.name,
                    tools: info.capabilities.tools,
                    // 默认为 true（清理 schema）
                    cleanSchema: info.config.cleanSchema !== false
                });
            }
        }

        return result;
    }

    /**
     * 获取所有已连接服务器的资源列表
     */
    getAllResources(): Array<{ serverId: string; serverName: string; resources: McpServerCapabilities['resources'] }> {
        const result: Array<{ serverId: string; serverName: string; resources: McpServerCapabilities['resources'] }> = [];

        for (const [serverId, info] of this.servers) {
            if (info.status === 'connected' && info.capabilities?.resources) {
                result.push({
                    serverId,
                    serverName: info.config.name,
                    resources: info.capabilities.resources
                });
            }
        }

        return result;
    }

    /**
     * 获取所有已连接服务器的提示模板列表
     */
    getAllPrompts(): Array<{ serverId: string; serverName: string; prompts: McpServerCapabilities['prompts'] }> {
        const result: Array<{ serverId: string; serverName: string; prompts: McpServerCapabilities['prompts'] }> = [];

        for (const [serverId, info] of this.servers) {
            if (info.status === 'connected' && info.capabilities?.prompts) {
                result.push({
                    serverId,
                    serverName: info.config.name,
                    prompts: info.capabilities.prompts
                });
            }
        }

        return result;
    }

    // ==================== 事件系统 ====================

    /**
     * 添加事件监听器
     */
    addEventListener(type: McpEventType, listener: McpEventListener): void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener);
    }

    /**
     * 移除事件监听器
     */
    removeEventListener(type: McpEventType, listener: McpEventListener): void {
        this.listeners.get(type)?.delete(listener);
    }

    /**
     * 发送事件
     */
    private emitEvent(event: McpEvent): void {
        const listeners = this.listeners.get(event.type);
        if (listeners) {
            for (const listener of listeners) {
                try {
                    listener(event);
                } catch {
                    // 忽略监听器错误
                }
            }
        }
    }

    // ==================== 私有方法 ====================

    /**
     * 更新服务器状态
     */
    private updateServerStatus(serverId: string, status: McpServerStatus): void {
        const info = this.servers.get(serverId);
        if (info) {
            info.status = status;
        }
    }

    /**
     * 执行连接
     */
    private async performConnect(info: McpServerInfo): Promise<void> {
        const { transport } = info.config;
        
        switch (transport.type) {
            case 'stdio': {
                const client = new StdioMcpClient(
                    transport.command,
                    transport.args || [],
                    transport.env,
                    undefined // cwd
                );
                
                // 设置错误处理
                client.on('error', (err) => {
                    info.lastError = err.message;
                    this.updateServerStatus(info.config.id, 'error');
                });
                
                client.on('exit', () => {
                    this.clients.delete(info.config.id);
                    this.updateServerStatus(info.config.id, 'disconnected');
                });
                
                // 连接
                await client.connect();
                
                // 保存客户端
                this.clients.set(info.config.id, client);
                
                // 获取能力
                info.capabilities = {
                    tools: client.getTools().map(t => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema
                    })),
                    resources: client.getResources().map(r => ({
                        uri: r.uri,
                        name: r.name,
                        description: r.description,
                        mimeType: r.mimeType
                    })),
                    prompts: client.getPrompts().map(p => ({
                        name: p.name,
                        description: p.description,
                        arguments: p.arguments
                    }))
                };
                info.protocolVersion = client.getProtocolVersion();
                
                const serverInfo = client.getServerInfo();
                if (serverInfo) {
                    info.serverVersion = serverInfo.version;
                    info.serverDescription = serverInfo.name;
                }
                break;
            }
            
            case 'sse': {
                const sseClient = new HttpMcpClient(
                    transport.url,
                    'sse',
                    transport.headers || {},
                    info.config.timeout || 30000
                );
                
                await sseClient.connect();
                
                this.clients.set(info.config.id, sseClient);
                
                info.capabilities = {
                    tools: sseClient.getTools().map(t => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema
                    })),
                    resources: sseClient.getResources().map(r => ({
                        uri: r.uri,
                        name: r.name,
                        description: r.description,
                        mimeType: r.mimeType
                    })),
                    prompts: sseClient.getPrompts().map(p => ({
                        name: p.name,
                        description: p.description,
                        arguments: p.arguments
                    }))
                };
                info.protocolVersion = sseClient.getProtocolVersion();
                
                const sseServerInfo = sseClient.getServerInfo();
                if (sseServerInfo) {
                    info.serverVersion = sseServerInfo.version;
                    info.serverDescription = sseServerInfo.name;
                }
                break;
            }
            
            case 'streamable-http': {
                const httpClient = new HttpMcpClient(
                    transport.url,
                    'streamable-http',
                    transport.headers || {},
                    info.config.timeout || 30000
                );
                
                await httpClient.connect();
                
                this.clients.set(info.config.id, httpClient);
                
                info.capabilities = {
                    tools: httpClient.getTools().map(t => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema
                    })),
                    resources: httpClient.getResources().map(r => ({
                        uri: r.uri,
                        name: r.name,
                        description: r.description,
                        mimeType: r.mimeType
                    })),
                    prompts: httpClient.getPrompts().map(p => ({
                        name: p.name,
                        description: p.description,
                        arguments: p.arguments
                    }))
                };
                info.protocolVersion = httpClient.getProtocolVersion();
                
                const httpServerInfo = httpClient.getServerInfo();
                if (httpServerInfo) {
                    info.serverVersion = httpServerInfo.version;
                    info.serverDescription = httpServerInfo.name;
                }
                break;
            }
        }
    }

    /**
     * 执行断开连接
     */
    private async performDisconnect(info: McpServerInfo): Promise<void> {
        const client = this.clients.get(info.config.id);
        if (client) {
            await client.disconnect();
            this.clients.delete(info.config.id);
        }
    }

    /**
     * 执行工具调用
     */
    private async performToolCall(
        info: McpServerInfo,
        request: McpToolCallRequest
    ): Promise<McpToolCallResult> {
        const client = this.clients.get(info.config.id);
        if (!client) {
            return {
                success: false,
                error: t('modules.mcp.errors.clientNotConnected')
            };
        }
        
        try {
            const result = await client.callTool(request.toolName, request.arguments);
            return {
                success: !result.isError,
                content: result.content.map(c => ({
                    type: c.type as 'text' | 'image' | 'resource',
                    text: c.text,
                    data: c.data,
                    mimeType: c.mimeType
                })),
                isError: result.isError
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : t('modules.mcp.errors.toolCallFailed')
            };
        }
    }

    /**
     * 执行资源读取
     */
    private async performResourceRead(
        info: McpServerInfo,
        request: McpResourceReadRequest
    ): Promise<McpResourceContent | null> {
        const client = this.clients.get(info.config.id);
        if (!client) {
            throw new Error(t('modules.mcp.errors.clientNotConnected'));
        }
        
        const result = await client.readResource(request.uri);
        const content = result.contents[0];
        if (!content) {
            return null;
        }
        
        return {
            uri: content.uri,
            mimeType: content.mimeType,
            text: content.text,
            blob: content.blob
        };
    }

    /**
     * 执行提示获取
     */
    private async performPromptGet(
        info: McpServerInfo,
        request: McpPromptGetRequest
    ): Promise<McpPromptMessage[]> {
        const client = this.clients.get(info.config.id);
        if (!client) {
            throw new Error(t('modules.mcp.errors.clientNotConnected'));
        }
        
        const result = await client.getPrompt(request.promptName, request.arguments);
        return result.messages.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: {
                type: m.content.type as 'text' | 'image' | 'resource',
                text: m.content.text
            }
        }));
    }
}