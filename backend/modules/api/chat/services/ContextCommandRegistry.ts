/**
 * LimCode - ContextCommandRegistry
 *
 * 修改原因：P1 要求 /context-status、/compact、/summarize、/context-undo、/context-restore、/context-reset 走统一协议，不能一个命令一个 handler。
 * 修改方式：集中解析 slash command、确认危险操作、调用 ContextOperationService，并返回统一 UiStatusPayload。
 * 修改目的：ChatFlow/Webview 只依赖 registry，避免 slash command 双入口和确认语义漂移。
 */

import { t } from '../../../../i18n';
import { CONVERSATION_METADATA_SCHEMA_VERSION, type UiStatusPayload } from '../../../conversation/contextTypes';
import type { ContextOperationService, ContextOperationRequest } from './ContextOperationService';

export interface ParsedContextCommand {
    raw: string;
    name: '/context-status' | '/compact' | '/summarize' | '/context-undo' | '/context-restore' | '/context-reset';
    args: string[];
    confirmed: boolean;
}

const COMMANDS = new Set<ParsedContextCommand['name']>([
    '/context-status',
    '/compact',
    '/summarize',
    '/context-undo',
    '/context-restore',
    '/context-reset'
]);

const DANGEROUS_COMMANDS = new Set<ParsedContextCommand['name']>(['/compact', '/summarize', '/context-reset']);

export class ContextCommandRegistry {
    constructor(private readonly operationService: ContextOperationService) {}

    parse(message: string | undefined): ParsedContextCommand | null {
        const raw = (message || '').trim();
        if (!raw.startsWith('/')) return null;
        const [nameRaw, ...argsRaw] = raw.split(/\s+/);
        const name = nameRaw as ParsedContextCommand['name'];
        if (!COMMANDS.has(name)) return null;
        const args = argsRaw.filter(arg => arg !== '--confirm' && arg !== '--yes');
        const confirmed = argsRaw.includes('--confirm') || argsRaw.includes('--yes');
        return { raw, name, args, confirmed };
    }

    async execute(parsed: ParsedContextCommand, request: Omit<ContextOperationRequest, 'command' | 'args'>): Promise<UiStatusPayload> {
        if (DANGEROUS_COMMANDS.has(parsed.name) && !parsed.confirmed) {
            return this.confirmPayload(parsed);
        }

        const operationRequest: ContextOperationRequest = {
            ...request,
            command: parsed.name,
            args: parsed.args,
            actor: request.actor ?? 'slash_command'
        };

        switch (parsed.name) {
            case '/context-status':
                return await this.operationService.status(operationRequest);
            case '/compact':
                return await this.operationService.compact(operationRequest);
            case '/summarize':
                return await this.operationService.summarize(operationRequest);
            case '/context-undo':
                return await this.operationService.undo(operationRequest);
            case '/context-restore':
                return await this.operationService.restore(operationRequest);
            case '/context-reset':
                return await this.operationService.reset(operationRequest);
        }
    }

    private confirmPayload(parsed: ParsedContextCommand): UiStatusPayload {
        /**
         * 修改原因：compact/summarize/reset 会改变工作上下文 projection，必须二次确认，不能静默执行。
         * 修改方式：registry 在调用 operation service 前统一返回 confirmation payload，确认语法为追加 --confirm。
         * 修改目的：让前端按钮、手输 slash command 和未来命令面板复用同一确认协议。
         */
        const confirmedCommand = `${parsed.name}${parsed.args.length > 0 ? ` ${parsed.args.join(' ')}` : ''} --confirm`;
        // 修改原因：确认卡片是 compact/summarize 用户路径上的第一条可见结果，不能固定为英文。
        // 修改方式：保留 command/nextActions 的机器可执行文本，只把标题和说明接入后端 i18n。
        // 修改目的：确保不同语言环境下仍能清楚说明 projection/ledger 语义，同时不破坏确认命令协议。
        return {
            schemaVersion: CONVERSATION_METADATA_SCHEMA_VERSION,
            kind: 'confirmation',
            title: t('modules.api.chat.contextCommands.confirmation.title', { command: parsed.name }),
            description: t('modules.api.chat.contextCommands.confirmation.description', { command: parsed.name, confirmedCommand }),
            iconName: 'warning',
            command: parsed.name,
            confirmationToken: '--confirm',
            lossy: parsed.name === '/compact' || parsed.name === '/summarize',
            reversible: parsed.name === '/context-reset',
            nextActions: [confirmedCommand, '/context-status']
        };
    }
}
