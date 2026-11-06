import { describe, expect, it } from 'vitest';

import envelopeFieldsFixture from '../../fixtures/mbd-v2/envelope-fields.json';
import fullCoverageFixture from '../../fixtures/mbd-v2/full-coverage.json';
import liveIsodimFixture from '../../fixtures/mbd-v2/live-isodim-24381-145018.json';
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

  /**
   * A2（2026-10-29）：`offset` / `suppressed_reason` 是 2026-07 之前图元上的旧字段
   * （rs-mbd 已删，抑制信息改走 `issues[category=suppress]`）。默认模式下它们
   * **不再整包失败**——多出来的字段一律忽略，前端不替后端判新旧；只有 strict
   * 模式（契约回归 / 联调对账）才把这种形状当错。
   */
  it('ignores removed linear-dimension wire fields by default and rejects them in strict mode', () => {
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

    const tolerant = parseMbdV2PipeData(legacy);
    expect(tolerant.ok).toBe(true);
    if (!tolerant.ok) return;
    expect(tolerant.data.primitives).toHaveLength(1);
    expect(tolerant.diagnostics).toEqual([]);

    const strict = parseMbdV2PipeData(legacy, { strict: true });
    expect(strict).toMatchObject({ ok: false });
    if (strict.ok) return;
    expect(strict.error).toContain('legacy-linear');
  });

  /**
   * A3（2026-10-29）：不认识的图元 kind —— 默认仍按 ADR 0046 整包拒绝，只有显式
   * `partial`（面板「允许部分显示」/ `?mbd_partial=1`）才降级成逐条诊断。「认识的
   * kind 但字段非法」在任何模式下都整包拒绝——「不认识」和「写错了」不是一回事。
   */
  it('downgrades unknown primitive kinds only when partial display is requested', () => {
    const linear = {
      kind: 'linear_dim',
      id: 'dim-1',
      start: [0, 0, 0],
      end: [1, 0, 0],
      text: '1000',
      extension_lines: [],
      arrow_lines: [],
      label_anchor: [0.5, 0, 0],
    };
    const payload = {
      version: 'v2',
      input_refno: 'future',
      branch_refno: 'future',
      primitives: [
        { kind: 'future_dim', id: 'future-1', text: 'x' },
        linear,
        { kind: 'future_dim', id: 'future-2' },
      ],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    };

    // 默认：ADR 0046，整包拒绝。
    expect(parseMbdV2PipeData(payload)).toMatchObject({ ok: false });

    // partial：跳过不认识的、交付其余，并逐条记诊断。
    const partial = parseMbdV2PipeData(payload, { partial: true });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.data.primitives.map(primitive => primitive.id)).toEqual(['dim-1']);
    expect(partial.diagnostics).toEqual([
      { id: 'future-1', reason: '还不认识的图元 kind：future_dim' },
      { id: 'future-2', reason: '还不认识的图元 kind：future_dim' },
    ]);

    // strict 把 partial 的宽容也收回。
    expect(parseMbdV2PipeData(payload, { partial: true, strict: true }))
      .toMatchObject({ ok: false });

    // 「写错了」不是「不认识」：认识的 kind 字段非法，partial 也整包拒绝。
    expect(parseMbdV2PipeData({
      ...payload,
      primitives: [{ ...linear, start: [0, 0] }],
    }, { partial: true })).toMatchObject({ ok: false });
  });

  /**
   * A1（2026-10-29）：现网 `GET /api/mbd/v2/pipe/24381_145018` 的原样响应（本机
   * gen-model :8022，77 个图元 / 0 条 issue / `layout_mode=isodim_main`）。这是
   * 「契约测试必须能吃掉真实负载」的锚点：它的作用不是证明字段全对，而是任何
   * 收紧（新增必填、加字段白名单）都必须先过这一关。
   */
  it('parses the live isodim payload unchanged', () => {
    const result = parseMbdV2PipeData(liveIsodimFixture);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.data.branch_refno).toBe('24381_145018');
    expect(result.data.primitives).toHaveLength(77);
    expect(result.data.meta.layout_mode).toBe('isodim_main');
    const kinds = new Set(result.data.primitives.map(primitive => primitive.kind));
    expect([...kinds].sort()).toEqual([
      'aid_line',
      'aid_text',
      'label',
      'leader_line',
      'linear_dim',
      'slope_mark',
    ]);
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

  it('rejects aid styles outside solid | dashed | dash_dot, naming the primitive', () => {
    const payload = (primitive: Record<string, unknown>) => ({
      version: 'v2',
      input_refno: 'aid',
      branch_refno: 'aid',
      primitives: [primitive],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    });
    const frame = {
      center: [0, 0, 0],
      x_axis: [1, 0, 0],
      normal: [0, 0, 1],
      radius: 0.2,
      start_angle_deg: 0,
      sweep_angle_deg: 90,
    };
    const aids = {
      aid_line: { start: [0, 0, 0], end: [0, 0, 1] },
      aid_arc: frame,
      aid_circle: { center: [0, 0, 0], normal: [0, 0, 1], radius: 0.1 },
    };
    const withStyle = (kind: string, fields: Record<string, unknown>, style?: unknown) =>
      payload({
        kind,
        id: `${kind}-style`,
        ...fields,
        ...(style === undefined ? {} : { style }),
      });

    for (const [kind, fields] of Object.entries(aids)) {
      // The kernel spelling (`dash-dot`), a different case, the empty string
      // and null are producer mistakes the contract must not let through (C6).
      for (const style of ['dotted', 'dash-dot', 'DASHED', '', null]) {
        const rejected = parseMbdV2PipeData(withStyle(kind, fields, style));
        expect(rejected.ok, `${kind} style ${JSON.stringify(style)}`).toBe(false);
        if (rejected.ok) return;
        expect(rejected.error).toContain(`${kind} "${kind}-style"`);
      }
      for (const style of ['solid', 'dashed', 'dash_dot', undefined]) {
        const accepted = parseMbdV2PipeData(withStyle(kind, fields, style));
        expect(accepted, `${kind} style ${String(style)}`).toMatchObject({ ok: true });
      }
    }
  });

  it('accepts an optional per-text height on aid_text and rejects non-positive ones', () => {
    const payload = (primitive: Record<string, unknown>) => ({
      version: 'v2',
      input_refno: 'aid-text',
      branch_refno: 'aid-text',
      primitives: [primitive],
      meta: { geometry_space: 'design_m', notes: [] },
      issues: [],
    });
    const aidText = {
      kind: 'aid_text',
      id: 'angle:isoline:0:dir-text',
      text: 'A:0',
      position: [0, 0, 0],
    };

    // The installation-angle direction labels declare `cheight / 2`.
    const withHeight = parseMbdV2PipeData(payload({ ...aidText, text_height_mm: 12.5 }));
    expect(withHeight.ok).toBe(true);
    if (!withHeight.ok) return;
    const parsedText = withHeight.data.primitives[0];
    expect(parsedText?.kind).toBe('aid_text');
    expect((parsedText as { text_height_mm?: number }).text_height_mm).toBe(12.5);

    // Absent stays valid (regression: every pre-existing producer omits it).
    expect(parseMbdV2PipeData(payload(aidText))).toMatchObject({ ok: true });

    // Zero, negative and NaN heights have no meaning and would poison the projection.
    for (const textHeight of [0, -1, Number.NaN]) {
      const rejected = parseMbdV2PipeData(payload({ ...aidText, text_height_mm: textHeight }));
      expect(rejected, `text_height_mm ${String(textHeight)}`).toMatchObject({ ok: false });
      if (rejected.ok) return;
      expect(rejected.error).toContain('aid_text "angle:isoline:0:dir-text"');
    }
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

  /**
   * T4.1（现行计划 W3-1 第①步）：`meta.coverage` 先接受、后消费。缺省 / `null` 照旧
   * 放行（现网生产者都还没发），给了就原样透传给消费方（条目不限于前端已知 kind）；
   * 不是「非空字符串数组」的形状按 ADR 0046 整包拒绝，和 `cheight_mm` / `layout_mode`
   * 一个口径。
   */
  it('accepts an optional meta.coverage kind list and rejects malformed ones', () => {
    const withMeta = (meta: Record<string, unknown>) => parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives: [],
      issues: [],
      meta: { geometry_space: 'design_m', notes: [], ...meta },
    });

    const absent = withMeta({});
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.data.meta.coverage).toBeUndefined();

    expect(withMeta({ coverage: null })).toMatchObject({ ok: true, data: { meta: { coverage: null } } });
    expect(withMeta({ coverage: [] })).toMatchObject({ ok: true, data: { meta: { coverage: [] } } });
    const declared = withMeta({ coverage: ['linear_dim', 'angle_dim', 'future_mark'] });
    expect(declared.ok).toBe(true);
    if (declared.ok) {
      expect(declared.data.meta.coverage).toEqual(['linear_dim', 'angle_dim', 'future_mark']);
    }

    for (const malformed of ['linear_dim', 0, [1], ['linear_dim', ''], { linear_dim: true }]) {
      expect(withMeta({ coverage: malformed })).toEqual({
        ok: false,
        error: 'MBD V2 payload has invalid meta',
      });
    }
  });

  /**
   * T4.5（现行计划 W3-2 第①步）：`meta.source_version` 用与 `/api/v1/spatial/centerline`
   * 相同的形状（`dbnum` / `sesno` / `databases[{ dbnum, sesno, db_type }]`），面板才能和
   * 管道信息卡、时间轴的版本口径直接对账。缺省 / `null` 放行；给了就校验结构、范围与
   * 库号唯一，`databases: []`（离线 CLI 生产者）也认；其它形状整包拒绝。
   */
  it('accepts an optional meta.source_version in the centerline shape and rejects malformed ones', () => {
    const withMeta = (meta: Record<string, unknown>) => parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives: [],
      issues: [],
      meta: { geometry_space: 'design_m', notes: [], ...meta },
    });
    const version = {
      dbnum: 24381,
      sesno: 145,
      databases: [
        { dbnum: 24381, sesno: 145, db_type: 'DESI' },
        { dbnum: 5054, sesno: 48, db_type: 'CATA' },
      ],
    };

    const absent = withMeta({});
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.data.meta.source_version).toBeUndefined();
    expect(withMeta({ source_version: null }))
      .toMatchObject({ ok: true, data: { meta: { source_version: null } } });

    const declared = withMeta({ source_version: version });
    expect(declared.ok).toBe(true);
    if (declared.ok) expect(declared.data.meta.source_version).toEqual(version);
    expect(withMeta({ source_version: { ...version, databases: [] } })).toMatchObject({ ok: true });

    const malformed: unknown[] = [
      '24381@145',
      { ...version, dbnum: 0 },
      { ...version, sesno: -1 },
      { ...version, dbnum: 24381.5 },
      { dbnum: 24381, sesno: 145 },
      { ...version, databases: [{ dbnum: 24381, sesno: 145 }] },
      { ...version, databases: [...version.databases, { dbnum: 5054, sesno: 49, db_type: 'CATA' }] },
    ];
    for (const candidate of malformed) {
      expect(withMeta({ source_version: candidate })).toEqual({
        ok: false,
        error: 'MBD V2 payload has invalid meta',
      });
    }
  });

  /**
   * T4.3（现行计划 W3-4 第①步）：`label` / `aid_text` / `slope_mark` 可选的 `text_dir`
   * （文字基线方向，PML `ori` 的 X 轴）。缺省 = 视口水平（今天所有生产者的行为）；给了
   * 就必须是有限且非零的三维向量，否则按 ADR 0046 点名整包拒绝；strict 下它是白名单
   * 字段，但只属于这三种 kind。
   */
  it('accepts an optional text_dir baseline on label / aid_text / slope_mark and rejects degenerate ones', () => {
    const withPrimitives = (primitives: unknown[], options?: { strict?: boolean }) => parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives,
      issues: [],
      meta: { geometry_space: 'design_m', notes: [] },
    }, options);
    const label = { kind: 'label', id: 'l-1', text: 'P-101', position: [0, 0, 0] };
    const aidText = { kind: 'aid_text', id: 't-1', text: 'EL +1', position: [1, 0, 0] };
    const slope = { kind: 'slope_mark', id: 's-1', text: '1:100', start: [0, 0, 0], end: [1, 0, 0.01] };

    const oriented = [
      { ...label, text_dir: [1, 0, 0] },
      { ...aidText, text_dir: [0, 0, 1] },
      { ...slope, text_dir: [1, 0, 0.01] },
    ];
    for (const strict of [false, true]) {
      const result = withPrimitives(oriented, { strict });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.primitives).toEqual(oriented);
    }
    const bare = withPrimitives([label, aidText, slope]);
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.data.primitives.every(primitive => !('text_dir' in primitive))).toBe(true);
    }

    const degenerate: readonly (readonly [Record<string, unknown>, unknown])[] = [
      [label, [0, 0, 0]],
      [aidText, [1, 0]],
      [slope, [1, Number.NaN, 0]],
      [label, 'X'],
    ];
    for (const [primitive, textDir] of degenerate) {
      const result = withPrimitives([{ ...primitive, text_dir: textDir }]);
      expect(result).toMatchObject({ ok: false });
      if (result.ok) continue;
      expect(result.error).toContain(
        `invalid primitive ${primitive.kind as string} "${primitive.id as string}"`,
      );
    }

    // 只属于这三种 kind：别的 kind 上出现 text_dir，默认模式当契约外字段忽略，strict 才拒。
    const weld = { kind: 'weld_mark', id: 'w-1', position: [0, 0, 0], text_dir: [1, 0, 0] };
    expect(withPrimitives([weld]).ok).toBe(true);
    expect(withPrimitives([weld], { strict: true })).toMatchObject({ ok: false });
  });

  /**
   * T4.4 + T4.6（现行计划 W3-5 / W3-6 第①步）：每种 kind 共有的两个可选定位字段——
   * `object_refno`（图元所标注的构件 refno，host 认得的文本，格式不在契约里校验）与
   * `isoline_idx`（所在直段下标，与 `meta.isolines[].index` / `MbdV2Issue.isoline_idx`
   * 同一套编号）。缺省 = 未声明（今天所有生产者的行为）；给了 `object_refno` 就得像 `id`
   * 一样是非空字符串，给了 `isoline_idx` 就得是非负安全整数，否则点名整包拒绝；strict 下
   * 两者都是所有 kind 共有的白名单字段。
   */
  it('accepts optional object_refno / isoline_idx locators on every primitive kind and rejects malformed ones', () => {
    const withPrimitives = (primitives: unknown[], options?: { strict?: boolean }) => parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives,
      issues: [],
      meta: { geometry_space: 'design_m', notes: [] },
    }, options);
    const frame = {
      center: [0, 0, 0], x_axis: [1, 0, 0], normal: [0, 0, 1], radius: 1, start_angle_deg: 0, sweep_angle_deg: 90,
    };
    // 契约里的 11 种 kind 各一条最小形状。
    const everyKind: readonly Record<string, unknown>[] = [
      {
        kind: 'linear_dim', id: 'd', start: [0, 0, 0], end: [1, 0, 0], text: '1000',
        extension_lines: [], arrow_lines: [], label_anchor: [0.5, 0, 0],
      },
      { kind: 'angle_dim', id: 'a', text: '90°', leg_lines: [], label_anchor: [0, 0, 0], ...frame },
      { kind: 'label', id: 'l', text: 'P-101', position: [0, 0, 0] },
      { kind: 'leader_line', id: 'ld', start: [0, 0, 0], end: [1, 0, 0] },
      { kind: 'aid_line', id: 'al', start: [0, 0, 0], end: [1, 0, 0] },
      { kind: 'aid_arc', id: 'aa', ...frame },
      { kind: 'aid_circle', id: 'ac', center: [0, 0, 0], normal: [0, 0, 1], radius: 1 },
      { kind: 'aid_point', id: 'ap', position: [0, 0, 0] },
      { kind: 'aid_text', id: 'at', text: 'EL +1', position: [0, 0, 0] },
      { kind: 'weld_mark', id: 'w', position: [0, 0, 0] },
      { kind: 'slope_mark', id: 's', text: '1:100', start: [0, 0, 0], end: [1, 0, 0.01] },
    ];
    expect(new Set(everyKind.map(primitive => primitive.kind)).size).toBe(11);

    const tagged = everyKind.map((primitive, index) => ({
      ...primitive,
      object_refno: `24381_${145018 + index}`,
      isoline_idx: index % 3,
    }));
    for (const strict of [false, true]) {
      const result = withPrimitives(tagged, { strict });
      expect(result.ok, `strict ${String(strict)}`).toBe(true);
      if (result.ok) expect(result.data.primitives).toEqual(tagged);
    }

    // 缺省不凭空出现（今天所有生产者）。
    const bare = withPrimitives([...everyKind]);
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.data.primitives.every(
        primitive => !('object_refno' in primitive) && !('isoline_idx' in primitive),
      )).toBe(true);
    }

    // 给了就得像 id 一样是非空字符串：空串 / 数字 / null 都点名整包拒绝（null 不等于缺省，
    // Rust 侧 `Option` 的 None 不会序列化出来）；isoline_idx 则是非负安全整数：负数 / 小数 /
    // 字符串 / null 同样点名拒绝。
    for (const primitive of everyKind) {
      for (const refno of ['', 24381, null]) {
        const result = withPrimitives([{ ...primitive, object_refno: refno }]);
        expect(result, `${primitive.kind as string} object_refno ${String(refno)}`)
          .toMatchObject({ ok: false });
        if (result.ok) continue;
        expect(result.error).toContain(
          `invalid primitive ${primitive.kind as string} "${primitive.id as string}"`,
        );
      }
      for (const idx of [-1, 1.5, '0', null]) {
        const result = withPrimitives([{ ...primitive, isoline_idx: idx }]);
        expect(result, `${primitive.kind as string} isoline_idx ${String(idx)}`)
          .toMatchObject({ ok: false });
        if (result.ok) continue;
        expect(result.error).toContain(
          `invalid primitive ${primitive.kind as string} "${primitive.id as string}"`,
        );
      }
    }
  });

  /**
   * T4.2 + T4.6（现行计划 W3-3 / W3-6 第①步，2026-10-29 拍板）：`meta.isolines[]` 一张直段表
   * （`index` / `members` / `cheight_mm` / `od_mm`），其中 `cheight_mm` 是直段级
   * `isoline_cheight_mm`（`sepSmallDim` 缩字后的组字高），即 D7 三层字高里的中间一层。
   * 缺省 / `null` 放行；给了就校验结构：下标非负安全整数且表内唯一（可不连续、可乱序——
   * plant-mbd 会跳过没有 `ldir` 的袋），成员是非空字符串（可为空数组），两个长度都是有限
   * 正数；其它形状整包拒绝 `invalid meta`。图元的 `isoline_idx` 不与表交叉校验：指向表里
   * 没有的下标不算错，由消费侧回落全局 `cheight_mm`。
   */
  it('accepts an optional meta.isolines table and rejects malformed ones', () => {
    const withMeta = (meta: Record<string, unknown>, primitives: unknown[] = []) => parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives,
      issues: [],
      meta: { geometry_space: 'design_m', notes: [], ...meta },
    });
    const row = { index: 0, members: ['24381_145018'], cheight_mm: 25, od_mm: 114.3 };
    // 乱序 + 不连续（袋 1、3、4 没有 ldir 被跳过）+ 空成员，都是合法的表。
    const table = [
      { index: 2, members: ['24381_146980', '24381_146984'], cheight_mm: 12, od_mm: 60.3 },
      row,
      { index: 5, members: [], cheight_mm: 25, od_mm: 114.3 },
    ];

    const absent = withMeta({});
    expect(absent.ok).toBe(true);
    if (absent.ok) expect(absent.data.meta.isolines).toBeUndefined();
    expect(withMeta({ isolines: null })).toMatchObject({ ok: true, data: { meta: { isolines: null } } });
    expect(withMeta({ isolines: [] })).toMatchObject({ ok: true, data: { meta: { isolines: [] } } });

    const declared = withMeta({ isolines: table });
    expect(declared.ok).toBe(true);
    if (declared.ok) expect(declared.data.meta.isolines).toEqual(table);

    // 图元的 isoline_idx 不与表交叉校验：悬空下标放行，消费侧回落。
    const dangling = withMeta({ isolines: table }, [
      { kind: 'weld_mark', id: 'w', position: [0, 0, 0], isoline_idx: 7 },
    ]);
    expect(dangling.ok).toBe(true);

    const malformed: unknown[] = [
      {},
      [1],
      [{ ...row, index: -1 }],
      [{ ...row, index: 1.5 }],
      [{ ...row, index: '0' }],
      [row, { ...row, members: [] }],
      [{ ...row, members: '24381_145018' }],
      [{ ...row, members: ['24381_145018', ''] }],
      [{ ...row, cheight_mm: 0 }],
      [{ ...row, cheight_mm: Number.NaN }],
      [{ ...row, od_mm: -1 }],
      [{ index: 0, members: [], cheight_mm: 25 }],
    ];
    for (const candidate of malformed) {
      expect(withMeta({ isolines: candidate })).toEqual({
        ok: false,
        error: 'MBD V2 payload has invalid meta',
      });
    }
  });

  /**
   * #103 第 2 步：`meta.isolines[].axis` 是直段轴线（PML `isoline.line`）。缺省 / `null` 放行；给了就得是
   * `{ from, to }` 两个有限三维点且不重合（零长的轴定不出方向），其它形状整包拒绝 `invalid meta`。
   */
  it('accepts an optional isoline axis and rejects malformed or zero-length ones', () => {
    const withIsolines = (isolines: unknown[]) => parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives: [],
      issues: [],
      meta: { geometry_space: 'design_m', notes: [], isolines },
    });
    const row = { index: 0, members: ['24381_145018'], cheight_mm: 25, od_mm: 114.3 };
    const axis = { from: [0, 0, 0], to: [1200, 0, 0] };

    const declared = withIsolines([{ ...row, axis }]);
    expect(declared.ok).toBe(true);
    if (declared.ok) expect(declared.data.meta.isolines?.[0]?.axis).toEqual(axis);
    expect(withIsolines([{ ...row, axis: null }]).ok).toBe(true);
    expect(withIsolines([row]).ok).toBe(true);

    const malformed: unknown[] = [
      'x',
      [0, 0, 0],
      { from: [0, 0, 0] },
      { from: [0, 0, 0], to: [1, 2] },
      { from: [0, 0, Number.NaN], to: [1, 0, 0] },
      { from: [5, 5, 5], to: [5, 5, 5] },
    ];
    for (const candidate of malformed) {
      expect(withIsolines([{ ...row, axis: candidate }])).toEqual({
        ok: false,
        error: 'MBD V2 payload has invalid meta',
      });
    }
  });

  describe('envelope fields (#103 M1-3)', () => {
    const withPackage = (
      fields: Record<string, unknown>,
      primitives: unknown[] = [],
      options?: { strict?: boolean },
    ) => parseMbdV2PipeData({
      version: 'v2',
      input_refno: 'x',
      branch_refno: 'y',
      primitives,
      issues: [],
      meta: { geometry_space: 'design_m', notes: [] },
      ...fields,
    }, options);
    const withPrimitives = (primitives: unknown[], options?: { strict?: boolean }) =>
      withPackage({}, primitives, options);
    const frame = {
      center: [0, 0, 0], x_axis: [1, 0, 0], normal: [0, 0, 1], radius: 1, start_angle_deg: 0, sweep_angle_deg: 90,
    };
    // 契约里的 11 种 kind 各一条最小形状。
    const everyKind: readonly Record<string, unknown>[] = [
      {
        kind: 'linear_dim', id: 'd', start: [0, 0, 0], end: [1, 0, 0], text: '1000',
        extension_lines: [], arrow_lines: [], label_anchor: [0.5, 0, 0],
      },
      { kind: 'angle_dim', id: 'a', text: '90°', leg_lines: [], label_anchor: [0, 0, 0], ...frame },
      { kind: 'label', id: 'l', text: 'P-101', position: [0, 0, 0] },
      { kind: 'leader_line', id: 'ld', start: [0, 0, 0], end: [1, 0, 0] },
      { kind: 'aid_line', id: 'al', start: [0, 0, 0], end: [1, 0, 0] },
      { kind: 'aid_arc', id: 'aa', ...frame },
      { kind: 'aid_circle', id: 'ac', center: [0, 0, 0], normal: [0, 0, 1], radius: 1 },
      { kind: 'aid_point', id: 'ap', position: [0, 0, 0] },
      { kind: 'aid_text', id: 'at', text: 'EL +1', position: [0, 0, 0] },
      { kind: 'weld_mark', id: 'w', position: [0, 0, 0] },
      { kind: 'slope_mark', id: 's', text: '1:100', start: [0, 0, 0], end: [1, 0, 0.01] },
    ];
    const byKind = (kind: string) => everyKind.find(primitive => primitive.kind === kind)!;
    const expectRejected = (primitive: Record<string, unknown>, label: string) => {
      const result = withPrimitives([primitive]);
      expect(result, label).toMatchObject({ ok: false });
      if (result.ok) return;
      expect(result.error).toContain(
        `invalid primitive ${primitive.kind as string} "${primitive.id as string}"`,
      );
    };

    /**
     * 权威 fixture（plant-mbd 镜像它）：非管道包 `em9_pipe_supp` + 归属对象，两段共用 `chain_id` 的
     * 线性尺寸、带类别 / 字高 / 文字向上方向的标签与角度、坡度、辅助文字——默认与 strict 都得吃下。
     */
    it('parses the authoritative envelope-fields fixture in default and strict mode', () => {
      for (const strict of [false, true]) {
        const result = parseMbdV2PipeData(envelopeFieldsFixture, { strict });
        expect(result.ok, `strict ${String(strict)}`).toBe(true);
        if (!result.ok) return;
        expect(result.diagnostics).toEqual([]);
        expect(result.data.annotation_type).toBe('em9_pipe_supp');
        expect(result.data.subject).toEqual({ refno: '24383_91813', noun: 'SUPPO' });
        expect(result.data.branch_refno).toBe('24383_91813');
        expect(result.data.meta.layout_mode).toBe('em9_pipe_supp');
        expect(result.data.primitives).toEqual(envelopeFieldsFixture.primitives);
        const chain = result.data.primitives.filter(primitive => primitive.chain_id === '24383_91813:chain:0');
        expect(chain.map(primitive => [primitive.kind, primitive.chain_seq])).toEqual([
          ['linear_dim', 0],
          ['linear_dim', 1],
        ]);
      }
    });

    it('accepts every annotation_type of the closed vocabulary and rejects anything else', () => {
      const vocabulary = [
        'em4_pipe', 'em9_pipe', 'em4_supp', 'em9_inst_supp', 'em9_pipe_supp',
        'civil', 'arch', 'em4_equi', 'em9_equi',
      ];
      for (const annotationType of vocabulary) {
        const result = withPackage({ annotation_type: annotationType }, [], { strict: true });
        expect(result.ok, annotationType).toBe(true);
        if (result.ok) expect(result.data.annotation_type).toBe(annotationType);
      }

      // 缺省 = 老的管道包：不凭空出现字段。
      const legacy = withPackage({});
      expect(legacy.ok).toBe(true);
      if (legacy.ok) {
        expect(legacy.data).not.toHaveProperty('annotation_type');
        expect(legacy.data).not.toHaveProperty('subject');
      }

      // 词表外（拼错、大小写、空串）与 null / 非字符串都整包拒绝；null 不等于缺省。
      for (const annotationType of ['em9_supp', 'EM4_PIPE', 'pipe', '']) {
        expect(withPackage({ annotation_type: annotationType })).toEqual({
          ok: false,
          error: `MBD V2 payload has an invalid annotation_type "${annotationType}"`,
        });
      }
      for (const annotationType of [null, 4, ['civil']]) {
        expect(withPackage({ annotation_type: annotationType })).toEqual({
          ok: false,
          error: 'MBD V2 payload has an invalid annotation_type',
        });
      }
    });

    it('accepts a subject with a refno and a noun and rejects malformed ones', () => {
      const subject = { refno: '24383_91813', noun: 'SUPPO' };
      const declared = withPackage({ subject }, [], { strict: true });
      expect(declared.ok).toBe(true);
      if (declared.ok) expect(declared.data.subject).toEqual(subject);

      for (const malformed of [
        { refno: '24383_91813' },
        { noun: 'SUPPO' },
        { refno: '', noun: 'SUPPO' },
        { refno: '24383_91813', noun: '' },
        { refno: 24383, noun: 'SUPPO' },
        '24383_91813',
        null,
      ]) {
        expect(withPackage({ subject: malformed }), JSON.stringify(malformed)).toEqual({
          ok: false,
          error: 'MBD V2 payload has an invalid subject',
        });
      }
    });

    /**
     * 11 种 kind 共有的 `function` / `node_refnos` / `chain_id` / `chain_seq`：给了合法值原样透传（strict
     * 下是共有白名单字段），缺省不凭空出现，形状不对点名整包拒绝。
     */
    it('accepts function / node_refnos / chain_id / chain_seq on every primitive kind', () => {
      expect(new Set(everyKind.map(primitive => primitive.kind)).size).toBe(11);
      const tagged = everyKind.map((primitive, index) => ({
        ...primitive,
        function: '定位尺寸',
        node_refnos: index % 2 === 0 ? ['24383_91814', '24383_91815'] : [],
        chain_id: `chain:${index}`,
        chain_seq: index,
      }));
      for (const strict of [false, true]) {
        const result = withPrimitives(tagged, { strict });
        expect(result.ok, `strict ${String(strict)}`).toBe(true);
        if (result.ok) expect(result.data.primitives).toEqual(tagged);
      }

      // 链 id 可以不带段序。
      expect(withPrimitives([{ ...byKind('linear_dim'), chain_id: 'chain:0' }], { strict: true }))
        .toMatchObject({ ok: true });

      const bare = withPrimitives([...everyKind]);
      expect(bare.ok).toBe(true);
      if (bare.ok) {
        for (const field of ['function', 'node_refnos', 'chain_id', 'chain_seq']) {
          expect(bare.data.primitives.every(primitive => !(field in primitive)), field).toBe(true);
        }
      }
    });

    it('rejects malformed function / node_refnos / chain fields, naming the primitive', () => {
      for (const primitive of everyKind) {
        const kind = primitive.kind as string;
        for (const fn of ['', 7, null, ['一级尺寸']]) {
          expectRejected({ ...primitive, function: fn }, `${kind} function ${JSON.stringify(fn)}`);
        }
        for (const nodes of ['24383_91814', [''], [24383], ['24383_91814', null], null]) {
          expectRejected({ ...primitive, node_refnos: nodes }, `${kind} node_refnos ${JSON.stringify(nodes)}`);
        }
        for (const chainId of ['', 3, null]) {
          expectRejected({ ...primitive, chain_id: chainId, chain_seq: 0 }, `${kind} chain_id ${JSON.stringify(chainId)}`);
        }
        for (const chainSeq of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '0', null]) {
          expectRejected({ ...primitive, chain_id: 'chain:0', chain_seq: chainSeq }, `${kind} chain_seq ${String(chainSeq)}`);
        }
        // 段序不能脱离链 id 单独出现。
        expectRejected({ ...primitive, chain_seq: 0 }, `${kind} chain_seq without chain_id`);
      }
    });

    /**
     * `text_height_mm` 扩到 `linear_dim` / `label` / `angle_dim` / `slope_mark`（`aid_text` 早已有），规则同
     * `aid_text`：有限正数；`text_up` 加在 `linear_dim` / `label` / `aid_text` / `slope_mark` 上：有限、非零
     * 三维向量。别的 kind 上出现时默认当契约外字段忽略，strict 才拒。
     */
    it('accepts text_height_mm and text_up on their kinds and rejects degenerate values', () => {
      const heightKinds = ['linear_dim', 'label', 'angle_dim', 'slope_mark', 'aid_text'];
      const upKinds = ['linear_dim', 'label', 'aid_text', 'slope_mark'];

      const declared = everyKind
        .filter(primitive => heightKinds.includes(primitive.kind as string) || upKinds.includes(primitive.kind as string))
        .map(primitive => ({
          ...primitive,
          ...(heightKinds.includes(primitive.kind as string) ? { text_height_mm: 12.5 } : {}),
          ...(upKinds.includes(primitive.kind as string) ? { text_up: [0, 0, 1] } : {}),
        }));
      for (const strict of [false, true]) {
        const result = withPrimitives(declared, { strict });
        expect(result.ok, `strict ${String(strict)}`).toBe(true);
        if (result.ok) expect(result.data.primitives).toEqual(declared);
      }
      const bare = withPrimitives([...everyKind]);
      expect(bare.ok).toBe(true);
      if (bare.ok) {
        expect(bare.data.primitives.some(primitive => 'text_up' in primitive)).toBe(false);
        expect(bare.data.primitives.some(primitive => 'text_height_mm' in primitive)).toBe(false);
      }

      for (const kind of heightKinds) {
        for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '12.5', null]) {
          expectRejected({ ...byKind(kind), text_height_mm: height }, `${kind} text_height_mm ${String(height)}`);
        }
      }
      for (const kind of upKinds) {
        for (const up of [[0, 0, 0], [Number.NaN, 0, 1], [0, 1], 'up', null]) {
          expectRejected({ ...byKind(kind), text_up: up }, `${kind} text_up ${JSON.stringify(up)}`);
        }
      }

      // 只属于各自那几种 kind：落在别的 kind 上，默认忽略，strict 拒。
      const strays: readonly Record<string, unknown>[] = [
        { ...byKind('weld_mark'), text_height_mm: 12.5 },
        { ...byKind('angle_dim'), text_up: [0, 0, 1] },
        { ...byKind('aid_line'), text_up: [0, 0, 1] },
      ];
      for (const stray of strays) {
        expect(withPrimitives([stray]).ok, `${stray.kind as string} default`).toBe(true);
        expect(withPrimitives([stray], { strict: true }), `${stray.kind as string} strict`)
          .toMatchObject({ ok: false });
      }
    });
  });
});
