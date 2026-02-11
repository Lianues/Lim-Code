/**
 * LimCode - Anthropic 配置类型
 *
 * Anthropic Claude API 的配置支持
 */

import type { BaseChannelConfig, ModelInfo } from './base';

/**
 * 配置项启用状态
 *
 * 用于控制哪些配置项会被发送到 API
 * 未列出的配置项默认不发送
 */
export interface AnthropicOptionsEnabled {
    /** 是否发送温度参数 */
    temperature?: boolean;
    
    /** 是否发送最大输出 token 数 */
    max_tokens?: boolean;
    
    /** 是否发送 top_p 参数 */
    top_p?: boolean;
    
    /** 是否发送 top_k 参数 */
    top_k?: boolean;
    
    /** 是否启用思考配置 */
    thinking?: boolean;
}

/**
 * Anthropic 配置
 *
 * 支持 Anthropic Claude API 格式的配置
 */
export interface AnthropicConfig extends BaseChannelConfig {
    type: 'anthropic';
    
    /** API 端点 URL */
    url: string;
    
    /** API 密钥 */
    apiKey: string;
    
    /** 是否使用 Authorization Bearer 格式发送 API Key（替代 x-api-key） */
    useAuthorizationHeader?: boolean;
    
    /** 当前使用的模型名称 */
    model: string;
    
    /** 可用模型列表 */
    models?: ModelInfo[];
    
    /** 系统指令 */
    systemInstruction?: string;
    
    /**
     * 工具调用模式
     * - function_call: 使用原生 tool_use/tool_result（默认）
     * - xml: 使用 XML 提示词格式
     * - json: 使用 JSON 提示词格式
     */
    toolMode?: 'function_call' | 'xml' | 'json';
    
    /** 生成配置（可选） */
    options?: {
        /** 温度参数 */
        temperature?: number;
        
        /** 最大输出 token 数 */
        max_tokens?: number;
        
        /** Top-p 采样参数 */
        top_p?: number;
        
        /** Top-k 采样参数 */
        top_k?: number;
        
        /** 停止序列 */
        stop_sequences?: string[];
        
        /** 是否启用流式输出 */
        stream?: boolean;
        
        /**
         * 思考配置
         *
         * 用于控制 Claude 的扩展思考能力
         *
         * 示例：
         * {
         *   type: "enabled",
         *   budget_tokens: 10000
         * }
         *
         * 或使用自适应模式（Opus 4.6+）：
         * {
         *   type: "adaptive",
         *   effort: "high"
         * }
         */
        thinking?: {
            /**
             * 思考类型
             * - enabled: 启用思考（需配合 budget_tokens）
             * - adaptive: 自适应思考（Opus 4.6+，Claude 自动决定思考深度）
             * - disabled: 禁用思考
             */
            type?: 'enabled' | 'adaptive' | 'disabled';
            
            /**
             * 思考预算（Token 数量）
             * 思考过程使用的最大 Token 数量
             * 建议值：5000-50000
             * 仅在 type 为 'enabled' 时使用
             */
            budget_tokens?: number;
            
            /**
             * 思考努力级别
             * 仅在 type 为 'adaptive' 时使用
             * - max: 最大努力（仅 Opus 4.6）
             * - high: 高努力（默认）
             * - medium: 中等努力
             * - low: 低努力
             */
            effort?: 'max' | 'high' | 'medium' | 'low';
        };
    };
    
    /**
     * 配置项启用状态
     *
     * 控制 options 中的哪些参数会被发送到 API
     * 仅当此处的对应字段为 true 时，options 中的值才会被发送
     */
    optionsEnabled?: AnthropicOptionsEnabled;
}