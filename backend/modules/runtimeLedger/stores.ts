import * as fs from 'fs/promises';
import * as path from 'path';
import type { RuntimeEventEnvelope, RuntimeLedgerStore } from './types';

export class JsonlRuntimeLedgerStore implements RuntimeLedgerStore {
    private appendQueue: Promise<void> = Promise.resolve();

    constructor(private readonly filePath: string) {}

    append<TPayload>(event: RuntimeEventEnvelope<TPayload>): Promise<void> {
        const write = this.appendQueue
            .catch(() => undefined)
            .then(async () => {
                await fs.mkdir(path.dirname(this.filePath), { recursive: true });
                await fs.appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf-8');
            });
        this.appendQueue = write;
        return write;
    }

    async list<TPayload>(): Promise<RuntimeEventEnvelope<TPayload>[]> {
        let content: string;
        try {
            content = await fs.readFile(this.filePath, 'utf-8');
        } catch (error: any) {
            if (error?.code === 'ENOENT') return [];
            throw error;
        }

        const events: RuntimeEventEnvelope<TPayload>[] = [];
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index].trim();
            if (!line) continue;
            try {
                events.push(JSON.parse(line) as RuntimeEventEnvelope<TPayload>);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`Invalid Runtime Ledger JSONL line ${index + 1}: ${message}`);
            }
        }
        return events;
    }
}
