import * as fs from 'fs/promises';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';

/**
 * CheckpointIgnoreResolver
 *
 * 职责：
 * - 以标准 `.gitignore` 语义解析检查点的忽略范围
 * - 在遍历工作区时按目录作用域逐层叠加规则
 * - 为快照收集、空目录清理、恢复过滤提供统一的判断入口
 *
 * 设计约束：
 * - 所有相对路径在进入匹配逻辑前都规范化为 POSIX 风格
 * - 嵌套 `.gitignore` 只影响其所在目录子树
 * - 当前模块只关心“检查点应该看到什么”，不负责检查点记录本身
 */
export interface CheckpointSnapshotEntries {
    /** 需要被纳入检查点的文件绝对路径 */
    files: string[];
    /** 需要被纳入检查点的空目录绝对路径 */
    dirs: string[];
}

/**
 * 单个目录作用域对应的一组忽略规则。
 *
 * `basePath` 表示该 `.gitignore` 所在目录相对于根目录的位置，
 * `matcher` 保存该目录本地规则以及根级自定义规则的匹配器。
 */
interface IgnoreScope {
    basePath: string;
    matcher: Ignore;
}

/**
 * 检查点始终强制忽略的目录片段。
 *
 * 这些目录不依赖项目 `.gitignore` 是否显式声明，属于检查点自己的固定边界。
 */
const FORCED_IGNORED_SEGMENTS = new Set(['.git', 'node_modules']);

/**
 * 将检查点内部使用的相对路径统一为稳定格式。
 *
 * 这样做可以避免：
 * - Windows 与 POSIX 分隔符不一致
 * - 重复斜杠导致的路径比较失败
 * - `./foo` / `/foo` / `foo/` 这种等价写法干扰哈希键和匹配逻辑
 */
export function normalizeCheckpointPath(relativePath: string): string {
    return relativePath
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '')
        .replace(/\/$/, '');
}

/**
 * 取得一个相对路径的父目录。
 *
 * 返回空字符串表示“位于根目录作用域”。
 */
function getParentDirectory(relativePath: string): string {
    const normalized = normalizeCheckpointPath(relativePath);
    if (!normalized || !normalized.includes('/')) {
        return '';
    }
    return normalized.slice(0, normalized.lastIndexOf('/'));
}

/**
 * 判断某个候选路径是否位于给定作用域之内。
 *
 * 只有位于同一目录子树中的路径，才应该接受该 `.gitignore` 规则的影响。
 */
function isWithinScope(relativePath: string, scopeBasePath: string): boolean {
    return !scopeBasePath || relativePath === scopeBasePath || relativePath.startsWith(`${scopeBasePath}/`);
}

/**
 * 将“相对于根目录的路径”转换为“相对于某个作用域目录的路径”。
 *
 * `ignore` 库要求传入的是当前 `.gitignore` 所在目录视角下的路径，
 * 因此这里要在进入 matcher 前做一次裁剪。
 */
function toScopedPath(relativePath: string, scopeBasePath: string): string {
    if (!scopeBasePath) {
        return relativePath;
    }
    if (relativePath === scopeBasePath) {
        return '';
    }
    return relativePath.slice(scopeBasePath.length + 1);
}

/**
 * 将一个或多个规则块编译为 `ignore` matcher。
 *
 * 规则块可能来自：
 * - 当前目录的 `.gitignore`
 * - 根目录级别的自定义忽略模式
 */
function createMatcher(patternBlocks: string[]): Ignore | null {
    const nonEmptyBlocks = patternBlocks.filter(block => block.trim().length > 0);
    if (nonEmptyBlocks.length === 0) {
        return null;
    }

    const matcher = ignore();
    for (const block of nonEmptyBlocks) {
        matcher.add(block);
    }
    return matcher;
}

/**
 * 自定义忽略模式来自设置面板，用户可能输入 Windows 风格反斜杠。
 *
 * `ignore` 库以 POSIX 路径语义工作，因此这里只做分隔符规范化，
 * 不改写用户模式的其他含义。
 */
function normalizeExtraPattern(pattern: string): string {
    return pattern.replace(/\\/g, '/');
}

export class CheckpointIgnoreResolver {
    /** 目录作用域缓存，避免同一子树重复加载父级规则链 */
    private readonly scopeCache = new Map<string, IgnoreScope[]>();
    /** 根级自定义忽略模式，统一转换为 POSIX 路径后再参与匹配 */
    private readonly normalizedExtraPatterns: readonly string[];

    constructor(
        private readonly rootDir: string,
        extraPatterns: readonly string[] = []
    ) {
        this.normalizedExtraPatterns = extraPatterns.map(normalizeExtraPattern);
    }

