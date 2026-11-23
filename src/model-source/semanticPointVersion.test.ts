import { describe, expect, it } from 'vitest';

import {
  createSemanticPointVersionTracker,
  parseSourceVersionKey,
  sourceVersionKey,
} from './semanticPointVersion';

describe('source version key', () => {
  it('keys a version by dbnum:sesno and refuses malformed versions', () => {
    expect(sourceVersionKey({ dbnum: 7997, sesno: 812, databases: [] })).toBe('7997:812');
    expect(sourceVersionKey(null)).toBeNull();
    expect(sourceVersionKey(undefined)).toBeNull();
    expect(sourceVersionKey({ dbnum: 1, sesno: -1 })).toBeNull();
    expect(sourceVersionKey({ dbnum: 1.5, sesno: 2 })).toBeNull();
    expect(parseSourceVersionKey('7997:812')).toEqual({ dbnum: 7997, sesno: 812 });
    expect(parseSourceVersionKey('7997')).toBeNull();
  });
});

describe('semantic point version tracker', () => {
  it('evicts refnos of the same database cached under another session', () => {
    const tracker = createSemanticPointVersionTracker();
    expect(tracker.observe('24381_1', '24381:10')).toEqual([]);
    expect(tracker.observe('24381_2', '24381:10')).toEqual([]);
    expect(tracker.observe('7997_1', '7997:3')).toEqual([]);
    expect(tracker.currentSesno(24381)).toBe(10);

    expect(tracker.observe('24381_3', '24381:11')).toEqual(['24381_1', '24381_2']);
    expect(tracker.versionOf('24381_1')).toBeNull();
    expect(tracker.versionOf('24381_3')).toBe('24381:11');
    expect(tracker.versionOf('7997_1')).toBe('7997:3');
    expect(tracker.currentSesno(24381)).toBe(11);

    expect(tracker.observe('24381_1', '24381:11')).toEqual([]);
  });

  it('re-reading the same refno under a new session does not report itself', () => {
    const tracker = createSemanticPointVersionTracker();
    tracker.observe('24381_1', '24381:10');
    expect(tracker.observe('24381_1', '24381:12')).toEqual([]);
    expect(tracker.versionOf('24381_1')).toBe('24381:12');
  });

  it('ignores responses without a version (older servers)', () => {
    const tracker = createSemanticPointVersionTracker();
    tracker.observe('24381_1', '24381:10');
    expect(tracker.observe('24381_2', null)).toEqual([]);
    expect(tracker.versionOf('24381_2')).toBeNull();
    expect(tracker.versionOf('24381_1')).toBe('24381:10');
    tracker.forget('24381_1');
    expect(tracker.versionOf('24381_1')).toBeNull();
    tracker.clear();
    expect(tracker.currentSesno(24381)).toBeNull();
  });
});
