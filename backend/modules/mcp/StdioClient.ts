/**
 * LimCode MCP 模块 - Stdio 客户端
 * 
 * 通过 stdin/stdout 与 MCP 服务器通信
 */

import * as cp from 'child_process';
import { EventEmitter } from 'events';

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
 * Stdio MCP 客户端
 */
export class StdioMcpClient extends EventEmitter {
    private process: cp.ChildProcess | null = null;
    private requestId = 0;
    private pendingRequests: Map<number | string, {
        resolve: (result: any) => void;
        reject: (error: Error) => void;
    }> = new Map();
    private buffer = '';
    
    // 服务器能力和信息
    private serverInfo?: { name: string; version: string };
    private protocolVersion?: string;
    private capabilities?: InitializeResult['capabilities'];
    
    // 缓存的工具、资源、提示
    private tools: McpTool[] = [];
    private resources: McpResource[] = [];
    private prompts: McpPrompt[] = [];
    
    // stderr 输出（用于错误诊断）
    private stderrOutput: string = '';
    
    constructor(
        private command: string,
        private args: string[] = [],
        private env?: Record<string, string>,
        private cwd?: string
    ) {
        super();
    }
    
    /**
     * 启动服务器进程并初始化
     */
    async connect(): Promise<void> {
        // 启动子进程
        const processEnv = {
            ...process.env,
            ...this.env
        };
        
        // 收集 stderr 输出用于错误诊断
        this.stderrOutput = '';
        
        this.process = cp.spawn(this.command, this.args, {
            env: processEnv,
            cwd: this.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32'  // Windows 需要 shell 来执行 .cmd/.bat 文件（如 npx）
        });
        
        // 设置错误处理
        this.process.on('error', (err) => {
            this.emit('error', err);
        });
        
        this.process.on('exit', (code, signal) => {
            this.emit('exit', code, signal);
            this.cleanup();
        });
        
        // 收集 stderr
        this.process.stderr?.on('data', (data) => {
            this.stderrOutput += data.toString();
        });
        
        // 读取 stdout
        this.process.stdout?.on('data', (data) => {
            this.handleData(data.toString());
        });
        
        // 发送初始化请求（带超时和进程退出检测）
        const initResult = await this.sendRequest<InitializeResult>('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                roots: { listChanged: true }
            },
            clientInfo: {
                name: 'LimCode',
                version: '1.0.5'
            }
        });
        
        this.serverInfo = initResult.serverInfo;
        this.protocolVersion = initResult.protocolVersion;
        this.capabilities = initResult.capabilities;
        
        // 发送 initialized 通知
        this.sendNotification('notifications/initialized', {});
        
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
        if (this.process) {
            this.process.kill();
            this.cleanup();
        }
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
     * 发送 JSON-RPC 请求（带超时和进程退出检测）
     */
    private sendRequest<T>(method: string, params?: any, timeout: number = 30000): Promise<T> {
        return new Promise((resolve, reject) => {
            if (!this.process || !this.process.stdin) {
                const errorInfo = this.stderrOutput ? `\nStderr: ${this.stderrOutput.trim()}` : '';
                reject(new Error(`Process not started${errorInfo}`));
                return;
            }
            
            const id = ++this.requestId;
            const request: JsonRpcRequest = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };
            
            let resolved = false;
            
            // 超时处理
            const timeoutId = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    this.pendingRequests.delete(id);
                    const errorInfo = this.stderrOutput ? `\nStderr: ${this.stderrOutput.trim()}` : '';
                    reject(new Error(`Request "${method}" timeout (${timeout / 1000}s)${errorInfo}`));
                }
            }, timeout);
            
            // 进程退出检测
            const onExit = () => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    this.pendingRequests.delete(id);
                    const errorInfo = this.stderrOutput ? `\nStderr: ${this.stderrOutput.trim()}` : '';
                    reject(new Error(`Process exited while waiting for "${method}" response${errorInfo}`));
                }
            };
            
            this.process.once('exit', onExit);
            
            this.pendingRequests.set(id, {
                resolve: (result) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeoutId);
                        this.process?.removeListener('exit', onExit);
                        resolve(result);
                    }
                },
                reject: (error) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeoutId);
                        this.process?.removeListener('exit', onExit);
                        reject(error);
                    }
                }
            });
            
            const message = JSON.stringify(request) + '\n';
            this.process.stdin.write(message);
        });
    }
    
    /**
     * 发送 JSON-RPC 通知（无需响应）
     */
    private sendNotification(method: string, params?: any): void {
        if (!this.process || !this.process.stdin) {
            return;
        }
        
        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };
        
        const message = JSON.stringify(notification) + '\n';
        this.process.stdin.write(message);
    }
    
    /**
     * 处理收到的数据
     */
    private handleData(data: string): void {
        this.buffer += data;
        
        // 处理每一行（JSON-RPC 消息以换行符分隔）
        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);
            
            if (!line) continue;
            
            try {
                const message = JSON.parse(line);
                this.handleMessage(message);
            } catch {
                // 忽略解析错误
            }
        }
    }
    
    /**
     * 处理 JSON-RPC 消息
     */
    private handleMessage(message: JsonRpcResponse | any): void {
        // 检查是响应还是通知
        if ('id' in message && message.id !== null) {
            // 这是响应
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                
                if (message.error) {
                    pending.reject(new Error(message.error.message));
                } else {
                    pending.resolve(message.result);
                }
            }
        } else if ('method' in message) {
            // 这是通知或请求
            this.emit('notification', message.method, message.params);
        }
    }
    
    /**
     * 清理资源
     */
    private cleanup(): void {
        this.process = null;
        
        // 拒绝所有等待中的请求（包含 stderr 信息）
        const errorInfo = this.stderrOutput ? `\nStderr: ${this.stderrOutput.trim()}` : '';
        for (const [id, pending] of this.pendingRequests) {
            pending.reject(new Error(`Connection closed${errorInfo}`));
        }
        this.pendingRequests.clear();
        
        this.tools = [];
        this.resources = [];
        this.prompts = [];
        this.stderrOutput = '';
    }
}