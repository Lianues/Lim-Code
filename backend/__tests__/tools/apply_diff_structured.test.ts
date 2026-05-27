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

    it('保留旧 patch 字符串兼容路径', () => {
        const parsed = parseUnifiedDiff('@@ -1,1 +1,1 @@\n-content: old;\n+content: "";\n');
        const result = applyUnifiedDiffBestEffort('content: old;\n', parsed);

        expect(result.results[0]).toMatchObject({ ok: true, startLine: 1 });
        expect(result.newContent).toBe('content: "";\n');
    });
});
