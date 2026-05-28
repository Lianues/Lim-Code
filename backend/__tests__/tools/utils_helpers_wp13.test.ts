/**
 * WP13: 工具 helper 去重 - 单元测试
 *
 * 目的：锁定 gcd、calculateAspectRatio、ensureParentDir 的行为边界，
 * 确保去重后的共享实现与原有行为一致。
 *
 * 测试范围：
 * 1. gcd - 最大公约数计算
 * 2. calculateAspectRatio - 宽高比计算（含 0、负数、常见比例边界）
 * 3. ensureParentDir - 父目录创建
 */

import * as vscode from 'vscode';
import { gcd, calculateAspectRatio, ensureParentDir, escapeRegExp } from '../../tools/utils';

describe('gcd (最大公约数)', () => {
    it('gcd(16, 9) = 1', () => {
        expect(gcd(16, 9)).toBe(1);
    });

    it('gcd(1920, 1080) = 120', () => {
        expect(gcd(1920, 1080)).toBe(120);
    });

    it('gcd(0, 5) = 5', () => {
        // gcd(0, x) = x 是欧几里得算法的标准行为
        expect(gcd(0, 5)).toBe(5);
    });

    it('gcd(5, 0) = 5', () => {
        expect(gcd(5, 0)).toBe(5);
    });

    it('gcd(0, 0) = 0', () => {
        expect(gcd(0, 0)).toBe(0);
    });

    it('gcd(7, 7) = 7', () => {
        expect(gcd(7, 7)).toBe(7);
    });

    it('gcd 满足交换律', () => {
        expect(gcd(48, 18)).toBe(gcd(18, 48));
    });
});

describe('calculateAspectRatio (宽高比计算)', () => {
    // === 边界值测试 ===

    it('width <= 0 时返回 1:1', () => {
        // WP13 修改原因：read_file.ts 中的本地 calculateAspectRatio 缺少 width/height <= 0 的边界守卫，
        // 而 utils.ts 版本有此守卫。统一到 utils.ts 版本后所有调用点获得一致的边界行为。
        // 修改方式：测试锁定 0 和负数行为。
        // 修改目的：避免去重后因边界差异引入回归。
        expect(calculateAspectRatio(0, 100)).toBe('1:1');
        expect(calculateAspectRatio(-1, 100)).toBe('1:1');
    });

    it('height <= 0 时返回 1:1', () => {
        expect(calculateAspectRatio(100, 0)).toBe('1:1');
        expect(calculateAspectRatio(100, -1)).toBe('1:1');
    });

    it('width 和 height 都为 0 时返回 1:1', () => {
        expect(calculateAspectRatio(0, 0)).toBe('1:1');
    });

    // === 常见比例测试 ===

    it('16:9 (1920x1080)', () => {
        expect(calculateAspectRatio(1920, 1080)).toBe('16:9');
    });

    it('4:3 (1024x768)', () => {
        expect(calculateAspectRatio(1024, 768)).toBe('4:3');
    });

    it('1:1 (500x500)', () => {
        expect(calculateAspectRatio(500, 500)).toBe('1:1');
    });

    it('3:2 (1500x1000)', () => {
        expect(calculateAspectRatio(1500, 1000)).toBe('3:2');
    });

    // === 近似比例测试（ratio 数字太大触发近似路径） ===

    it('近似 16:9 (1600x901) 触发近似路径仍返回 16:9', () => {
        // gcd(1600, 901) = 1, ratioW=1600, ratioH=901, 都大于 100 触发近似路径
        // ratio = 1600/901 ≈ 1.776, 与 16/9 ≈ 1.778 差约 0.001 < 0.05
        expect(calculateAspectRatio(1600, 901)).toBe('16:9');
    });

    it('近似 4:3 (4001x3000) 触发近似路径仍返回 4:3', () => {
        // gcd(4001, 3000) = 1, ratioW=4001 > 100, 触发近似
        // ratio = 4001/3000 ≈ 1.3337, 与 4/3 ≈ 1.3333 差约 0.0003 < 0.05
        expect(calculateAspectRatio(4001, 3000)).toBe('4:3');
    });

    it('近似 1:1 (1001x1000) 触发近似路径', () => {
        expect(calculateAspectRatio(1001, 1000)).toBe('1:1');
    });

    it('非标准比例返回小数 (5001x1000)', () => {
        // gcd=1, ratioW=5001, 触发近似路径，不匹配常见比例，返回小数
        const result = calculateAspectRatio(5001, 1000);
        expect(result).toMatch(/^\d+\.\d{2}:1$/);
    });

    it('近似 21:9 (2100x901) 触发近似路径仍返回 21:9', () => {
        // WP13 修改原因：互验报告指出 calculateAspectRatio 统一到 utils.ts 后
        // 新增了 21:9 和 9:21 近似比例识别（原 read_file.ts 版本没有）。
        // 需补充测试锁定此行为变化。
        // gcd(2100, 901) = 1, ratioW=2100 > 100, 触发近似路径
        // ratio = 2100/901 ≈ 2.3307, 与 21/9 ≈ 2.3333 差约 0.0026 < 0.05
        expect(calculateAspectRatio(2100, 901)).toBe('21:9');
    });

    it('近似 9:21 (901x2100) 触发近似路径仍返回 9:21', () => {
        // WP13 修改原因：9:21 是竖屏比例，互验报告要求补测。
        // gcd(901, 2100) = 1, ratioH=2100 > 100, 触发近似路径
        // ratio = 901/2100 ≈ 0.4290, 与 9/21 ≈ 0.4286 差约 0.0004 < 0.05
        expect(calculateAspectRatio(901, 2100)).toBe('9:21');
    });

    // === 小比例（不触发近似路径） ===

    it('6:4 (600x400) 简化后为 3:2', () => {
        // gcd(600, 400) = 200, ratioW=3, ratioH=2, 都不大于 100
        expect(calculateAspectRatio(600, 400)).toBe('3:2');
    });

    it('8:5 (800x500) 简化后为 8:5', () => {
        expect(calculateAspectRatio(800, 500)).toBe('8:5');
    });
});

