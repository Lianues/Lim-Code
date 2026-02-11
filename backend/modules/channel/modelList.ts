/**
 * 模型列表管理
 *
 * 提供获取各平台可用模型列表的功能
 * 所有平台均支持分页获取，确保能拿到完整的模型列表
 */

import { t } from '../../i18n';
import type { ChannelConfig } from '../config/types';
import { createProxyFetch } from './proxyFetch';

/**
 * 模型信息
 */
export interface ModelInfo {
  /** 模型 ID */
  id: string;
  
  /** 模型名称 */
  name?: string;
  
  /** 模型描述 */
  description?: string;
  
  /** 上下文窗口大小 */
  contextWindow?: number;
  
  /** 最大输出token */
  maxOutputTokens?: number;
}

/**
 * 获取 Gemini 模型列表
 * Gemini API 支持 pageSize 和 pageToken 分页参数
 */
export async function getGeminiModels(config: ChannelConfig, proxyUrl?: string): Promise<ModelInfo[]> {
  const apiKey = (config as any).apiKey;
  const url = (config as any).url || 'https://generativelanguage.googleapis.com/v1beta';

  if (!apiKey) {
    throw new Error(t('modules.channel.modelList.errors.apiKeyRequired'));
  }

  try {
    const proxyFetch = createProxyFetch(proxyUrl);
    const allModels: any[] = [];
    let pageToken: string | undefined;

    // 循环获取所有分页数据
    do {
      const params = new URLSearchParams({ key: apiKey, pageSize: '1000' });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const response = await proxyFetch(`${url}/models?${params.toString()}`);

      if (!response.ok) {
        throw new Error(t('modules.channel.modelList.errors.fetchModelsFailed', { error: response.statusText }));
      }

      const data = await response.json() as any;
      const models = data.models || [];
      allModels.push(...models);

      pageToken = data.nextPageToken;
    } while (pageToken);

    // 过滤出支持 generateContent 的模型
    return allModels
      .filter((m: any) => 
        m.supportedGenerationMethods?.includes('generateContent')
      )
      .map((m: any) => ({
        id: m.name.replace('models/', ''),
        name: m.displayName,
        description: m.description,
        contextWindow: m.inputTokenLimit,
        maxOutputTokens: m.outputTokenLimit
      }));
  } catch (error) {
    console.error('Failed to get Gemini models:', error);
    throw error;
  }
}

/**
 * 获取 OpenAI 兼容模型列表
 * 很多第三方中转站会对 /models 接口做分页限制（默认可能只返回 50 条）
 * 通过传递较大的 limit 参数并支持分页遍历来获取所有模型
 */
export async function getOpenAIModels(config: ChannelConfig, proxyUrl?: string): Promise<ModelInfo[]> {
  const apiKey = (config as any).apiKey;
  let url = (config as any).url || 'https://api.openai.com/v1';

  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  // 如果是 openai-responses 且 URL 包含 /responses，移除它以获取模型列表
  if (config.type === 'openai-responses' && url.endsWith('/responses')) {
    url = url.slice(0, -10);
  }

  if (!apiKey) {
    throw new Error(t('modules.channel.modelList.errors.apiKeyRequired'));
  }

  try {
    const proxyFetch = createProxyFetch(proxyUrl);
    const allModels: any[] = [];
    let hasMore = true;
    let afterCursor: string | undefined;

    // 循环获取所有分页数据
    // OpenAI 官方 API 不分页，但第三方中转站可能支持 limit/after 分页
    do {
      const params = new URLSearchParams({ limit: '10000' });
      if (afterCursor) {
        params.set('after', afterCursor);
      }

      const response = await proxyFetch(`${url}/models?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      if (!response.ok) {
        throw new Error(t('modules.channel.modelList.errors.fetchModelsFailed', { error: response.statusText }));
      }

      const data = await response.json() as any;
      const models = data.data || [];
      allModels.push(...models);

      // 检查是否还有更多数据（OpenAI list API 支持 has_more 字段）
      if (data.has_more && models.length > 0) {
        afterCursor = models[models.length - 1].id;
      } else {
        hasMore = false;
      }
    } while (hasMore);

    return allModels.map((m: any) => ({
      id: m.id,
      name: m.id,
      description: `Created: ${new Date(m.created * 1000).toLocaleDateString()}`
    }));
  } catch (error) {
    console.error('Failed to get OpenAI models:', error);
    throw error;
  }
}

/**
 * 获取 Claude 模型列表（通过 Anthropic Models API）
 * Anthropic Models API 默认 limit=20，最大 limit=1000，支持分页游标
 */
export async function getClaudeModels(config: ChannelConfig, proxyUrl?: string): Promise<ModelInfo[]> {
  const apiKey = (config as any).apiKey;
  let url = (config as any).url || 'https://api.anthropic.com';

  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }

  // 移除末尾的 /v1/messages 等路径，只保留基础 URL
  url = url.replace(/\/v1\/(messages|complete)$/i, '');

  if (!apiKey) {
    throw new Error(t('modules.channel.modelList.errors.apiKeyRequired'));
  }

  try {
    const proxyFetch = createProxyFetch(proxyUrl);
    const allModels: any[] = [];
    let afterId: string | undefined;

    // 循环获取所有分页数据
    do {
      const params = new URLSearchParams({ limit: '1000' });
      if (afterId) {
        params.set('after_id', afterId);
      }

      const response = await proxyFetch(`${url}/v1/models?${params.toString()}`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      });

      if (!response.ok) {
        throw new Error(t('modules.channel.modelList.errors.fetchModelsFailed', { error: response.statusText }));
      }

      const data = await response.json() as any;
      const models = data.data || [];
      allModels.push(...models);

      // Anthropic API 返回 has_more 和 last_id 用于分页
      if (data.has_more && data.last_id) {
        afterId = data.last_id;
      } else {
        afterId = undefined;
      }
    } while (afterId);

    return allModels.map((m: any) => ({
      id: m.id,
      name: m.display_name || m.id,
      description: m.display_name ? m.id : undefined,
      contextWindow: m.input_token_limit,
      maxOutputTokens: m.output_token_limit
    }));
  } catch (error) {
    console.error('Failed to get Claude models:', error);
    throw error;
  }
}

/**
 * 根据配置类型获取模型列表
 */
export async function getModels(config: ChannelConfig, proxyUrl?: string): Promise<ModelInfo[]> {
  switch (config.type) {
    case 'gemini':
      return getGeminiModels(config, proxyUrl);
    
    case 'openai':
      return getOpenAIModels(config, proxyUrl);
    
    case 'openai-responses':
      return getOpenAIModels(config, proxyUrl);
    
    case 'anthropic':
      return getClaudeModels(config, proxyUrl);
    
    default:
      throw new Error(t('modules.channel.modelList.errors.unsupportedConfigType', { type: (config as any).type }));
  }
}
