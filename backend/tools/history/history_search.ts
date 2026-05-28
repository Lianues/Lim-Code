/**
 * history_search 工具
 *
 * 允许 AI 检索被上下文总结压缩掉的原始对话内容。
 *
 * 核心思路：将被压缩的历史消息格式化为一个带行号的"虚拟文档"，
 * AI 可以像操作文件一样通过 search + read 两种模式来检索：
 *
 * - search: 关键词/正则搜索，返回匹配的行号和上下文
 * - read:   按行号范围读取格式化后的历史内容
 *
 * 格式化后的文档样例：
 * ```
 *    1 | ══ Round 1 (L1-L13) ══════════
 *    2 | 👤 User:
 *    3 | 帮我实现一个 WebSocket 连接
 *    4 |
 *    5 | 🤖 Model:
 *    6 | 好的，我来帮你实现...
 *    7 | ```typescript
 *    8 | const ws = new WebSocket(...)
 *    9 | ```
 *   10 |
 *   11 | 🤖 Model [tool_call]:
 *   12 | write_file({"path": "src/ws.ts", ...})
 *   13 |
 *   14 | ══ Round 2 (L14-L16) ══════════
 *   15 | 👤 User:
 *   16 | 连接断开后怎么重连？
 * ```
 *
 * 数据来源：ConversationManager.getHistory() 获取完整历史，
 * 然后只处理 isSummary 标记之前（被压缩）的消息。
 */

import type { Tool, ToolDeclaration, ToolResult, ToolContext } from '../types';
import type { Content } from '../../modules/conversation/types';
import type { HistorySearchToolConfig } from '../../modules/settings/types';
import { DEFAULT_HISTORY_SEARCH_CONFIG } from '../../modules/settings/types';
import { t } from '../../i18n';
import { escapeRegExp } from '../utils';

// ─── 默认常量（当 settingsManager 不可用时的 fallback） ───

const {
    maxSearchMatches: MAX_SEARCH_MATCHES,
    searchContextLines: SEARCH_CONTEXT_LINES,
    maxReadLines: MAX_READ_LINES,
    maxResultChars: MAX_RESULT_CHARS,
    lineDisplayLimit: LINE_DISPLAY_LIMIT
} = DEFAULT_HISTORY_SEARCH_CONFIG;

/** 运行时配置，handler 启动时从 settingsManager 加载 */
interface RuntimeConfig {
    searchScope?: 'all' | 'summarized';
    maxSearchMatches: number;
    searchContextLines: number;
    maxReadLines: number;
    maxResultChars: number;
    lineDisplayLimit: number;
}

// ─── 格式化引擎 ─────────────────────────────────────────

/**
 * 查找历史中最后一个总结消息的索引
 */
function findLastSummaryIndex(history: Content[]): number {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].isSummary) {
            return i;
        }
    }
    return -1;
}

/**
 * 从历史消息中提取被总结覆盖的消息（总结之前的消息）
 */
function getSummarizedMessages(history: Content[]): Content[] {
    const summaryIndex = findLastSummaryIndex(history);
    if (summaryIndex < 0) return [];
    return history.slice(0, summaryIndex);
}

/**
 * 获取消息的类型标签
 */
function getMessageTypeTag(message: Content): string {
    const hasFunctionCall = message.parts.some(p => p.functionCall);
    const hasFunctionResponse = message.parts.some(p => p.functionResponse);

    if (hasFunctionCall) return ' [tool_call]';
    if (hasFunctionResponse) return ' [tool_result]';
    return '';
}

/**
 * 将单条消息格式化为文本行数组
 */
function formatMessage(message: Content): string[] {
    const lines: string[] = [];
    const roleTag = message.role === 'user' ? '👤 User' : '🤖 Model';
    const typeTag = getMessageTypeTag(message);

    lines.push(`${roleTag}${typeTag}:`);

    for (const part of message.parts) {
        // 思考过程跳过（不需要检索）
        if (part.thought) continue;

        if (part.text) {
            lines.push(...part.text.split('\n'));
        }

        if (part.functionCall) {
            const argsStr = JSON.stringify(part.functionCall.args);
            lines.push(`${part.functionCall.name}(${argsStr})`);
        }

        if (part.functionResponse) {
            const responseStr = JSON.stringify(part.functionResponse.response);
            lines.push(`${part.functionResponse.name} → ${responseStr}`);
        }
    }

    return lines;
}

