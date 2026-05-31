import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  JsonlRuntimeLedgerStore,
  RuntimeEventRegistry,
  RuntimeIdentityRegistry,
  RuntimeLedger,
  RuntimeSchemaRegistry,
  createRuntimeSchema
} from '../../../modules/runtimeLedger';

function createRuntimeLedgerFixture(filePath: string, random: () => string = () => 'fixed') {
  const schemas = new RuntimeSchemaRegistry();
  const events = new RuntimeEventRegistry(schemas);
  events.register({
    eventType: 'runtime.monitor.window_materialized',
    kind: 'domain',
    context: 'monitor',
    subject: 'contentWindow',
    persistence: 'snapshot',
    schema: createRuntimeSchema<{ contentCount: number }>('runtime.monitor.window_materialized', 1, payload => {
      if (typeof payload?.contentCount !== 'number') {
        throw new Error('contentCount is required');
      }
    })
  });

  const ids = new RuntimeIdentityRegistry({
    now: () => 1000,
    random
  });
  const ledger = new RuntimeLedger({
    eventRegistry: events,
    identityRegistry: ids,
    store: new JsonlRuntimeLedgerStore(filePath),
    now: () => 2000
  });

  return { ledger, ids };
}

describe('Runtime Ledger durable store contracts', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'limcode-runtime-ledger-'));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('persists envelopes as JSONL and rehydrates projections from a new ledger instance', async () => {
    const filePath = path.join(rootDir, 'runtime-ledger.jsonl');
    const first = createRuntimeLedgerFixture(filePath);
    const conversationId = first.ids.create('conversation', 'persisted');
    const runId = first.ids.create('run', 'monitor');

    const firstAppend = await first.ledger.append({
      eventType: 'runtime.monitor.window_materialized',
      kind: 'domain',
      context: 'monitor',
      subject: 'contentWindow',
      conversationId,
      runId,
      persistence: 'snapshot',
      payload: { contentCount: 1 },
      coverage: { contentRevision: 1, contentCoveredEventSequence: 1, replayAvailableFrom: 1 }
    });

    const second = createRuntimeLedgerFixture(filePath);
    const projection = await second.ledger.getProjection({ conversationId, runId });
    expect(projection).toMatchObject({
      status: 'ok',
      lastEventSequence: 1,
      eventCountsByType: {
        'runtime.monitor.window_materialized': 1
      }
    });
    await expect(second.ledger.getCoverage({ conversationId, runId })).resolves.toMatchObject({
      eventSequence: 1,
      contentRevision: 1,
      contentCoveredEventSequence: 1,
      replayAvailableFrom: 1,
      replayAvailableTo: 1
    });

    const secondAppend = await second.ledger.append({
      eventType: 'runtime.monitor.window_materialized',
      kind: 'domain',
      context: 'monitor',
      subject: 'contentWindow',
      conversationId,
      runId,
      persistence: 'snapshot',
      payload: { contentCount: 2 },
      coverage: { contentRevision: 2, contentCoveredEventSequence: 2, replayAvailableFrom: 1 }
    });

    expect(secondAppend.event).toMatchObject({
      sequence: 2,
      eventId: 'rtevt_monitor_1000_fixed_1'
    });
    expect(secondAppend.event?.eventId).not.toBe(firstAppend.event?.eventId);

    const reloadedEvents = await new JsonlRuntimeLedgerStore(filePath).list();
    expect(reloadedEvents.map(event => event.sequence)).toEqual([1, 2]);
  });

  it('fails closed when a durable log contains invalid JSONL', async () => {
    const filePath = path.join(rootDir, 'runtime-ledger.jsonl');
    await fs.writeFile(filePath, 'not-json\n', 'utf-8');

    const { ledger, ids } = createRuntimeLedgerFixture(filePath);
    const conversationId = ids.create('conversation', 'broken');
    const runId = ids.create('run', 'broken');

    await expect(ledger.append({
      eventType: 'runtime.monitor.window_materialized',
      kind: 'domain',
      context: 'monitor',
      subject: 'contentWindow',
      conversationId,
      runId,
      persistence: 'snapshot',
      payload: { contentCount: 1 }
    })).rejects.toThrow('Invalid Runtime Ledger JSONL line 1');
  });
});
