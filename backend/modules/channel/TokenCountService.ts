/**
 * LimCode - Token 计数服务
 *
 * 提供通过 API 精确计算 token 数量的功能
 * 支持 Gemini、OpenAI、Anthropic 三种渠道
 */

import { createProxyFetch } from './proxyFetch';
import type { TokenCountChannelConfig, TokenCountConfig } from '../settings/types';
import type { Content } from '../conversation/types';
import type { ChannelConfig, TokenCountMethod, TokenCountApiConfig } from '../config/types';
import { cleanContentForAPI } from '../conversation/helpers';

/**
 * Token 计数结果
 */
export interface TokenCountResult {
    /** 是否成功 */
    success: boolean;
    /** 总 token 数 */
    totalTokens?: number;
    /** 错误信息 */
    error?: string;
}

/**
 * Token 计数服务
 * 
 * 根据渠道类型调用对应的 token 计数 API
 */
export class TokenCountService {
    private proxyUrl?: string;
    
    constructor(proxyUrl?: string) {
        this.proxyUrl = proxyUrl;
    }
    
    /**
     * 更新代理设置
     */
    setProxyUrl(proxyUrl?: string) {
        this.proxyUrl = proxyUrl;
    }
    
    /**
     * 计算内容的 token 数（使用全局配置）
     *
     * @param channelType 渠道类型 (gemini, openai, anthropic)
     * @param config Token 计数配置
     * @param contents 要计算的内容
     * @returns Token 计数结果
     */
    async countTokens(
        channelType: 'gemini' | 'openai' | 'anthropic' | 'openai-responses',
        config: TokenCountConfig,
        contents: Content[]
    ): Promise<TokenCountResult> {
        const channelConfig = config[channelType];
        
        if (!channelConfig?.enabled) {
            return {
                success: false,
                error: `Token count not enabled for ${channelType}`
            };
        }
        
        if (!channelConfig.apiKey) {
            return {
                success: false,
                error: `API key not configured for ${channelType} token count`
            };
        }
        
        try {
            switch (channelType) {
                case 'gemini':
                    return await this.countGeminiTokens(channelConfig, contents);
                case 'openai':
                    return await this.countOpenAITokens(channelConfig, contents);
                case 'openai-responses':
                    return await this.countOpenAIResponsesTokens(channelConfig, contents);
                case 'anthropic':
                    return await this.countAnthropicTokens(channelConfig, contents);
                default:
                    return {
                        success: false,
                        error: `Unknown channel type: ${channelType}`
                    };
            }
        } catch (error: any) {
            return {
                success: false,
                error: error?.message || 'Unknown error'
            };
        }
    }
    
    /**
     * 根据渠道配置计算内容的 token 数
     *
     * 根据渠道的 tokenCountMethod 字段选择对应的计数方式：
     * - 'channel_default': 根据渠道类型自动选择默认方式
     * - 'gemini': 使用 Gemini countTokens API
     * - 'openai_custom': 使用自定义 OpenAI 格式 API
     * - 'anthropic': 使用 Anthropic count_tokens API
     * - 'local': 使用本地估算
     *
     * @param channelConfig 渠道配置
     * @param contents 要计算的内容
     * @returns Token 计数结果
     */
    async countTokensWithChannelConfig(
        channelConfig: ChannelConfig,
        contents: Content[]
    ): Promise<TokenCountResult> {
        const method = channelConfig.tokenCountMethod || 'channel_default';
        const apiConfig = channelConfig.tokenCountApiConfig;
        
        // 确定实际使用的计数方式
        let actualMethod: TokenCountMethod = method;
        if (method === 'channel_default') {
            // 根据渠道类型选择默认方式
            switch (channelConfig.type) {
                case 'gemini':
                    actualMethod = 'gemini';
                    break;
                case 'anthropic':
                    actualMethod = 'anthropic';
                    break;
                case 'openai-responses':
                    actualMethod = 'openai_responses';
                    break;
                case 'openai':
                default:
                    actualMethod = 'local';
                    break;
            }
        }
        
        try {
            switch (actualMethod) {
                case 'gemini':
                    return await this.countGeminiTokensWithConfig(channelConfig, apiConfig, contents);
                case 'openai_custom':
                    return await this.countOpenAITokensWithConfig(channelConfig, apiConfig, contents);
                case 'openai_responses':
                    return await this.countOpenAIResponsesTokensWithConfig(channelConfig, apiConfig, contents);
                case 'anthropic':
                    return await this.countAnthropicTokensWithConfig(channelConfig, apiConfig, contents);
                case 'local':
                    return this.countLocalTokens(contents);
                default:
                    return {
                        success: false,
                        error: `Unknown token count method: ${actualMethod}`
                    };
            }
        } catch (error: any) {
            return {
                success: false,
                error: error?.message || 'Unknown error'
            };
        }
    }
    