/**
 * 将被总结的消息格式化为完整的虚拟文档
 *
 * 两遍扫描：
 * 1. 先生成所有行，记录每个 Round 标题的行索引
 * 2. 回填每个 Round 标题的行号范围 (L start - L end)
 */
function formatToDocument(messages: Content[]): string[] {
    const docLines: string[] = [];
    let roundNumber = 0;
    // 记录每个 Round 标题在 docLines 中的索引
    const roundHeaderIndices: number[] = [];

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];

        // 遇到非 functionResponse 的 user 消息，标记新回合
        if (message.role === 'user' && !message.isFunctionResponse) {
            roundNumber++;
            if (docLines.length > 0) {
                docLines.push(''); // 回合间空行
            }
            roundHeaderIndices.push(docLines.length);
            docLines.push(''); // 占位，后面回填
        }

        // 格式化消息内容
        const msgLines = formatMessage(message);
        docLines.push(...msgLines);
        docLines.push(''); // 消息间空行
    }

    // 第二遍：回填 Round 标题，写入行号范围
    for (let r = 0; r < roundHeaderIndices.length; r++) {
        const headerIdx = roundHeaderIndices[r];
        const startLine = headerIdx + 1; // 1-based
        const endLine = r + 1 < roundHeaderIndices.length
            ? roundHeaderIndices[r + 1] - 1   // 下一个 Round 的空行分隔符之前
            : docLines.length;                 // 最后一个 Round 到文档末尾

        docLines[headerIdx] = `══ Round ${r + 1} (L${startLine}-L${endLine}) ══════════`;
    }

    return docLines;
}

/**
 * 截断过长的行用于显示，附带提示
 * docLines 内部仍存完整内容，仅在输出时调用
 */
function truncateLineForDisplay(line: string, lineNum: number, limit: number = LINE_DISPLAY_LIMIT): string {
    if (line.length <= limit) return line;
    return line.substring(0, limit)
        + `... [${line.length} chars, read line ${lineNum} for full content]`;
}

/**
 * 给行数组添加行号前缀（1-based），返回格式化字符串
 * @param truncateLong 是否截断过长的行（默认 false）
 * @param lineLimit 单行显示字符限制
 */
function addLineNumbers(lines: string[], startLine: number = 1, truncateLong: boolean = false, lineLimit: number = LINE_DISPLAY_LIMIT): string {
    const totalLines = startLine + lines.length - 1;
    const maxDigits = String(totalLines).length;

    return lines.map((line, idx) => {
        const lineNum = startLine + idx;
        const numStr = String(lineNum).padStart(maxDigits, ' ');
        const displayLine = truncateLong ? truncateLineForDisplay(line, lineNum, lineLimit) : line;
        return `${numStr} | ${displayLine}`;
    }).join('\n');
}

// ─── 模式实现 ───────────────────────────────────────────

function splitKeywordQuery(query: string): string[] {
    // 多关键词搜索是给模型常见的 “keyword keyword keyword” 调用习惯兜底。
    // 为什么只在非正则模式使用：正则模式下空格本身有明确语义，不能擅自改写用户表达式。
    // 怎么做：按空白切词、去重、丢弃空词。目的：当完整短语搜不到时，仍能用单个关键词定位历史行号。
    return Array.from(new Set(query.trim().split(/\s+/).filter(Boolean)));
}

function collectMatchingLineIndices(
    docLines: string[],
    maxMatches: number,
    testLine: (line: string) => boolean
): number[] {
    const matchLineIndices: number[] = [];
    for (let i = 0; i < docLines.length; i++) {
        if (testLine(docLines[i])) {
            matchLineIndices.push(i);
            if (matchLineIndices.length >= maxMatches) break;
        }
    }
    return matchLineIndices;
}

/**
 * search 模式：关键词搜索，返回匹配行号和上下文
 */
