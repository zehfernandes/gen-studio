import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import { readBody, safeJoin } from './server';

describe('safeJoin', () => {
  it('resolves children inside the base', () => {
    expect(safeJoin('/tmp/sketches', 'poster', 'exports', 'print.png')).toBe('/tmp/sketches/poster/exports/print.png');
  });

  it('rejects paths outside the base', () => {
    expect(() => safeJoin('/tmp/sketches', '..', 'secret')).toThrow('unsafe path');
  });
});

describe('readBody', () => {
  it('collects chunked request bodies', async () => {
    const req = Readable.from([Buffer.from('hello '), Buffer.from('world')]);
    await expect(readBody(req)).resolves.toEqual(Buffer.from('hello world'));
  });

  it('rejects bodies over the limit', async () => {
    const req = Readable.from([Buffer.from('123'), Buffer.from('456')]);
    await expect(readBody(req, 5)).rejects.toThrow('body too large');
  });
});
