/**
 * LimCode - 格式转换器注册表
 * 
 * 管理所有格式转换器的注册和获取
 */

import { BaseFormatter } from './base';
import { GeminiFormatter } from './gemini';
import { OpenAIFormatter } from './openai';
import { AnthropicFormatter } from './anthropic';
import { OpenAIResponsesFormatter } from './openai-responses';
import type { ChannelType } from '../../config/types';

/**
 * 格式转换器注册表
 */
export class FormatterRegistry {
    private formatters: Map<ChannelType, BaseFormatter> = new Map();
    
    constructor() {
        // 注册默认格式转换器
        this.register(new GeminiFormatter());
        this.register(new OpenAIFormatter());
        this.register(new AnthropicFormatter());
        this.register(new OpenAIResponsesFormatter());
    }
    
    /**
     * 注册格式转换器
     */
    register(formatter: BaseFormatter): void {
        const type = formatter.getSupportedType() as ChannelType;
        this.formatters.set(type, formatter);
    }
    
    /**
     * 获取格式转换器
     */
    get(type: ChannelType): BaseFormatter | undefined {
        return this.formatters.get(type);
    }
    
    /**
     * 检查是否支持某种类型
     */
    has(type: ChannelType): boolean {
        return this.formatters.has(type);
    }
    
    /**
     * 获取所有支持的类型
     */
    getSupportedTypes(): ChannelType[] {
        return Array.from(this.formatters.keys());
    }
}

// 导出默认实例
export const formatterRegistry = new FormatterRegistry();

// 导出类型和类
export { BaseFormatter } from './base';
export { GeminiFormatter } from './gemini';
export { OpenAIFormatter } from './openai';
export { AnthropicFormatter } from './anthropic';
export { OpenAIResponsesFormatter } from './openai-responses';