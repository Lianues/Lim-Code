/**
 * WP12 修复 4：前后端 MCP codec parity tests。
 *
 * 为什么需要这个测试：
 *   后端 `backend/modules/mcp/mcpToolNameCodec.ts` 和
 *   前端 `frontend/src/utils/tools/mcp/mcpToolNameCodec.ts` 是两份独立实现。
 *   虽然它们当前逻辑相同，但没有机制保证未来不会各自独立演化导致分歧。
 *
 * 怎么改：
 *   在同一测试文件中导入两份实现，对相同的输入并行调用，断言输出完全一致。
 *   任何一方修改后如果导致行为不一致，此测试会立即捕获。
 *
 * 目的：
 *   满足 G1 集成审计要求：前后端 codec 重复实现需要 parity test 或共享方案。
 *   在实现共享之前（跨前后端共享需要更复杂的构建配置），parity test 是短期最优方案。
 */

import {
    encodeMcpToolName as backendEncode,
    decodeMcpToolName as backendDecode,
    isMcpToolName as backendIsMcp,
    MCP_TOOL_PREFIX as backendPrefix,
    MCP_TOOL_SEPARATOR as backendSep,
} from '../../modules/mcp/mcpToolNameCodec';

// 前端 codec 是纯 TypeScript（无 Vue 依赖），可在 Node 测试中直接导入。
import {
    encodeMcpToolName as frontendEncode,
    decodeMcpToolName as frontendDecode,
    isMcpToolName as frontendIsMcp,
    MCP_TOOL_PREFIX as frontendPrefix,
    MCP_TOOL_SEPARATOR as frontendSep,
} from '../../../frontend/src/utils/tools/mcp/mcpToolNameCodec';

describe('WP12: frontend/backend codec parity', () => {
    // === 常量一致性 ===
    it('MCP_TOOL_PREFIX is identical', () => {
        expect(frontendPrefix).toBe(backendPrefix);
        expect(frontendPrefix).toBe('mcp__');
    });

    it('MCP_TOOL_SEPARATOR is identical', () => {
        expect(frontendSep).toBe(backendSep);
        expect(frontendSep).toBe('__');
    });

    // === encode parity ===
    const encodeCases: Array<[string, string]> = [
        ['exa', 'web_search_exa'],
        ['github', 'search_repos'],
        ['my_server', 'my_tool'],
        ['s1', 't'],
        ['', ''],
        ['server', 'tool__with__double'],
        ['my-server', 'get_completions'],
        ['a', 'b'],
    ];

    for (const [serverId, toolName] of encodeCases) {
        it(`encode parity: serverId="${serverId}", toolName="${toolName}"`, () => {
            const be = backendEncode(serverId, toolName);
            const fe = frontendEncode(serverId, toolName);
            expect(fe).toBe(be);
        });
    }

    // === decode parity ===
    const decodeCases = [
        'mcp__exa__web_search_exa',
        'mcp__server__tool',
        'mcp__my_server__search',
        'mcp__server1__tool__with__double',
        'mcp__my_server__web_search_exa',
        'mcp____',
        'mcp__invalid',
        'mcp____something',
        '',
        'read_file',
        'execute_command',
        'mcp_server_tool',  // old format
    ];

    for (const name of decodeCases) {
        it(`decode parity: "${name}"`, () => {
            const be = backendDecode(name);
            const fe = frontendDecode(name);
            if (be === null) {
                expect(fe).toBeNull();
            } else {
                expect(fe).toEqual(be);
            }
        });
    }

    // === isMcpToolName parity ===
    const isMcpCases: Array<[string, boolean]> = [
        ['mcp__exa__web_search_exa', true],
        ['mcp__server__tool', true],
        ['read_file', false],
        ['execute_command', false],
        ['mcp_server_tool', false],
        ['', false],
        ['mcp__', true],
    ];

    for (const [name, expected] of isMcpCases) {
        it(`isMcpToolName parity: "${name}" → ${expected}`, () => {
            expect(frontendIsMcp(name)).toBe(expected);
            expect(backendIsMcp(name)).toBe(expected);
        });
    }
});
