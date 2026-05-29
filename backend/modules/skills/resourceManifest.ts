import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export type SkillResourceKind = 'script' | 'reference' | 'asset' | 'other';

export interface SkillResourceManifestItem {
    skillUri: string;
    relativePath: string;
    kind: SkillResourceKind;
    size: number;
    sha256: string;
    maybeExecutable: boolean;
    textReadable: boolean;
    truncatedReason?: string;
}

export interface ResolvedSkillResource {
    relativePath: string;
    absolutePath: string;
    realPath: string;
    stat: fs.Stats;
    sha256: string;
}

const MAX_MANIFEST_ITEMS = 200;
const MAX_RESOURCE_SIZE = 5 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
    '.md', '.markdown', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.xml', '.html', '.htm', '.css',
    '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
    '.csv', '.tsv', '.sql', '.ini', '.conf', '.cfg', '.dockerfile'
]);

const EXECUTABLE_EXTENSIONS = new Set(['.py', '.js', '.mjs', '.cjs', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd']);
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__']);
const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.crt', '.cer']);
const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', '.npmrc', '.pypirc', 'id_rsa', 'id_ed25519']);
const WINDOWS_DEVICE_NAMES = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9']);

export function createSkillUri(skillName: string, relativePath = ''): string {
    const encodedName = encodeURIComponent(skillName);
    const normalized = relativePath ? normalizeSkillRelativePath(relativePath) : '';
    return normalized ? `skill://${encodedName}/${normalized.split('/').map(encodeURIComponent).join('/')}` : `skill://${encodedName}/`;
}

export function canonicalizeSkillRoot(basePath: string): string {
    const real = fs.realpathSync(basePath);
    return path.resolve(real);
}

export function normalizeSkillRelativePath(input: string): string {
    if (typeof input !== 'string') throw new Error('relativePath must be a string');
    const trimmed = input.trim();
    if (!trimmed) throw new Error('relativePath is required');
    if (trimmed.includes('\0')) throw new Error('relativePath contains NUL byte');
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) throw new Error('relativePath must not be a URI or drive path');
    if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) throw new Error('relativePath must not be a UNC path');
    if (path.isAbsolute(trimmed)) throw new Error('relativePath must not be absolute');

    const slashPath = trimmed.replace(/\\/g, '/');
    const normalized = path.posix.normalize(slashPath);
    if (!normalized || normalized === '.') throw new Error('relativePath is empty after normalization');
    if (normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
        throw new Error('relativePath must not escape the skill directory');
    }
    if (normalized.startsWith('/')) throw new Error('relativePath must stay relative');

    for (const segment of normalized.split('/')) {
        if (!segment || segment === '.' || segment === '..') throw new Error('relativePath contains invalid path segment');
        const lower = segment.toLowerCase();
        if (WINDOWS_DEVICE_NAMES.has(lower.replace(/\..*$/, ''))) {
            throw new Error(`relativePath contains reserved device name: ${segment}`);
        }
    }

    return normalized;
}

export function getResourceKind(relativePath: string): SkillResourceKind {
    const first = relativePath.split('/')[0];
    if (first === 'scripts') return 'script';
    if (first === 'references') return 'reference';
    if (first === 'assets') return 'asset';
    return 'other';
}

export function isTextReadable(relativePath: string, size: number): boolean {
    if (size > MAX_RESOURCE_SIZE) return false;
    const lower = path.posix.basename(relativePath).toLowerCase();
    if (lower === 'dockerfile') return true;
    const ext = path.posix.extname(lower);
    if (TEXT_EXTENSIONS.has(ext)) return true;
    // 为什么要改：.env.example 过去在 text-readable 规则里放行，但 isExcludedName 会先排除所有 dotfile。
    // 怎么改：以安全优先的 dotfile 排除为准，不再把 .env.example 标成可读候选。
    // 目的：消除 manifest 策略自相矛盾，避免用户误以为环境文件会进入模型可读清单。
    return false;
}

export function isMaybeExecutable(relativePath: string, stat: fs.Stats): boolean {
    const ext = path.posix.extname(relativePath).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(ext)) return true;
    if (process.platform !== 'win32' && (stat.mode & 0o111) !== 0) return true;
    return false;
}