function handleSearch(docLines: string[], query: string, isRegex: boolean, cfg: RuntimeConfig): ToolResult {
    let keywordFallbackTerms: string[] = [];
    let matchLineIndices: number[] = [];
    try {
        if (isRegex) {
            const pattern = new RegExp(query, 'gi');
            matchLineIndices = collectMatchingLineIndices(docLines, cfg.maxSearchMatches, line => {
                pattern.lastIndex = 0;
                return pattern.test(line);
            });
        } else {
            // WP13b：history_search 的字面量转义语义不变，只复用共享 escapeRegExp 消除跨工具副本。
            const exactPattern = new RegExp(escapeRegExp(query), 'gi');
            matchLineIndices = collectMatchingLineIndices(docLines, cfg.maxSearchMatches, line => {
                exactPattern.lastIndex = 0;
                return exactPattern.test(line);
            });

            const keywordTerms = splitKeywordQuery(query);
            if (matchLineIndices.length === 0 && keywordTerms.length > 1) {
                // WP13b：关键词兜底仍逐词字面量匹配，统一调用共享 helper，避免 escapeRegexLiteral 私有副本。
                const keywordPatterns = keywordTerms.map(term => new RegExp(escapeRegExp(term), 'gi'));
                matchLineIndices = collectMatchingLineIndices(docLines, cfg.maxSearchMatches, line => {
                    return keywordPatterns.some(pattern => {
                        pattern.lastIndex = 0;
                        return pattern.test(line);
                    });
                });
                if (matchLineIndices.length > 0) {
                    keywordFallbackTerms = keywordTerms;
                }
            }
        }
    } catch (e: any) {
        return {
            success: false,
            error: t('tools.history.invalidRegex', { error: e.message })
        };
    }

    if (matchLineIndices.length === 0) {
        return {
            success: true,
            data: t('tools.history.noMatchesFound', { query, totalLines: docLines.length })
        };
    }

    // 构建结果：每个匹配显示行号 + 上下文
    const resultParts: string[] = [];
    resultParts.push(t('tools.history.searchResultHeader', {
        count: matchLineIndices.length,
        query,
        totalLines: docLines.length
    }));
    if (keywordFallbackTerms.length > 0) {
        resultParts.push(t('tools.history.keywordFallbackNotice', {
            terms: keywordFallbackTerms.join(', ')
        }));
    }
    resultParts.push('');

    // 合并相邻的上下文范围，避免重复输出
    const ranges: Array<{ start: number; end: number; matchLines: number[] }> = [];
    for (const lineIdx of matchLineIndices) {
        const start = Math.max(0, lineIdx - cfg.searchContextLines);
        const end = Math.min(docLines.length - 1, lineIdx + cfg.searchContextLines);

        const lastRange = ranges[ranges.length - 1];
        if (lastRange && start <= lastRange.end + 1) {
            // 与前一个范围相邻或重叠，合并
            lastRange.end = Math.max(lastRange.end, end);
            lastRange.matchLines.push(lineIdx);
        } else {
            ranges.push({ start, end, matchLines: [lineIdx] });
        }
    }

    for (let ri = 0; ri < ranges.length; ri++) {
        const range = ranges[ri];
        const contextLines = docLines.slice(range.start, range.end + 1);
        const formatted = contextLines.map((line, idx) => {
            const lineNum = range.start + idx + 1; // 1-based
            const maxDigits = String(docLines.length).length;
            const numStr = String(lineNum).padStart(maxDigits, ' ');
            const displayLine = truncateLineForDisplay(line, lineNum, cfg.lineDisplayLimit);
            const isMatch = range.matchLines.includes(range.start + idx);
            const marker = isMatch ? '>' : ' ';
            return `${marker} ${numStr} | ${displayLine}`;
        }).join('\n');

        resultParts.push(formatted);
        // 只在 range 之间加分隔符，最后一组不加（避免看起来像被截断）
        if (ri < ranges.length - 1) {
            resultParts.push('  ...');
        }
    }

    if (matchLineIndices.length >= cfg.maxSearchMatches) {
        resultParts.push(t('tools.history.resultsLimited', { max: cfg.maxSearchMatches }));
    }

    const result = resultParts.join('\n');
    return {
        success: true,
        data: truncateResult(result, cfg.maxResultChars)
    };
}

/**
 * read 模式：按行号范围读取格式化后的历史内容。
 *
 * 当 start_line === end_line（单行读取）时，不做字符数截断，保证完整返回该行。
 */
