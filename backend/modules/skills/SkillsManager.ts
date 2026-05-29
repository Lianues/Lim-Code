/**
 * LimCode - Skills 管理器
 *
 * 负责扫描、解析和管理所有 skills
 * Skills 现在支持从多个目录加载，包括项目级和用户级。
 * 不再使用拼接注入模式，AI 按需通过工具读取 Skill 内容。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Skill, SkillDiagnostic, SkillResourceManifestItem, SkillsChangeEvent, SkillsChangeListener, SkillSource } from './types';
import { parseSkillFrontmatter } from './frontmatter';
import {
    buildSkillResourceManifest,
    canonicalizeSkillRoot,
    createSkillUri,
    resolveSkillResource
} from './resourceManifest';

/**
 * Skills 管理器
 *
 * 功能：
 * 1. 扫描多个 skills 目录（项目级和用户级）
 * 2. 解析 SKILL.md 文件（frontmatter + 正文），带校验
 * 3. 管理 skill 的启用/禁用状态
 * 4. 提供已启用 Skill 的摘要给 read_skill 工具
 * 5. 根据名称查找并返回 Skill 详情
 */
export class SkillsManager {
    /** 所有已加载的 skills (id -> Skill) */
    private skills: Map<string, Skill> = new Map();
    
    /** 已启用的 skill IDs */
    private enabledSkillIds: Set<string> = new Set();

    /**
     * 为什么要加：过去加载失败只写 console，用户、测试与 headless 场景都拿不到原因。
     * 怎么改：在 manager 层集中保存结构化诊断，loaded 与 skipped Skill 都能被查询。
     * 目的：让 UI、formatter、API 和单元测试复用同一套 fatal/warning/info 事实来源。
     */
    private diagnostics: SkillDiagnostic[] = [];
    private diagnosticsBySkillId: Map<string, SkillDiagnostic[]> = new Map();
    private skippedDiagnostics: SkillDiagnostic[] = [];
    
    /** 变更监听器 */
    private listeners: Set<SkillsChangeListener> = new Set();
    
    /**
     * 为什么要改：Skill 来源需要支持插件内置目录，同时删除 legacy 运行时扫描，不能继续用零散字段表达不同来源。
     * 怎么改：把所有运行时来源统一建模为 scanDirs；只读退役来源另放 retiredSkillRoots 做迁移诊断，不参与加载。
     * 目的：未来新增来源只需要添加扫描根，不需要在读取工具、UI 或具体 Skill ID 上写特判。
     */
    private scanDirs: Array<{ path: string; source: SkillSource; readOnly: boolean }> = [];

    /**
     * 为什么要改：旧 globalStoragePath/skills 不能继续作为运行时来源，但直接沉默会让老用户误以为 Skill 丢失。
     * 怎么改：保留只读退役来源列表，只在发现旧 SKILL.md 时记录 warning 诊断，不扫描、不创建、不删除。
     * 目的：提供安全迁移提示，同时彻底切断 legacy 对 read_skill 可用列表的影响。
     */
    private retiredSkillRoots: Array<{ id: string; path: string; suggestedTargetPath: string }> = [];
    
    /** 是否已初始化 */
    private initialized: boolean = false;
    
    constructor(options: { workspacePath?: string; globalStoragePath: string; builtinSkillsPath?: string }) {
        this.buildScanDirs(options);
    }

