/**
 * MCP 工具名称编解码器 (WP12)
 *
 * 为什么需要这个模块：
 *   项目中有两套 MCP 工具名约定：toolAdapter.ts 用 mcp_（单下划线），
 *   ToolDeclarationResolver / ToolExecutionService / 前端 mcp_tool.ts 用 mcp__（双下划线）。
 *   这导致编码和解码逻辑分散、不一致，且手动 split('__') 在 serverId 或 toolName
 *   本身包含双下划线时会错误分割。
 *
 * 怎么改：
 *   创建单一权威 codec 模块，所有 MCP 工具名的编码（serverId+toolName → 完整名）
 *   和解码（完整名 → serverId+toolName）都必须通过这里。
 *   禁止调用点手拼 `mcp__${x}__${y}` 或 `startsWith('mcp__')` 字符串。
 *
 * 目的：
 *   统一 MCP 工具名格式为 mcp__<serverId>__<toolName>，用 indexOf 而非 split 解析，
 *   正确处理 serverId/toolName 含下划线或双下划线的边界情况。
 */

/** MCP 工具名前缀（所有 MCP 工具名以此开头） */
export const MCP_TOOL_PREFIX = 'mcp__';

/** MCP 工具名分隔符（分隔 serverId 和 toolName） */
export const MCP_TOOL_SEPARATOR = '__';

/**
 * 编码：将 serverId 和 toolName 组合为完整的 MCP 工具名。
 *
 * 格式：mcp__<serverId>__<toolName>
 *
 * 为什么使用双下划线：
 *   Gemini API 不允许函数名中包含多个冒号，所以不能用 mcp:server:tool 格式。
 *   双下划线是合理的折中。
 *
 * MCP 工具名 grammar（WP12 修复 1）：
 *   serverId 由 McpManager.validateServerId() 保证：允许字母数字、单下划线、中划线，
 *   禁止连续双下划线 __（正则 /^(?!.*__)[a-zA-Z0-9_-]+$/）。
 *   这确保 decodeMcpToolName 可以用 indexOf('__') 无歧义定位分隔符。
 *   toolName 无此限制（可以是 MCP 服务端返回的任意合法工具名，可含下划线或双下划线）。
 *
 * @param serverId MCP 服务器 ID（由 validateServerId 保证不含 __）
 * @param toolName 原始工具名（可含单下划线，如 web_search_exa）
 * @returns 完整的 MCP 工具名
 */
export function encodeMcpToolName(serverId: string, toolName: string): string {
    return `${MCP_TOOL_PREFIX}${serverId}${MCP_TOOL_SEPARATOR}${toolName}`;
}

/**
 * 解码：从完整 MCP 工具名中提取 serverId 和原始 toolName。
 *
 * 为什么用 indexOf 而非 split：
 *   toolName 可能包含双下划线（极端情况），split('__') 会把 toolName 切成多段，
 *   导致解析错误。indexOf 只找第一个分隔符，剩余部分完整保留为 toolName。
 *
 * @param fullName 完整的 MCP 工具名，如 "mcp__exa__web_search_exa"
 * @returns { serverId, toolName } 或 null（如果不是 MCP 工具名）
 */
export function decodeMcpToolName(fullName: string): { serverId: string; toolName: string } | null {
    if (!fullName.startsWith(MCP_TOOL_PREFIX)) {
        return null;
    }

    const remainder = fullName.substring(MCP_TOOL_PREFIX.length);
    const sepIndex = remainder.indexOf(MCP_TOOL_SEPARATOR);

    if (sepIndex < 0) {
        // 格式不完整：只有 mcp__ 前缀但没有分隔符
        return null;
    }

    const serverId = remainder.substring(0, sepIndex);
    const toolName = remainder.substring(sepIndex + MCP_TOOL_SEPARATOR.length);

    // serverId 不能为空，toolName 不能为空
    if (!serverId || !toolName) {
        return null;
    }

    return { serverId, toolName };
}

/**
 * 判断给定名称是否为 MCP 工具名。
 *
 * 替代所有手写的 startsWith('mcp__') 调用点。
 */
export function isMcpToolName(name: string): boolean {
    return name.startsWith(MCP_TOOL_PREFIX);
}
