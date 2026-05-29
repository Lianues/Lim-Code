/**
 * 对话管理模块
 *
 * 完整支持 Gemini API 格式:
 * - Content[] 数组作为存储格式
 * - 支持函数调用、思考签名、文件数据等
 * - 支持多模态内容（图片、音频、视频、文档）
 * - 可直接用于 Gemini API 调用
 */

export { ConversationManager } from './ConversationManager';
export { createConversationModule } from './register';
export {
    IStorageAdapter,
    MemoryStorageAdapter,
    VSCodeStorageAdapter,
    FileSystemStorageAdapter
} from './storage';
export type {
    // 修改原因：webview 层和未来测试需要复用对话存储定位结果类型，而不应重新声明同构对象。
    // 修改方式：从 conversation 模块统一导出 ConversationStorageLocation。
    // 修改目的：保持历史 reveal 的返回结构类型单一来源。
    ConversationStorageLocation
} from './storage';
export {
    // 修改原因：主对话和 SubAgent 子对话都要复用同一套消息截断与工具配对删除规则。
    // 修改方式：从 conversation 模块统一导出 TranscriptMutation 的纯函数和 adapter 变更入口。
    // 修改目的：调用方不再各自复制 functionCall/functionResponse 配对处理逻辑。
    truncateFrom,
    deleteLogicalMessage,
    mutateTranscript
} from './TranscriptMutation';
export type { TranscriptAdapter } from './TranscriptMutation';
export {
    // 修改原因：WP22 需要让主聊天与 SubAgent 通过统一 transcript 仓储接口读写内容。
    // 修改方式：从 conversation 模块集中导出 TranscriptRepository 抽象及主聊天 adapter。
    // 修改目的：后续协作者只依赖 conversation 模块公开的 transcript seam，而不直接耦合具体文件路径。
    cloneTranscriptContents,
    DelegatingTranscriptRepository,
    ConversationTranscriptRepository
} from './TranscriptRepository';
export type {
    ITranscriptRepository,
    TranscriptContentsMutator,
    TranscriptRepositoryDelegate
} from './TranscriptRepository';
export type {
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
    MessageInsert
} from './types';
export {
    // 修改原因：P1 中央事实源的类型和 runtime guards 必须从 conversation 模块统一暴露，调用方不能深路径复制 schema。
    // 修改方式：集中 re-export contextTypes 的常量、工厂和守卫。
    // 修改目的：让后端上下文、SubAgent、Monitor 后续扩展都引用同一 schema。
    CONVERSATION_METADATA_SCHEMA_VERSION,
    CONVERSATION_CONTEXT_PROJECTION_KEY,
    CONVERSATION_CONTEXT_LEDGER_KEY,
    CONVERSATION_ARTIFACT_REFS_KEY,
    CONVERSATION_MONITOR_WINDOW_STATE_KEY,
    CONVERSATION_SUBAGENT_RUNS_KEY,
    CONVERSATION_CUSTOM_METADATA_KEYS,
    isConversationCustomMetadataKey,
    createEmptyContextProjectionDocument,
    createEmptyContextLedgerDocument,
    createEmptyArtifactRefDocument,
    createEmptyMonitorWindowStateDocument,
    isContextProjectionDocument,
    isContextLedgerDocument,
    isArtifactRefDocument,
    isMonitorWindowStateDocument,
    getContentStableId
} from './contextTypes';
export type {
    ConversationCustomMetadataKey,
    ContextOperationKind,
    ContextOperationStatus,
    ContextProjectionMode,
    ContextActor,
    ContextRestoreBoundary,
    VerbatimMapEntry,
    VerbatimMap,
    ContextProjection,
    ContextProjectionDocument,
    ContextLedgerEntry,
    ContextLedgerDocument,
    ContextStatusSnapshot,
    UiStatusPayload,
    CommandConfirmPayload,
    ArtifactRef,
    ArtifactRefDocument,
    SubAgentOutcome,
    SubAgentStructuredSummary,
    SubAgentRunRecord,
    MonitorWindowState,
    MonitorWindowStateDocument
} from './contextTypes';
export { ConversationMetadataRepository } from './ConversationMetadataRepository';
export type { ConversationMetadataRepositoryDelegate } from './ConversationMetadataRepository';

// 多模态工具
export {
    IMAGE_MIME_TYPES,
    AUDIO_MIME_TYPES,
    VIDEO_MIME_TYPES,
    DOCUMENT_MIME_TYPES,
    SUPPORTED_MIME_TYPES,
    isSupportedMimeType,
    getMultimediaType,
    createInlineDataPart,
    createImagePart,
    createAudioPart,
    createVideoPart,
    createDocumentPart,
    createPartFromDataUrl,
    getInlineDataSize,
    inlineDataToDataUrl,
    hasMultimediaContent,
    getPartMultimediaType
} from './multimedia';
export type {
    ImageMimeType,
    AudioMimeType,
    VideoMimeType,
    DocumentMimeType,
    SupportedMimeType,
    MultimediaType
} from './multimedia';

// 辅助工具函数
export {
    buildMessage,
    buildUserMessage,
    buildModelMessage,
    appendParts,
    prependParts,
    getMessageText,
    getTextParts,
    getMultimediaParts,
    hasMultimedia,
    hasConsecutiveSameRole,
    groupByConsecutiveRole,
    mergeConsecutiveSameRole,
    countParts,
    createTextMessage,
    createMultiTextMessage
} from './helpers';

// 函数调用工具（支持并行调用）
export {
    createFunctionCall,
    createFunctionCallMessage,
    createParallelFunctionCalls,
    extractFunctionCalls,
    hasFunctionCalls,
    hasParallelFunctionCalls,
    getFunctionCallCount,
    hasFunctionResponses,
    extractFunctionResponses,
    createParallelFunctionResponses,
    groupFunctionCallsByName,
    analyzeFunctionCalls,
    matchFunctionCallsAndResponses
} from './functionCall';

// 函数响应工具（多模态支持 - Gemini 3 Pro+）
export {
    FUNCTION_RESPONSE_MIME_TYPES,
    createJsonRef,
    isJsonRef,
    getRefDisplayName,
    isSupportedForFunctionResponse,
    createFunctionResponse,
    createMultimodalFunctionResponse,
    createFunctionResponseWithFile,
    createFunctionResponseWithInlineData,
    createFunctionResponseWithMultipleFiles,
    validateFunctionResponseRefs,
    extractMultimediaFromFunctionResponse,
    hasFunctionResponseMultimedia
} from './functionResponse';
export type {
    JsonReference,
    FunctionResponseMimeType
} from './functionResponse';

// Token 工具
export {
    setMessageTokens,
    createMessageWithTokens,
    getTotalTokens,
    hasTokenCounts,
    calculateHistoryTokens,
    batchSetTokenCounts,
    getTokenEfficiency,
    formatTokenCount
} from './tokenUtils';

// Diff 存储管理器（用于抽离 apply_diff 的 originalContent/newContent）
export {
    DiffStorageManager,
    getDiffStorageManager
} from './DiffStorageManager';
export type {
    DiffContent,
    DiffReference
} from './DiffStorageManager';