import { describe, expect, it } from 'vitest';
import { IncrementalSummaryExtractor } from '../src/modules/ai/summary-extractor.js';

const extract = (chunks: string[]) => {
  const extractor = new IncrementalSummaryExtractor();
  return { text: chunks.map((chunk) => extractor.push(chunk)).join(''), complete: extractor.isComplete() };
};

describe('incremental structured summary extraction', () => {
  it('handles a summary split across arbitrary chunks', () => {
    expect(extract(['{"sum', 'mary":"The most ', 'important risk', ' is timing.","risks":[]'])).toEqual({ text: 'The most important risk is timing.', complete: true });
  });

  it('decodes escaped quotes, backslashes, and control escapes without exposing JSON', () => {
    const result = extract(['{"summary":"Review \\', '"API\\" path C:', '\\\\work\\nnow","highlights":[]']);
    expect(result).toEqual({ text: 'Review "API" path C:\\work\nnow', complete: true });
  });

  it('decodes unicode escapes split between chunks', () => {
    expect(extract(['{"summary":"Ready \\uD8', '3D\\uDE', '80 today","risks":[]']).text).toBe('Ready \u{1F680} today');
  });
});
