export class IncrementalSummaryExtractor {
  private state: 'SEEK_KEY' | 'SEEK_COLON' | 'SEEK_QUOTE' | 'VALUE' | 'DONE' = 'SEEK_KEY';
  private seekBuffer = '';
  private escaped = false;
  private unicodeDigits: string | null = null;
  private pendingHighSurrogate = '';

  push(chunk: string) {
    let output = '';
    for (const char of chunk) {
      if (this.state === 'DONE') continue;
      if (this.state === 'SEEK_KEY') {
        this.seekBuffer = (this.seekBuffer + char).slice(-32);
        if (this.seekBuffer.includes('"summary"')) this.state = 'SEEK_COLON';
        continue;
      }
      if (this.state === 'SEEK_COLON') {
        if (char === ':') this.state = 'SEEK_QUOTE';
        continue;
      }
      if (this.state === 'SEEK_QUOTE') {
        if (/\s/.test(char)) continue;
        if (char === '"') this.state = 'VALUE';
        continue;
      }
      if (this.unicodeDigits !== null) {
        this.unicodeDigits += char;
        if (this.unicodeDigits.length === 4) {
          const code = Number.parseInt(this.unicodeDigits, 16);
          this.unicodeDigits = null;
          if (Number.isNaN(code)) continue;
          const decoded = String.fromCharCode(code);
          if (code >= 0xd800 && code <= 0xdbff) this.pendingHighSurrogate = decoded;
          else if (code >= 0xdc00 && code <= 0xdfff && this.pendingHighSurrogate) {
            output += this.pendingHighSurrogate + decoded;
            this.pendingHighSurrogate = '';
          } else {
            if (this.pendingHighSurrogate) output += this.pendingHighSurrogate;
            this.pendingHighSurrogate = '';
            output += decoded;
          }
        }
        continue;
      }
      if (this.escaped) {
        this.escaped = false;
        if (char === 'u') this.unicodeDigits = '';
        else output += ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' } as Record<string, string>)[char] ?? '';
        continue;
      }
      if (char === '\\') {
        this.escaped = true;
        continue;
      }
      if (char === '"') {
        if (this.pendingHighSurrogate) output += this.pendingHighSurrogate;
        this.pendingHighSurrogate = '';
        this.state = 'DONE';
        continue;
      }
      output += char;
    }
    return output;
  }

  isComplete() {
    return this.state === 'DONE';
  }
}
