/**
 * LimCode MCP (Model Context Protocol) 模块
 * 
 * 提供 MCP 服务器配置管理和客户端连接功能
 */

// 类型定义
export type {
    McpTransportType,
    McpServerStatus,
    StdioTransportConfig,
    SseTransportConfig,
    StreamableHttpTransportConfig,
    McpTransportConfig,
    McpServerConfig,
    CreateMcpServerInput,
    UpdateMcpServerInput,
    McpToolDefinition,
    McpResourceDefinition,
    McpPromptDefinition,
    McpServerCapabilities,
    McpServerInfo,
    McpToolCallRequest,
    McpToolCallResult,
    McpResourceReadRequest,
    McpResourceContent,
    McpPromptGetRequest,
    McpPromptMessage,
    McpLogLevel,
    McpLogEntry,
    McpStorageAdapter,
    McpEventType,
    McpEvent,
    McpEventListener
} from './types';

// 管理器
export { McpManager } from './McpManager';

// 客户端
export { StdioMcpClient } from './StdioClient';
export { HttpMcpClient } from './HttpClient';

// 存储适配器
export {
    MementoMcpStorageAdapter,
    InMemoryMcpStorageAdapter,
    FileSystemMcpStorageAdapter,
    VSCodeFileSystemMcpStorageAdapter
} from './storage';

// 模块注册
export { registerMcpModule } from './register';

// 工具适配器
export {
    mcpToolToDeclaration,
    mcpResultToToolResult,
    parseMcpToolName,
    createMcpTool,
    mcpToolsToDeclarations,
    collectAllMcpToolDeclarations,
    mcpToolSimpleName,
    mcpToolToDeclarationWithOptions
} from './toolAdapter';
export type { McpToolSchema, McpToolRegistrationOptions } from './toolAdapter';

// WP12：MCP 工具名编解码器（统一编码和解码，禁止调用点手拼 mcp__ 字符串）
export {
    encodeMcpToolName,
    decodeMcpToolName,
    isMcpToolName,
    MCP_TOOL_PREFIX,
    MCP_TOOL_SEPARATOR
} from './mcpToolNameCodec';