describe('escapeRegExp (正则转义)', () => {
    // WP13 修改原因：escapeRegExp 原在 jsonFormatter.ts、plan/todoListSection.ts、
    // review/reviewDocumentSection.ts 各有一份完全相同的实现。
    // 收敛到 utils.ts 后需补充测试锁定行为不变。

    it('转义点号 .', () => {
        expect(escapeRegExp('.')).toBe('\\.');
    });

    it('转义星号 *', () => {
        expect(escapeRegExp('*')).toBe('\\*');
    });

    it('转义加号 +', () => {
        expect(escapeRegExp('+')).toBe('\\+');
    });

    it('转义问号 ?', () => {
        expect(escapeRegExp('?')).toBe('\\?');
    });

    it('转义脱字符 ^', () => {
        expect(escapeRegExp('^')).toBe('\\^');
    });

    it('转义美元符 $', () => {
        expect(escapeRegExp('$')).toBe('\\$');
    });

    it('转义花括号 {}', () => {
        expect(escapeRegExp('{')).toBe('\\{');
        expect(escapeRegExp('}')).toBe('\\}');
    });

    it('转义圆括号 ()', () => {
        expect(escapeRegExp('(')).toBe('\\(');
        expect(escapeRegExp(')')).toBe('\\)');
    });

    it('转义方括号 []', () => {
        expect(escapeRegExp('[')).toBe('\\[');
        expect(escapeRegExp(']')).toBe('\\]');
    });

    it('转义管道符 |', () => {
        expect(escapeRegExp('|')).toBe('\\|');
    });

    it('转义反斜杠 \\', () => {
        expect(escapeRegExp('\\')).toBe('\\\\');
    });

    it('组合特殊字符全部转义', () => {
        const input = '<<<TOOL_CALL>>>';
        const escaped = escapeRegExp(input);
        // 所有 < 和 > 不是正则特殊字符，不需要转义，但输入中无正则特殊字符
        expect(escaped).toBe('<<<TOOL_CALL>>>');
    });

    it('TOOL_CALL_START / TOOL_CALL_END 标记中特殊字符正确转义', () => {
        // 这些标记用于 jsonFormatter 中构建正则，
        // 必须验证 escapeRegExp 对它们的行为与原来完全一致。
        // <<< 和 >>> 不含正则特殊字符，应原样返回
        expect(escapeRegExp('<<<TOOL_CALL>>>')).toBe('<<<TOOL_CALL>>>');
        expect(escapeRegExp('<<<END_TOOL_CALL>>>')).toBe('<<<END_TOOL_CALL>>>');
    });

    it('普通字符串不变', () => {
        expect(escapeRegExp('hello world')).toBe('hello world');
    });
});

describe('ensureParentDir (确保父目录存在)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('使用 path.dirname 提取父目录并调用 vscode.workspace.fs.createDirectory', async () => {
        // WP13 修改原因：ensureParentDir 在四份文件中各有一份相同实现，统一到 utils.ts 后需要测试验证。
        // 修改方式：mock vscode.workspace.fs.createDirectory，断言被调用时的参数。
        // 修改目的：确保去重后的共享实现行为与原有实现一致。
        const createDirectoryMock = vscode.workspace.fs.createDirectory as jest.Mock;

        await ensureParentDir('C:/repo/.limcode/design/test.md');

        expect(createDirectoryMock).toHaveBeenCalledTimes(1);
        // path.dirname('C:/repo/.limcode/design/test.md') = 'C:/repo/.limcode/design'
        const calledUri = createDirectoryMock.mock.calls[0][0];
        expect(calledUri.fsPath || calledUri.path).toContain('.limcode/design');
    });
});
