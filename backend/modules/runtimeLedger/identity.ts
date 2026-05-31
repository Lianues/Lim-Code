/**
 * LimCode - Runtime identity registry
 *
 * 修改原因：新事件系统的核心身份必须由后端统一生成和校验，不能由前端 fallback 拼凑。
 * 修改方式：提供带前缀的 ID 工厂和注册校验器，测试可注入 clock/random 保持确定性。
 * 修改目的：为 eventId、messageId、contentId、toolInvocationId 等运行时身份提供单一入口。
 */

export type RuntimeIdentityKind =
    | 'event'
    | 'command'
    | 'conversation'
    | 'run'
    | 'message'
    | 'content'
    | 'floor'
    | 'toolInvocation'
    | 'functionResponse'
    | 'projection';

const PREFIX_BY_KIND: Record<RuntimeIdentityKind, string> = {
    event: 'rtevt',
    command: 'rtcmd',
    conversation: 'conv',
    run: 'run',
    message: 'msg',
    content: 'cnt',
    floor: 'floor',
    toolInvocation: 'tool',
    functionResponse: 'fnres',
    projection: 'rtproj'
};

export interface RuntimeIdentityRegistryOptions {
    now?: () => number;
    random?: () => string;
}

export class RuntimeIdentityRegistry {
    private readonly issued = new Set<string>();
    private readonly counters = new Map<string, number>();
    private readonly now: () => number;
    private readonly random: () => string;

    constructor(options: RuntimeIdentityRegistryOptions = {}) {
        this.now = options.now ?? (() => Date.now());
        this.random = options.random ?? (() => Math.random().toString(36).slice(2, 10));
    }

    create(kind: RuntimeIdentityKind, scope?: string): string {
        const prefix = PREFIX_BY_KIND[kind];
        const normalizedScope = scope ? `_${this.normalize(scope)}` : '';
        const base = `${prefix}${normalizedScope}_${this.now()}_${this.normalize(this.random())}`;
        const id = this.createUniqueId(base);
        this.register(kind, id);
        return id;
    }

    register(kind: RuntimeIdentityKind, id: string): void {
        const prefix = PREFIX_BY_KIND[kind];
        if (!id || typeof id !== 'string') {
            throw new Error(`Runtime ${kind} id is required`);
        }
        if (!id.startsWith(`${prefix}_`) && !id.startsWith(`${prefix}:`)) {
            throw new Error(`Runtime ${kind} id must start with ${prefix}`);
        }
        if (this.issued.has(id)) {
            throw new Error(`Duplicate runtime ${kind} id: ${id}`);
        }
        this.issued.add(id);
    }

    validate(kind: RuntimeIdentityKind, id: string | undefined): string {
        const prefix = PREFIX_BY_KIND[kind];
        if (!id) throw new Error(`Runtime ${kind} id is required`);
        if (!id.startsWith(`${prefix}_`) && !id.startsWith(`${prefix}:`)) {
            throw new Error(`Runtime ${kind} id must start with ${prefix}`);
        }
        return id;
    }

    private normalize(value: string): string {
        return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'id';
    }

    private createUniqueId(base: string): string {
        if (!this.issued.has(base)) return base;
        const next = (this.counters.get(base) ?? 0) + 1;
        this.counters.set(base, next);
        const candidate = `${base}_${next}`;
        return this.issued.has(candidate) ? this.createUniqueId(base) : candidate;
    }
}
