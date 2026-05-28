/**
 * WP12: MCP 工具名编解码器测试
 *
 * 覆盖：
 * - encodeMcpToolName：正常编码、含下划线的 serverId/toolName
 * - decodeMcpToolName：正常解码、边界情况、serverId/toolName 含下划线或双下划线
 * - isMcpToolName：正例和反例
 * - 向后兼容：mcp_ 单下划线格式仍可被 parseMcpToolName（旧 API）解析
 */

import {
    encodeMcpToolName,
    decodeMcpToolName,
    isMcpToolName,
    MCP_TOOL_PREFIX,
    MCP_TOOL_SEPARATOR
} from '../../modules/mcp/mcpToolNameCodec';
import { parseMcpToolName } from '../../modules/mcp/toolAdapter';

describe('mcpToolNameCodec - encodeMcpToolName', () => {
    it('encodes a simple serverId and toolName', () => {
        const result = encodeMcpToolName('exa', 'web_search_exa');
        expect(result).toBe('mcp__exa__web_search_exa');
    });

    it('encodes serverId with underscores', () => {
        // serverId 理论上不应含 __（由 validateServerId 保证），但编码器应原样处理
        const result = encodeMcpToolName('my_server', 'search');
        expect(result).toBe('mcp__my_server__search');
    });

    it('encodes toolName with underscores', () => {
        const result = encodeMcpToolName('exa', 'web_search_exa');
        expect(result).toBe('mcp__exa__web_search_exa');
    });

    it('encodes empty strings without throwing', () => {
        const result = encodeMcpToolName('', '');
        expect(result).toBe('mcp____');
    });
});

