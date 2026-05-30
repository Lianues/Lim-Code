/**
 * LimCode - SubAgent result serializer
 *
 * 修改原因：SubAgent 完整 transcript 已经隔离到 Monitor，但最终 response/partialResponse 仍会作为主工具结果进入主对话上下文。
 * 修改方式：把原始 executor result 投影为有上限的结构化摘要，主对话只接收 outcome、summary、keyFindings、runId 和预算/截断元数据。
 * 修改目的：满足 P1 “主对话不写入完整 SubAgent transcript”的要求，同时保留 Monitor 详情入口。
 */

import type { SubAgentResult } from './types';
import type { SubAgentOutcome, SubAgentStructuredSummary } from '../../modules/conversation/contextTypes';
import { t } from '../../i18n';

const DEFAULT_MAIN_SUMMARY_MAX_CHARS = 4000;
const DEFAULT_KEY_FINDING_MAX_COUNT = 8;
const DEFAULT_KEY_FINDING_MAX_CHARS = 500;

export interface SerializeSubAgentResultOptions {
    agentName: string;
    channelName?: string;
    modelId?: string;
    maxSummaryChars?: number;
}

export interface SerializedSubAgentToolData {
    agentName: string;
    runId?: string;
    outcome: SubAgentOutcome;
    summary: string;
    keyFindings: string[];
    artifacts: unknown[];
    errors: Array<{ code: string; message: string }>;
    tokenStats?: SubAgentStructuredSummary['tokenStats'];
    provenance: SubAgentStructuredSummary['provenance'];
    channelName?: string;
    modelId?: string;
    steps?: number;
    truncated: boolean;
    fullResponseChars: number;
    /**
     * 修改原因：旧前端 subagents.vue 读取 response/partialResponse 字段；一次性删除会让工具卡空白。
     * 修改方式：兼容字段只放 bounded summary，不再放 executor raw response。
     * 修改目的：在保护主上下文的同时，保持旧 UI 可读，后续 UI 可迁移到 summary/keyFindings。
     */
    response?: string;
    partialResponse?: string;
}

export function serializeSubAgentResult(
    result: SubAgentResult,
    options: SerializeSubAgentResultOptions
): SerializedSubAgentToolData {
    const outcome = resolveOutcome(result);
    const rawResponse = typeof result.response === 'string' ? result.response : '';
    const maxSummaryChars = Math.max(200, options.maxSummaryChars ?? DEFAULT_MAIN_SUMMARY_MAX_CHARS);
    const summary = buildBoundedSummary(rawResponse, maxSummaryChars);
    const keyFindings = extractKeyFindings(summary);
    const artifacts = extractArtifactRefsFromText(rawResponse);
    const errorMessage = result.error ? String(result.error) : undefined;
    const errors = errorMessage ? [{ code: outcome.toUpperCase(), message: errorMessage }] : [];
    const truncated = rawResponse.length > summary.length;

    const base: SerializedSubAgentToolData = {
        agentName: options.agentName,
        runId: result.runId,
        outcome,
        summary,
        keyFindings,
        artifacts,
        errors,
        provenance: {
            runId: result.runId || '',
            agentName: options.agentName
        },
        channelName: options.channelName,
        modelId: options.modelId,
        steps: result.steps,
        truncated,
        fullResponseChars: rawResponse.length
    };

    if (result.success) {
        base.response = summary;
    } else {
        base.partialResponse = summary;
    }

    return base;
}

function resolveOutcome(result: SubAgentResult): SubAgentOutcome {
    if (result.cancelled) return 'cancelled';
    if (result.success) return 'completed';
    if (typeof result.error === 'string' && /time\s*out|timeout|maximum runtime/i.test(result.error)) return 'timeout';
    if (result.response) return 'partial';
    return 'failed';
}

function buildBoundedSummary(raw: string, maxChars: number): string {
    if (!raw.trim()) return '';
    if (raw.length <= maxChars) return raw;
    /**
     * 修改原因：不能在 handler 或 cleanFunctionResponseForAPI 里临时截断；但主工具结果必须有统一输出上限。
     * 修改方式：在 serializer 单点生成 bounded summary，并附带 fullResponseChars/truncated 元数据。
     * 修改目的：让模型和 UI 都知道这是摘要投影，完整内容应去 Monitor/artifact 查看。
     */
    const head = raw.slice(0, Math.floor(maxChars * 0.7)).trimEnd();
    const tail = raw.slice(raw.length - Math.floor(maxChars * 0.2)).trimStart();
    return [
        head,
        '',
        t('tools.subagents.errors.outputTruncated', { length: raw.length }),
        '',
        tail
    ].join('\n');
}

function extractArtifactRefsFromText(text: string): any[] {
    /**
     * 修改原因：P1 要求 SubAgent 主结果携带 artifact refs，而不是只把报告路径藏在摘要 prose 里。
     * 修改方式：从 SubAgent 输出中提取常见仓库相对路径，生成轻量 ArtifactRef；完整持久化由后续 ArtifactRefStore 继续承接。
     * 修改目的：主对话可以结构化引用报告/文件，同时不把完整 transcript 塞回上下文。
     */
    const matches = new Set<string>();
    const pathRe = /(?:docs|backend|frontend|webview|test|scripts|resources)\/[\w.()\-\/]+/g;
    for (const match of text.matchAll(pathRe)) {
        matches.add(match[0].replace(/[),.;:]+$/, ''));
    }
    return Array.from(matches).slice(0, 20).map(path => ({
        artifactId: `artifact_${stableHash(path)}`,
        kind: path.startsWith('docs/') ? 'report' : 'file',
        path,
        title: path.split('/').pop() || path,
        createdAt: Date.now(),
        provenance: { source: 'subagent_result_serializer' }
    }));
}

function stableHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
}

function extractKeyFindings(summary: string): string[] {
    if (!summary.trim()) return [];
    const lines = summary
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*[-*]\s+/, '').trim())
        .filter(Boolean)
        .filter(line => !line.startsWith('```'));
    return lines
        .slice(0, DEFAULT_KEY_FINDING_MAX_COUNT)
        .map(line => line.length > DEFAULT_KEY_FINDING_MAX_CHARS ? `${line.slice(0, DEFAULT_KEY_FINDING_MAX_CHARS - 1)}…` : line);
}
