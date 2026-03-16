/**
 * 模式工具策略
 * 定义不同模式下允许使用的工具和路径规则
 */

/**
 * 检查路径是否允许在指定 LimCode 文档目录下写入
 *
 * 通用拒绝规则：
 * - 不在指定目录下的路径
 * - 绝对路径
 * - 包含路径穿越（..）的路径
 * - 非 .md 扩展名的文件
 * - 空字符串或目录路径
 */
function isScopedMarkdownPathAllowed(path: string, scopeRoot: string): boolean {
    // 空字符串不允许
    if (!path || path.length === 0) {
        return false;
    }

    // 处理 Windows 路径分隔符：将 \ 转换为 /
    const normalizedPath = path.replace(/\\/g, '/');

    // 拒绝绝对路径（以 / 开头）
    if (normalizedPath.startsWith('/')) {
        return false;
    }

    // 防止路径穿越：包含 .. 的一律拒绝
    if (normalizedPath.includes('..')) {
        return false;
    }

    // 必须以指定目录开头
    if (!normalizedPath.startsWith(scopeRoot)) {
        return false;
    }

    // 不能只是目录名（以 / 结尾）
    if (normalizedPath.endsWith('/')) {
        return false;
    }

    // 必须是一个文件路径（不能只是目录本身）
    const relativePath = normalizedPath.substring(scopeRoot.length);
    if (!relativePath || relativePath.length === 0) {
        return false;
    }

    // 仅允许 Markdown 文件
    return relativePath.endsWith('.md');
}

/**
 * 检查路径是否允许在 Plan 模式下写入
 * 
 * 允许的路径：
 * - .limcode/plans/xxx.plan.md
 * - .limcode/plans/sub/xxx.md
 * 
 * 拒绝的路径：
 * - 不在 .limcode/plans/ 下的路径
 * - 绝对路径
 * - 包含路径穿越（..）的路径
 * - 非 .md 或 .plan.md 扩展名的文件
 * - 空字符串或目录路径
 * 
 * @param path 要检查的路径
 * @returns 如果路径允许则返回 true，否则返回 false
 */
export function isPlanPathAllowed(path: string): boolean {
    return isScopedMarkdownPathAllowed(path, '.limcode/plans/');
}

/**
 * 检查路径是否允许在 Design 模式下写入
 *
 * 允许的路径：
 * - .limcode/design/xxx.md
 * - .limcode/design/sub/xxx.md
 *
 * 拒绝的路径：
 * - 不在 .limcode/design/ 下的路径
 * - 绝对路径
 * - 包含路径穿越（..）的路径
 * - 非 .md 扩展名的文件
 * - 空字符串或目录路径
 *
 * @param path 要检查的路径
 * @returns 如果路径允许则返回 true，否则返回 false
 */
export function isDesignPathAllowed(path: string): boolean {
    return isScopedMarkdownPathAllowed(path, '.limcode/design/');
}

/**
 * 获取只读模式下被认为是危险的工具集合
 * 
 * @returns 危险工具名称的 Set
 */
export function getReadonlyModeDangerousTools(): Set<string> {
    return new Set([
        'apply_diff',
        'write_file',
        'delete_file',
        'create_directory',
        'execute_command'
    ]);
}
