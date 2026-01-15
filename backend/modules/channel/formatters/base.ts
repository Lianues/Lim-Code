/**
 * LimCode - 格式转换器基类
 * 
 * 定义格式转换器的抽象接口
 */

import type { Content } from '../../conversation/types';
import type { ChannelConfig } from '../../config/types';
import type { ToolDeclaration } from '../../../tools/types';
import type {
    GenerateRequest,
    GenerateResponse,
    StreamChunk,
    HttpRequestOptions
} from '../types';

/**
 * 格式转换器基类
 * 
 * 所有格式转换器都必须继承此类并实现抽象方法
 */
export abstract class BaseFormatter {
    /**
     * 构建 HTTP 请求
     *
     * 将统一的 GenerateRequest 转换为特定 API 的请求格式
     *
     * @param request 生成请求
     * @param config 渠道配置
     * @param tools 工具声明列表（可选）
     * @returns HTTP 请求选项
     */
    abstract buildRequest(
        request: GenerateRequest,
        config: ChannelConfig,
        tools?: ToolDeclaration[]
    ): HttpRequestOptions;
    
    /**
     * 解析响应
     * 
     * 将 API 响应转换为统一的 GenerateResponse 格式
     * 
     * @param response 原始响应
     * @returns 标准化的响应
     */
    abstract parseResponse(response: any): GenerateResponse;
    
    /**
     * 解析流式响应块
     * 
     * 将流式响应块转换为 StreamChunk 格式
     * 
     * @param chunk 原始响应块
     * @returns 标准化的流式响应块
     */
    abstract parseStreamChunk(chunk: any): StreamChunk;
    
    /**
     * 验证配置
     * 
     * 检查配置是否适用于此格式转换器
     * 
     * @param config 渠道配置
     * @returns 是否有效
     */
    abstract validateConfig(config: ChannelConfig): boolean;
    
    /**
     * 获取支持的配置类型
     *
     * @returns 配置类型
     */
    abstract getSupportedType(): string;
    
    /**
     * 转换工具声明
     *
     * 将统一的工具声明格式转换为特定 API 的工具格式
     *
     * @param tools 工具声明数组
     * @returns 转换后的工具格式
     */
    abstract convertTools(tools: ToolDeclaration[]): any;
    
    /**
     * 查找动态提示词插入点的索引
     *
     * 查找连续的最后一组带有 isUserInput 标记的消息
     * 返回这组消息的第一条索引，动态提示词会被插入到该消息之前
     *
     * @param history 处理后的历史消息
     * @returns 插入点索引，找不到返回 -1
     */
    protected findLastUserMessageGroupIndex(history: Content[]): number {
        let firstIndex = -1;
        let foundMarkedMessage = false;
        
        // 从后向前查找
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].isUserInput) {
                // 找到用户输入消息，记录索引，继续向前查找连续的用户输入消息
                firstIndex = i;
                foundMarkedMessage = true;
            } else if (foundMarkedMessage) {
                // 已找到用户输入消息，但当前消息不是，说明连续组结束
                break;
            }
            // 如果还没找到用户输入消息，继续向前查找
        }
        
        return firstIndex;
    }
    
    /**
     * 清理历史消息中的内部字段
     *
     * 移除不应该发送给 API 的内部标记字段（如 isUserInput）
     *
     * @param history 历史消息
     * @returns 清理后的历史消息
     */
    protected cleanInternalFields(history: Content[]): Content[] {
        return history.map(content => {
            const { isUserInput, ...rest } = content;
            return rest;
        });
    }
}