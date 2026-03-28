import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CheckpointIgnoreResolver, normalizeCheckpointPath } from '../../modules/checkpoint/CheckpointIgnoreResolver';

/**
 * CheckpointIgnoreResolver 测试
 *
 * 这些用例覆盖一些忽略语义：
 * - 根目录与嵌套目录的 `.gitignore` 作用域
 * - anchored / negation 规则
 * - Windows 风格自定义忽略模式
 * - `.gitignore` 不可用时的收敛行为
 */
async function createTempWorkspace(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'limcode-checkpoint-ignore-'));
}

/**
 * 在临时工作区中创建文件，自动补齐父目录。
 */
async function writeFile(rootDir: string, relativePath: string, content: string = ''): Promise<void> {
    const fullPath = path.join(rootDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
}

/**
 * 返回 resolver 最终会纳入检查点的相对路径列表。
 *
 * 这里统一经过 `normalizeCheckpointPath`，确保断言不受平台路径分隔符影响。
 */
async function listTrackedPaths(rootDir: string, extraPatterns: string[] = []): Promise<string[]> {
    const resolver = new CheckpointIgnoreResolver(rootDir, extraPatterns);
    const { files } = await resolver.collectEntries();
    return files
        .map(filePath => normalizeCheckpointPath(path.relative(rootDir, filePath)))
        .sort();
}

describe('CheckpointIgnoreResolver', () => {
    test('ignores root and nested target directories while preserving tracked files', async () => {
        const rootDir = await createTempWorkspace();

        try {
            // 根目录规则 `target/` 应该匹配任意层级的同名目录。
            await writeFile(rootDir, '.gitignore', 'target/\n');
            await writeFile(rootDir, 'src/main.rs', 'fn main() {}\n');
            await writeFile(rootDir, 'target/debug/app.exe', 'binary');
            await writeFile(rootDir, 'nested/target/cache.txt', 'ignored');
            await writeFile(rootDir, 'nested/src/lib.rs', 'pub fn lib() {}\n');
            await writeFile(rootDir, '.git/HEAD', 'ref: refs/heads/main\n');
            await writeFile(rootDir, 'node_modules/pkg/index.js', 'module.exports = {}\n');

            await expect(listTrackedPaths(rootDir)).resolves.toEqual([
                '.gitignore',
                'nested/src/lib.rs',
                'src/main.rs'
            ]);
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    test('respects anchored root-only directory rules', async () => {
        const rootDir = await createTempWorkspace();

        try {
            // `/target/` 只忽略根目录下的 target，不影响嵌套目录。
            await writeFile(rootDir, '.gitignore', '/target/\n');
            await writeFile(rootDir, 'target/root.txt', 'ignored');
            await writeFile(rootDir, 'nested/target/nested.txt', 'tracked');

            await expect(listTrackedPaths(rootDir)).resolves.toEqual([
                '.gitignore',
                'nested/target/nested.txt'
            ]);
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    test('keeps nested gitignore scope local and supports negation within that scope', async () => {
        const rootDir = await createTempWorkspace();

        try {
            // packages/a 下的规则只能影响 a 子树，且 `!dist/keep.txt` 需要正确反选。
            await writeFile(rootDir, 'packages/a/.gitignore', 'dist/*\n!dist/keep.txt\nfoo.txt\n');
            await writeFile(rootDir, 'packages/a/dist/keep.txt', 'tracked');
            await writeFile(rootDir, 'packages/a/dist/drop.txt', 'ignored');
            await writeFile(rootDir, 'packages/a/foo.txt', 'ignored');
            await writeFile(rootDir, 'packages/b/dist/keep.txt', 'tracked');
            await writeFile(rootDir, 'packages/b/foo.txt', 'tracked');

            await expect(listTrackedPaths(rootDir)).resolves.toEqual([
                'packages/a/.gitignore',
                'packages/a/dist/keep.txt',
                'packages/b/dist/keep.txt',
                'packages/b/foo.txt'
            ]);
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    test('applies custom ignore patterns at the checkpoint root scope', async () => {
        const rootDir = await createTempWorkspace();

        try {
            // 自定义规则与根目录 `.gitignore` 处于同一逻辑作用域。
            await writeFile(rootDir, 'generated/code.ts', 'ignored');
            await writeFile(rootDir, 'src/app.ts', 'tracked');

            await expect(listTrackedPaths(rootDir, ['generated/'])).resolves.toEqual([
                'src/app.ts'
            ]);
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    test('normalizes Windows-style custom ignore patterns before matching', async () => {
        const rootDir = await createTempWorkspace();

        try {
            // 用户可能从 Windows 视角输入反斜杠路径，resolver 需要先规范化再匹配。
            await writeFile(rootDir, 'generated/code.ts', 'ignored');
            await writeFile(rootDir, 'src/app.ts', 'tracked');

            await expect(listTrackedPaths(rootDir, ['generated\\'])).resolves.toEqual([
                'src/app.ts'
            ]);
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });

    test('treats unreadable gitignore files as having no local rules', async () => {
        const rootDir = await createTempWorkspace();

        try {
            // 把 `.gitignore` 做成目录来模拟“该路径不可作为规则文件读取”的场景。
            await fs.mkdir(path.join(rootDir, '.gitignore'));
            await writeFile(rootDir, 'target/debug/app.exe', 'binary');

            await expect(listTrackedPaths(rootDir)).resolves.toEqual([
                'target/debug/app.exe'
            ]);
        } finally {
            await fs.rm(rootDir, { recursive: true, force: true });
        }
    });
});