    /**
     * 构建待扫描的目录列表
     * 按优先级排序（先扫到的优先）
     */
    private buildScanDirs(options: { workspacePath?: string; globalStoragePath: string; builtinSkillsPath?: string }) {
        // 1. 项目级目录 (优先级最高)
        if (options.workspacePath) {
            this.scanDirs.push({ 
                path: path.join(options.workspacePath, '.limcode', 'skills'), 
                source: 'project-limcode',
                readOnly: false
            });
            this.scanDirs.push({ 
                path: path.join(options.workspacePath, '.agents', 'skills'), 
                source: 'project-agents',
                readOnly: false
            });
        }

        // 2. 用户全局目录
        this.scanDirs.push({ 
            path: path.join(os.homedir(), '.limcode', 'skills'), 
            source: 'user-limcode',
            readOnly: false
        });
        this.scanDirs.push({ 
            path: path.join(os.homedir(), '.agents', 'skills'), 
            source: 'user-agents',
            readOnly: false
        });

        // 3. 插件随包内置目录（最低优先级，用户/项目同名 Skill 可以覆盖它）
        if (options.builtinSkillsPath) {
            this.scanDirs.push({
                path: options.builtinSkillsPath,
                source: 'builtin',
                readOnly: true
            });
        }

        // 为什么要改：globalStoragePath/skills 已退役，不能再被扫描或自动创建，但仍需给旧用户一个可见迁移提示。
        // 怎么改：把旧路径登记为 retired root，只由 checkRetiredSkillRoots 做只读检测。
        // 目的：不破坏用户磁盘文件，同时保证旧目录不再影响模型可用 Skill 列表。
        this.retiredSkillRoots.push({
            id: 'legacy-global-storage-skills',
            path: path.join(options.globalStoragePath, 'skills'),
            suggestedTargetPath: path.join(os.homedir(), '.limcode', 'skills')
        });
    }
    
    /**
     * 初始化 Skills 管理器
     *
     * 扫描所有运行时 Skill 来源，并对退役来源做只读迁移诊断
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        
        // 为什么要改：legacy 目录已退役，初始化不能再创建或扫描 globalStoragePath/skills。
        // 怎么改：直接刷新运行时扫描根；旧目录只在 refresh 内通过只读诊断检测。
        // 目的：让内置 Skill 成为默认兜底来源，同时避免继续污染用户 globalStorage。
        await this.refresh();
        
        this.initialized = true;
    }
    
    /**
     * 获取第一个用户级目录路径（用于打开目录功能）
     */
    getSkillsDirectory(): string {
        const userDir = this.scanDirs.find(d => d.source === 'user-limcode');
        // 为什么要改：legacy 路径已经退役，打开目录功能不能再回退到 globalStoragePath/skills。
        // 怎么改：优先复用扫描根中的 user-limcode；极端情况下显式回退到标准用户目录。
        // 目的：引导用户把自定义 Skill 放到长期支持的用户目录，而不是旧插件存储目录。
        return userDir ? userDir.path : path.join(os.homedir(), '.limcode', 'skills');
    }
    
    /**
     * 刷新 skills 列表
     *
     * 重新扫描所有配置的目录并加载 skills
     */
    async refresh(): Promise<void> {
        this.skills.clear();
        this.diagnostics = [];
        this.diagnosticsBySkillId.clear();
        this.skippedDiagnostics = [];
        
        for (const dirInfo of this.scanDirs) {
            await this.scanDirectory(dirInfo.path, dirInfo.source);
        }

        await this.checkRetiredSkillRoots();
        
        // 通知监听器
        this.notifyChange({
            type: 'refresh',
            skillIds: Array.from(this.skills.keys())
        });
    }

