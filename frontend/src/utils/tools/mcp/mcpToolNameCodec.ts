/**
 * MCP 工具名称编解码器 - 前端版本 (WP12)
 *
 * 为什么需要这个模块：
 *   前端的 mcp_tool.ts 有多处手写 startsWith('mcp__') 和 split('__') 解析。
 *   与后端 codec 保持一致的编解码逻辑，避免 serverId/toolName 含下划线时解析错误。
 *
 * 怎么改：
 *   导出与后端 mcpToolNameCodec.ts 函数签名一致的函数，
 *   前端调用点替换手写字符串操作为统一 codec 调用。
 *
 * 目的：
 *   前端和后端使用同一套编解码规则，保证跨层一致性。
 */

/** MCP 工具名前缀（所有 MCP 工具名以此开头） */
export const MCP_TOOL_PREFIX = 'mcp__';

/** MCP 工具名分隔符（分隔 serverId 和 toolName） */
export const MCP_TOOL_SEPARATOR = '__';

/**
 * 编码：将 serverId 和 toolName 组合为完整的 MCP 工具名。
 */
export function encodeMcpToolName(serverId: string, toolName: string): string {
    return `${MCP_TOOL_PREFIX}${serverId}${MCP_TOOL_SEPARATOR}${toolName}`;
}

/**
 * 解码：从完整 MCP 工具名中提取 serverId 和原始 toolName。
 *
 * 为什么用 indexOf 而非 split：
 *   toolName 可能包含双下划线，split('__') 会把 toolName 切成多段导致解析错误。
 *   indexOf 只找第一个分隔符，剩余部分完整保留为 toolName。
 */
export function decodeMcpToolName(fullName: string): { serverId: string; toolName: string } | null {
    if (!fullName.startsWith(MCP_TOOL_PREFIX)) {
        return null;
    }

    const remainder = fullName.substring(MCP_TOOL_PREFIX.length);
    const sepIndex = remainder.indexOf(MCP_TOOL_SEPARATOR);

    if (sepIndex < 0) {
        return null;
    }

    const serverId = remainder.substring(0, sepIndex);
    const toolName = remainder.substring(sepIndex + MCP_TOOL_SEPARATOR.length);

    if (!serverId || !toolName) {
        return null;
    }

    return { serverId, toolName };
}

/**
 * 判断给定名称是否为 MCP 工具名。
 */
export function isMcpToolName(name: string): boolean {
    return name.startsWith(MCP_TOOL_PREFIX);
}
