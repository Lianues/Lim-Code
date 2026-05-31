/**
 * LimCode - Runtime registries
 *
 * 修改原因：事件总账不能退化为一个开放字符串总线；operation、event 和 payload schema 必须有可审计注册入口。
 * 修改方式：提供内存 registry 与运行时校验，先覆盖合同测试，再逐步接入真实 producer。
 * 修改目的：让后续迁移能证明每类事件有 owner、schemaVersion、persistence 和 payload 约束。
 */

import type {
    RuntimeEventDefinition,
    RuntimeEventDraft,
    RuntimeOperationDefinition,
    RuntimeSchemaDefinition
} from './types';

export class RuntimeSchemaRegistry {
    private readonly schemas = new Map<string, RuntimeSchemaDefinition<any>>();

    register<TPayload>(schema: RuntimeSchemaDefinition<TPayload>): void {
        const key = this.createKey(schema.name, schema.version);
        if (this.schemas.has(key)) {
            throw new Error(`Runtime schema already registered: ${key}`);
        }
        this.schemas.set(key, schema);
    }

    get<TPayload>(name: string, version: number): RuntimeSchemaDefinition<TPayload> {
        const key = this.createKey(name, version);
        const schema = this.schemas.get(key);
        if (!schema) throw new Error(`Runtime schema is not registered: ${key}`);
        return schema;
    }

    validate<TPayload>(schema: RuntimeSchemaDefinition<TPayload>, payload: TPayload): void {
        this.get(schema.name, schema.version);
        schema.validate?.(payload);
    }

    private createKey(name: string, version: number): string {
        return `${name}@${version}`;
    }
}

export class RuntimeEventRegistry {
    private readonly events = new Map<string, RuntimeEventDefinition<any>>();

    constructor(private readonly schemaRegistry: RuntimeSchemaRegistry) {}

    register<TPayload>(definition: RuntimeEventDefinition<TPayload>): void {
        if (this.events.has(definition.eventType)) {
            throw new Error(`Runtime event already registered: ${definition.eventType}`);
        }
        this.schemaRegistry.register(definition.schema);
        this.events.set(definition.eventType, definition);
    }

    get<TPayload>(eventType: string): RuntimeEventDefinition<TPayload> {
        const definition = this.events.get(eventType);
        if (!definition) throw new Error(`Runtime event is not registered: ${eventType}`);
        return definition;
    }

    validateDraft<TPayload>(draft: RuntimeEventDraft<TPayload>): void {
        const definition = this.get<TPayload>(draft.eventType);
        if (definition.kind !== draft.kind) throw new Error(`Runtime event kind mismatch for ${draft.eventType}`);
        if (definition.context !== draft.context) throw new Error(`Runtime event context mismatch for ${draft.eventType}`);
        if (definition.subject !== draft.subject) throw new Error(`Runtime event subject mismatch for ${draft.eventType}`);
        if (definition.persistence !== draft.persistence) throw new Error(`Runtime event persistence mismatch for ${draft.eventType}`);
        this.schemaRegistry.validate(definition.schema, draft.payload as TPayload);
    }
}

export class RuntimeOperationRegistry {
    private readonly operations = new Map<string, RuntimeOperationDefinition<any>>();

    constructor(private readonly schemaRegistry: RuntimeSchemaRegistry) {}

    register<TPayload>(definition: RuntimeOperationDefinition<TPayload>): void {
        if (this.operations.has(definition.operationId)) {
            throw new Error(`Runtime operation already registered: ${definition.operationId}`);
        }
        this.schemaRegistry.register(definition.schema);
        this.operations.set(definition.operationId, definition);
    }

    get<TPayload>(operationId: string): RuntimeOperationDefinition<TPayload> {
        const definition = this.operations.get(operationId);
        if (!definition) throw new Error(`Runtime operation is not registered: ${operationId}`);
        return definition;
    }
}

export function createRuntimeSchema<TPayload>(
    name: string,
    version: number,
    validate?: (payload: TPayload) => void
): RuntimeSchemaDefinition<TPayload> {
    return { name, version, validate };
}
