/**
 * 工具参数预处理。
 *
 * 这里只保留一个兜底：
 * - 当工具 schema 的顶层参数声明为 array
 * - 且模型把该参数返回成 string
 * - 尝试对该字符串做一次 JSON.parse
 * - 只有解析结果本身就是数组时才替换原值
 *
 * 其他类型不再做自动纠正，交给工具自身或调用方报错。
 */

export interface ToolParameterSchema {
    type: 'object';
    properties: Record<string, PropertySchema>;
    required?: string[];
}

export interface PropertySchema {
    type: string;
    items?: PropertySchema;
    properties?: Record<string, PropertySchema>;
    required?: string[];
    [key: string]: any;
}

/**
 * 仅处理顶层 array 参数的字符串转数组兜底。
 */
export function coerceToolArgs(
    args: Record<string, any>,
    schema: ToolParameterSchema | undefined
): Record<string, any> {
    if (args == null || typeof args !== 'object' || !schema?.properties) {
        return args;
    }

    const result: Record<string, any> = { ...args };
    let modified = false;

    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in result) || propSchema?.type !== 'array') {
            continue;
        }

        const rawValue = result[key];
        if (Array.isArray(rawValue) || typeof rawValue !== 'string') {
            continue;
        }

        const parsed = tryParseJson(rawValue);
        if (Array.isArray(parsed)) {
            result[key] = parsed;
            modified = true;
        }
    }

    return modified ? result : args;
}

/**
 * 校验 array 参数是否已经是数组。
 *
 * 设计目标：
 * - 先经过 coerceToolArgs 做一次字符串转数组尝试
 * - 如果对应参数仍然不是数组，则直接返回工具结果错误
 */
export function getToolArgsArrayValidationError(
    toolName: string,
    args: Record<string, any>,
    schema: ToolParameterSchema | undefined
): string | null {
    if (args == null || typeof args !== 'object' || !schema?.properties) {
        return null;
    }

    for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in args) || propSchema?.type !== 'array') {
            continue;
        }

        const value = args[key];
        if (Array.isArray(value)) {
            continue;
        }

        if (typeof value === 'string') {
            return `Tool "${toolName}" expects parameter "${key}" to be an array. The model returned a string, but it could not be parsed into a JSON array.`;
        }

        return `Tool "${toolName}" expects parameter "${key}" to be an array.`;
    }

    return null;
}

function tryParseJson(str: string): unknown {
    try {
        return JSON.parse(str);
    } catch {
        return undefined;
    }
}
