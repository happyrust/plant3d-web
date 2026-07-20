import { describe, expect, it } from 'vitest';

import fullCoverageFixture from '../../fixtures/mbd-v2/full-coverage.json';
import cliSplitStubFixture from '../../fixtures/mbd-v2/rs-mbd-cli-split-stub.json';

import { parseMbdV2PipeData } from './mbdV2Contract';

describe('parseMbdV2PipeData', () => {
  it('accepts genuine rs-mbd-cli output (contract drift guard, ADR 0043)', () => {
    const result = parseMbdV2PipeData(cliSplitStubFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.data.version).toBe('v2');
    expect(result.data.branch_refno).toBe('toy-bridge-and-stick');
    expect(result.data.primitives).toEqual([]);
    expect(result.data.meta.layout_mode).toBe('split_only_stub');
    expect(result.data.meta.cheight_mm).toBeUndefined();
  });

  it('accepts the full-coverage contract fixture without diagnostics', () => {
    const result = parseMbdV2PipeData(fullCoverageFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.data.version).toBe('v2');
    expect(result.data.branch_refno).toBe('24381/145712');
    expect(result.data.primitives).toHaveLength(14);
    expect(result.data.meta.cheight_mm).toBe(100);
    expect(result.data.issues).toHaveLength(2);
    expect(
      new Set(result.data.primitives.map(primitive => primitive.kind)),
    ).toEqual(new Set([
      'linear_dim',
      'angle_dim',
      'label',
      'leader_line',
      'aid_line',
      'aid_arc',
      'aid_circle',
      'aid_point',
      'aid_text',
      'weld_mark',
      'slope_mark',
    ]));
  });

  it('rejects a structurally broken top level', () => {
    expect(parseMbdV2PipeData(null)).toMatchObject({ ok: false });
    expect(parseMbdV2PipeData({ version: 'v2' })).toMatchObject({ ok: false });
    expect(parseMbdV2PipeData({ primitives: [] })).toMatchObject({ ok: false });
  });

  it('skips invalid primitives and issues with per-entry diagnostics', () => {
    const result = parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives: [
        { kind: 'linear_dim', id: 'ok-1', start: [0, 0, 0], end: [1, 0, 0], text: '1' },
        { kind: 'linear_dim', id: 'bad-geometry', start: [0, 0], end: [1, 0, 0], text: '1' },
        { kind: 'hologram', id: 'bad-kind' },
        'not-an-object',
      ],
      meta: { notes: 'not-an-array' },
      issues: [
        { id: 'i-1', severity: 'info', category: 'split', message: 'ok' },
        { id: 'i-2', severity: 'fatal', category: 'split', message: 'bad severity' },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitives.map(primitive => primitive.id)).toEqual(['ok-1']);
    expect(result.data.issues.map(issue => issue.id)).toEqual(['i-1']);
    expect(result.data.meta.notes).toEqual([]);
    expect(result.diagnostics).toEqual([
      { id: 'bad-geometry', reason: 'invalid primitive fields' },
      { id: 'bad-kind', reason: 'unknown primitive kind "hologram"' },
      { id: 'primitive-3', reason: 'invalid primitive fields' },
      { id: 'issue-1', reason: 'invalid issue entry' },
    ]);
  });
});
