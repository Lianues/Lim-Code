/**
 * LimCode MCP 模块 - HTTP/SSE 客户端
 *
 * 通过 HTTP 或 SSE 与 MCP 服务器通信
 */

import { EventEmitter } from 'events';
import { t } from '../../i18n';

/**
 * JSON-RPC 请求
 */
interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: number | string;
    method: string;
    params?: any;
}

/**
 * JSON-RPC 响应
 */
interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: number | string;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

/**
 * MCP 初始化响应
 */
interface InitializeResult {
    protocolVersion: string;
    serverInfo: {
        name: string;
        version: string;
    };
    capabilities: {
        tools?: { listChanged?: boolean };
        resources?: { listChanged?: boolean };
        prompts?: { listChanged?: boolean };
    };
}

/**
 * MCP 工具定义
 */
interface McpTool {
    name: string;
    description?: string;
    inputSchema: {
        type: 'object';
        properties?: Record<string, any>;
        required?: string[];
    };
}

/**
 * MCP 资源定义
 */
interface McpResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

/**
 * MCP 提示模板定义
 */
interface McpPrompt {
    name: string;
    description?: string;
    arguments?: Array<{
        name: string;
        description?: string;
        required?: boolean;
    }>;
}

/**
 * HTTP/SSE MCP 客户端
 * 
 * 支持两种模式：
 * 1. SSE (Server-Sent Events) - 使用 SSE 接收响应
 * 2. Streamable HTTP - 使用标准 HTTP POST 请求
 */
export class HttpMcpClient extends EventEmitter {
    private requestId = 0;
    private sessionId?: string;
    private connected = false;
    private timeout: number;
    
    // 服务器能力和信息
    private serverInfo?: { name: string; version: string };
    private protocolVersion?: string;
    private capabilities?: InitializeResult['capabilities'];
    
    // 缓存的工具、资源、提示
    private tools: McpTool[] = [];
    private resources: McpResource[] = [];
    private prompts: McpPrompt[] = [];
    
    constructor(
        private url: string,
        private transportType: 'sse' | 'streamable-http',
        private headers: Record<string, string> = {},
        timeout: number = 30000
    ) {
        super();
        this.timeout = timeout;
    }
    
    /**
     * 连接到服务器
     */
    async connect(): Promise<void> {
        // 发送初始化请求
        const initResult = await this.sendRequest<InitializeResult>('initialize', {
            protocolVersion: '2025-12-19',
            capabilities: {
                roots: { listChanged: true }
            },
            clientInfo: {
                name: 'LimCode',
                // 为什么同步 MCP HTTP 客户端版本：HTTP/Streamable HTTP server 会读取初始化元数据用于兼容性判断。
                // 怎么改：随 1.2.1 性能优化发布同步 clientInfo.version。
                // 目的：避免远端 MCP server 看到过期 LimCode 客户端版本。
                version: '1.2.1'
            }
        });
        
        this.serverInfo = initResult.serverInfo;
        this.protocolVersion = initResult.protocolVersion;
        this.capabilities = initResult.capabilities;
        this.connected = true;
        
        // 发送 initialized 通知
        await this.sendNotification('notifications/initialized', {});
        
        // 获取工具列表（如果支持）
        if (this.capabilities?.tools) {
            try {
                const toolsResult = await this.sendRequest<{ tools: McpTool[] }>('tools/list', {});
                this.tools = toolsResult.tools || [];
            } catch {
                // 忽略获取工具失败
            }
        }
        
        // 获取资源列表（如果支持）
        if (this.capabilities?.resources) {
            try {
                const resourcesResult = await this.sendRequest<{ resources: McpResource[] }>('resources/list', {});
                this.resources = resourcesResult.resources || [];
            } catch {
                // 忽略获取资源失败
            }
        }
        
        // 获取提示列表（如果支持）
        if (this.capabilities?.prompts) {
            try {
                const promptsResult = await this.sendRequest<{ prompts: McpPrompt[] }>('prompts/list', {});
                this.prompts = promptsResult.prompts || [];
            } catch {
                // 忽略获取提示失败
            }
        }
    }
    