describe('mcpToolNameCodec - decodeMcpToolName', () => {
    it('decodes a normal MCP tool name', () => {
        const result = decodeMcpToolName('mcp__exa__web_search_exa');
        expect(result).toEqual({ serverId: 'exa', toolName: 'web_search_exa' });
    });

    it('decodes when serverId contains underscores', () => {
        const result = decodeMcpToolName('mcp__my_server__search');
        expect(result).toEqual({ serverId: 'my_server', toolName: 'search' });
    });

    it('decodes when toolName contains underscores', () => {
        const result = decodeMcpToolName('mcp__exa__web_search_exa');
        expect(result).toEqual({ serverId: 'exa', toolName: 'web_search_exa' });
    });

    it('decodes when toolName contains double underscores (extreme case)', () => {
        // toolName 本身包含 __ 时，只有第一个 __ 是分隔符，剩余部分完整保留为 toolName
        const result = decodeMcpToolName('mcp__server1__tool__with__double');
        expect(result).toEqual({ serverId: 'server1', toolName: 'tool__with__double' });
    });

    it('decodes when both serverId and toolName contain underscores', () => {
        const result = decodeMcpToolName('mcp__my_server__web_search_exa');
        expect(result).toEqual({ serverId: 'my_server', toolName: 'web_search_exa' });
    });

    it('returns null for non-MCP tool names', () => {
        expect(decodeMcpToolName('read_file')).toBeNull();
        expect(decodeMcpToolName('execute_command')).toBeNull();
    });

    it('returns null for mcp prefix with no separator', () => {
        expect(decodeMcpToolName('mcp__invalid')).toBeNull();
    });

    it('returns null for empty serverId', () => {
        // mcp____something: serverId='' (empty), so decode returns null
        expect(decodeMcpToolName('mcp____something')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(decodeMcpToolName('')).toBeNull();
    });
});

describe('mcpToolNameCodec - isMcpToolName', () => {
    it('returns true for MCP tool names', () => {
        expect(isMcpToolName('mcp__exa__web_search_exa')).toBe(true);
        expect(isMcpToolName('mcp__server__tool')).toBe(true);
    });

    it('returns false for builtin tool names', () => {
        expect(isMcpToolName('read_file')).toBe(false);
        expect(isMcpToolName('execute_command')).toBe(false);
    });

    it('returns false for old mcp_ single-underscore format', () => {
        // 旧的 mcp_ 格式不被 isMcpToolName 识别为有效 MCP 工具名
        // 但 parseMcpToolName（向后兼容）会处理它
        expect(isMcpToolName('mcp_server_tool')).toBe(false);
    });
});

describe('mcpToolNameCodec - backward compat via parseMcpToolName', () => {
    it('parseMcpToolName decodes mcp__ format via decodeMcpToolName', () => {
        const result = parseMcpToolName('mcp__exa__web_search_exa');
        expect(result).toEqual(['exa', 'web_search_exa']);
    });

    it('parseMcpToolName still decodes old mcp_ format', () => {
        const result = parseMcpToolName('mcp_server_tool');
        expect(result).toEqual(['server', 'tool']);
    });

    it('parseMcpToolName decodes old mcp_ format with multi-part toolName', () => {
        const result = parseMcpToolName('mcp_server_search_exa');
        expect(result).toEqual(['server', 'search_exa']);
    });

    it('parseMcpToolName returns null for builtin', () => {
        expect(parseMcpToolName('read_file')).toBeNull();
    });
});

describe('mcpToolNameCodec - roundtrip', () => {
    it('encode then decode returns original components', () => {
        const testCases = [
            { serverId: 'exa', toolName: 'web_search_exa' },
            { serverId: 'github', toolName: 'search_repos' },
            { serverId: 'my_server', toolName: 'my_tool' },
            { serverId: 's1', toolName: 't' },
        ];

        for (const { serverId, toolName } of testCases) {
            const encoded = encodeMcpToolName(serverId, toolName);
            const decoded = decodeMcpToolName(encoded);
            expect(decoded).toEqual({ serverId, toolName });
        }
    });

    it('roundtrip preserves serverId/toolName with double underscores in toolName', () => {
        const serverId = 'server1';
        const toolName = 'tool__with__double';
        const encoded = encodeMcpToolName(serverId, toolName);
        const decoded = decodeMcpToolName(encoded);
        expect(decoded).toEqual({ serverId, toolName });
    });

    it('roundtrip returns null for empty serverId (invalid)', () => {
        // WP12: empty serverId is invalid; encode produces mcp____tool, decode rejects it
        const encoded = encodeMcpToolName('', 'tool');
        expect(encoded).toBe('mcp____tool');
        const decoded = decodeMcpToolName(encoded);
        expect(decoded).toBeNull();
    });

    // === WP12 修复 4：serverId 含 __ 时 roundtrip 确定性行为 ===
    it('roundtrip with serverId containing __ is rejected by validateServerId', () => {
        // serverId 含 __ 会被 validateServerId 拒绝（WP12 修复 1），
        // 但 codec 本身不做校验——它按 indexOf 解析，serverId 含 __ 会导致
        // serverId 被截断（只取到第一个 __ 之前），这是预期行为：
        // 因为 serverId 由业务层保证不含 __。
        const encoded = encodeMcpToolName('foo__bar', 'tool');
        // 编码仍能生成
        expect(encoded).toBe('mcp__foo__bar__tool');
        // 解码会截断 serverId：第一个 __ 被当作分隔符
        const decoded = decodeMcpToolName(encoded);
        expect(decoded).toEqual({ serverId: 'foo', toolName: 'bar__tool' });
        // 这说明：若 serverId 含 __，roundtrip 不保持。
        // 因此 validateServerId 必须禁止 serverId 含 __（WP12 修复 1）。
    });

    // === WP12 修复 4：serverId 含中划线正常 roundtrip ===
    it('roundtrip with serverId containing hyphens', () => {
        const testCases = [
            { serverId: 'my-server', toolName: 'search' },
            { serverId: 'github-copilot', toolName: 'get_completions' },
        ];
        for (const { serverId, toolName } of testCases) {
            const encoded = encodeMcpToolName(serverId, toolName);
            const decoded = decodeMcpToolName(encoded);
            expect(decoded).toEqual({ serverId, toolName });
        }
    });
});
