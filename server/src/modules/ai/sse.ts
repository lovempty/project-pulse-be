import { once } from 'node:events';
import type { ServerResponse } from 'node:http';
import type { AiStreamEvent } from './types.js';

export class SseWriter {
  private sequence = 0;
  private closed = false;

  constructor(private readonly response: ServerResponse) {}

  async send(event: AiStreamEvent) {
    if (this.isClosed()) return;
    this.sequence += 1;
    await this.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\nid: ${this.sequence}\n\n`);
  }

  async heartbeat() {
    if (!this.isClosed()) await this.write(': ping\n\n');
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (!this.response.writableEnded) this.response.end();
  }

  isClosed() {
    return this.closed || this.response.destroyed || this.response.writableEnded;
  }

  private async write(value: string) {
    if (this.isClosed()) return;
    if (this.response.write(value)) return;
    await Promise.race([once(this.response, 'drain'), once(this.response, 'close')]);
  }
}
