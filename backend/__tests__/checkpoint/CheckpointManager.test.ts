import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('../../tools/file/diffManager', () => ({
    getDiffManager: () => ({
        cancelAllPending: jest.fn().mockResolvedValue({ cancelled: [] })
    })
}));

import { CheckpointManager, type CheckpointRecord } from '../../modules/checkpoint/CheckpointManager';

/**
 * CheckpointManager restore 测试
 *
 * 这些用例专门保护引入的 restore 边界：
 * - 恢复时必须服从“当前工作区”的 ignore 规则
 * - 该语义对新旧两类 checkpoint 记录都成立
 */
async function createTempDirectory(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * 创建测试文件，自动补齐父目录。
 */
async function writeFile(rootDir: string, relativePath: string, content: string = ''): Promise<void> {
    const fullPath = path.join(rootDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
}

/**
 * 判断某个路径当前是否存在。
 */
async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * 生成与 CheckpointManager 一致的文件内容哈希。
 */
function hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * 构造一个最小可运行的 CheckpointManager 测试环境。
 *
 * 这里显式 mock 出：
 * - 单根工作区
 * - checkpoint 设置
 * - conversation metadata 读写
 * - restore 期间会碰到的 VS Code API
 */
async function createCheckpointManager(
    workspaceRoot: string,
    storageRoot: string,
    checkpoints: CheckpointRecord[],
    customIgnorePatterns: string[] = []
): Promise<CheckpointManager> {
    (vscode.workspace as any).workspaceFolders = [
        {
            uri: {
                fsPath: workspaceRoot,
                scheme: 'file',
                path: workspaceRoot
            }
        }
    ];
    (vscode.workspace as any).textDocuments = [];
    (vscode as any).window = {
        setStatusBarMessage: jest.fn(),
        showTextDocument: jest.fn(),
        tabGroups: {
            all: [],
            close: jest.fn()
        }
    };
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined);

    const metadata = { custom: { checkpoints: [...checkpoints] } };
    const settingsManager = {
        getCheckpointConfig: jest.fn().mockReturnValue({
            enabled: true,
            beforeTools: [],
            afterTools: [],
            messageCheckpoint: {
                beforeMessages: [],
                afterMessages: []
            },
            maxCheckpoints: -1,
            customIgnorePatterns
        })
    };
    const conversationManager = {
        getMetadata: jest.fn().mockResolvedValue(metadata),
        setCustomMetadata: jest.fn().mockImplementation(async (_conversationId: string, key: string, value: unknown) => {
            (metadata.custom as Record<string, unknown>)[key] = value;
        }),
        rejectAllPendingToolCalls: jest.fn().mockResolvedValue(undefined),
        listConversations: jest.fn().mockResolvedValue([])
    };

    const manager = new CheckpointManager(
        settingsManager as any,
        conversationManager as any,
        {
            globalStorageUri: {
                fsPath: storageRoot
            }
        } as any
    );
    await manager.initialize();
    return manager;
}

describe('CheckpointManager restore ignore semantics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('restore skips checkpoint files that are currently ignored', async () => {
        const workspaceRoot = await createTempDirectory('limcode-checkpoint-workspace-');
        const storageRoot = await createTempDirectory('limcode-checkpoint-storage-');
        const conversationId = 'conv-current-ignore';
        const checkpointId = 'cp-current-ignore';
        const visibleContent = 'checkpoint visible\n';
        const ignoredContent = 'checkpoint ignored\n';

        try {
            // 工作区当前已经把 ignored/ 视为不可触碰区域，restore 不应覆盖里面的内容。
            await writeFile(workspaceRoot, 'visible.txt', 'workspace visible\n');
            await writeFile(workspaceRoot, 'ignored/secret.txt', 'keep current ignored\n');

            const checkpoint: CheckpointRecord = {
                id: checkpointId,
                conversationId,
                messageIndex: 0,
                toolName: 'apply_diff',
                phase: 'after',
                timestamp: Date.now(),
                backupDir: checkpointId,
                fileCount: 2,
                contentHash: 'hash-current-ignore',
                type: 'full',
                fileHashes: {
                    'visible.txt': hashContent(visibleContent),
                    'ignored/secret.txt': hashContent(ignoredContent)
                },
                emptyDirs: ['ignored/empty']
            };

            const backupRoot = path.join(storageRoot, 'checkpoints', checkpointId);
            await writeFile(backupRoot, 'visible.txt', visibleContent);
            await writeFile(backupRoot, 'ignored/secret.txt', ignoredContent);

            const manager = await createCheckpointManager(
                workspaceRoot,
                storageRoot,
                [checkpoint],
                ['ignored/']
            );

            const result = await manager.restoreCheckpoint(conversationId, checkpointId);

            expect(result).toMatchObject({
                success: true,
                restored: 1,
                deleted: 0,
                skipped: 0
            });
            // 只有当前未忽略的文件应被恢复；忽略路径和忽略空目录都必须保持不变。
            await expect(fs.readFile(path.join(workspaceRoot, 'visible.txt'), 'utf-8')).resolves.toBe(visibleContent);
            await expect(fs.readFile(path.join(workspaceRoot, 'ignored/secret.txt'), 'utf-8')).resolves.toBe('keep current ignored\n');
            await expect(pathExists(path.join(workspaceRoot, 'ignored/empty'))).resolves.toBe(false);
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
            await fs.rm(storageRoot, { recursive: true, force: true });
        }
    });

    test('legacy restore also skips checkpoint files that are currently ignored', async () => {
        const workspaceRoot = await createTempDirectory('limcode-checkpoint-workspace-');
        const storageRoot = await createTempDirectory('limcode-checkpoint-storage-');
        const conversationId = 'conv-legacy-ignore';
        const checkpointId = 'cp-legacy-ignore';
        const visibleContent = 'legacy visible\n';
        const ignoredContent = 'legacy ignored\n';

        try {
            // legacy checkpoint 没有 fileHashes，但 restore 仍然不能绕过当前 ignore 规则。
            await writeFile(workspaceRoot, 'visible.txt', 'workspace visible\n');
            await writeFile(workspaceRoot, 'ignored/secret.txt', 'keep current ignored\n');

            const checkpoint: CheckpointRecord = {
                id: checkpointId,
                conversationId,
                messageIndex: 0,
                toolName: 'apply_diff',
                phase: 'after',
                timestamp: Date.now(),
                backupDir: checkpointId,
                fileCount: 2,
                contentHash: 'hash-legacy-ignore',
                type: 'full'
            };

            const backupRoot = path.join(storageRoot, 'checkpoints', checkpointId);
            await writeFile(backupRoot, 'visible.txt', visibleContent);
            await writeFile(backupRoot, 'ignored/secret.txt', ignoredContent);
            await fs.mkdir(path.join(backupRoot, 'ignored/empty'), { recursive: true });

            const manager = await createCheckpointManager(
                workspaceRoot,
                storageRoot,
                [checkpoint],
                ['ignored/']
            );

            const result = await manager.restoreCheckpoint(conversationId, checkpointId);

            expect(result).toMatchObject({
                success: true,
                restored: 1,
                deleted: 0
            });
            // 新旧恢复路径最终都应该表现为同一条规则：只恢复当前可见路径。
            await expect(fs.readFile(path.join(workspaceRoot, 'visible.txt'), 'utf-8')).resolves.toBe(visibleContent);
            await expect(fs.readFile(path.join(workspaceRoot, 'ignored/secret.txt'), 'utf-8')).resolves.toBe('keep current ignored\n');
            await expect(pathExists(path.join(workspaceRoot, 'ignored/empty'))).resolves.toBe(false);
        } finally {
            await fs.rm(workspaceRoot, { recursive: true, force: true });
            await fs.rm(storageRoot, { recursive: true, force: true });
        }
    });
});
