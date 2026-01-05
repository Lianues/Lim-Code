/**
 * LimCode - 基础配置类型
 *
 * 所有渠道配置的基础接口和通用类型
 */

/**
 * 支持的渠道类型
 */
export type ChannelType = 'gemini' | 'openai' | 'anthropic' | 'openai-responses';

/**
 * 裁切图片工具配置
 */
export interface CropImageToolOptions {
    /**
     * 是否使用归一化坐标
     *
     * - true: 使用 0-1000 归一化坐标系统（适用于 Gemini 等模型）
     * - false: 模型直接输出像素坐标（适用于能自行计算坐标的模型）
     *
     * 默认值：true
     */
    useNormalizedCoordinates?: boolean;
}

/**
 * 工具配置
 *
 * 各工具的渠道级配置
 */
export interface ToolOptions {
    /** 裁切图片工具配置 */
    cropImage?: CropImageToolOptions;
}

/**
 * 工具使用模式
 */
export type ToolMode = 'function_call' | 'xml' | 'json';

/**
 * Token 计数方式
 *
 * - 'channel_default': 使用渠道默认方式（根据渠道类型自动选择）
 * - 'gemini': 使用 Gemini countTokens API
 * - 'openai_custom': 使用自定义 OpenAI 格式 API
 * - 'openai_responses': 使用 OpenAI Responses input_tokens API
 * - 'anthropic': 使用 Anthropic count_tokens API
 * - 'local': 使用本地估算方式（4 字符约等于 1 token）
 */
export type TokenCountMethod = 'channel_default' | 'gemini' | 'openai_custom' | 'openai_responses' | 'anthropic' | 'local';

/**
 * Token 计数 API 配置
 */
export interface TokenCountApiConfig {
    /** API URL */
    url?: string;
    
    /** API Key */
    apiKey?: string;
    
    /** 模型名称 */
    model?: string;
}

/**
 * 自定义请求标头项
 */
export interface CustomHeader {
    /** 标头键名 */
    key: string;
    
    /** 标头值 */
    value: string;
    
    /** 是否启用 */
    enabled: boolean;
}

/**
 * 自定义 body 模式
 */
export type CustomBodyMode = 'simple' | 'advanced';

/**
 * 自定义 body 简单模式项
 *
 * 键值对形式，值可以是 JSON 字符串
 */
export interface CustomBodyItem {
    /** 键名（支持嵌套路径，如 "extra_body" 或 "extra_body.google"） */
    key: string;
    
    /** 值（JSON 字符串或普通字符串） */
    value: string;
    
    /** 是否启用 */
    enabled: boolean;
}

/**
 * 自定义 body 配置
 */
export interface CustomBodyConfig {
    /** 模式：simple = 键值对，advanced = 完整 JSON */
    mode: CustomBodyMode;
    
    /** 简单模式下的键值对列表 */
    items?: CustomBodyItem[];
    
    /** 复杂模式下的 JSON 字符串 */
    json?: string;
}

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
 * 基础配置接口
 *
 * 所有渠道配置都继承此接口
 */
export interface BaseChannelConfig {
    /** 唯一标识符 */
    id: string;
    
    /** 显示名称 */
    name: string;
    
    /** 渠道类型 */
    type: ChannelType;
    
    /** 是否启用 */
    enabled: boolean;
    
    /** 创建时间戳 */
    createdAt: number;
    
    /** 最后更新时间戳 */
    updatedAt: number;
    
    /** 描述信息（可选） */
    description?: string;
    
    /** 标签（用于分类） */
    tags?: string[];
    
    /**
     * 系统指令（可选）
     * 
     * 为模型提供系统级指令，定义其行为和角色
     * 例如："You are a helpful AI assistant"
     */
    systemInstruction?: string;
    
    /**
     * 请求超时时间（毫秒）
     *
     * 必填项，默认推荐：120000 (120秒)
     * 用于控制 API 请求的最大等待时间
     */
    timeout: number;
    
    /**
     * 是否优先使用流式输出
     *
     * - true: 默认使用流式（某些渠道可能只支持流式）
     * - false: 默认使用非流式（默认值）
     * - 注意：config.options.stream 可以覆盖此设置
     */
    preferStream?: boolean;
    