function isExcludedName(name: string): boolean {
    const lower = name.toLowerCase();
    if (name.startsWith('.')) return true;
    if (SENSITIVE_NAMES.has(lower)) return true;
    if (SENSITIVE_EXTENSIONS.has(path.extname(lower))) return true;
    return false;
}

function isInside(parent: string, child: string): boolean {
    const rel = path.relative(parent, child);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

export async function hashFile(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', resolve);
    });
    return hash.digest('hex');
}

export async function resolveSkillResource(canonicalBasePath: string, relativePath: string): Promise<ResolvedSkillResource> {
    const normalized = normalizeSkillRelativePath(relativePath);
    const base = canonicalizeSkillRoot(canonicalBasePath);

    let cursor = base;
    const segments = normalized.split('/');
    for (const segment of segments) {
        cursor = path.join(cursor, segment);
        const lst = await fs.promises.lstat(cursor);
        if (lst.isSymbolicLink()) {
            throw new Error(`Skill resource path contains a symlink/reparse point: ${normalized}`);
        }
    }

    const real = path.resolve(await fs.promises.realpath(cursor));
    if (!isInside(base, real)) {
        throw new Error(`Skill resource escapes skill directory: ${normalized}`);
    }

    const stat = await fs.promises.stat(real);
    if (!stat.isFile()) {
        throw new Error(`Skill resource is not a regular file: ${normalized}`);
    }
    if (stat.size > MAX_RESOURCE_SIZE) {
        throw new Error(`Skill resource exceeds size limit: ${normalized}`);
    }

    return {
        relativePath: normalized,
        absolutePath: path.join(base, ...segments),
        realPath: real,
        stat,
        sha256: await hashFile(real)
    };
}

function extractMarkdownLinks(body: string): string[] {
    const result: string[] = [];
    const regex = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)\s]+)?(?:\s+"[^"]*")?\)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
        const target = match[1].trim();
        if (!target || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || target.startsWith('#')) continue;
        result.push(target);
    }
    return result;
}

async function addManifestItem(skillName: string, canonicalBasePath: string, relativePath: string, items: Map<string, SkillResourceManifestItem>): Promise<void> {
    if (items.size >= MAX_MANIFEST_ITEMS) return;

    let normalized: string;
    try {
        normalized = normalizeSkillRelativePath(relativePath);
    } catch {
        return;
    }

    const basename = path.posix.basename(normalized);
    if (isExcludedName(basename)) return;
    if (normalized.split('/').some(part => EXCLUDED_DIRS.has(part))) return;

    try {
        const resolved = await resolveSkillResource(canonicalBasePath, normalized);
        const kind = getResourceKind(normalized);
        items.set(normalized, {
            skillUri: createSkillUri(skillName, normalized),
            relativePath: normalized,
            kind,
            size: resolved.stat.size,
            sha256: resolved.sha256,
            maybeExecutable: kind === 'script' && isMaybeExecutable(normalized, resolved.stat),
            textReadable: isTextReadable(normalized, resolved.stat.size)
        });
    } catch {
        // Invalid resources are intentionally skipped from model-visible manifest.
    }
}

export async function buildSkillResourceManifest(skillName: string, canonicalBasePath: string, skillBody: string): Promise<SkillResourceManifestItem[]> {
    const items = new Map<string, SkillResourceManifestItem>();

    for (const link of extractMarkdownLinks(skillBody)) {
        await addManifestItem(skillName, canonicalBasePath, link, items);
    }

    for (const dir of ['scripts', 'references', 'assets']) {
        const absDir = path.join(canonicalBasePath, dir);
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(absDir, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (items.size >= MAX_MANIFEST_ITEMS) break;
            if (!entry.isFile()) continue;
            if (isExcludedName(entry.name)) continue;
            await addManifestItem(skillName, canonicalBasePath, `${dir}/${entry.name}`, items);
        }
    }

    const list = Array.from(items.values()).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    if (items.size >= MAX_MANIFEST_ITEMS) {
        list.push({
            skillUri: createSkillUri(skillName, '__truncated__'),
            relativePath: '__truncated__',
            kind: 'other',
            size: 0,
            sha256: '',
            maybeExecutable: false,
            textReadable: false,
            truncatedReason: `Resource manifest limited to ${MAX_MANIFEST_ITEMS} entries`
        });
    }
    return list;
}
