import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMMENT_EVENT_LOG_CAPACITY,
  createCommentEventLog,
} from './commentEventLog';

describe('commentEventLog', () => {
  it('starts empty with default capacity', () => {
    const log = createCommentEventLog();
    expect(log.size()).toBe(0);
    expect(log.snapshot()).toEqual([]);
    expect(log.capacity()).toBe(DEFAULT_COMMENT_EVENT_LOG_CAPACITY);
  });

  it('records events with default `now` if omitted', () => {
    const log = createCommentEventLog({ now: () => 12345 });
    log.push({ kind: 'snapshot_merged', key: 'text:a-1', payload: { count: 3 } });
    expect(log.size()).toBe(1);
    expect(log.snapshot()[0]).toEqual({
      kind: 'snapshot_merged',
      at: 12345,
      key: 'text:a-1',
      payload: { count: 3 },
    });
  });

  it('respects explicit `at` when provided', () => {
    const log = createCommentEventLog({ now: () => 1 });
    log.push({ kind: 'thread_upsert', at: 100 });
    expect(log.snapshot()[0].at).toBe(100);
  });

  it('overwrites oldest entries when capacity exceeded', () => {
    const log = createCommentEventLog({ capacity: 3, now: () => 0 });
    log.push({ kind: 'thread_upsert', key: 'k0' });
    log.push({ kind: 'thread_upsert', key: 'k1' });
    log.push({ kind: 'thread_upsert', key: 'k2' });
    log.push({ kind: 'thread_upsert', key: 'k3' });
    expect(log.size()).toBe(3);
    expect(log.snapshot().map((e) => e.key)).toEqual(['k1', 'k2', 'k3']);
  });

  it('snapshot(limit) returns the latest `limit` entries in chronological order', () => {
    const log = createCommentEventLog({ capacity: 5, now: () => 0 });
    for (let i = 0; i < 5; i += 1) {
      log.push({ kind: 'thread_upsert', key: `k${i}` });
    }
    expect(log.snapshot(2).map((e) => e.key)).toEqual(['k3', 'k4']);
    expect(log.snapshot(0)).toEqual([]);
    expect(log.snapshot(100).map((e) => e.key)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
  });

  it('clear() resets to empty state', () => {
    const log = createCommentEventLog({ capacity: 3 });
    log.push({ kind: 'thread_clear' });
    log.push({ kind: 'thread_clear' });
    log.clear();
    expect(log.size()).toBe(0);
    expect(log.snapshot()).toEqual([]);
  });

  it('floors / clamps capacity to at least 1', () => {
    const log = createCommentEventLog({ capacity: 0 });
    expect(log.capacity()).toBe(1);
    log.push({ kind: 'thread_upsert', key: 'a' });
    log.push({ kind: 'thread_upsert', key: 'b' });
    expect(log.snapshot()).toHaveLength(1);
    expect(log.snapshot()[0].key).toBe('b');
  });
});
