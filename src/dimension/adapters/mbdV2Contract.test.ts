import { describe, expect, it } from 'vitest';

import cliLinearFixture from '../../fixtures/mbd-v2/rs-mbd-cli-linear.json';

import { parseMbdV2PipeData } from './mbdV2Contract';

describe('parseMbdV2PipeData', () => {
  it('accepts genuine rs-mbd-cli output (contract drift guard, ADR 0043)', () => {
    const result = parseMbdV2PipeData(cliLinearFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.data.version).toBe('v2');
    expect(result.data.branch_refno).toBe('linear-small-dimension');
    expect(result.data.input_refno).toBe('fixture:linear-small-dimension');
    expect(result.data.primitives).toHaveLength(1);
    expect(result.data.primitives[0]?.kind).toBe('linear_dim');
    expect(result.data.meta.layout_mode).toBe('linear_mvp');
    expect(result.data.meta.cheight_mm).toBeUndefined();
  });

  it('accepts explicit linear geometry and preserves issue locators', () => {
    const result = parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'fixture:linear',
      branch_refno: 'linear',
      primitives: [{
        kind: 'linear_dim',
        id: 'linear:0',
        start: [0, 10, 0],
        end: [100, 10, 0],
        text: '100',
        extension_lines: [
          { from: [0, 0, 0], to: [0, 10, 0] },
          { from: [100, 0, 0], to: [100, 10, 0] },
        ],
        arrow_lines: [],
        label_anchor: [50, 10, 0],
      }],
      meta: {
        geometry_space: 'source_mm',
        source_to_design: [
          0.001, 0, 0, 0,
          0, 0.001, 0, 0,
          0, 0, 0.001, 0,
          0, 0, 0, 1,
        ],
        notes: [],
      },
      issues: [{
        id: 'small-dim:0',
        severity: 'warning',
        category: 'suppress',
        message: 'suppressed',
        refno: 'linear',
        isoline_idx: 0,
        object_refno: 'T1',
        rule_id: 'linear.small_dim',
      }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.data.issues[0]).toMatchObject({
      isoline_idx: 0,
      object_refno: 'T1',
      rule_id: 'linear.small_dim',
    });
  });

  it('rejects wrong versions and structurally broken top levels', () => {
    expect(parseMbdV2PipeData(null)).toMatchObject({ ok: false });
    expect(parseMbdV2PipeData({ version: 'v2' })).toMatchObject({ ok: false });
    expect(parseMbdV2PipeData({ primitives: [] })).toMatchObject({ ok: false });
    expect(parseMbdV2PipeData({
      version: 'v3',
      input_refno: 'x',
      branch_refno: 'y',
      primitives: [],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    })).toMatchObject({ ok: false });
  });

  it('rejects the whole external payload when a primitive or issue is invalid', () => {
    const result = parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives: [
        {
          kind: 'linear_dim',
          id: 'ok-1',
          start: [0, 0, 0],
          end: [1, 0, 0],
          text: '1',
          extension_lines: [],
          arrow_lines: [],
          label_anchor: [0.5, 0, 0],
        },
        { kind: 'linear_dim', id: 'bad-geometry', start: [0, 0], end: [1, 0, 0], text: '1' },
        { kind: 'hologram', id: 'bad-kind' },
        'not-an-object',
      ],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [
        { id: 'i-1', severity: 'info', category: 'split', message: 'ok' },
        { id: 'i-2', severity: 'fatal', category: 'split', message: 'bad severity' },
      ],
    });

    expect(result).toMatchObject({ ok: false });
  });

  it('rejects removed linear-dimension wire fields', () => {
    const legacy = {
      version: 'v2',
      input_refno: 'legacy',
      branch_refno: 'legacy',
      primitives: [{
        kind: 'linear_dim',
        id: 'legacy-linear',
        start: [0, 0, 0],
        end: [1, 0, 0],
        text: '1',
        extension_lines: [],
        arrow_lines: [],
        label_anchor: [0.5, 0, 0],
        offset: 0.1,
      }],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    };

    expect(parseMbdV2PipeData(legacy)).toMatchObject({ ok: false });
  });

  it('rejects primitive kinds whose explicit geometry is not in the V2 contract', () => {
    for (const kind of ['angle_dim', 'aid_arc', 'aid_circle']) {
      expect(parseMbdV2PipeData({
        version: 'v2',
        input_refno: 'unsupported',
        branch_refno: 'unsupported',
        primitives: [{ kind, id: `unsupported-${kind}`, text: 'x' }],
        meta: { geometry_space: 'design_m', notes: [] },
        issues: [],
      })).toMatchObject({ ok: false });
    }
  });
});
