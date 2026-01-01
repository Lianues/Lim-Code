import { Tool, ToolRegistration } from '../types';
import { t } from '../../i18n';
import { getGlobalSettingsManager, getGlobalConfigManager } from '../../core/settingsContext';

/**
 * Google Search 工具
 * 
 * 对于 Gemini 渠道：
 * 使用 Gemini 内置的 Google Search Grounding 功能进行搜索。
 * 由于 Gemini 不允许内置搜索工具与自定义工具一同发送，
 * 我们在此工具处理器中独立发起一个仅包含内置搜索的 Gemini 请求，
 * 并将返回的已整理文本作为工具结果返回。
 * 这样主对话就能同时支持搜索和其他自定义工具了。
 * 
 * 支持独立渠道配置：
 * 用户可以在设置中指定专门用于搜索的渠道和模型，
 * 这样可以使用更便宜或更快的模型来执行搜索子请求。
 * 
 * 对于其他渠道：
 * 目前返回暂不支持的错误，未来可以加入 Serper/Google Search API 支持。
 */
export const googleSearchTool: Tool = {
    declaration: {
        name: 'google_search',
        description: 'Search the web using Google to get up-to-date information about current events, people, places, and more.',
        category: 'search',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query'
                }
            },
            required: ['query']
        }
    },
    handler: async (args, context) => {
        const query = args.query as string;
        if (!query) {
            return { success: false, error: 'Query is required' };
        }

        // 获取搜索配置
        const settingsManager = getGlobalSettingsManager();
        const configManager = getGlobalConfigManager();
        const googleSearchConfig = settingsManager?.getGoogleSearchConfig();
        
        // 决定使用哪个渠道配置
        let effectiveConfig: any;
        let effectiveChannelType: string;
        
        if (googleSearchConfig?.useDedicatedModel && 
            googleSearchConfig.dedicatedChannelId && 
            googleSearchConfig.dedicatedModelId &&
            configManager) {
            // 使用独立渠道配置
            const dedicatedConfig = await configManager.getConfig(googleSearchConfig.dedicatedChannelId);
            if (dedicatedConfig) {
                effectiveConfig = {
                    ...dedicatedConfig,
                    model: googleSearchConfig.dedicatedModelId  // 覆盖模型
                };
                effectiveChannelType = dedicatedConfig.type;
            } else {
                // 独立渠道不存在，回退到主对话配置
                effectiveConfig = context?.config as any;
                effectiveChannelType = context?.channelType as string;
            }
        } else {
            // 使用主对话配置
            effectiveConfig = context?.config as any;
            effectiveChannelType = context?.channelType as string;
        }

        if (effectiveChannelType === 'gemini' && effectiveConfig) {
            try {
                // 执行 Gemini 独立搜索请求
                const result = await performGeminiNativeSearch(query, effectiveConfig, context);
                return {
                    success: true,
                    data: result
                };
            } catch (error: any) {
                return {
                    success: false,
                    error: `Gemini search failed: ${error.message}`
                };
            }
        }

        return {
            success: false,
            error: t('tools.search.google_search.errors.unsupportedChannel', { channel: effectiveChannelType || 'unknown' })
        };
    }
};

/**
 * 执行 Gemini 原生搜索请求
 */
async function performGeminiNativeSearch(query: string, config: any, context: any): Promise<string> {
    const { apiKey, url, model } = config;
    
    // 使用配置中的模型（已在 handler 中处理了独立渠道逻辑）
    const searchModel = model;
    
    // 构建 API URL
    const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    const apiUrl = `${baseUrl}/models/${searchModel}:generateContent`;
    
    const googleSearchTool = { google_search: {} };

    // 构建请求体
    const body = {
        contents: [{
            role: 'user',
            parts: [{ text: query }]
        }],
        tools: [googleSearchTool]
    };

    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    };
    
    if (apiKey) {
        if (config.useAuthorizationHeader) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else {
            headers['x-goog-api-key'] = apiKey;
        }
    }

    // 尝试使用环境提供的 fetcher (如果可用)
    // 否则回退到原生 fetch
    const fetchFn = (context?.fetcher as typeof fetch) || fetch;
    
    const response = await fetchFn(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: context?.abortSignal
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API error (${response.status}): ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return extractGeminiSearchResponse(data);
}

/**
 * 从 Gemini 响应中提取搜索结果
 */
function extractGeminiSearchResponse(response: any): string {
    const candidate = response?.candidates?.[0];
    if (!candidate?.content?.parts) {
        return 'No results found.';
    }
    
    const parts = candidate.content.parts;
    let text = parts.map((p: any) => p.text || '').join('\n').trim();
    
    // 处理可能的 Grounding Metadata 
    if (!text && candidate.groundingMetadata) {
        return 'Information was found but no text summary was provided by the model.';
    }
    
    return text || 'No results found.';
}

export const registerGoogleSearch: ToolRegistration = () => googleSearchTool;
