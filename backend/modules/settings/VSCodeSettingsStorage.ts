/**
 * LimCode - VS Code Settings 存储实现
 *
 * 将 LimCode 的“设置类配置”存入 VS Code Settings（workspace.getConfiguration），
 * 从而支持 Settings Sync。
 *
 * - 可同步配置：使用默认 scope（会参与 Settings Sync）
 * - 机器相关配置：在 package.json 中声明 scope: "machine"（不会参与 Settings Sync）
 *
 * 同时提供从旧版 settings/settings.json（globalStorage 下）的一次性迁移。
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { SettingsStorage } from './SettingsManager';
import type { GlobalSettings } from './types';

export interface VSCodeSettingsStorageOptions {
    /**
     * 旧版基于文件的 settings 目录（例如：context.globalStorageUri.fsPath/settings）
     *
     * 用于升级迁移。
     */
    legacySettingsDir?: string;

    /** 是否尝试从旧文件迁移（默认 true） */
    enableLegacyMigration?: boolean;

    /** 迁移成功后是否将旧文件重命名为 .bak（默认 true） */
    backupLegacyFile?: boolean;
}

const LIMCODE_CONFIG_SECTION = 'limcode';

// 这些 key 参与 Settings Sync（默认 scope）
const SYNCABLE_KEYS = [
    'toolsConfig',
    'ui',
    'toolsEnabled',
    'toolAutoExec',
    'maxToolIterations',
    'defaultToolMode',
    'activeChannelId',
    'lastReadAnnouncementVersion'
] as const;

// 这些 key 应在 package.json 中声明 scope: "machine"
const MACHINE_KEYS = ['proxy', 'storagePath'] as const;

type SyncableKey = typeof SYNCABLE_KEYS[number];
type MachineKey = typeof MACHINE_KEYS[number];

type ConfigKey = SyncableKey | MachineKey;

export class VSCodeSettingsStorage implements SettingsStorage {
    private options: Required<VSCodeSettingsStorageOptions>;

    constructor(options: VSCodeSettingsStorageOptions = {}) {
        this.options = {
            legacySettingsDir: options.legacySettingsDir,
            enableLegacyMigration: options.enableLegacyMigration ?? true,
            backupLegacyFile: options.backupLegacyFile ?? true
        };
    }

    async load(): Promise<GlobalSettings | null> {
        const config = vscode.workspace.getConfiguration(LIMCODE_CONFIG_SECTION);

        const hasAnySyncable = this.hasAnyUserValue(config, SYNCABLE_KEYS);
        const hasAnyMachine = this.hasAnyUserValue(config, MACHINE_KEYS);

        // 如果没有任何（可同步）配置，优先尝试从旧文件迁移
        if (!hasAnySyncable && this.options.enableLegacyMigration) {
            const migrated = await this.tryMigrateFromLegacyFile(config, hasAnyMachine);
            if (migrated) {
                return migrated;
            }
        }

        // 如果用户没有设置过任何 limcode.*（包括 machine），返回 null 让 SettingsManager 使用默认值
        if (!hasAnySyncable && !hasAnyMachine) {
            return null;
        }

        return this.readSettingsFromVSCode(config, {
            includeSyncable: true,
            includeMachine: true
        });
    }

    async save(settings: GlobalSettings): Promise<void> {
        const config = vscode.workspace.getConfiguration(LIMCODE_CONFIG_SECTION);

        // 注意：这里全部写入 Global 目标。
        // 对于 scope: "machine" 的配置项，VS Code 会自动将其写入 Machine Settings，并且不参与 Sync。
        await config.update('toolsConfig', settings.toolsConfig, vscode.ConfigurationTarget.Global);
        await config.update('ui', settings.ui, vscode.ConfigurationTarget.Global);
        await config.update('toolsEnabled', settings.toolsEnabled, vscode.ConfigurationTarget.Global);
        await config.update('toolAutoExec', settings.toolAutoExec, vscode.ConfigurationTarget.Global);
        await config.update('maxToolIterations', settings.maxToolIterations, vscode.ConfigurationTarget.Global);
        await config.update('defaultToolMode', settings.defaultToolMode, vscode.ConfigurationTarget.Global);
        await config.update('activeChannelId', settings.activeChannelId, vscode.ConfigurationTarget.Global);
        await config.update('lastReadAnnouncementVersion', settings.lastReadAnnouncementVersion, vscode.ConfigurationTarget.Global);

        await config.update('proxy', settings.proxy, vscode.ConfigurationTarget.Global);
        await config.update('storagePath', settings.storagePath, vscode.ConfigurationTarget.Global);
    }

