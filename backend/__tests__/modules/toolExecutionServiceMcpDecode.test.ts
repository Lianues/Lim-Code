/**
 * WP12 修复 5：ToolExecutionService MCP 解码测试。
 *
 * 为什么需要这个测试：
 *   ToolExecutionService.executeMcpTool()（私有方法）和 prepareToolCallForExecution()
 *   通过 isMcpToolName() + decodeMcpToolName() 组合来判断和解析 MCP 工具名。
 *   这些代码路径没有独立的单元测试覆盖 MCP 解码的正确性。
 *
 * 怎么改：
 *   直接测试 isMcpToolName + decodeMcpToolName 的集成模式：
 *   - isMcpToolName 返回 true 的名称必须能被 decodeMcpToolName 正确解析
 *   - 正向测试（正常 MCP 工具名流经 ToolExecutionService 的逻辑）
 *   - 边界测试（toolName 含下划线、serverId 含单下划线、含中划线）
 *   - 负向测试（非 MCP 名不被误判）
 *
 * 目的：
 *   确保 ToolExecutionService 在执行路径中使用的 codec 组合在所有边界情况下一致。
 *   这些测试不依赖 ToolExecutionService 实例化（私有方法不便直接调用），
 *   而是对 codec 在 ToolExecutionService 中的使用模式进行集成级验证。
 */

import {
    encodeMcpToolName,
    decodeMcpToolName,
    isMcpToolName,
} from '../../modules/mcp/mcpToolNameCodec';

describe('WP12: ToolExecutionService MCP codec usage patterns', () => {
    /**
     * ToolExecutionService 中的 MCP 检测模式：
     *
     *   if (isMcpToolName(executionCall.name) && this.mcpManager) {
     *       response = await this.executeMcpTool(executionCall);
     *   }
     *
     * 然后 executeMcpTool 内部：
     *
     *   const decoded = decodeMcpToolName(call.name);
     *   if (decoded) {
     *       const { serverId, toolName } = decoded;
     *       this.mcpManager!.callTool({ serverId, toolName, arguments: call.args });
     *   }
     */

    // === 正向：isMcpToolName + decodeMcpToolName 全链路 ===
    it('valid MCP tool name: isMcpToolName=true and decode returns valid components', () => {
        const toolName = encodeMcpToolName('exa', 'web_search_exa');
        expect(isMcpToolName(toolName)).toBe(true);

        const decoded = decodeMcpToolName(toolName);
        expect(decoded).not.toBeNull();
        expect(decoded!.serverId).toBe('exa');
        expect(decoded!.toolName).toBe('web_search_exa');
    });

    it('MCP tool name with serverId containing single underscores', () => {
        const toolName = encodeMcpToolName('my_mcp_server', 'search');
        expect(isMcpToolName(toolName)).toBe(true);

        const decoded = decodeMcpToolName(toolName);
        expect(decoded).not.toBeNull();
        expect(decoded!.serverId).toBe('my_mcp_server');
        expect(decoded!.toolName).toBe('search');
    });

    it('MCP tool name with serverId containing hyphens', () => {
        // WP12 修复 1：validateServerId 允许中划线
        const toolName = encodeMcpToolName('github-copilot', 'get_completions');
        expect(isMcpToolName(toolName)).toBe(true);

        const decoded = decodeMcpToolName(toolName);
        expect(decoded).not.toBeNull();
        expect(decoded!.serverId).toBe('github-copilot');
        expect(decoded!.toolName).toBe('get_completions');
    });

    it('MCP tool name with toolName containing double underscores', () => {
        const toolName = encodeMcpToolName('server1', 'tool__with__double');
        expect(isMcpToolName(toolName)).toBe(true);

        const decoded = decodeMcpToolName(toolName);
        expect(decoded).not.toBeNull();
        expect(decoded!.serverId).toBe('server1');
        // 关键：toolName 中 __ 被完整保留，不会错误分割
        expect(decoded!.toolName).toBe('tool__with__double');
    });

    // === 负向：非 MCP 工具名不被误判 ===
    it('builtin tool names are not detected as MCP', () => {
        const builtins = [
            'read_file', 'write_file', 'execute_command',
            'search_in_files', 'apply_diff', 'delete_file',
            'create_directory', 'list_files', 'find_files',
            'subagents', 'generate_image',
        ];

        for (const name of builtins) {
            expect(isMcpToolName(name)).toBe(false);
            expect(decodeMcpToolName(name)).toBeNull();
        }
    });

    // === 半格式不会被当作有效 MCP 名 ===
    it('mcpToolSimpleName-style half-format is detected but decode returns null', () => {
        // mcpToolSimpleName() 生成 mcp__toolName（缺少 serverId）
        // isMcpToolName 返回 true（因为以 mcp__ 开头）
        // 但 decodeMcpToolName 返回 null（因为找不到 __ 分隔符后的 serverId）
        const halfName = 'mcp__web_search_exa';
        expect(isMcpToolName(halfName)).toBe(true);
        expect(decodeMcpToolName(halfName)).toBeNull();
        // 这就是为什么 mcpToolSimpleName 被废弃（WP12 修复 2）：
        //   ToolExecutionService 会把它当作 MCP 名，但执行阶段无法解码。
    });

    // === 空字符串和边界 ===
    it('empty and edge-case names are handled safely', () => {
        expect(isMcpToolName('')).toBe(false);
        expect(decodeMcpToolName('')).toBeNull();

        expect(isMcpToolName('mcp__')).toBe(true);
        expect(decodeMcpToolName('mcp__')).toBeNull(); // 无分隔符后的内容

        expect(isMcpToolName('mcp____')).toBe(true);
        expect(decodeMcpToolName('mcp____')).toBeNull(); // 空 serverId
    });

    // === prepareToolCallForExecution 模式：MCP 工具跳过参数验证 ===
    it('MCP tools are correctly identified for skipping schema validation', () => {
        // ToolExecutionService.prepareToolCallForExecution() 的逻辑：
        //   if (isMcpToolName(call.name)) { return { call, error: null }; }
        // 即：MCP 工具名跳过参数类型校验。
        // 这个测试确保所有标准 MCP 工具名格式都能正确进入此路径。

        const mcpNames = [
            encodeMcpToolName('exa', 'web_search_exa'),
            encodeMcpToolName('github', 'search_repos'),
            encodeMcpToolName('my_server', 'my_tool'),
            encodeMcpToolName('s1', 't'),
            encodeMcpToolName('server', 'tool__with__double'),
            encodeMcpToolName('my-server', 'get_completions'),
        ];

        for (const name of mcpNames) {
            expect(isMcpToolName(name)).toBe(true);
            const decoded = decodeMcpToolName(name);
            expect(decoded).not.toBeNull();
            // serverId 和 toolName 都不能为空
            expect(decoded!.serverId.length).toBeGreaterThan(0);
            expect(decoded!.toolName.length).toBeGreaterThan(0);
        }
    });
});