    /**
     * 扫描单个目录并加载 skills
     */
    private async scanDirectory(dirPath: string, source: SkillSource): Promise<void> {
        try {
            if (!fs.existsSync(dirPath)) {
                return;
            }
            
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    // 如果已存在同名 Skill (id 相同)，由于 scanDirs 顺序决定了优先级，后扫到的跳过。
                    // 为什么要改：旧逻辑直接 continue，用户无法知道低优先级 Skill 被 shadow。
                    // 怎么改：保留优先级行为，但记录 warning 诊断供 UI/headless 查询。
                    // 目的：不改变运行时选择规则，同时让冲突排障可见。
                    if (this.skills.has(entry.name)) {
                        this.recordSkippedDiagnostic({
                            severity: 'warning',
                            code: 'skill-duplicate-shadowed',
                            message: `Skill "${entry.name}" is shadowed by a higher-priority skill with the same id.`,
                            skillId: entry.name,
                            filePath: path.join(dirPath, entry.name, 'SKILL.md'),
                            source
                        });
                        continue;
                    }

                    const skillFile = path.join(dirPath, entry.name, 'SKILL.md');
                    if (fs.existsSync(skillFile)) {
                        try {
                            const skill = await this.loadSkill(entry.name, skillFile, source);
                            if (skill) {
                                this.skills.set(skill.id, skill);
                            }
                        } catch (error) {
                            console.warn(`[SkillsManager] Failed to load skill ${entry.name} from ${source}:`, error);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`[SkillsManager] Failed to scan directory ${dirPath}:`, error);
        }
    }

    private async checkRetiredSkillRoots(): Promise<void> {
        // 为什么要改：删除 legacy 运行时扫描后，旧用户目录里的 SKILL.md 不能再被模型读取，但用户仍需要迁移提示。
        // 怎么改：只读遍历 retired roots，发现子目录含 SKILL.md 时记录 warning；不调用 loadSkill，不创建目录，不复制文件。
        // 目的：把“停止使用旧来源”和“不破坏用户文件”两个约束同时固定在 loader 层。
        for (const root of this.retiredSkillRoots) {
            let entries: fs.Dirent[];
            try {
                if (!fs.existsSync(root.path)) continue;
                entries = await fs.promises.readdir(root.path, { withFileTypes: true });
            } catch (error) {
                this.recordSkippedDiagnostic({
                    severity: 'warning',
                    code: 'retired-skill-root-unreadable',
                    message: `Retired Skill root "${root.id}" could not be inspected. No skills were loaded from this path.`,
                    filePath: root.path
                });
                continue;
            }

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const skillFile = path.join(root.path, entry.name, 'SKILL.md');
                if (!fs.existsSync(skillFile)) continue;
                this.recordSkippedDiagnostic({
                    severity: 'warning',
                    code: 'legacy-directory-detected',
                    message: `Legacy Skill "${entry.name}" was found in retired root "${root.id}" and was not loaded. Move it to ${root.suggestedTargetPath} or a project .limcode/skills directory to use it again.`,
                    skillId: entry.name,
                    filePath: skillFile
                });
            }
        }
    }
    
    private createSkillDiagnostic(
        id: string,
        filePath: string,
        source: SkillSource,
        diagnostic: Pick<SkillDiagnostic, 'severity' | 'code' | 'message' | 'field'>
    ): SkillDiagnostic {
        return { ...diagnostic, skillId: id, filePath, source };
    }

    private recordDiagnostic(diagnostic: SkillDiagnostic): void {
        this.diagnostics.push(diagnostic);
        if (diagnostic.skillId) {
            const current = this.diagnosticsBySkillId.get(diagnostic.skillId) || [];
            current.push(diagnostic);
            this.diagnosticsBySkillId.set(diagnostic.skillId, current);
        }
    }

    private recordSkillDiagnostics(id: string, diagnostics: SkillDiagnostic[]): void {
        for (const diagnostic of diagnostics) {
            this.recordDiagnostic({ ...diagnostic, skillId: diagnostic.skillId || id });
        }
    }

    private recordSkippedDiagnostic(diagnostic: SkillDiagnostic): void {
        this.skippedDiagnostics.push(diagnostic);
        this.recordDiagnostic(diagnostic);
    }

    private recordSkippedDiagnostics(diagnostics: SkillDiagnostic[]): void {
        for (const diagnostic of diagnostics) {
            this.recordSkippedDiagnostic(diagnostic);
        }
    }