    private readSettingsFromVSCode(
        config: vscode.WorkspaceConfiguration,
        opts: { includeSyncable: boolean; includeMachine: boolean }
    ): GlobalSettings {
        // 注意：这里返回的是“部分 settings”。
        // SettingsManager.initialize() 会与 DEFAULT_GLOBAL_SETTINGS 做合并。
        const settings: Partial<GlobalSettings> = {};

        if (opts.includeSyncable) {
            settings.toolsConfig = config.get('toolsConfig');
            settings.ui = config.get('ui');
            settings.toolsEnabled = config.get('toolsEnabled') as any;
            settings.toolAutoExec = config.get('toolAutoExec');
            settings.maxToolIterations = config.get('maxToolIterations');
            settings.defaultToolMode = config.get('defaultToolMode') as any;
            const activeChannelId = config.get<string>('activeChannelId');
            settings.activeChannelId = activeChannelId && activeChannelId.trim() ? activeChannelId : undefined;

            const lastReadAnnouncementVersion = config.get<string>('lastReadAnnouncementVersion');
            settings.lastReadAnnouncementVersion = lastReadAnnouncementVersion && lastReadAnnouncementVersion.trim()
                ? lastReadAnnouncementVersion
                : undefined;
        }

        if (opts.includeMachine) {
            settings.proxy = config.get('proxy');
            settings.storagePath = config.get('storagePath');
        }

        // toolsEnabled 在类型上是必填字段（但这里可能为 undefined），兜底给空对象，避免 TS 报错
        return {
            toolsEnabled: (settings.toolsEnabled as any) ?? {},
            lastUpdated: Date.now(),
            ...(settings as any)
        };
    }

    private hasAnyUserValue<T extends readonly ConfigKey[]>(
        config: vscode.WorkspaceConfiguration,
        keys: T
    ): boolean {
        for (const key of keys) {
            const inspected = config.inspect(key);
            if (!inspected) {
                continue;
            }

            // 只要用户在任意层级设置过（global/workspace/workspaceFolder），就认为“有值”
            if (
                inspected.globalValue !== undefined ||
                inspected.workspaceValue !== undefined ||
                inspected.workspaceFolderValue !== undefined
            ) {
                return true;
            }
        }
        return false;
    }

    private async tryMigrateFromLegacyFile(
        config: vscode.WorkspaceConfiguration,
        preserveExistingMachineValues: boolean
    ): Promise<GlobalSettings | null> {
        if (!this.options.legacySettingsDir) {
            return null;
        }

        const legacyFile = path.join(this.options.legacySettingsDir, 'settings.json');

        let legacyContent: string;
        try {
            legacyContent = await fs.readFile(legacyFile, 'utf-8');
        } catch (error: any) {
            if (error?.code === 'ENOENT') {
                return null;
            }
            console.warn('[VSCodeSettingsStorage] Failed to read legacy settings file:', error);
            return null;
        }

        let legacySettings: GlobalSettings;
        try {
            legacySettings = JSON.parse(legacyContent);
        } catch (error) {
            console.warn('[VSCodeSettingsStorage] Failed to parse legacy settings file:', error);
            return null;
        }

        // 如果用户已经设置过 machine 配置，迁移时不覆盖（例如 proxy 不同机器端口不同）
        if (preserveExistingMachineValues) {
            const current = this.readSettingsFromVSCode(config, { includeSyncable: false, includeMachine: true });
            legacySettings = {
                ...legacySettings,
                proxy: current.proxy ?? legacySettings.proxy,
                storagePath: current.storagePath ?? legacySettings.storagePath
            };
        }

        // 写入 VS Code Settings
        await this.save(legacySettings);

        // 迁移成功后备份旧文件，避免重复迁移/歧义
        if (this.options.backupLegacyFile) {
            await this.backupLegacySettingsFileSafely(legacyFile);
        }

        console.log('[VSCodeSettingsStorage] Migrated legacy settings to VS Code Settings:', legacyFile);
        return legacySettings;
    }

    private async backupLegacySettingsFileSafely(legacyFile: string): Promise<void> {
        const bakFile = legacyFile + '.bak';

        try {
            // 如果已经存在备份，则不重复备份
            try {
                await fs.access(bakFile);
                return;
            } catch {
                // ignore
            }

            await fs.rename(legacyFile, bakFile);
        } catch (error) {
            // rename 在跨设备或权限受限时可能失败：退化为 copy + 保留原文件
            try {
                const content = await fs.readFile(legacyFile);
                await fs.writeFile(bakFile, content);
            } catch (e) {
                console.warn('[VSCodeSettingsStorage] Failed to backup legacy settings file:', e);
            }
        }
    }
}
