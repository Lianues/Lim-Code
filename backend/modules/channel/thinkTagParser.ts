/**
 * Utilities for extracting a leading <think>...</think> block from model text.
 *
 * Some OpenAI-compatible proxy services do not expose reasoning_content as a
 * dedicated field. Instead they prepend it to content as:
 *
 *   <think>reasoning...</think>final answer...
 *
 * LimCode's UI already knows how to render ContentPart objects with
 * `thought: true` as collapsible thinking blocks. This parser converts only
 * those leading proxy-style tags into that internal representation. Later
 * <think> tags in Markdown/code/plain text are preserved as ordinary text.
 */

import type { ContentPart } from '../conversation/types';

const OPENING_THINK_TAG = '<think>';
const CLOSING_THINK_TAG = '</think>';

type ParserState = 'beforePrefix' | 'insideThink' | 'afterThink' | 'plainText';

function startsWithTag(source: string, tag: string): boolean {
    return source.toLowerCase().startsWith(tag);
}

function isPotentialTagPrefix(source: string, tag: string): boolean {
    return source.length > 0 && tag.startsWith(source.toLowerCase());
}

/**
 * Case-insensitive indexOf for fixed ASCII tags.
 */
function indexOfTag(source: string, tag: string): number {
    return source.toLowerCase().indexOf(tag);
}

/**
 * Returns the longest suffix length of `source` that may be the beginning of
 * `tag`. Used to avoid leaking partial streaming tags such as "</thi".
 */
function potentialTagPrefixLength(source: string, tag: string): number {
    const lowerSource = source.toLowerCase();
    const maxLen = Math.min(lowerSource.length, tag.length - 1);

    for (let len = maxLen; len > 0; len--) {
        if (tag.startsWith(lowerSource.slice(lowerSource.length - len))) {
            return len;
        }
    }

    return 0;
}

function leadingWhitespaceLength(text: string): number {
    return text.match(/^\s*/)?.[0].length ?? 0;
}

function appendTextPart(parts: ContentPart[], text: string, thought: boolean): void {
    if (!text) return;

    const lastPart = parts[parts.length - 1];
    if (
        lastPart &&
        'text' in lastPart &&
        !lastPart.functionCall &&
        (lastPart.thought === true) === thought
    ) {
        lastPart.text = `${lastPart.text || ''}${text}`;
        return;
    }

    parts.push(thought ? { text, thought: true } : { text });
}

/**
 * Streaming-safe leading <think> tag extractor.
 *
 * It only parses <think> blocks before the first non-whitespace normal answer
 * token. Once normal text starts, the parser switches to plainText mode and
 * preserves any later <think> tags exactly as text, which prevents Markdown or
 * code examples from being folded accidentally.
 */
export class ThinkTagParser {
    private buffer = '';
    private state: ParserState = 'beforePrefix';
    private hasParsedThinkPrefix = false;

    process(text: string): ContentPart[] {
        if (!text) return [];

        this.buffer += text;
        return this.drain(false);
    }

    finalize(): ContentPart[] {
        return this.drain(true);
    }

    reset(): void {
        this.buffer = '';
        this.state = 'beforePrefix';
        this.hasParsedThinkPrefix = false;
    }

    private drain(final: boolean): ContentPart[] {
        const parts: ContentPart[] = [];

        while (this.buffer.length > 0) {
            if (this.state === 'plainText') {
                appendTextPart(parts, this.buffer, false);
                this.buffer = '';
                break;
            }

            if (this.state === 'insideThink') {
                const closingIndex = indexOfTag(this.buffer, CLOSING_THINK_TAG);

                if (closingIndex >= 0) {
                    appendTextPart(parts, this.buffer.slice(0, closingIndex), true);
                    this.buffer = this.buffer.slice(closingIndex + CLOSING_THINK_TAG.length);
                    this.state = 'afterThink';
                    continue;
                }

                if (final) {
                    appendTextPart(parts, this.buffer, true);
                    this.buffer = '';
                    this.state = 'afterThink';
                    break;
                }

                const keepLen = potentialTagPrefixLength(this.buffer, CLOSING_THINK_TAG);
                const emitLen = this.buffer.length - keepLen;

                if (emitLen > 0) {
                    appendTextPart(parts, this.buffer.slice(0, emitLen), true);
                    this.buffer = this.buffer.slice(emitLen);
                }

                break;
            }

            const whitespaceLen = leadingWhitespaceLength(this.buffer);
            const afterWhitespace = this.buffer.slice(whitespaceLen);

            if (afterWhitespace.length === 0) {
                if (final && !this.hasParsedThinkPrefix) {
                    appendTextPart(parts, this.buffer, false);
                }
                if (final) this.buffer = '';
                break;
            }

            if (startsWithTag(afterWhitespace, OPENING_THINK_TAG)) {
                // Drop whitespace before the first leading think block, but keep
                // separators between multiple leading think blocks as thought
                // content so separate reasoning chunks do not get glued together.
                if (this.hasParsedThinkPrefix && whitespaceLen > 0) {
                    appendTextPart(parts, this.buffer.slice(0, whitespaceLen), true);
                }
                this.buffer = afterWhitespace.slice(OPENING_THINK_TAG.length);
                this.state = 'insideThink';
                this.hasParsedThinkPrefix = true;
                continue;
            }

            if (!final && isPotentialTagPrefix(afterWhitespace, OPENING_THINK_TAG)) {
                // Wait for more chunks before deciding whether this is really a
                // leading <think> tag or ordinary text starting with similar chars.
                break;
            }

            appendTextPart(parts, this.buffer, false);
            this.buffer = '';
            this.state = 'plainText';
            break;
        }

        return parts;
    }
}

/**
 * Non-stream helper for complete content strings.
 */
export function splitThinkTagsFromText(text: string): ContentPart[] {
    const parser = new ThinkTagParser();
    return [...parser.process(text), ...parser.finalize()];
}
