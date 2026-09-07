import { describe, expect, it } from 'vitest';

import fullCoverageFixture from '../../fixtures/mbd-v2/full-coverage.json';
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

  it('accepts the arc kinds with a PML AIDARC frame (ADR 0055)', () => {
    const result = parseMbdV2PipeData(fullCoverageFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.primitives.map(primitive => primitive.kind)).toContain('angle_dim');
    expect(result.data.primitives.map(primitive => primitive.kind)).toContain('aid_arc');
    expect(result.data.primitives.map(primitive => primitive.kind)).toContain('aid_circle');
  });

  it('rejects arc kinds whose frame is structurally invalid, naming the primitive', () => {
    const frame = {
      center: [0, 0, 0],
      x_axis: [1, 0, 0],
      normal: [0, 0, 1],
      radius: 0.2,
      start_angle_deg: 0,
      sweep_angle_deg: 90,
    };
    const payload = (primitive: Record<string, unknown>) => ({
      version: 'v2',
      input_refno: 'arc',
      branch_refno: 'arc',
      primitives: [primitive],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    });
    const angle = {
      kind: 'angle_dim',
      id: 'angle-bad',
      text: '90°',
      leg_lines: [],
      label_anchor: [0.1, 0.1, 0],
      ...frame,
    };

    // The pre-2026-09 id/text-only shape is now simply invalid.
    for (const kind of ['angle_dim', 'aid_arc', 'aid_circle']) {
      const legacy = parseMbdV2PipeData(payload({ kind, id: `legacy-${kind}`, text: 'x' }));
      expect(legacy.ok).toBe(false);
      if (legacy.ok) return;
      expect(legacy.error).toContain(`${kind} "legacy-${kind}"`);
      expect(legacy.error).not.toContain('frozen V2 contract');
    }
    for (const broken of [
      { ...angle, radius: 0 },
      { ...angle, radius: Number.NaN },
      { ...angle, sweep_angle_deg: 0 },
      { ...angle, sweep_angle_deg: 361 },
      { ...angle, x_axis: [0, 0, 0] },
      { ...angle, normal: [0, 0] },
      { ...angle, leg_lines: [{ from: [0, 0, 0] }] },
      { ...angle, label_anchor: undefined },
    ]) {
      expect(parseMbdV2PipeData(payload(broken))).toMatchObject({ ok: false });
    }
    expect(parseMbdV2PipeData(payload({
      kind: 'aid_arc', id: 'arc-bad', ...frame, style: 7,
    }))).toMatchObject({ ok: false });
    expect(parseMbdV2PipeData(payload({
      kind: 'aid_circle', id: 'circle-bad', center: [0, 0, 0], normal: [0, 0, 1], radius: -1,
    }))).toMatchObject({ ok: false });

    // A full sweep is the closed-arc limit; the solver uses aid_circle for circles.
    expect(parseMbdV2PipeData(payload({
      kind: 'aid_arc', id: 'arc-full', ...frame, sweep_angle_deg: 360,
    }))).toMatchObject({ ok: true });
  });

  it('names the offending primitive and issue in rejection reasons', () => {
    const base = {
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      meta: { geometry_space: 'design_m', notes: [] },
    };
    const malformed = parseMbdV2PipeData({
      ...base,
      primitives: [{ kind: 'linear_dim', id: 'bad-geometry', start: [0, 0] }],
      issues: [],
    });
    const badIssue = parseMbdV2PipeData({
      ...base,
      primitives: [],
      issues: [{ id: 'i-2', severity: 'fatal', category: 'split', message: 'x' }],
    });

    expect(malformed).toMatchObject({ ok: false });
    expect(badIssue).toMatchObject({ ok: false });
    if (malformed.ok || badIssue.ok) return;
    expect(malformed.error).toContain('"bad-geometry"');
    expect(badIssue.error).toContain('"i-2"');
  });
});
