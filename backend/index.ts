/**
 * LimCode Backend - 后端模块入口
 */

// 核心注册系统
export { ModuleRegistry, globalRegistry } from './core/registry';
export { initializeProductMetadata, getProductMetadata, getProductVersion } from './core/productMetadata';
export type {
    ApiParameter,
    ApiDefinition,
    ModuleDefinition,
    ApiRequest,
    ApiResponse,
    IModuleRegistry
} from './core/registry';

// 对话管理模块
export {
    ConversationManager,
    createConversationModule,
    VSCodeStorageAdapter,
    FileSystemStorageAdapter
} from './modules/conversation';
export type {
    IStorageAdapter,
    Content,
    ContentPart,
    ConversationHistory,
    ConversationMetadata,
    ConversationData,
    MessagePosition,
    MessageFilter,
    HistorySnapshot,
    ConversationStats,
    MessageEdit,
    MessageInsert,
    ImageMimeType,
    AudioMimeType,
    VideoMimeType,
    DocumentMimeType,
    SupportedMimeType,
    MultimediaType,
    JsonReference,
    FunctionResponseMimeType
} from './modules/conversation';

// 配置管理模块
export {
    ConfigManager,
    MementoStorageAdapter,
    HybridStorageAdapter,
    registerConfigModule
} from './modules/config';
export type {
    ConfigStorageAdapter,
    ChannelType,
    BaseChannelConfig,
    GeminiConfig,
    OpenAIConfig,
    AnthropicConfig,
    ChannelConfig,
    CreateConfigInput,
    UpdateConfigInput,
    ConfigStats,
    ValidationResult,
    ExportOptions,
    ImportOptions,
    ConfigFilter,
    ConfigSortOptions
} from './modules/config';

// 渠道管理模块
export * from './modules/channel';

// MCP模块
export * from './modules/mcp';

// API模块
export * from './modules/api';