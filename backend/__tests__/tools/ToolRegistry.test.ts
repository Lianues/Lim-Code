/**
 * WP11：ToolRegistry alias index 测试。
 *
 * 修改原因：WP11 为 ToolRegistry 建立 aliasToName Map 索引，将 getTool() 的 alias 查找从 O(n) 降为 O(1)。
 * 本测试文件覆盖：alias 注册/查找、alias 冲突、unregister 清理、clear 清理、refreshTool 同步、公共 API 不变。
 * 修改目的：确保 alias index 在所有生命周期操作下保持正确，公共 API 行为不变。
 */

import { ToolRegistry } from '../../tools/ToolRegistry';
import type { Tool, ToolRegistration } from '../../tools/types';

// ---- helpers ----

function makeTool(name: string, aliases?: string[]): Tool {
    return {
        declaration: {
            name,
            description: `Tool ${name}`,
            parameters: { type: 'object', properties: {} },
            aliases,
        },
        handler: async () => ({ success: true }),
    };
}

function makeReg(name: string, aliases?: string[]): ToolRegistration {
    return () => makeTool(name, aliases);
}

// 工厂函数：动态生成 aliases（用于 refreshTool 和相关测试）
function makeDynamicReg(name: string, getAliases: () => string[]): ToolRegistration {
    return () => ({
        declaration: {
            name,
            description: 'dynamic tool',
            parameters: { type: 'object', properties: {} },
            aliases: getAliases(),
        },
        handler: async () => ({ success: true }),
    });
}

// ---- tests ----