    /**
     * 本地估算 token 数
     * 约 4 个字符 = 1 个 token
     */
    private countLocalTokens(contents: Content[]): TokenCountResult {
        let totalChars = 0;
        
        for (const content of contents) {
            const cleaned = cleanContentForAPI(content);
            for (const part of cleaned.parts) {
                if ('text' in part && part.text) {
                    totalChars += part.text.length;
                }
            }
        }
        
        return {
            success: true,
            totalTokens: Math.ceil(totalChars / 4)
        };
    }
    
    /**
     * 使用渠道配置调用 Gemini Token 计数
     */
    private async countGeminiTokensWithConfig(
        channelConfig: ChannelConfig,
        apiConfig: TokenCountApiConfig | undefined,
        contents: Content[]
    ): Promise<TokenCountResult> {
        // 使用独立配置或渠道配置
        const url = apiConfig?.url || channelConfig.url;
        const apiKey = apiConfig?.apiKey || channelConfig.apiKey;
        const model = apiConfig?.model || channelConfig.model;
        
        if (!url || !apiKey || !model) {
            return {
                success: false,
                error: 'Gemini token count: URL, API key or model not configured'
            };
        }
        
        // 构建 countTokens URL
        // 将 generateContent 或其他端点替换为 countTokens
        let countUrl: string;
        if (url.includes('{model}') && url.includes('{key}')) {
            // 使用模板格式
            countUrl = url
                .replace('{model}', model)
                .replace('{key}', apiKey);
        } else if (url.includes(':generateContent')) {
            // 替换 generateContent 为 countTokens
            countUrl = url.replace(':generateContent', ':countTokens');
            if (!countUrl.includes('key=')) {
                countUrl += (countUrl.includes('?') ? '&' : '?') + `key=${apiKey}`;
            }
        } else if (url.includes(':streamGenerateContent')) {
            // 替换 streamGenerateContent 为 countTokens
            countUrl = url.replace(':streamGenerateContent', ':countTokens');
            if (!countUrl.includes('key=')) {
                countUrl += (countUrl.includes('?') ? '&' : '?') + `key=${apiKey}`;
            }
        } else {
            // 假设是基础 URL，添加 countTokens 端点
            const baseUrl = url.replace(/\/$/, '');
            countUrl = `${baseUrl}/models/${model}:countTokens?key=${apiKey}`;
        }
        
        // 构建请求体
        const geminiContents = contents.map(content => {
            const cleaned = cleanContentForAPI(content);
            return {
                role: cleaned.role,
                parts: cleaned.parts.map(part => {
                    if ('text' in part && part.text !== undefined) {
                        return { text: part.text };
                    }
                    return part;
                })
            };
        });
        
        const requestBody = {
            contents: geminiContents
        };
        
        const proxyFetch = createProxyFetch(this.proxyUrl);
        const response = await proxyFetch(countUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = `HTTP ${response.status}`;
            }
            return {
                success: false,
                error: `Gemini API error: ${errorBody}`
            };
        }
        
        const result = await response.json() as { totalTokens: number };
        
