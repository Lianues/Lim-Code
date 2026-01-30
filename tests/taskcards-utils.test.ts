import { describe, it, expect } from 'vitest';

import { extractPreviewText, formatSubAgentRuntimeBadge, isPlanDocPath } from '../frontend/src/utils/taskCards';

describe('taskCards utils', () => {
    describe('extractPreviewText', () => {
        it('should trim and keep only first N lines', () => {
            const input = `\n\nline1\nline2\nline3\nline4\n`;
            const out = extractPreviewText(input, { maxLines: 2, maxChars: 10_000 });
            expect(out).toBe('line1\nline2');
        });

        it('should truncate by maxChars (and add ellipsis)', () => {
            const input = 'abcdefghijklmnopqrstuvwxyz';
            const out = extractPreviewText(input, { maxLines: 50, maxChars: 10 });
            expect(out.length).toBeLessThanOrEqual(11);
            expect(out.endsWith('…')).toBe(true);
        });
    });

    describe('formatSubAgentRuntimeBadge', () => {
        it('should prefer modelVersion over modelId', () => {
            const out = formatSubAgentRuntimeBadge({
                channelId: 'chanA',
                modelId: 'modelIdX',
                modelVersion: 'modelVersionY'
            });
            expect(out).toBe('chanA · modelVersionY');
        });

        it('should fallback to modelId when modelVersion missing', () => {
            const out = formatSubAgentRuntimeBadge({
                channelId: 'chanA',
                modelId: 'modelIdX'
            });
            expect(out).toBe('chanA · modelIdX');
        });
    });

    describe('isPlanDocPath', () => {
        it('should accept .cursor/plans markdown files', () => {
            expect(isPlanDocPath('.cursor/plans/a.plan.md')).toBe(true);
            expect(isPlanDocPath('.cursor/plans/a.md')).toBe(true);
            expect(isPlanDocPath('workspaceA/.cursor/plans/a.plan.md')).toBe(true);
        });

        it('should reject non-plan paths', () => {
            expect(isPlanDocPath('.cursor/other/a.md')).toBe(false);
            expect(isPlanDocPath('README.md')).toBe(false);
            expect(isPlanDocPath('.cursor/plans/a.txt')).toBe(false);
            // Must not match nested prefixes like foo/bar/.cursor/plans/...
            expect(isPlanDocPath('foo/bar/.cursor/plans/a.md')).toBe(false);
        });
    });
});