function handleRead(docLines: string[], startLine: number, endLine: number, cfg: RuntimeConfig): ToolResult {
    const totalLines = docLines.length;

    // 边界修正（用户传入 1-based）
    const start0 = Math.max(0, startLine - 1);           // 转为 0-based
    const end0 = Math.min(totalLines - 1, endLine - 1);  // 转为 0-based

    if (start0 > end0 || start0 >= totalLines) {
        return {
            success: false,
            error: t('tools.history.invalidRange', {
                start: startLine,
                end: endLine,
                totalLines
            })
        };
    }

    // 限制单次读取行数
    const actualEnd0 = Math.min(end0, start0 + cfg.maxReadLines - 1);
    const wasTruncated = actualEnd0 < end0;
    const isSingleLine = start0 === actualEnd0;

    const slice = docLines.slice(start0, actualEnd0 + 1);
    // 多行读取时截断长行，单行读取时保留完整内容
    const formatted = addLineNumbers(slice, start0 + 1, !isSingleLine, cfg.lineDisplayLimit);

    const parts: string[] = [];
    parts.push(t('tools.history.readResultHeader', {
        start: start0 + 1,
        end: actualEnd0 + 1,
        totalLines
    }));
    parts.push('');
    parts.push(formatted);

    if (wasTruncated) {
        parts.push('');
        parts.push(t('tools.history.readTruncated', {
            max: cfg.maxReadLines,
            nextStart: actualEnd0 + 2  // 1-based
        }));
    }

    const result = parts.join('\n');
    return {
        success: true,
        // 单行读取不截断，保证工具响应等长行可以被完整获取
        data: isSingleLine ? result : truncateResult(result, cfg.maxResultChars)
    };
}

// ─── 辅助 ───────────────────────────────────────────────

/**
 * 安全地截断结果字符串
 */
function truncateResult(result: string, maxChars: number = MAX_RESULT_CHARS): string {
    if (result.length <= maxChars) return result;
    return result.substring(0, maxChars)
        + '\n\n[Result truncated. Try a narrower line range or more specific query.]';
}

// ─── 工具声明与处理器 ───────────────────────────────────

import { getGlobalSettingsManager } from '../../core/settingsContext';
export function createHistorySearchToolDeclaration(): ToolDeclaration {
    const declaration: ToolDeclaration = {
        name: 'history_search',
        description: '', // Will be overridden by getter
        category: 'history',
        parameters: {
            type: 'object',
            properties: {
                mode: {
                    type: 'string',
                    // 为什么要改：history_search 的参数说明会直接进入模型上下文，英文说明在中文对话里更容易被模型忽略或和 read_file 语法混淆。
                    // 怎么改：保留 mode 的枚举值不变，只把说明改成中文，并继续强调 search 后 read 的两步流程。
                    // 目的：让模型先定位历史行号，再用 start_line/end_line 精确读取，而不是把搜索结果当完整历史内容。
                    description:
                        '操作模式。先使用 "search" 定位匹配行号和上下文片段；随后使用 "read" 通过 start_line/end_line 精确读取历史行。',
                    enum: ['search', 'read']
                },
                query: {
                    type: 'string',
                    description: '[search 模式，必填] 用于定位早期对话行的关键词、空格分隔关键词、完整短语或正则表达式。非正则模式下，多词输入会先尝试完整短语；如果没有命中，会降级为逐个空格分隔关键词搜索。search 输出只是定位器和片段，不是完整历史内容。'
                },
                is_regex: {
                    type: 'boolean',
                    description: '[search 模式] 是否把 query 当作正则表达式处理。默认 false。'
                },
                start_line: {
                    type: 'number',
                    description: '[read 模式] 从前一次 search 结果或轮次标题中取得的起始行号，1-based，包含该行。必须使用 snake_case 的 start_line，不要使用 read_file 的 startLine。'
                },
                end_line: {
                    type: 'number',
                    description: '[read 模式] 虚拟历史文档中的结束行号，1-based，包含该行。每次最多读取 ' + MAX_READ_LINES + ' 行。如果需要读取某一条完整长行，请让 end_line 与 start_line 相同。'
                }
            },
            required: ['mode']
        }
    };

    Object.defineProperty(declaration, 'description', {
        get() {
            const scope = getGlobalSettingsManager()?.getHistorySearchConfig()?.searchScope ?? 'all';
            const scopeText = scope === 'summarized' ? '仅压缩/摘要历史' : '完整对话历史';
            // 这段 description 是模型实际看到的工具提示词。
            // 为什么要写得更明确：旧文案把 history_search 类比成 read_file，并出现 startLine/endLine，模型容易误用参数名或把 search 结果当完整内容。
            // 怎么改：把工具边界、两步流程、虚拟文档格式、snake_case 参数名和单行完整读取规则都放在主描述里，并统一改成中文。
            // 目的：让模型先用 search 定位行号，再用 read 精确取证，同时避免把它误用于代码库文件搜索。
            return `搜索并读取本次聊天的对话历史，而不是仓库文件。` +
                `当需要查找早期轮次、之前的工具调用、工具结果或用户决定时使用本工具。` +
                `如果要搜索工作区文件，请改用 search_in_files 或 find_files。` +
                `当前设置允许搜索范围：[${scopeText}]。\n` +
                `历史内容会被格式化成带行号的虚拟文档。输出行形如 "  42 | text"；其中行号和竖线只是定位标记，不属于消息正文。` +
                `轮次标题会显示行范围，例如 "══ Round 3 (L45-L88) ══"；需要读取整轮内容时，用该 L 范围调用 read。\n` +
                `工作流：\n` +
                `1. mode="search"：提供 query，或同时提供 query 与 is_regex=true。search 只返回匹配行号和少量上下文；它是定位器，不是完整历史内容。非正则模式下支持 query="关键词1 关键词2 关键词3"：工具会先搜索完整短语；如果没有命中，会自动降级为逐个空格分隔关键词搜索。\n` +
                `2. mode="read"：search 定位后，使用虚拟文档中的 start_line 和 end_line 精确读取历史行。必须使用 snake_case 的 start_line/end_line，不要使用 read_file 的 startLine/endLine。每次最多读取 ${MAX_READ_LINES} 行。\n` +
                `3. 如果 search 结果提示某一长行被截断，或你需要读取一条完整工具结果行，请调用 read，并设置 start_line=N 且 end_line=N；单行读取永不截断。`;
        },
        enumerable: true
    });

    return declaration;
}

