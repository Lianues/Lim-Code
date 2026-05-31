import type { TerminalOutputEvent } from '../backend/tools';

const TERMINAL_OUTPUT_PREVIEW_BYTES = 4096;
const TERMINAL_OUTPUT_REF_STORE_MAX_ENTRIES = 512;

export interface TerminalOutputDataRef {
  refId: string;
  terminalId: string;
  byteLength: number;
  previewBytes: number;
  truncated: boolean;
  createdAt: number;
}

export interface ProjectedTerminalOutputEvent extends TerminalOutputEvent {
  dataRef?: TerminalOutputDataRef;
  dataTruncated?: boolean;
}

export interface TerminalOutputWindow {
  ref: TerminalOutputDataRef;
  data?: string;
  window: {
    startBytes: number;
    endBytes: number;
    totalBytes: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeIdPart(value: string): string {
  return (value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unknown';
}

export class TerminalOutputProjectionStore {
  private entries = new Map<string, { ref: TerminalOutputDataRef; data: string }>();
  private order: string[] = [];
  private counter = 0;

  project(event: TerminalOutputEvent): ProjectedTerminalOutputEvent {
    if (typeof event.data !== 'string' || this.utf8ByteLength(event.data) <= TERMINAL_OUTPUT_PREVIEW_BYTES) {
      return { ...event };
    }

    const data = event.data;
    const byteLength = this.utf8ByteLength(data);
    const refId = [
      'terminal-output',
      normalizeIdPart(event.terminalId),
      Date.now().toString(36),
      (++this.counter).toString(36),
      stableHash(data)
    ].join(':');
    const ref: TerminalOutputDataRef = {
      refId,
      terminalId: event.terminalId,
      byteLength,
      previewBytes: TERMINAL_OUTPUT_PREVIEW_BYTES,
      truncated: true,
      createdAt: Date.now()
    };
    this.entries.set(refId, { ref, data });
    this.order.push(refId);
    this.pruneToMaxEntries(TERMINAL_OUTPUT_REF_STORE_MAX_ENTRIES);

    return {
      ...event,
      data: this.truncateStringByBytes(data, TERMINAL_OUTPUT_PREVIEW_BYTES),
      dataRef: ref,
      dataTruncated: true
    };
  }

  getWindow(
    refId: string,
    options: { startBytes?: number; maxBytes?: number; includePayload?: boolean } = {}
  ): TerminalOutputWindow | undefined {
    const entry = this.entries.get(refId);
    if (!entry) return undefined;

    const totalBytes = this.utf8ByteLength(entry.data);
    const startBytes = Math.max(0, Math.min(totalBytes, Math.floor(options.startBytes ?? 0)));
    const maxBytes = Math.max(0, Math.floor(options.maxBytes ?? totalBytes));
    const hasRange = typeof options.startBytes === 'number' || typeof options.maxBytes === 'number';
    const includePayload = options.includePayload ?? !hasRange;
    const data = includePayload
      ? entry.data
      : this.sliceUtf8ByBytes(entry.data, startBytes, maxBytes);
    const endBytes = includePayload
      ? totalBytes
      : Math.min(totalBytes, startBytes + this.utf8ByteLength(data));

    return {
      ref: entry.ref,
      data,
      window: {
        startBytes,
        endBytes,
        totalBytes,
        hasMoreBefore: startBytes > 0,
        hasMoreAfter: endBytes < totalBytes
      }
    };
  }

  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.order = [];
    this.counter = 0;
  }

  private pruneToMaxEntries(maxEntries: number): void {
    while (this.order.length > maxEntries) {
      const refId = this.order.shift();
      if (refId) this.entries.delete(refId);
    }
  }

  private truncateStringByBytes(text: string, maxBytes: number): string {
    const marker = '\n[Terminal output preview truncated.]';
    const markerBytes = this.utf8ByteLength(marker);
    return `${this.sliceUtf8ByBytes(text, 0, Math.max(0, maxBytes - markerBytes))}${marker}`;
  }

  private sliceUtf8ByBytes(text: string, startBytes: number, maxBytes: number): string {
    if (maxBytes <= 0) return '';
    let currentBytes = 0;
    let outputBytes = 0;
    let output = '';

    for (const char of text) {
      const charBytes = this.utf8ByteLength(char);
      if (currentBytes + charBytes <= startBytes) {
        currentBytes += charBytes;
        continue;
      }
      if (outputBytes + charBytes > maxBytes) {
        break;
      }
      output += char;
      outputBytes += charBytes;
      currentBytes += charBytes;
    }
    return output;
  }

  private utf8ByteLength(text: string): number {
    return Buffer.byteLength(text, 'utf8');
  }
}