    /**
     * 工具使用模式
     *
     * - `function_call`: 使用 Function Calling（默认）
     *   工具定义会作为独立字段传递给 API
     * - `xml`: 使用 XML 提示词格式
     *   工具定义会被转换为 XML 格式并插入到系统提示词中
     * - `json`: 使用 JSON 代码块格式
     *   工具定义会被转换为 JSON 格式说明，模型输出 ```json 代码块
     *
     * 默认值：'function_call'
     */
    toolMode?: ToolMode;
    
    /**
     * 自定义请求标头
     *
     * 用于添加额外的 HTTP 请求标头
     * 按照数组顺序发送
     */
    customHeaders?: CustomHeader[];
    
    /**
     * 是否启用自定义标头功能
     */
    customHeadersEnabled?: boolean;
    
    /**
     * 自定义请求 body
     *
     * 用于添加额外的请求体字段
     * 支持嵌套 JSON 覆盖
     */
    customBody?: CustomBodyConfig;
    
    /**
     * 是否启用自定义 body 功能
     */
    customBodyEnabled?: boolean;
    
    /**
     * 是否发送历史思考签名
     *
     * 启用后，将发送历史对话中的所有思考签名
     * 签名会根据渠道类型选择对应格式发送
     *
     * 默认值：false
     */
    sendHistoryThoughtSignatures?: boolean;
    
    /**
     * 是否发送历史思考内容
     *
     * 启用后，将发送历史对话中的所有思考内容（包括摘要）
     * 这可能会显著增加上下文长度
     *
     * 默认值：false
     */
    sendHistoryThoughts?: boolean;
    
    /**
     * 发送历史思考的回合数
     *
     * 控制发送最近多少轮非最新回合的历史对话的思考签名/内容
     * - -1: 发送全部历史回合
     * - 0: 不发送任何历史回合（仅发送最新回合）
     * - n (n > 0): 发送最近 n 轮历史对话（不包括最新回合）
     *
     * 例如：设置为 1 表示只发送倒数第二回合的思考内容
     *
     * 默认值：-1（全部）
     */
    historyThinkingRounds?: number;

    /**
     * 是否发送当前轮次思考签名 (Gemini 3/2.5 必需)
     */
    sendCurrentThoughtSignatures?: boolean;

    /**
     * 是否发送当前轮次思考内容 (Reasoning Content)
     */
    sendCurrentThoughts?: boolean;
    
    /**
     * 是否启用自动重试
     *
     * 启用后，当 API 返回非 200 错误时自动重试
     *
     * 默认值：true
     */
    retryEnabled?: boolean;
    
    /**
     * 重试次数
     *
     * API 返回错误时的最大重试次数
     *
     * 默认值：3
     */
    retryCount?: number;
    
    /**
     * 重试间隔（毫秒）
     *
     * 每次重试之间的等待时间
     *
     * 默认值：3000 (3秒)
     */
    retryInterval?: number;
    
    /**
     * 是否启用上下文阈值检测
     *
     * 启用后，当总 token 数超过阈值时，自动舍弃最旧的对话回合
     *
     * 默认值：false
     */
    contextThresholdEnabled?: boolean;
    
    /**
     * 上下文阈值
     *
     * 支持两种格式：
     * - 数值：直接指定 token 数量，如 100000
     * - 字符串百分比：如 "80%" 表示上下文窗口的 80%
     *
     * 当 totalTokenCount 超过此阈值时，自动舍弃最旧的对话回合
     *
     * 注意：此值应小于 maxContextTokens，否则无意义
     *
     * 默认值："80%"
     */
    contextThreshold?: number | string;
    
    /**
     * 裁剪时额外裁剪的 token 数量或比例
     *
     * 当触发上下文裁剪时，实际保留的上下文 = 阈值 - 额外裁剪值
     * 支持两种格式：
     * - 数值：直接指定额外裁剪的 token 数量，如 5000
     * - 字符串百分比：如 "10%" 表示额外裁剪最大上下文的 10%
     *
     * 例如：阈值为 80%，额外裁剪为 10%，则实际保留 70% 的上下文
     *
     * 注意：如果只有一个回合，则跳过裁剪
     *
     * 默认值：0（不额外裁剪）
     */
    contextTrimExtraCut?: number | string;
    
    /**
     * 是否启用自动总结（占位功能，暂未实现）
     *
     * 启用后，在舍弃旧回合前先进行总结
     *
     * 默认值：false
     */
    autoSummarizeEnabled?: boolean;
    
