/**
 * Skill frontmatter parser regression tests.
 *
 * 为什么要改：旧 SkillsManager.parseFrontmatter 不是 YAML parser，会把合法 block scalar
 * description 解析成字面量 `>` / `|`，导致 Skill 摘要失真甚至静默跳过。
 * 怎么改：通过新增的公共 parseSkillFrontmatter 纯函数覆盖用户可观察的 frontmatter 行为，
 * 不再测试 SkillsManager 的私有实现细节。
 * 目的：保证 LimCode loader 兼容合法 YAML frontmatter，同时保留未知生态字段而不赋予核心语义。
 */

import { parseSkillFrontmatter } from '../../../modules/skills/frontmatter';

describe('parseSkillFrontmatter', () => {
    it('parses folded block scalar description using >', () => {
        const result = parseSkillFrontmatter(`---
name: test-skill
description: >
  A folded
  description
---
Body`);

        expect(result.frontmatter.name).toBe('test-skill');
        expect(result.frontmatter.description).toBe('A folded description\n');
        expect(result.body).toBe('Body');
        expect(result.diagnostics).toEqual([]);
    });

    it('parses folded strip block scalar description using >-', () => {
        const result = parseSkillFrontmatter(`---
name: test-skill
description: >-
  A folded
  description
---
Body`);

        expect(result.frontmatter.description).toBe('A folded description');
    });

    it('parses literal block scalar description using |', () => {
        const result = parseSkillFrontmatter(`---
name: test-skill
description: |
  Line 1
  Line 2
---
Body`);

        expect(result.frontmatter.description).toBe('Line 1\nLine 2\n');
    });

    it('parses literal strip block scalar description using |-', () => {
        const result = parseSkillFrontmatter(`---
name: test-skill
description: |-
  Line 1
  Line 2
---
Body`);

        expect(result.frontmatter.description).toBe('Line 1\nLine 2');
    });

    it('keeps frontmatter delimiters inside YAML values', () => {
        const result = parseSkillFrontmatter(`---
name: test-skill
description: "Value with --- inside"
metadata:
  note: "another --- marker"
---
Body`);

        expect(result.frontmatter.description).toBe('Value with --- inside');
        expect(result.frontmatter.extras?.metadata).toEqual({ note: 'another --- marker' });
        expect(result.body).toBe('Body');
    });

    it('handles UTF-8 BOM and CRLF line endings', () => {
        const result = parseSkillFrontmatter('\uFEFF---\r\nname: test-skill\r\ndescription: ok\r\n---\r\nBody');

        expect(result.frontmatter.name).toBe('test-skill');
        expect(result.frontmatter.description).toBe('ok');
        expect(result.body).toBe('Body');
    });

    it('preserves unknown ecosystem fields as extras without diagnostics', () => {
        const result = parseSkillFrontmatter(`---
name: test-skill
description: ok
triggers:
  - debug
allowed-tools:
  - read
metadata:
  version: 1
---`);

        expect(result.frontmatter.extras).toEqual({
            triggers: ['debug'],
            'allowed-tools': ['read'],
            metadata: { version: 1 }
        });
        expect(result.diagnostics).toEqual([]);
    });
});
