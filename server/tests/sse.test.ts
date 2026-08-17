import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { SseWriter } from '../src/modules/ai/sse.js';

class FakeResponse extends EventEmitter {
  chunks: string[] = [];
  destroyed = false;
  writableEnded = false;
  backpressure = false;
  write(value: string) { this.chunks.push(value); if (this.backpressure) { this.backpressure = false; queueMicrotask(() => this.emit('drain')); return false; } return true; }
  end() { this.writableEnded = true; this.emit('close'); }
}

describe('SSE writer', () => {
  it('frames JSON events with monotonic IDs and blank lines', async () => {
    const raw = new FakeResponse(); const writer = new SseWriter(raw as any);
    await writer.send({ type: 'status', data: { stage: 'CLASSIFYING', message: 'Checking' } });
    await writer.send({ type: 'delta', data: { text: 'Hello\nworld' } });
    expect(raw.chunks[0]).toBe('event: status\ndata: {"stage":"CLASSIFYING","message":"Checking"}\nid: 1\n\n');
    expect(raw.chunks[1]).toContain('id: 2\n\n');
    expect(raw.chunks[1]).not.toContain('Hello\nworld');
  });

  it('honors backpressure and sends ID-free heartbeats', async () => {
    const raw = new FakeResponse(); raw.backpressure = true; const writer = new SseWriter(raw as any);
    await writer.heartbeat();
    await writer.send({ type: 'done', data: { requestId: 'req-1' } });
    expect(raw.chunks[0]).toBe(': ping\n\n');
    expect(raw.chunks[1]).toContain('id: 1');
  });
});
