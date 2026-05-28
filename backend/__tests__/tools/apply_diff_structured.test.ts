import {
    applyStructuredDiffHunksBestEffort,
    type StructuredDiffHunk
} from '../../tools/file/apply_diff';
import { applyUnifiedDiffBestEffort, parseUnifiedDiff } from '../../tools/file/unifiedDiff';

/**
 * apply_diff 结构化 hunk 回归测试。
 *
 * 为什么要新增：旧 patch 字符串会让模型把 JSON 字符串转义和 unified diff 文本语义混在一起，导致双引号、反斜杠被错误写入文件。
 * 怎么改：直接测试 oldContent/newContent 结构化路径，确认 newContent 是最终文件内容；同时保留旧 patch 兼容测试，避免迁移破坏历史调用。
 * 目的：把“内容唯一时忽略 startLine，重复时才用 startLine，并维护多 hunk 行号偏移”的约定锁成可执行规范。
 */
describe('apply_diff structured hunks', () => {
    function apply(original: string, hunks: StructuredDiffHunk[]) {
        return applyStructuredDiffHunksBestEffort(original, hunks);
    }

    it('把 newContent 当作最终内容写入，双引号不需要 diff 层转义', () => {
        const result = apply('content: old;\n', [
            {
                oldContent: 'content: old;',
                newContent: 'content: "";'
            }
        ]);

        expect(result.appliedCount).toBe(1);
        expect(result.failedCount).toBe(0);
        expect(result.newContent).toBe('content: "";\n');
    });

    it('把反斜杠作为普通最终内容保留，不做第二次 JSON 反转义', () => {
        const result = apply('path = old\n', [
            {
                oldContent: 'path = old',
                newContent: 'path = C:\\Users\\Moeblack'
            }
        ]);

        expect(result.appliedCount).toBe(1);
        expect(result.newContent).toBe('path = C:\\Users\\Moeblack\n');
    });

    it('oldContent 唯一匹配时忽略错误的 startLine，避免陈旧行号导致失败', () => {
        const result = apply('line1\nunique target\nline3\n', [
            {
                oldContent: 'unique target',
                newContent: 'changed',
                startLine: 999
            }
        ]);

        expect(result.appliedCount).toBe(1);
        expect(result.results[0]).toMatchObject({ success: true, startLine: 2 });
        expect(result.newContent).toBe('line1\nchanged\nline3\n');
    });

    it('oldContent 重复出现时才使用 startLine，并按前序 hunk 的行号变化调整定位', () => {
        const result = apply('one\nsame\ntwo\nsame\n', [
            {
                oldContent: 'one',
                newContent: 'one\ninserted',
                startLine: 1
            },
            {
                oldContent: 'same',
                newContent: 'target',
                startLine: 4
            }
        ]);

        expect(result.appliedCount).toBe(2);
        expect(result.failedCount).toBe(0);
        expect(result.results[1]).toMatchObject({ success: true, startLine: 5 });
        expect(result.newContent).toBe('one\ninserted\nsame\ntwo\ntarget\n');
    });

    it('前序 hunk 删除整行到空字符串时按 LF 数量维护 lineDelta', () => {
        // 修改原因：lineDelta 如果用展示行数差计算，会把 `first\n` 删除为空误算成 -2，导致后续重复 oldContent 选错候选。
        // 修改方式：先删除第一整行，再用原始 startLine 定位第二个 same，验证后续定位只向上偏移一行。
        // 修改目的：锁住 lineDelta 必须基于 LF 数量差这一规则，避免删除场景回归。
        const result = apply('first\nsame\nsame\n', [
            {
                oldContent: 'first\n',
                newContent: ''
            },
            {
                oldContent: 'same',
                newContent: 'target',
                startLine: 3
            }
        ]);

        expect(result.appliedCount).toBe(2);
        expect(result.failedCount).toBe(0);
        expect(result.results[1]).toMatchObject({ success: true, startLine: 2 });
        expect(result.newContent).toBe('same\ntarget\n');
    });


    it('oldContent 重复且没有 startLine 时拒绝应用并返回候选行', () => {
        const result = apply('same\nother\nsame\n', [
            {
                oldContent: 'same',
                newContent: 'target'
            }
        ]);

        expect(result.appliedCount).toBe(0);
        expect(result.failedCount).toBe(1);
        expect(result.results[0]).toMatchObject({
            success: false,
            matchCount: 2,
            candidateLines: [1, 3]
        });
        expect(result.newContent).toBe('same\nother\nsame\n');
    });

    /**
     * 为什么要覆盖缩进 fallback：AI 常把 oldContent 的整体缩进少写或多写，旧逻辑会因为 indexOf 精确匹配失败而拒绝整块。
     * 怎么改：用结构化 hunk 的公开函数直接验证 exact 优先、缩进容错、候选歧义和换行边界。
     * 目的：把“只容忍行首缩进差异，不容忍主体内容差异”的安全边界固化成回归测试。
     */
    it('exact 匹配成功时不启用缩进重映射，保持 newContent 原样写入', () => {
        const result = apply('    value\n', [
            {
                oldContent: '    value',
                newContent: 'changed'
            }
        ]);

        expect(result.appliedCount).toBe(1);
        expect(result.results[0]).toMatchObject({ success: true, matchKind: 'exact', startLine: 1 });
        expect(result.newContent).toBe('changed\n');
    });

    it('oldContent 只错行首缩进时启用 fallback，并把 newContent 重映射到真实缩进', () => {
        const original = [
            'export const messages = {',
            '    en: {',
            "        title: 'Old',",
            '    },',
            '};',
            ''
        ].join('\n');

        const result = apply(original, [
            {
                oldContent: [
                    'en: {',
                    "    title: 'Old',",
                    '},'
                ].join('\n'),
                newContent: [
                    'en: {',
                    "    title: 'New',",
                    "    desc: 'Added',",
                    '},'
                ].join('\n')
            }
        ]);

        expect(result.appliedCount).toBe(1);
        expect(result.results[0]).toMatchObject({ success: true, matchKind: 'indent_fallback', startLine: 2 });
        expect(result.newContent).toBe([
            'export const messages = {',
            '    en: {',
            "        title: 'New',",
            "        desc: 'Added',",
            '    },',
            '};',
            ''
        ].join('\n'));
    });

    it('缩进 fallback 不忽略行内空白差异', () => {
        const result = apply("    const label = 'a b';\n", [
            {
                oldContent: "const label = 'ab';",
                newContent: "const label = 'changed';"
            }
        ]);

        expect(result.appliedCount).toBe(0);
        expect(result.results[0]).toMatchObject({ success: false, matchCount: 0 });
        expect(result.newContent).toBe("    const label = 'a b';\n");
    });

    it('缩进 fallback 多候选且没有 startLine 时拒绝应用并返回候选行', () => {
        // 修改原因：少写缩进的单行 oldContent 可能被原有 indexOf 子串 exact 命中，无法验证 fallback 歧义保护。
        // 修改方式：让模型 oldContent 多写缩进，使 exact 为 0，同时去掉行首缩进后仍有两个候选。
        // 修改目的：确保无 startLine 的 fallback 多候选场景不会被自动猜测应用。
        const result = apply('  item\nother\n    item\n', [
            {
                oldContent: '      item',
                newContent: '      done'
            }
        ]);

        expect(result.appliedCount).toBe(0);
        expect(result.results[0]).toMatchObject({
            success: false,
            matchCount: 2,
            candidateLines: [1, 3]
        });
        expect(result.results[0].error).toContain('Indentation fallback found multiple candidates');
    });

    it('缩进 fallback 多候选时使用 startLine 选择调整后的候选', () => {
        // 修改原因：单行 oldContent 如果只是少写缩进，原有 indexOf 仍可能作为子串 exact 命中，无法验证 fallback 分支。
        // 修改方式：让模型 oldContent 多写缩进，使 exact 为 0，但去掉行首缩进后的主体仍能匹配两个候选。
        // 修改目的：确保本用例真正覆盖“fallback 多候选 + startLine 定位”的安全边界。
        const result = apply('  item\nother\n    item\n', [
            {
                oldContent: '      item',
                newContent: '      done',
                startLine: 3
            }
        ]);

        expect(result.appliedCount).toBe(1);
        expect(result.results[0]).toMatchObject({ success: true, matchKind: 'indent_fallback', startLine: 3 });
        expect(result.newContent).toBe('  item\nother\n    done\n');
    });

    it('缩进 fallback 在 oldContent 不带末尾换行时不吞掉下一行换行', () => {
        const result = apply('  first\n  second\n  third\n', [
            {
                oldContent: 'first\nsecond',
                newContent: 'first\nchanged'
            }
        ]);

        expect(result.appliedCount).toBe(1);
        expect(result.results[0]).toMatchObject({ success: true, matchKind: 'indent_fallback', startLine: 1 });
        expect(result.newContent).toBe('  first\n  changed\n  third\n');
    });

    it('纯空白 oldContent 不允许通过缩进 fallback 命中', () => {
        // 修改原因：纯空白块如果 exact 已经命中，测试不到 fallback 的禁用保护。
        // 修改方式：文件使用 tab 空白而 oldContent 使用 space 空白，使 exact 失败后进入 fallback 禁用分支。
        // 修改目的：确认“只剩缩进/空白的信息量为零”时不会被缩进容错自动应用。
        const result = apply('\t\t\nnext\n', [
            {
                oldContent: '    \n',
                newContent: 'changed\n'
            }
        ]);

        expect(result.appliedCount).toBe(0);
        expect(result.results[0]).toMatchObject({ success: false, matchCount: 0 });
        expect(result.newContent).toBe('\t\t\nnext\n');
    });


    it('保留旧 patch 字符串兼容路径', () => {
        const parsed = parseUnifiedDiff('@@ -1,1 +1,1 @@\n-content: old;\n+content: "";\n');
        const result = applyUnifiedDiffBestEffort('content: old;\n', parsed);

        expect(result.results[0]).toMatchObject({ ok: true, startLine: 1 });
        expect(result.newContent).toBe('content: "";\n');
    });
});
