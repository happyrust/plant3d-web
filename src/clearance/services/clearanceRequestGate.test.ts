import { describe, expect, it } from 'vitest';

import { createClearanceRequestGate } from './clearanceRequestGate';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('clearance request gate', () => {
  it('aborts the previous request on the same key and drops its late answer', async () => {
    const gate = createClearanceRequestGate();
    const first = deferred<string>();
    const second = deferred<string>();
    let firstSignal: AbortSignal | null = null;
    const a = gate.run('query', (signal) => { firstSignal = signal; return first.promise; });
    const b = gate.run('query', () => second.promise);
    expect(firstSignal!.aborted).toBe(true);
    second.resolve('new');
    first.resolve('old');
    expect(await b).toEqual({ status: 'fresh', value: 'new' });
    expect(await a).toEqual({ status: 'superseded' });
  });

  it('swallows the abort rejection of a superseded request but rethrows real failures', async () => {
    const gate = createClearanceRequestGate();
    const a = gate.run('query', signal => new Promise<string>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const b = gate.run('query', async () => { throw new Error('500 boom'); });
    expect(await a).toEqual({ status: 'superseded' });
    await expect(b).rejects.toThrow('500 boom');
  });

  it('keeps different keys independent and cancel() supersedes in-flight requests', async () => {
    const gate = createClearanceRequestGate();
    const x = deferred<number>();
    const y = deferred<number>();
    const a = gate.run('refine:1', () => x.promise);
    const b = gate.run('refine:2', () => y.promise);
    gate.cancel('refine:1');
    x.resolve(1);
    y.resolve(2);
    expect(await a).toEqual({ status: 'superseded' });
    expect(await b).toEqual({ status: 'fresh', value: 2 });

    const z = deferred<number>();
    const c = gate.run('refine:2', () => z.promise);
    gate.cancel();
    z.resolve(3);
    expect(await c).toEqual({ status: 'superseded' });
  });

  it('refuses a model version older than one already accepted for the same scope and database', () => {
    const gate = createClearanceRequestGate();
    expect(gate.acceptModelVersion('bran:1', { dbnum: 24381, sesno: 10 })).toBe(true);
    expect(gate.acceptModelVersion('bran:1', { dbnum: 24381, sesno: 10 })).toBe(true);
    expect(gate.acceptModelVersion('bran:1', { dbnum: 24381, sesno: 9 })).toBe(false);
    expect(gate.acceptModelVersion('bran:1', { dbnum: 24382, sesno: 1 })).toBe(true);
    expect(gate.acceptModelVersion('bran:2', { dbnum: 24381, sesno: 1 })).toBe(true);
    expect(gate.acceptModelVersion('bran:1', null)).toBe(true);
    gate.resetModelVersions('bran:1');
    expect(gate.acceptModelVersion('bran:1', { dbnum: 24381, sesno: 9 })).toBe(true);
    gate.resetModelVersions();
    expect(gate.acceptModelVersion('bran:2', { dbnum: 24381, sesno: 0 })).toBe(true);
  });
});