describe('ToolRegistry', () => {
    // ========================================================================
    // 基础 API — 行为不应改变
    // ========================================================================
    describe('basic API (unchanged behavior)', () => {
        let registry: ToolRegistry;

        beforeEach(() => {
            registry = new ToolRegistry();
        });

        it('register + getTool + count + has + getToolNames', () => {
            registry.register(makeReg('tool_a'));
            expect(registry.count()).toBe(1);
            expect(registry.has('tool_a')).toBe(true);
            expect(registry.has('tool_b')).toBe(false);
            expect(registry.getToolNames()).toEqual(['tool_a']);

            const t = registry.getTool('tool_a');
            expect(t).toBeDefined();
            expect(t!.declaration.name).toBe('tool_a');
        });

        it('getTool returns undefined for unknown tool', () => {
            expect(registry.getTool('nonexistent')).toBeUndefined();
        });

        it('registerBatch', () => {
            registry.registerBatch([makeReg('a'), makeReg('b'), makeReg('c')]);
            expect(registry.count()).toBe(3);
            expect(registry.getTool('a')).toBeDefined();
            expect(registry.getTool('b')).toBeDefined();
            expect(registry.getTool('c')).toBeDefined();
        });

        it('duplicate registration throws', () => {
            registry.register(makeReg('dup'));
            expect(() => registry.register(makeReg('dup'))).toThrow();
        });

        it('getAllTools returns all tools', () => {
            registry.registerBatch([makeReg('a'), makeReg('b')]);
            const tools = registry.getAllTools();
            expect(tools.length).toBe(2);
        });
    });

    // ========================================================================
    // alias 注册与查找 — WP11 核心
    // ========================================================================
    describe('alias registration and lookup', () => {
        let registry: ToolRegistry;

        beforeEach(() => {
            registry = new ToolRegistry();
        });

        it('getTool resolves by alias (O(1) via index)', () => {
            registry.register(makeReg('read_file', ['read', 'cat_file']));
            const byAlias1 = registry.getTool('read');
            const byAlias2 = registry.getTool('cat_file');
            expect(byAlias1).toBeDefined();
            expect(byAlias1!.declaration.name).toBe('read_file');
            expect(byAlias2).toBeDefined();
            expect(byAlias2!.declaration.name).toBe('read_file');
            // 同一个实例
            expect(byAlias1).toBe(byAlias2);
        });

        it('getTool prefers main name over alias', () => {
            // WP11 修复 2：双向冲突禁止主名称等于已有 alias。
            // 如果 tool_a alias 到 'tool_b'，则不能再注册主名称为 'tool_b' 的工具。
            // 这里测试正常路径：两个不相冲突的别名系统
            registry.register(makeReg('tool_a', ['alias_for_a']));
            registry.register(makeReg('tool_b', ['alias_for_b']));

            const a = registry.getTool('alias_for_a');
            const b = registry.getTool('alias_for_b');
            expect(a!.declaration.name).toBe('tool_a');
            expect(b!.declaration.name).toBe('tool_b');
            expect(a).not.toBe(b);
        });

        it('alias lookup works after unregister and re-register of different tool', () => {
            registry.register(makeReg('tool_a', ['old_alias']));
            expect(registry.getTool('old_alias')!.declaration.name).toBe('tool_a');

            registry.unregister('tool_a');
            expect(registry.getTool('old_alias')).toBeUndefined();

            // 重新注册另一个工具使用原别名
            registry.register(makeReg('tool_b', ['old_alias']));
            expect(registry.getTool('old_alias')!.declaration.name).toBe('tool_b');
        });

        it('tool without aliases works normally', () => {
            registry.register(makeReg('simple'));
            expect(registry.getTool('simple')!.declaration.name).toBe('simple');
            expect(registry.getTool('any_alias')).toBeUndefined();
        });

        it('aliases is undefined on declaration', () => {
            const tool: Tool = {
                declaration: {
                    name: 'no_alias_tool',
                    description: '',
                    parameters: { type: 'object', properties: {} },
                    // aliases intentionally omitted
                },
                handler: async () => ({ success: true }),
            };
            registry.register(() => tool);
            expect(registry.getTool('no_alias_tool')!.declaration.name).toBe('no_alias_tool');
        });

        it('aliases is empty array on declaration', () => {
            const tool: Tool = {
                declaration: {
                    name: 'empty_alias_tool',
                    description: '',
                    parameters: { type: 'object', properties: {} },
                    aliases: [],
                },
                handler: async () => ({ success: true }),
            };
            registry.register(() => tool);
            expect(registry.getTool('empty_alias_tool')!.declaration.name).toBe('empty_alias_tool');
        });
    });

    // ========================================================================
    // alias 冲突检测 — WP11 新增 + WP11 修复轮次补充
    // ========================================================================
    describe('alias conflict detection', () => {
        let registry: ToolRegistry;

        beforeEach(() => {
            registry = new ToolRegistry();
        });

        it('alias conflicts with existing tool name → throw', () => {
            registry.register(makeReg('tool_a'));
            expect(() => registry.register(makeReg('tool_b', ['tool_a']))).toThrow(
                /alias.*"tool_a".*conflicts/
            );
        });

        it('alias conflicts with another tool alias → throw', () => {
            registry.register(makeReg('tool_a', ['shared_alias']));
            expect(() => registry.register(makeReg('tool_b', ['shared_alias']))).toThrow(
                /alias.*"shared_alias".*already registered by "tool_a"/
            );
        });

        it('same alias used in same tool\'s own aliases list → same alias is fine (one tool)', () => {
            // 同一个工具的两个别名相同 — 由工具定义者负责，工具注册器不应特殊处理重复别名
            // 实际上这不会导致冲突，因为同一个工具注册时 aliases 数组里如果有重复只是浪费索引 entry
            registry.register(makeReg('tool_a', ['a1', 'a1']));
            expect(registry.getTool('a1')!.declaration.name).toBe('tool_a');
        });

        // === WP11 修复 2：双向冲突 — 注册主名称时不能与已有别名冲突 ===
        it('registering a tool whose name is already another tool\'s alias → throw', () => {
            // 先注册 tool_a，其别名包含 'b'
            registry.register(makeReg('tool_a', ['b']));
            // 再尝试注册主名称为 'b' 的 tool_b → 应抛错，因为 'b' 已是 tool_a 的别名
            expect(() => registry.register(makeReg('b'))).toThrow(
                /already registered as an alias/
            );
        });

        // === WP11 修复 1：refreshTool 新 alias 冲突检测 ===
        it('refreshTool throws when new alias conflicts with another tool name', () => {
            registry.register(makeReg('tool_a'));
            let aliases: string[] = ['ok_alias'];
            const reg = makeDynamicReg('dynamic_tool', () => aliases);
            registry.register(reg);

            // 改变 aliases 使其与 tool_a 主名称冲突
            aliases = ['tool_a'];
            expect(() => registry.refreshTool('dynamic_tool')).toThrow(
                /alias.*"tool_a".*conflicts/
            );
        });

        it('refreshTool throws when new alias conflicts with another tool\'s alias', () => {
            registry.register(makeReg('tool_a', ['shared']));
            let aliases: string[] = ['ok_alias'];
            const reg = makeDynamicReg('dynamic_tool', () => aliases);
            registry.register(reg);

            // 改变 aliases 使其与 tool_a 的别名 'shared' 冲突
            aliases = ['shared'];
            expect(() => registry.refreshTool('dynamic_tool')).toThrow(
                /alias.*"shared".*already registered by "tool_a"/
            );
        });
    });

    // ========================================================================
    // unregister 清理 alias 索引
    // ========================================================================
    describe('unregister cleans alias index', () => {
        let registry: ToolRegistry;

        beforeEach(() => {
            registry = new ToolRegistry();
        });

        it('unregister removes aliases from index', () => {
            registry.register(makeReg('tool_a', ['a_alias', 'aa']));
            expect(registry.getTool('a_alias')).toBeDefined();
            expect(registry.getTool('aa')).toBeDefined();

            const result = registry.unregister('tool_a');
            expect(result).toBe(true);

            expect(registry.getTool('tool_a')).toBeUndefined();
            expect(registry.getTool('a_alias')).toBeUndefined();
            expect(registry.getTool('aa')).toBeUndefined();
        });

        it('unregister nonexistent tool returns false', () => {
            expect(registry.unregister('nope')).toBe(false);
        });

        it('unregister tool without aliases does not throw', () => {
            registry.register(makeReg('plain'));
            expect(() => registry.unregister('plain')).not.toThrow();
            expect(registry.getTool('plain')).toBeUndefined();
        });

        it('after unregister, old alias can be reused', () => {
            registry.register(makeReg('tool_a', ['my_alias']));
            registry.unregister('tool_a');
            // 别名已释放，应可重新注册
            expect(() => registry.register(makeReg('tool_b', ['my_alias']))).not.toThrow();
            expect(registry.getTool('my_alias')!.declaration.name).toBe('tool_b');
        });
    });

    // ========================================================================
    // clear 清理 alias 索引
    // ========================================================================
    describe('clear cleans alias index', () => {
        it('clear removes all tools and aliases', () => {
            const registry = new ToolRegistry();
            registry.register(makeReg('a', ['alias_a']));
            registry.register(makeReg('b', ['alias_b']));
            expect(registry.count()).toBe(2);
            expect(registry.getTool('alias_a')).toBeDefined();

            registry.clear();
            expect(registry.count()).toBe(0);
            expect(registry.getTool('a')).toBeUndefined();
            expect(registry.getTool('alias_a')).toBeUndefined();
            expect(registry.getTool('b')).toBeUndefined();
            expect(registry.getTool('alias_b')).toBeUndefined();
        });

        it('after clear, old aliases can be reused without conflict', () => {
            const registry = new ToolRegistry();
            registry.register(makeReg('x', ['old_alias']));
            registry.clear();
            expect(() => registry.register(makeReg('y', ['old_alias']))).not.toThrow();
        });
    });

    // ========================================================================
    // refreshTool 同步 alias 索引
    // ========================================================================
    describe('refreshTool syncs alias index', () => {
        let registry: ToolRegistry;

        beforeEach(() => {
            registry = new ToolRegistry();
        });

        // makeDynamicReg 已提升至顶层 helpers（WP11 修复：供 alias conflict detection 和 refreshTool 共用）

        it('refreshTool updates aliases when factory returns different aliases', () => {
            let aliases: string[] = ['v1_alias'];
            const reg = makeDynamicReg('dynamic_tool', () => aliases);
            registry.register(reg);

            expect(registry.getTool('v1_alias')!.declaration.name).toBe('dynamic_tool');

            // 改变工厂返回的 aliases
            aliases = ['v2_alias', 'another_v2'];
            const ok = registry.refreshTool('dynamic_tool');
            expect(ok).toBe(true);

            // 旧别名应失效
            expect(registry.getTool('v1_alias')).toBeUndefined();
            // 新别名应生效
            expect(registry.getTool('v2_alias')!.declaration.name).toBe('dynamic_tool');
            expect(registry.getTool('another_v2')!.declaration.name).toBe('dynamic_tool');
        });

        it('refreshTool on tool without aliases (before and after)', () => {
            let aliases: string[] | undefined = undefined;
            const reg: ToolRegistration = () => ({
                declaration: {
                    name: 'no_alias',
                    description: '',
                    parameters: { type: 'object', properties: {} },
                    aliases,
                },
                handler: async () => ({ success: true }),
            });

            registry.register(reg);
            const ok = registry.refreshTool('no_alias');
            expect(ok).toBe(true);
            expect(registry.getTool('no_alias')).toBeDefined();
        });

        it('refreshTool nonexistent tool returns false', () => {
            expect(registry.refreshTool('no_such_tool')).toBe(false);
        });

        it('refreshTool removes all old aliases before adding new ones', () => {
            let aliases: string[] = ['old1', 'old2'];
            const reg = makeDynamicReg('dyn', () => aliases);
            registry.register(reg);

            expect(registry.getTool('old1')).toBeDefined();
            expect(registry.getTool('old2')).toBeDefined();

            aliases = [];
            registry.refreshTool('dyn');

            expect(registry.getTool('old1')).toBeUndefined();
            expect(registry.getTool('old2')).toBeUndefined();
            expect(registry.getTool('dyn')).toBeDefined();
        });
    });

    // ========================================================================
    // 综合性：alias + 所有公共 API 一致性
    // ========================================================================
    describe('integration: alias consistency across lifecycle', () => {
        it('register → getTool(by alias) → refreshTool → getTool → unregister → getTool', () => {
            const registry = new ToolRegistry();

            // Step 1: register
            registry.register(makeReg('core_tool', ['core']));
            expect(registry.getTool('core')!.declaration.name).toBe('core_tool');

            // Step 2: refreshTool (same aliases)
            // 工厂函数不变
            const reg = makeReg('core_tool', ['core']);
            registry.register(makeReg('placeholder')); // 先清掉
            registry.clear();

            registry.register(reg);
            registry.refreshTool('core_tool');
            expect(registry.getTool('core')!.declaration.name).toBe('core_tool');

            // Step 3: unregister
            registry.unregister('core_tool');
            expect(registry.getTool('core')).toBeUndefined();
            expect(registry.getTool('core_tool')).toBeUndefined();
        });

        it('has() only checks main names, not aliases', () => {
            // has() 行为不应改变：它只检查主名称，不管别名
            const registry = new ToolRegistry();
            registry.register(makeReg('main', ['alias_main']));
            expect(registry.has('main')).toBe(true);
            // has 不按别名检查（这是原有行为）
            expect(registry.has('alias_main')).toBe(false);
        });

        it('getAllTools / getAllDeclarations unchanged', () => {
            const registry = new ToolRegistry();
            registry.register(makeReg('a', ['a_alias']));
            registry.register(makeReg('b'));

            const tools = registry.getAllTools();
            expect(tools.length).toBe(2);
            expect(tools.map(t => t.declaration.name).sort()).toEqual(['a', 'b']);

            const decls = registry.getAllDeclarations();
            expect(decls.length).toBe(2);
        });
    });
});