    /**
     * 收集当前根目录下所有需要纳入检查点的文件和空目录。
     *
     * 约定：
     * - 只返回“未被忽略”的路径
     * - 空目录只记录非根目录
     * - 目录一旦被忽略，整棵子树都不会继续遍历
     */
    async collectEntries(
        currentDir: string = this.rootDir,
        result: CheckpointSnapshotEntries = { files: [], dirs: [] }
    ): Promise<CheckpointSnapshotEntries> {
        const relativeDir = currentDir === this.rootDir
            ? ''
            : normalizeCheckpointPath(path.relative(this.rootDir, currentDir));
        const scopes = await this.getScopesForDirectory(relativeDir);

        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });
            let hasTrackedChildren = false;

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                const relativePath = normalizeCheckpointPath(path.relative(this.rootDir, fullPath));

                // 目录作用域已经在本层解析完成，下面只做纯粹的路径过滤。
                if (await this.shouldIgnore(relativePath, entry.isDirectory(), scopes)) {
                    continue;
                }

                hasTrackedChildren = true;

                if (entry.isDirectory()) {
                    await this.collectEntries(fullPath, result);
                } else if (entry.isFile()) {
                    result.files.push(fullPath);
                }
            }

            if (!hasTrackedChildren && currentDir !== this.rootDir) {
                result.dirs.push(currentDir);
            }
        } catch {
            // Ignore unreadable directories to preserve previous checkpoint behavior.
        }

        return result;
    }

    /**
     * 供外部按“当前检查点规则”查询单个路径是否应该忽略。
     *
     * 这个入口让恢复逻辑不必复制任何 ignore 细节，
     * 只依赖 resolver 这一处统一语义来源。
     */
    async isIgnored(relativePath: string, isDirectory: boolean = false): Promise<boolean> {
        return this.shouldIgnore(relativePath, isDirectory);
    }

    /**
     * 递归删除所有未被忽略且已经为空的目录。
     *
     * 这一步主要用于 restore 之后清理工作区中被删除文件留下的空壳目录，
     * 同时确保不会误动当前本来就被忽略的目录树。
     */
    async removeEmptyDirectories(currentDir: string = this.rootDir): Promise<void> {
        const relativeDir = currentDir === this.rootDir
            ? ''
            : normalizeCheckpointPath(path.relative(this.rootDir, currentDir));
        const scopes = await this.getScopesForDirectory(relativeDir);

        try {
            const entries = await fs.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }

                const fullPath = path.join(currentDir, entry.name);
                const relativePath = normalizeCheckpointPath(path.relative(this.rootDir, fullPath));

                if (await this.shouldIgnore(relativePath, true, scopes)) {
                    continue;
                }

                await this.removeEmptyDirectories(fullPath);

                try {
                    const remaining = await fs.readdir(fullPath);
                    if (remaining.length === 0) {
                        await fs.rmdir(fullPath);
                    }
                } catch {
                    // Ignore transient cleanup failures.
                }
            }
        } catch {
            // Ignore unreadable directories to preserve previous cleanup behavior.
        }
    }

    /**
     * 判断一个路径在当前规则链下是否应被忽略。
     *
     * 处理顺序：
     * 1. 先处理检查点自己的强制忽略目录
     * 2. 再按父到子的作用域顺序依次求值
     * 3. 保留 `ignored` / `unignored` 的状态覆盖关系
     */
    private async shouldIgnore(
        relativePath: string,
        isDirectory: boolean,
        directoryScopes?: IgnoreScope[]
    ): Promise<boolean> {
        const normalized = normalizeCheckpointPath(relativePath);
        if (!normalized) {
            return false;
        }

        if (normalized.split('/').some(segment => FORCED_IGNORED_SEGMENTS.has(segment))) {
            return true;
        }

        const scopes = directoryScopes ?? await this.getScopesForDirectory(getParentDirectory(normalized));
        const candidatePath = isDirectory ? `${normalized}/` : normalized;

        let ignored = false;

        // 作用域必须按“从根到当前目录”的顺序计算，后面的规则才能正确覆盖前面。
        for (const scope of scopes) {
            if (!isWithinScope(normalized, scope.basePath)) {
                continue;
            }

            const scopedPath = toScopedPath(candidatePath, scope.basePath);
            const result = scope.matcher.test(scopedPath);

            if (result.ignored) {
                ignored = true;
            } else if (result.unignored) {
                ignored = false;
            }
        }

        return ignored;
    }

    /**
     * 获取某个目录可见的完整作用域链。
     *
     * 返回值包含：
     * - 根目录的规则
     * - 沿途每一级祖先目录的 `.gitignore`
     * - 当前目录自己的 `.gitignore`
     */
    private async getScopesForDirectory(relativeDir: string): Promise<IgnoreScope[]> {
        const normalizedDir = normalizeCheckpointPath(relativeDir);
        const cacheKey = normalizedDir || '';
        const cached = this.scopeCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const parentDir = getParentDirectory(normalizedDir);
        const parentScopes = normalizedDir
            ? await this.getScopesForDirectory(parentDir)
            : [];

        const localScope = await this.loadScope(cacheKey);
        const scopes = localScope
            ? [...parentScopes, localScope]
            : parentScopes;

        this.scopeCache.set(cacheKey, scopes);
        return scopes;
    }

    /**
     * 加载某个目录自己的局部规则。
     *
     * 规则来源：
     * - 当前目录下的 `.gitignore`
     * - 如果是根目录，再额外追加 checkpoint 配置中的自定义忽略模式
     */
    private async loadScope(relativeDir: string): Promise<IgnoreScope | null> {
        const gitignorePath = path.join(this.rootDir, relativeDir, '.gitignore');
        const patternBlocks: string[] = [];

        try {
            patternBlocks.push(await fs.readFile(gitignorePath, 'utf-8'));
        } catch {
            // 对检查点来说，“无法读取本层规则”和“本层没有规则”都等价为不追加局部 matcher。
        }

        if (!relativeDir && this.normalizedExtraPatterns.length > 0) {
            patternBlocks.push(this.normalizedExtraPatterns.join('\n'));
        }

        const matcher = createMatcher(patternBlocks);
        if (!matcher) {
            return null;
        }

        return {
            basePath: relativeDir,
            matcher
        };
    }
}