async function historySearchHandler(
    args: Record<string, unknown>,
    context?: ToolContext
): Promise<ToolResult> {
    if (!context) {
        return { success: false, error: t('tools.history.errors.contextRequired') };
    }

    const conversationId = context.conversationId as string | undefined;
    const conversationStore = context.conversationStore as any;

    if (!conversationId) {
        return { success: false, error: t('tools.history.errors.conversationIdRequired') };
    }
    if (!conversationStore) {
        return { success: false, error: t('tools.history.errors.conversationStoreRequired')};
    }
    // conversationStore 实际上就是 ConversationManager 实例
    if (typeof conversationStore.getHistory !== 'function') {
        return { success: false, error: t('tools.history.errors.getHistoryNotAvailable') };
    }

    const mode = args.mode as string;
    if (!['search', 'read'].includes(mode)) {
        return {
            success: false,
            error: t('tools.history.errors.invalidMode', { mode })
        };
    }

    try {
        // 获取全局 settingsManager
        const settingsManager = getGlobalSettingsManager();
        const userCfg: HistorySearchToolConfig | undefined =
            settingsManager
                ? settingsManager.getHistorySearchConfig()
                : undefined;
        const cfg: RuntimeConfig = {
            ...DEFAULT_HISTORY_SEARCH_CONFIG,
            ...(userCfg || {})
        };

        // 获取完整对话历史
        const fullHistory = await conversationStore.getHistory(conversationId) as Content[];

        const targetMessages = cfg.searchScope === 'summarized' ? getSummarizedMessages(fullHistory) : fullHistory;

        if (targetMessages.length === 0) {
            return {
                success: true,
                data: cfg.searchScope === 'summarized' 
                    ? t('tools.history.noSummarizedHistory') 
                    : t('tools.history.noHistory')
            };
        }

        // 格式化为虚拟文档
        const docLines = formatToDocument(targetMessages);

        switch (mode) {
            case 'search': {
                const query = args.query as string;
                if (!query || typeof query !== 'string' || !query.trim()) {
                    return {
                        success: false,
                        error: t('tools.history.errors.queryRequired')
                    };
                }
                const isRegex = args.is_regex === true;
                return handleSearch(docLines, query.trim(), isRegex, cfg);
            }

            case 'read': {
                const startLine = typeof args.start_line === 'number' ? args.start_line : 1;
                const endLine = typeof args.end_line === 'number' ? args.end_line : startLine + cfg.maxReadLines - 1;
                return handleRead(docLines, startLine, endLine, cfg);
            }

            default:
                return {
                    success: false,
                    error: t('tools.history.errors.invalidMode', { mode })
                };
        }
    } catch (e: any) {
        return {
            success: false,
            error: t('tools.history.errors.searchFailed', { error: e?.message || String(e) })
        };
    }
}

// ─── 导出 ───────────────────────────────────────────────

export function createHistorySearchTool(): Tool {
    return {
        declaration: createHistorySearchToolDeclaration(),
        handler: historySearchHandler
    };
}

export function registerHistorySearch(): Tool {
    return createHistorySearchTool();
}
