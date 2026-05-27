/**
 * LimCode - 渠道调用模块
 * 
 * 统一导出所有类型、类和函数
 */

// 类型定义
export type {
    GenerateRequest,
    GenerateResponse,
    StreamChunk,
    HttpRequestOptions,
    HttpResponse
} from './types';

export { ErrorType, ChannelError } from './types';

// 格式转换器
export {
    BaseFormatter,
    GeminiFormatter,
    OpenAIFormatter,
    AnthropicFormatter,
    FormatterRegistry,
    formatterRegistry
} from './formatters';

// 核心管理器
export { ChannelManager } from './ChannelManager';
export {
    ToolDeclarationResolver,
    type ToolDeclarationResolveOptions,
    type DeclarationChannelType,
    type DeclarationToolMode
} from './ToolDeclarationResolver';

// 流式处理工具
export { StreamAccumulator } from './StreamAccumulator';

// Token 计数服务
export { TokenCountService, createTokenCountService } from './TokenCountService';
export type { TokenCountResult } from './TokenCountService';

// 模型列表
export type { ModelInfo } from './modelList';
export { getModels, getGeminiModels, getOpenAIModels, getClaudeModels } from './modelList';

// 模块注册
export { registerChannelModule } from './register';