        return {
            success: true,
            totalTokens: result.totalTokens
        };
    }
    
    /**
     * 使用渠道配置调用 OpenAI 兼容 Token 计数
     */
    private async countOpenAITokensWithConfig(
        channelConfig: ChannelConfig,
        apiConfig: TokenCountApiConfig | undefined,
        contents: Content[]
    ): Promise<TokenCountResult> {
        // 使用独立配置或渠道配置
        const url = apiConfig?.url;
        const apiKey = apiConfig?.apiKey || channelConfig.apiKey;
        const model = apiConfig?.model || channelConfig.model;
        
        if (!url) {
            return {
                success: false,
                error: 'OpenAI custom token count: URL not configured'
            };
        }
        
        if (!apiKey) {
            return {
                success: false,
                error: 'OpenAI custom token count: API key not configured'
            };
        }
        
        // 转换内容格式
        const messages = contents.map(content => {
            const cleaned = cleanContentForAPI(content);
            return {
                role: cleaned.role === 'model' ? 'assistant' : cleaned.role,
                content: cleaned.parts.map(part => {
                    if ('text' in part && part.text) {
                        return { type: 'text' as const, text: part.text };
                    }
                    if ('inlineData' in part && part.inlineData) {
                        return {
                            type: 'image_url' as const,
                            image_url: {
                                url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                            }
                        };
                    }
                    return { type: 'text' as const, text: '' };
                })
            };
        });
        
        const requestBody: any = { messages };
        if (model) {
            requestBody.model = model;
        }
        
        const proxyFetch = createProxyFetch(this.proxyUrl);
        const response = await proxyFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = `HTTP ${response.status}`;
            }
            return {
                success: false,
                error: `OpenAI compatible API error: ${errorBody}`
            };
        }
        
        const result = await response.json() as { total_tokens?: number; totalTokens?: number };
        const totalTokens = result.total_tokens ?? result.totalTokens;
        
        if (totalTokens === undefined) {
            return {
                success: false,
                error: 'Response missing total_tokens field'
            };
        }
        
        return {
            success: true,
            totalTokens
        };
    }
    
    /**
     * 使用渠道配置调用 OpenAI Responses Token 计数
     */
    private async countOpenAIResponsesTokensWithConfig(
        channelConfig: ChannelConfig,
        apiConfig: TokenCountApiConfig | undefined,
        contents: Content[]
    ): Promise<TokenCountResult> {
        // 使用独立配置或渠道配置
        const url = apiConfig?.url || (channelConfig.type === 'openai-responses' ? channelConfig.url : undefined);
        const apiKey = apiConfig?.apiKey || channelConfig.apiKey;
        const model = apiConfig?.model || channelConfig.model;
        
        if (!url) {
            return {
                success: false,
                error: 'OpenAI responses token count: URL not configured'
            };
        }
        
        if (!apiKey) {
            return {
                success: false,
                error: 'OpenAI responses token count: API key not configured'
            };
        }

        // 构建请求端点
        let countUrl = url;
        if (countUrl.endsWith('/responses')) {
            countUrl = countUrl + '/input_tokens';
        } else if (!countUrl.includes('/responses/input_tokens')) {
            const baseUrl = countUrl.replace(/\/$/, '');
            countUrl = `${baseUrl}/v1/responses/input_tokens`;
        }
        
        // 转换内容格式
        // 对于 Responses API，我们将所有内容转换为 input 数组
        // 系统消息提取为 instructions
        let instructions = '';
        const inputParts: any[] = [];

        for (const content of contents) {
            const cleaned = cleanContentForAPI(content);
            if (cleaned.role === 'system') {
                for (const part of cleaned.parts) {
                    if ('text' in part && part.text) {
                        instructions += (instructions ? '\n' : '') + part.text;
                    }
                }
                continue;
            }

            // user/model 消息都放入 input
            for (const part of cleaned.parts) {
                if ('text' in part && part.text) {
                    inputParts.push({ type: 'text', text: part.text });
                } else if ('inlineData' in part && part.inlineData) {
                    inputParts.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                        }
                    });
                }
            }
        }
        
        const requestBody: any = { 
            input: inputParts 
        };
        if (instructions) {
            requestBody.instructions = instructions;
        }
        if (model) {
            requestBody.model = model;
        }
        
        const proxyFetch = createProxyFetch(this.proxyUrl);
        const response = await proxyFetch(countUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = `HTTP ${response.status}`;
            }
            return {
                success: false,
                error: `OpenAI Responses API error: ${errorBody}`
            };
        }
        
        const result = await response.json() as { input_tokens?: number };
        
        if (result.input_tokens === undefined) {
            return {
                success: false,
                error: 'Response missing input_tokens field'
            };
        }
        
        return {
            success: true,
            totalTokens: result.input_tokens
        };
    }
    
    /**
     * 使用渠道配置调用 Anthropic Token 计数
     */
    private async countAnthropicTokensWithConfig(
        channelConfig: ChannelConfig,
        apiConfig: TokenCountApiConfig | undefined,
        contents: Content[]
    ): Promise<TokenCountResult> {
        // 使用独立配置或渠道配置
        const baseUrl = apiConfig?.url || channelConfig.url;
        const apiKey = apiConfig?.apiKey || channelConfig.apiKey;
        const model = apiConfig?.model || channelConfig.model;
        
        if (!apiKey || !model) {
            return {
                success: false,
                error: 'Anthropic token count: API key or model not configured'
            };
        }
        
        // 构建 count_tokens URL
        let countUrl: string;
        if (baseUrl) {
            if (baseUrl.includes('/messages/count_tokens')) {
                countUrl = baseUrl;
            } else if (baseUrl.includes('/messages')) {
                countUrl = baseUrl.replace('/messages', '/messages/count_tokens');
            } else {
                const cleanUrl = baseUrl.replace(/\/$/, '');
                countUrl = `${cleanUrl}/v1/messages/count_tokens`;
            }
        } else {
            countUrl = 'https://api.anthropic.com/v1/messages/count_tokens';
        }
        
        // 转换内容格式
        const messages = contents.map(content => {
            const cleaned = cleanContentForAPI(content);
            return {
                role: cleaned.role === 'model' ? 'assistant' : cleaned.role,
                content: cleaned.parts.map(part => {
                    if ('text' in part && part.text !== undefined) {
                        return { type: 'text' as const, text: part.text };
                    }
                    return { type: 'text' as const, text: '' };
                })
            };
        });
        
        const requestBody = {
            model,
            messages
        };
        
        const proxyFetch = createProxyFetch(this.proxyUrl);
        const response = await proxyFetch(countUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = `HTTP ${response.status}`;
            }
            return {
                success: false,
                error: `Anthropic API error: ${errorBody}`
            };
        }
        
        const result = await response.json() as { input_tokens: number };
        
        return {
            success: true,
            totalTokens: result.input_tokens
        };
    }
    
    /**
     * Gemini Token 计数
     * 
     * API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens?key={key}
     * 
     * 请求体:
     * {
     *   "contents": [{ "parts": [{ "text": "..." }] }]
     * }
     * 
     * 响应:
     * {
     *   "totalTokens": number,
     *   "cachedContentTokenCount": number,
     *   "promptTokensDetails": [...],
     *   "cacheTokensDetails": [...]
     * }
     */
    private async countGeminiTokens(
        config: TokenCountChannelConfig,
        contents: Content[]
    ): Promise<TokenCountResult> {
        // 构建 URL
        let url = config.baseUrl
            .replace('{model}', config.model)
            .replace('{key}', config.apiKey);
        
        // 清理并转换内容格式为 Gemini 格式
        const geminiContents = contents.map(content => {
            const cleaned = cleanContentForAPI(content);
            return {
                role: cleaned.role,
                parts: cleaned.parts.map(part => {
                    if ('text' in part && part.text !== undefined) {
                        return { text: part.text };
                    }
                    // 处理其他类型的 part（如 inlineData, functionResponse 等）
                    return part;
                })
            };
        });
        
        const requestBody = {
            contents: geminiContents
        };
        
        const proxyFetch = createProxyFetch(this.proxyUrl);
        const response = await proxyFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = `HTTP ${response.status}`;
            }
            return {
                success: false,
                error: `Gemini API error: ${errorBody}`
            };
        }
        
        const result = await response.json() as { totalTokens: number };
        
        return {
            success: true,
            totalTokens: result.totalTokens
        };
    }
    
    /**
     * OpenAI Token 计数
     *
     * 支持用户自定义的 OpenAI 兼容 Token 计数 API。
     *
     * API 规范：
     * - POST {baseUrl}
     * - Headers: Content-Type: application/json, Authorization: Bearer {apiKey}
     * - Body: { model: string, messages: [...] }
     * - Response: { total_tokens: number }
     */
    private async countOpenAITokens(
        config: TokenCountChannelConfig,
        contents: Content[]
    ): Promise<TokenCountResult> {
        // 如果没有配置 baseUrl，返回失败让调用方回退到估算
        if (!config.baseUrl) {
            return {
                success: false,
                error: 'OpenAI token count API URL not configured. Use estimation instead.'
            };
        }
        
        // 清理并转换内容格式为 OpenAI Messages 格式
        const messages = contents.map(content => {
            const cleaned = cleanContentForAPI(content);
            return {
                role: cleaned.role === 'model' ? 'assistant' : cleaned.role,
                content: cleaned.parts.map(part => {
                    if ('text' in part && part.text) {
                        return { type: 'text' as const, text: part.text };
                    }
                    // 处理图片等其他类型
                    if ('inlineData' in part && part.inlineData) {
                        return {
                            type: 'image_url' as const,
                            image_url: {
                                url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                            }
                        };
                    }
                    return { type: 'text' as const, text: '' };
                })
            };
        });
        
        const requestBody = {
            model: config.model,
            messages
        };
        
        const proxyFetch = createProxyFetch(this.proxyUrl);
        const response = await proxyFetch(config.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = `HTTP ${response.status}`;
            }
            return {
                success: false,
                error: `OpenAI compatible API error: ${errorBody}`
            };
        }
        
        const result = await response.json() as { total_tokens?: number; totalTokens?: number };
        
        // 支持 total_tokens 或 totalTokens 字段
        const totalTokens = result.total_tokens ?? result.totalTokens;
        
        if (totalTokens === undefined) {
            return {
                success: false,
                error: 'Response missing total_tokens field'
            };
        }
        
        return {
            success: true,
            totalTokens
        };
    }
    
    /**
     * OpenAI Responses Token 计数
     *
     * API: POST https://api.openai.com/v1/responses/input_tokens
     *
     * 请求体:
     * {
     *   "model": "gpt-5",
     *   "input": [...],
     *   "instructions": "..."
     * }
     *
     * 响应:
     * {
     *   "object": "response.input_tokens",
     *   "input_tokens": number
     * }
     */
    private async countOpenAIResponsesTokens(
        config: TokenCountChannelConfig,
        contents: Content[]
    ): Promise<TokenCountResult> {
        if (!config.baseUrl) {
            return {
                success: false,
                error: 'OpenAI responses token count API URL not configured. Use estimation instead.'
            };
        }

        // 构建 URL
        let url = config.baseUrl;
        if (url.endsWith('/responses')) {
            url = url + '/input_tokens';
        } else if (!url.includes('/responses/input_tokens')) {
            const baseUrl = url.replace(/\/$/, '');
            url = `${baseUrl}/v1/responses/input_tokens`;
        }
        
        // 转换内容格式
        let instructions = '';
        const inputParts: any[] = [];

        for (const content of contents) {
            const cleaned = cleanContentForAPI(content);
            if (cleaned.role === 'system') {
                for (const part of cleaned.parts) {
                    if ('text' in part && part.text) {
                        instructions += (instructions ? '\n' : '') + part.text;
                    }
                }
                continue;
            }

            for (const part of cleaned.parts) {
                if ('text' in part && part.text) {
                    inputParts.push({ type: 'text', text: part.text });
                } else if ('inlineData' in part && part.inlineData) {
                    inputParts.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                        }
                    });
                }
            }
        }
        
        const requestBody = {
            model: config.model,
            input: inputParts,
            instructions: instructions || undefined
        };
        
        const proxyFetch = createProxyFetch(this.proxyUrl);
        const response = await proxyFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = `HTTP ${response.status}`;
            }
            return {
                success: false,
                error: `OpenAI Responses API error: ${errorBody}`
            };
        }
        
        const result = await response.json() as { input_tokens: number };
        
        if (result.input_tokens === undefined) {
            return {
                success: false,
                error: 'Response missing input_tokens field'
            };
        }
        
        return {
            success: true,
            totalTokens: result.input_tokens
        };
    }
    
    /**
     * Anthropic Token 计数
     * 
     * API: POST https://api.anthropic.com/v1/messages/count_tokens
     * 
     * 请求体:
     * {
     *   "model": "claude-sonnet-4-5",
     *   "messages": [...]
     * }
     * 
     * 响应:
     * {
     *   "input_tokens": number
     * }
     */
    private async countAnthropicTokens(
        config: TokenCountChannelConfig,
        contents: Content[]
    ): Promise<TokenCountResult> {
        // 清理并转换内容格式为 Anthropic messages 格式
        const messages = contents.map(content => {
            const cleaned = cleanContentForAPI(content);
            return {
                role: cleaned.role === 'model' ? 'assistant' : cleaned.role,
                content: cleaned.parts.map(part => {
                    if ('text' in part && part.text !== undefined) {
                        return { type: 'text' as const, text: part.text };
                    }
                    // 处理图片等其他类型
                    return { type: 'text' as const, text: '' };
                })
            };
        });
        
        const requestBody = {
            model: config.model,
            messages
        };
        
        const proxyFetch = createProxyFetch(this.proxyUrl);
        const response = await proxyFetch(config.baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = `HTTP ${response.status}`;
            }
            return {
                success: false,
                error: `Anthropic API error: ${errorBody}`
            };
        }
        
        const result = await response.json() as { input_tokens: number };
        
        return {
            success: true,
            totalTokens: result.input_tokens
        };
    }
}

/**
 * 创建 TokenCountService 实例
 */
export function createTokenCountService(proxyUrl?: string): TokenCountService {
    return new TokenCountService(proxyUrl);
}