    private createExtraFieldDiagnostics(id: string, filePath: string, source: SkillSource, extras: Record<string, unknown> | undefined): SkillDiagnostic[] {
        if (!extras) return [];
        return Object.keys(extras).map(field => this.createSkillDiagnostic(id, filePath, source, {
            // 为什么要改：跨生态字段必须可见，但不能因为被识别就改变 LimCode 的发现或权限行为。
            // 怎么改：所有非 name/description 字段统一记录为 metadata 诊断；version 这种规范位置问题升级为 warning。
            // 目的：教育用户字段兼容状态，同时冻结核心语义只来自 name/description。
            severity: field === 'version' ? 'warning' : 'info',
            code: field === 'version' ? 'skill-version-should-be-metadata' : 'skill-field-preserved-as-metadata',
            field,
            message: field === 'version'
                ? 'Top-level version is preserved, but metadata.version is preferred by Agent Skills compatible formats.'
                : `Frontmatter field "${field}" is preserved as metadata and is not used by LimCode for discovery, tool permissions, or script execution.`
        }));
    }

    /**
     * 加载单个 skill
     *
     * @param id Skill ID（文件夹名称）
     * @param filePath SKILL.md 文件路径
     * @param source 来源
     */
    private async loadSkill(id: string, filePath: string, source: SkillSource): Promise<Skill | null> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const parsed = parseSkillFrontmatter(content, { filePath, source, skillId: id });
            const parseFatal = parsed.diagnostics.filter(d => d.severity === 'fatal');
            if (parseFatal.length > 0) {
                this.recordSkippedDiagnostics(parseFatal);
                console.warn(`[SkillsManager] Skill ${id} frontmatter parse failed:`, parseFatal.map(d => d.message).join('; '));
                return null;
            }
            
            const { frontmatter, body } = parsed;
            if (!frontmatter.name) {
                const diagnostic = this.createSkillDiagnostic(id, filePath, source, {
                    severity: 'fatal',
                    code: 'skill-missing-name',
                    field: 'name',
                    message: `Skill ${id} missing required frontmatter field: name.`
                });
                this.recordSkippedDiagnostic(diagnostic);
                console.warn(`[SkillsManager] Skill ${id} missing required frontmatter field: name`);
                return null;
            }
            if (!frontmatter.description) {
                const diagnostic = this.createSkillDiagnostic(id, filePath, source, {
                    severity: 'fatal',
                    code: 'skill-missing-description',
                    field: 'description',
                    message: `Skill ${id} missing required frontmatter field: description.`
                });
                this.recordSkippedDiagnostic(diagnostic);
                console.warn(`[SkillsManager] Skill ${id} missing required frontmatter field: description`);
                return null;
            }

            // 新增：frontmatter 中的 name 必须与 id (文件夹名) 一致。
            // 为什么要改：旧行为只 console.warn，UI/headless 无法知道 Skill 为何消失。
            // 怎么改：保留跳过行为，但记录 fatal 诊断。
            // 目的：严格保持目录名即 Skill id 的跨生态约束，同时让修复建议可见。
            if (frontmatter.name !== id) {
                const diagnostic = this.createSkillDiagnostic(id, filePath, source, {
                    severity: 'fatal',
                    code: 'skill-name-mismatch',
                    field: 'name',
                    message: `Frontmatter name "${frontmatter.name}" does not match folder name "${id}".`
                });
                this.recordSkippedDiagnostic(diagnostic);
                console.warn(`[SkillsManager] Skill ${id} name mismatch: frontmatter name "${frontmatter.name}" does not match folder name "${id}". Skipping.`);
                return null;
            }

            // 新增：name 格式校验
            const nameRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
            if (!nameRegex.test(frontmatter.name) || frontmatter.name.length > 64 || frontmatter.name.includes('--')) {
                const diagnostic = this.createSkillDiagnostic(id, filePath, source, {
                    severity: 'fatal',
                    code: 'skill-invalid-name',
                    field: 'name',
                    message: `Skill name "${frontmatter.name}" must be 1-64 chars, lowercase, digits, and hyphens only, with no consecutive hyphens.`
                });
                this.recordSkippedDiagnostic(diagnostic);
                console.warn(`[SkillsManager] Skill ${id} name "${frontmatter.name}" is invalid. Must be 1-64 chars, lowercase, digits, and hyphens only, no consecutive hyphens. Skipping.`);
                return null;
            }