    /**
     * 是否启用多模态工具
     *
     * 启用后，read_file 等工具将支持读取以下类型的文件：
     * - 图片：image/png, image/jpeg, image/webp
     * - 文档：application/pdf, text/plain
     *
     * 禁用时，只允许读取文本文件 (text/plain)
     *
     * 默认值：false（禁用多模态，仅支持文本）
     */
    multimodalToolsEnabled?: boolean;
    
    /**
     * 工具配置
     *
     * 各工具的渠道级配置项
     */
    toolOptions?: ToolOptions;
    
    /**
     * Token 计数方式
     *
     * - 'channel_default': 使用渠道默认方式（根据渠道类型自动选择）
     *   - Gemini 渠道 → 使用 Gemini countTokens API
     *   - Anthropic 渠道 → 使用 Anthropic count_tokens API
     *   - OpenAI 渠道 → 使用本地估算
     * - 'gemini': 使用 Gemini countTokens API
     * - 'openai_custom': 使用自定义 OpenAI 格式 API
     * - 'anthropic': 使用 Anthropic count_tokens API
     * - 'local': 使用本地估算方式
     *
     * 默认值：'channel_default'
     */
    tokenCountMethod?: TokenCountMethod;
    
    /**
     * Token 计数 API 配置
     *
     * 当 tokenCountMethod 需要 API 调用时使用
     * - 如果不配置，将使用渠道的 url 和 apiKey
     * - 配置后可使用独立的 Token 计数 API
     */
    tokenCountApiConfig?: TokenCountApiConfig;
}

/**
 * 深度合并两个对象
 *
 * @param target 目标对象
 * @param source 源对象
 * @returns 合并后的对象
 */
export function deepMerge(target: any, source: any): any {
    if (source === null || source === undefined) {
        return target;
    }
    
    // 如果目标是数组，将源合并进去（如果是数组则拼接，否则作为单项追加）
    // 这确保了 tools 等数组字段永远不会被自定义设置直接抹除，只会增加
    if (Array.isArray(target)) {
        const sourceItems = Array.isArray(source) ? source : [source];
        return [...target, ...sourceItems];
    }
    
    // 如果源是数组（但目标不是），由于类型冲突，采用覆盖策略
    if (Array.isArray(source)) {
        return source;
    }
    
    // 如果源不是对象，直接覆盖
    if (typeof source !== 'object') {
        return source;
    }
    
    // 如果目标不是对象，初始化为空对象
    if (typeof target !== 'object' || target === null) {
        target = {};
    }
    
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
        // 递归合并所有子节点
        result[key] = deepMerge(result[key], source[key]);
    }
    
    return result;
}

/**
 * 解析自定义 body 配置并与原始 body 合并
 *
 * @param originalBody 原始请求体
 * @param customBody 自定义 body 配置
 * @param enabled 是否启用
 * @returns 合并后的请求体
 */
export function applyCustomBody(originalBody: any, customBody?: CustomBodyConfig, enabled?: boolean): any {
    if (!enabled || !customBody) {
        return originalBody;
    }
    
    let result = { ...originalBody };
    
    if (customBody.mode === 'simple' && customBody.items) {
        // 简单模式：遍历所有项
        for (const item of customBody.items) {
            if (!item.enabled || !item.key || !item.key.trim()) {
                continue;
            }
            
            const rawKey = item.key.trim();
            let value: any;
            
            // 尝试解析值为 JSON
            try {
                value = JSON.parse(item.value);
            } catch {
                // 解析失败，使用原始字符串
                value = item.value;
            }
            
            // 处理嵌套路径键名（如 "extra_body.google"）
            if (rawKey.includes('.')) {
                const parts = rawKey.split('.');
                const nestedObj = {};
                let current: any = nestedObj;
                for (let i = 0; i < parts.length - 1; i++) {
                    current[parts[i]] = {};
                    current = current[parts[i]];
                }
                current[parts[parts.length - 1]] = value;
                result = deepMerge(result, nestedObj);
            } else {
                result = deepMerge(result, { [rawKey]: value });
            }
        }
    } else if (customBody.mode === 'advanced' && customBody.json) {
        // 复杂模式：解析完整 JSON 并深度合并
        try {
            const customData = JSON.parse(customBody.json);
            result = deepMerge(result, customData);
        } catch (error) {
            console.warn('Failed to parse custom body JSON:', error);
        }
    }
    
    return result;
}