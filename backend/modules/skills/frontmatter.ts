import { parseDocument } from 'yaml';
import type { SkillDiagnostic, SkillFrontmatter, SkillSource } from './types';

export interface ParseSkillFrontmatterOptions {
    filePath?: string;
    source?: SkillSource;
    skillId?: string;
}

export interface ParsedSkillFrontmatter {
    frontmatter: Partial<SkillFrontmatter>;
    raw: Record<string, unknown>;
    body: string;
    diagnostics: SkillDiagnostic[];
    hasFrontmatter: boolean;
}

const FRONTMATTER_DELIMITER = '---';

function createDiagnostic(
    options: ParseSkillFrontmatterOptions,
    diagnostic: Pick<SkillDiagnostic, 'severity' | 'code' | 'message' | 'field'>
): SkillDiagnostic {
    return {
        ...diagnostic,
        skillId: options.skillId,
        filePath: options.filePath,
        source: options.source
    };
}

function stripUtf8Bom(content: string): string {
    // 为什么要改：用户从不同编辑器保存 SKILL.md 时可能带 UTF-8 BOM，旧 startsWith('---') 会直接失效。
    // 怎么改：在识别 frontmatter 前剥离单个 BOM，不改变正文其它内容。
    // 目的：让合法 frontmatter 在 Windows/Office 类工具链下仍能被稳定加载。
    return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
}

function findClosingDelimiter(content: string, startIndex: number): { frontmatterEnd: number; bodyStart: number } | null {
    // 为什么要改：旧实现用 indexOf('---', 3)，会被 description 中的普通文本 `---` 误截断。
    // 怎么改：逐行查找单独成行的 closing delimiter，兼容 LF/CRLF。
    // 目的：只让 YAML frontmatter 语法边界结束 header，而不是让字段值里的分隔符破坏解析。
    let cursor = startIndex;
    while (cursor <= content.length) {
        const lineEnd = content.indexOf('\n', cursor);
        const end = lineEnd === -1 ? content.length : lineEnd;
        const line = content.slice(cursor, end).replace(/\r$/, '');
        if (line.trim() === FRONTMATTER_DELIMITER) {
            return {
                frontmatterEnd: cursor,
                bodyStart: lineEnd === -1 ? content.length : lineEnd + 1
            };
        }
        if (lineEnd === -1) break;
        cursor = lineEnd + 1;
    }
    return null;
}

function normalizeFrontmatter(raw: unknown, options: ParseSkillFrontmatterOptions): { frontmatter: Partial<SkillFrontmatter>; raw: Record<string, unknown>; diagnostics: SkillDiagnostic[] } {
    const diagnostics: SkillDiagnostic[] = [];
    const rawObject = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};

    if (raw !== null && raw !== undefined && (typeof raw !== 'object' || Array.isArray(raw))) {
        diagnostics.push(createDiagnostic(options, {
            severity: 'fatal',
            code: 'frontmatter-not-map',
            message: 'Skill frontmatter must be a YAML mapping.'
        }));
    }

    const frontmatter: Partial<SkillFrontmatter> = {};
    if (typeof rawObject.name === 'string') {
        frontmatter.name = rawObject.name;
    }
    if (typeof rawObject.description === 'string') {
        frontmatter.description = rawObject.description;
    }

    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawObject)) {
        if (key !== 'name' && key !== 'description') {
            extras[key] = value;
        }
    }
    if (Object.keys(extras).length > 0) {
        // 为什么要改：生态字段必须无损保留，但不能在解析层获得 LimCode 核心语义。
        // 怎么改：除 name/description 外统一放入 extras，由后续 validator 决定是否提示。
        // 目的：避免 triggers/allowed-tools/scripts 等字段绕过 description 发现机制或脚本安全模型。
        frontmatter.extras = extras;
    }

    return { frontmatter, raw: rawObject, diagnostics };
}

export function parseSkillFrontmatter(content: string, options: ParseSkillFrontmatterOptions = {}): ParsedSkillFrontmatter {
    const diagnostics: SkillDiagnostic[] = [];
    const withoutBom = stripUtf8Bom(content);
    const openingMatch = withoutBom.match(/^---[ \t]*(?:\r?\n|$)/);
    if (!openingMatch) {
        return {
            frontmatter: {},
            raw: {},
            body: withoutBom,
            diagnostics,
            hasFrontmatter: false
        };
    }

    const headerStart = openingMatch[0].length;
    const closing = findClosingDelimiter(withoutBom, headerStart);
    if (!closing) {
        diagnostics.push(createDiagnostic(options, {
            severity: 'fatal',
            code: 'frontmatter-unclosed',
            message: 'Skill frontmatter starts with --- but has no closing delimiter line.'
        }));
        return {
            frontmatter: {},
            raw: {},
            body: withoutBom.slice(headerStart),
            diagnostics,
            hasFrontmatter: true
        };
    }

    const header = withoutBom.slice(headerStart, closing.frontmatterEnd);
    const body = withoutBom.slice(closing.bodyStart).trim();
    const document = parseDocument(header, {
        prettyErrors: false,
        // 为什么要改：使用 YAML 标准解析器而不是自写分支，才能一次性覆盖 block scalar、注释、数组和嵌套对象。
        // 怎么改：使用 yaml 包的 core schema，不启用自定义 tag 行为。
        // 目的：兼容合法 YAML，同时避免把生态字段升级成运行时权限语义。
        schema: 'core'
    });

    for (const error of document.errors) {
        diagnostics.push(createDiagnostic(options, {
            severity: 'fatal',
            code: 'frontmatter-yaml-parse-error',
            message: error.message
        }));
    }
    if (diagnostics.some(d => d.severity === 'fatal')) {
        return { frontmatter: {}, raw: {}, body, diagnostics, hasFrontmatter: true };
    }

    const normalized = normalizeFrontmatter(document.toJSON(), options);
    return {
        frontmatter: normalized.frontmatter,
        raw: normalized.raw,
        body,
        diagnostics: [...diagnostics, ...normalized.diagnostics],
        hasFrontmatter: true
    };
}