            this.recordSkillDiagnostics(id, [
                ...parsed.diagnostics.filter(d => d.severity !== 'fatal'),
                ...this.createExtraFieldDiagnostics(id, filePath, source, frontmatter.extras)
            ]);
            
            const basePath = path.dirname(filePath);
            const canonicalBasePath = canonicalizeSkillRoot(basePath);
            const trimmedBody = body.trim();
            const resources = await buildSkillResourceManifest(frontmatter.name, canonicalBasePath, trimmedBody);

            return {
                id,
                name: frontmatter.name,
                description: frontmatter.description,
                content: trimmedBody,
                path: filePath,
                basePath,
                canonicalBasePath,
                skillUri: createSkillUri(frontmatter.name),
                resources,
                extras: frontmatter.extras,
                source,
                enabled: this.enabledSkillIds.has(id),
                sendContent: false // Deprecated 模式下不再使用拼接
            };
        } catch (error: any) {
            const diagnostic = this.createSkillDiagnostic(id, filePath, source, {
                severity: 'fatal',
                code: 'skill-load-error',
                message: error?.message || `Failed to load skill ${id}.`
            });
            this.recordSkippedDiagnostic(diagnostic);
            console.error(`[SkillsManager] Failed to load skill ${id}:`, error);
            return null;
        }
    }

    getSkillRootPaths(): string[] {
        // 为什么要改：execute_command 需要阻止直接访问所有 Skill 文件系统区域；只返回已加载 Skill 会漏掉被 shadow 的 builtin 目录。
        // 怎么改：合并已加载 Skill 根目录与所有运行时扫描根，存在的路径同时加入 realpath 和 resolve 形态，缺失路径用 resolve 兜底。
        // 目的：即使 builtin Skill 被项目同名 Skill 覆盖，模型也不能绕过 manifest/hash 直接用 shell 读取 resources/skills。
        const roots = new Set<string>();
        for (const skill of this.skills.values()) {
            roots.add(skill.canonicalBasePath || skill.basePath);
        }
        for (const dir of this.scanDirs) {
            roots.add(path.resolve(dir.path));
            try {
                if (fs.existsSync(dir.path)) {
                    roots.add(canonicalizeSkillRoot(dir.path));
                }
            } catch {
                // 目录不存在或 realpath 失败时，resolve 形态已经足够保护命令文本中的显式路径。
            }
        }
        return Array.from(roots).filter(Boolean);
    }

    async resolveManifestResource(
        name: string,
        relativePath: string,
        options?: { requireTextReadable?: boolean; requireScript?: boolean }
    ): Promise<
        | {
            ok: true;
            skill: Skill;
            item: SkillResourceManifestItem;
            realPath: string;
            currentSha256: string;
            readText: () => Promise<string>;
        }
        | { ok: false; error: string }
    > {
        const skill = this.getSkillByName(name);
        if (!skill) return { ok: false, error: `Skill not found: "${name}".` };
        if (!skill.enabled) return { ok: false, error: `Skill "${name}" is disabled by user.` };

        let normalized: string;
        try {
            normalized = relativePath.replace(/\\/g, '/');
        } catch {
            return { ok: false, error: 'Invalid relativePath.' };
        }

        const item = skill.resources.find(r => r.relativePath === normalized);
        if (!item) {
            return { ok: false, error: `Skill resource is not in the manifest: ${relativePath}` };
        }
        if (options?.requireTextReadable && !item.textReadable) {
            return { ok: false, error: `Skill resource is not text-readable: ${relativePath}` };
        }
        if (options?.requireScript && !(item.kind === 'script' && item.maybeExecutable)) {
            return { ok: false, error: `Skill resource is not an executable script: ${relativePath}` };
        }

        try {
            const resolved = await resolveSkillResource(skill.canonicalBasePath, item.relativePath);
            if (resolved.sha256 !== item.sha256) {
                return { ok: false, error: `Skill resource changed after manifest creation: ${item.relativePath}. Refresh skills and ask for confirmation again.` };
            }
            return {
                ok: true,
                skill,
                item,
                realPath: resolved.realPath,
                currentSha256: resolved.sha256,
                readText: async () => fs.promises.readFile(resolved.realPath, 'utf-8')
            };
        } catch (error: any) {
            return { ok: false, error: error?.message || `Failed to resolve skill resource: ${relativePath}` };
        }
    }
    
    /**
     * 获取所有已加载的 skills
     */
    getAllSkills(): Skill[] {
        return Array.from(this.skills.values());
    }

    getDiagnostics(): SkillDiagnostic[] {
        // 为什么要加：诊断不能只存在于前端或 console，否则 CLI/headless/API 无法解释 Skill 缺失。
        // 怎么改：暴露 manager 级完整诊断副本，包含 loaded 的 warning/info 与 skipped 的 fatal/warning。
        // 目的：让 UI、测试和未来命令入口复用同一份结构化事实。
        return [...this.diagnostics];
    }

    getLoadReport(): { loaded: Array<{ skill: Skill; diagnostics: SkillDiagnostic[] }>; skipped: SkillDiagnostic[] } {
        // 为什么要加：前端需要同时展示成功加载的 Skill 与被跳过 Skill 的原因。
        // 怎么改：把 loaded skill 与自身诊断绑定返回，skipped 返回未加载目录的诊断。
        // 目的：满足用户“为什么没加载”的排障闭环，同时不泄露给模型本地绝对路径。
        return {
            loaded: Array.from(this.skills.values()).map(skill => ({
                skill,
                diagnostics: [...(this.diagnosticsBySkillId.get(skill.id) || [])]
            })),
            skipped: [...this.skippedDiagnostics]
        };
    }
    
    /**
     * 获取指定 skill
     */
    getSkill(id: string): Skill | undefined {
        return this.skills.get(id);
    }

    /**
     * 按名称获取 Skill (用于 read_skill 工具)
     * 注意：AI 可能在知道已禁用的情况下尝试读取，我们需要返回对象以便 read_skill 处理提示语。
     */
    getSkillByName(name: string): Skill | undefined {
        return Array.from(this.skills.values()).find(s => s.name === name);
    }

    /**
     * 获取所有已启用 Skill 的摘要信息
     */
    getSkillSummaries(): Array<{ name: string; description: string }> {
        return this.getEnabledSkills().map(s => ({ 
            name: s.name, 
            description: s.description 
        }));
    }
    
    /**
     * 获取已启用的 skills
     */
    getEnabledSkills(): Skill[] {
        return Array.from(this.skills.values()).filter(skill => this.enabledSkillIds.has(skill.id));
    }
    
    /**
     * 检查 skill 是否启用
     */
    isSkillEnabled(id: string): boolean {
        return this.enabledSkillIds.has(id);
    }
    
    /**
     * 启用 skill
     */
    enableSkill(id: string): boolean {
        if (!this.skills.has(id)) {
            return false;
        }
        
        if (!this.enabledSkillIds.has(id)) {
            this.enabledSkillIds.add(id);
            
            const skill = this.skills.get(id);
            if (skill) {
                skill.enabled = true;
            }
            
            this.notifyChange({
                type: 'enabled',
                skillIds: [id]
            });
        }
        
        return true;
    }
    
    /**
     * 禁用 skill
     */
    disableSkill(id: string): boolean {
        if (this.enabledSkillIds.has(id)) {
            this.enabledSkillIds.delete(id);
            
            const skill = this.skills.get(id);
            if (skill) {
                skill.enabled = false;
            }
            
            this.notifyChange({
                type: 'disabled',
                skillIds: [id]
            });
            
            return true;
        }
        
        return false;
    }
    
    /**
     * 批量设置 skills 状态
     */
    setSkillsState(skillStates: Record<string, boolean>): void {
        const changedIds: string[] = [];
        
        for (const [id, enabled] of Object.entries(skillStates)) {
            if (!this.skills.has(id)) {
                continue;
            }
            
            const currentlyEnabled = this.enabledSkillIds.has(id);
            
            if (enabled && !currentlyEnabled) {
                this.enabledSkillIds.add(id);
                const skill = this.skills.get(id);
                if (skill) skill.enabled = true;
                changedIds.push(id);
            } else if (!enabled && currentlyEnabled) {
                this.enabledSkillIds.delete(id);
                const skill = this.skills.get(id);
                if (skill) skill.enabled = false;
                changedIds.push(id);
            }
        }
        
        if (changedIds.length > 0) {
            this.notifyChange({ type: 'update', skillIds: changedIds });
        }
    }
    
    /**
     * 禁用所有 skills
     */
    disableAllSkills(): void {
        const disabledIds = Array.from(this.enabledSkillIds);
        
        for (const id of disabledIds) {
            const skill = this.skills.get(id);
            if (skill) {
                skill.enabled = false;
            }
        }
        
        this.enabledSkillIds.clear();
        
        if (disabledIds.length > 0) {
            this.notifyChange({ type: 'disabled', skillIds: disabledIds });
        }
    }
    
    /**
     * 添加变更监听器
     */
    addChangeListener(listener: SkillsChangeListener): void {
        this.listeners.add(listener);
    }
    
    /**
     * 移除变更监听器
     */
    removeChangeListener(listener: SkillsChangeListener): void {
        this.listeners.delete(listener);
    }
    
    /**
     * 通知变更
     */
    private notifyChange(event: SkillsChangeEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('[SkillsManager] Listener error:', error);
            }
        }
    }
    
    /**
     * 获取 skills 数量
     */
    getSkillsCount(): number {
        return this.skills.size;
    }
    
    /**
     * 获取启用的 skills 数量
     */
    getEnabledSkillsCount(): number {
        // 为什么要改：refresh 后已删除或加载失败的 id 仍可能留在 enabledSkillIds，旧计数会虚高。
        // 怎么改：只统计当前已加载且启用的 Skill。
        // 目的：让 UI badge 和工具声明计数反映真实可用 Skill，而不破坏“同 id 重新出现时继承启用状态”的配置语义。
        return this.getEnabledSkills().length;
    }
    
    /**
     * 释放资源
     */
    dispose(): void {
        this.listeners.clear();
    }
}

// 全局实例
let globalSkillsManager: SkillsManager | null = null;

/**
 * 获取全局 SkillsManager 实例
 */
export function getSkillsManager(): SkillsManager | null {
    return globalSkillsManager;
}

/**
 * 设置全局 SkillsManager 实例
 */
export function setSkillsManager(manager: SkillsManager): void {
    globalSkillsManager = manager;
}

/**
 * 创建并初始化 SkillsManager
 *
 * @param options 初始化选项，包含工作区路径和全局存储路径
 */
export async function createSkillsManager(options: {
    workspacePath?: string;
    globalStoragePath: string;
    /**
     * 为什么要加：插件随包内置 Skill 需要由宿主在运行时提供扩展安装目录下的资源路径。
     * 怎么改：把 builtinSkillsPath 作为普通扫描根配置传入 SkillsManager，而不是在 manager 内硬编码 VS Code extensionPath。
     * 目的：让 loader 保持平台无关，测试也能用临时目录构造内置 Skill 来源。
     */
    builtinSkillsPath?: string;
}): Promise<SkillsManager> {
    const manager = new SkillsManager(options);
    await manager.initialize();
    setSkillsManager(manager);
    return manager;
}
