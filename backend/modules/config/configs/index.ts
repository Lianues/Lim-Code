/**
 * LimCode - 配置类型统一导出
 *
 * 集中管理所有渠道配置类型的导出
 */

// 导出基础类型
export type { ChannelType, BaseChannelConfig, ModelInfo, TokenCountMethod, TokenCountApiConfig } from './base';

// 导出各渠道配置
export type { GeminiConfig, GeminiOptionsEnabled, ThinkingConfig, ThinkingLevel, ThinkingMode } from './gemini';
export type { OpenAIConfig } from './openai';
export type { AnthropicConfig } from './anthropic';
export type { OpenAIResponsesConfig, OpenAIResponsesOptionsEnabled } from './openai-responses';

/**
 * 渠道配置联合类型
 *
 * 使用 TypeScript 的 discriminated union 实现类型安全
 */
import type { GeminiConfig } from './gemini';
import type { OpenAIConfig } from './openai';
import type { AnthropicConfig } from './anthropic';
import type { OpenAIResponsesConfig } from './openai-responses';

export type ChannelConfig =
    | GeminiConfig
    | OpenAIConfig
    | AnthropicConfig
    | OpenAIResponsesConfig;