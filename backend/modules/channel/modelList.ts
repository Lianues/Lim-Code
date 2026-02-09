/**
 * 模型列表管理
 *
 * 提供获取各平台可用模型列表的功能
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
 */
export async function getGeminiModels(config: ChannelConfig, proxyUrl?: string): Promise<ModelInfo[]> {
  const apiKey = (config as any).apiKey;
  const url = (config as any).url || 'https://generativelanguage.googleapis.com/v1beta';
  
  if (!apiKey) {
    throw new Error(t('modules.channel.modelList.errors.apiKeyRequired'));
  }
  
  try {
    const proxyFetch = createProxyFetch(proxyUrl);
    const response = await proxyFetch(`${url}/models?key=${apiKey}`);
    
    if (!response.ok) {
      throw new Error(t('modules.channel.modelList.errors.fetchModelsFailed', { error: response.statusText }));
    }
    
    const data = await response.json() as any;
    
    // 过滤出支持 generateContent 的模型
    const models = data.models || [];
    return models
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
    const response = await proxyFetch(`${url}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(t('modules.channel.modelList.errors.fetchModelsFailed', { error: response.statusText }));
    }
    
    const data = await response.json() as any;
    
    // 返回所有模型
    const models = data.data || [];
    return models.map((m: any) => ({
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
    const response = await proxyFetch(`${url}/v1/models`, {
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
    return models.map((m: any) => ({
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