    /**
     * 断开连接
     */
    async disconnect(): Promise<void> {
        this.connected = false;
        this.sessionId = undefined;
        this.tools = [];
        this.resources = [];
        this.prompts = [];
    }
    
    /**
     * 获取工具列表
     */
    getTools(): McpTool[] {
        return this.tools;
    }
    
    /**
     * 获取资源列表
     */
    getResources(): McpResource[] {
        return this.resources;
    }
    
    /**
     * 获取提示列表
     */
    getPrompts(): McpPrompt[] {
        return this.prompts;
    }
    
    /**
     * 获取服务器信息
     */
    getServerInfo(): { name: string; version: string } | undefined {
        return this.serverInfo;
    }
    
    /**
     * 获取协议版本
     */
    getProtocolVersion(): string | undefined {
        return this.protocolVersion;
    }
    
    /**
     * 调用工具
     */
    async callTool(name: string, args: Record<string, unknown>): Promise<{
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        isError?: boolean;
    }> {
        return await this.sendRequest('tools/call', {
            name,
            arguments: args
        });
    }
    
    /**
     * 读取资源
     */
    async readResource(uri: string): Promise<{
        contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
    }> {
        return await this.sendRequest('resources/read', { uri });
    }
    
    /**
     * 获取提示
     */
    async getPrompt(name: string, args?: Record<string, string>): Promise<{
        messages: Array<{ role: string; content: { type: string; text?: string } }>;
    }> {
        return await this.sendRequest('prompts/get', { name, arguments: args });
    }
    
    /**
     * 发送 JSON-RPC 请求
     */
    private async sendRequest<T>(method: string, params?: any): Promise<T> {
        const id = ++this.requestId;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id,
            method,
            params
        };
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            ...this.headers
        };
        
        // 如果有 session ID，添加到请求头
        if (this.sessionId) {
            headers['Mcp-Session-Id'] = this.sessionId;
        }
        
        // 创建 AbortController 用于超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, this.timeout);
        
        let response: Response;
        try {
            response = await fetch(this.url, {
                method: 'POST',
                headers,
                body: JSON.stringify(request),
                signal: controller.signal
            });
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(t('modules.mcp.errors.requestTimeout', { timeout: this.timeout }));
            }
            throw error;
        }
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }
        
        // 检查是否返回了 session ID
        const newSessionId = response.headers.get('Mcp-Session-Id');
        if (newSessionId) {
            this.sessionId = newSessionId;
        }
        
        const contentType = response.headers.get('Content-Type') || '';
        
        // SSE 响应
        if (contentType.includes('text/event-stream')) {
            return await this.handleSseResponse<T>(response);
        }
        
        // JSON 响应
        const jsonResponse = await response.json() as JsonRpcResponse;
        
        if (jsonResponse.error) {
            throw new Error(jsonResponse.error.message);
        }
        
        return jsonResponse.result as T;
    }
    
    /**
     * 处理 SSE 响应
     */
    private async handleSseResponse<T>(response: Response): Promise<T> {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }
        
        const decoder = new TextDecoder();
        let buffer = '';
        let result: T | undefined;
        
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                buffer += decoder.decode(value, { stream: true });
                
                // 处理 SSE 事件
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const jsonStr = line.slice(5).trim();
                        if (!jsonStr || jsonStr === '[DONE]') continue;
                        
                        try {
                            const event = JSON.parse(jsonStr) as Partial<JsonRpcResponse>;
                            
                            // 检查是否是最终结果
                            if (event.jsonrpc === '2.0' && event.id !== undefined) {
                                if (event.error) {
                                    throw new Error(event.error.message);
                                }
                                result = event.result as T;
                            }
                        } catch (parseError) {
                            // 忽略解析错误
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
        
        if (result === undefined) {
            throw new Error('No result received from SSE stream');
        }
        
        return result;
    }
    
    /**
     * 发送通知（无需响应）
     */
    private async sendNotification(method: string, params?: any): Promise<void> {
        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...this.headers
        };
        
        if (this.sessionId) {
            headers['Mcp-Session-Id'] = this.sessionId;
        }
        
        await fetch(this.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(notification)
        });
    }
}