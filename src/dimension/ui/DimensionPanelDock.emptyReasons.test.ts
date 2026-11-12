import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { emptyDimensionDocument } from '../domain/testFixtures';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { MbdV2Issue, MbdV2PipeData } from '../adapters/mbdV2Contract';
import type { MbdDiagnosticsSourceSnapshot } from '@/composables/useMbdDiagnosticsStore';

import { useMbdDiagnosticsStore } from '@/composables/useMbdDiagnosticsStore';
import { createMbdExternalSync } from '@/composables/useMbdExternalSync';

const mocks = vi.hoisted(() => ({
  currentUser: { value: { id: 'designer-1', role: 'designer' } },
  dimensionSystem: { value: null as any },
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser: mocks.currentUser }),
}));
vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ dimensionSystem: mocks.dimensionSystem }),
}));
vi.mock('@/ribbon/toastBus', () => ({
  emitToast: vi.fn(),
}));

const apps: ReturnType<typeof createApp>[] = [];

function mountPanel(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(DimensionPanelDock);
  apps.push(app);
  app.mount(host);
  return host;
}

function createSystem() {
  const state = emptyDimensionDocument();
  return {
    externalRegistry: new ExternalDimensionRegistry(),
    document: {
      state,
      canUndo: false,
      canRedo: false,
      subscribe(listener: (next: typeof state) => void) {
        listener(state);
        return vi.fn();
      },
    },
    viewport: {
      getSelection: () => null,
      setSelection: vi.fn(),
      setDisplayMode: vi.fn(),
      subscribeSelection: () => vi.fn(),
      getLayouts: () => [] as readonly unknown[],
      subscribeLayouts: () => vi.fn(),
    },
    pointer: { start: vi.fn() },
    snapPort: null,
    getRecoveryPreview: () => null,
    acceptRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    exportSvg: vi.fn(() => '<svg/>'),
  };
}

/** 最终标注包里的原话（`respond-final-b3-83f69d8`）。 */
const WORDS = {
  emptyBranch: 'branch has no members; nothing to split',
  supportNothing: 'nothing to annotate on this support: 0 usable member(s) (section members, plates, hangers, clamps, legs), 3 element(s) '
    + 'skipped for missing geometry, 0 point ATTA(s) on its pipes; they give 0 dimension line(s) and 0 label(s)',
  em4NoAtta: 'the support has no point ATTA on its pipes: no wall search, no reference look direction and no near walls (PML errors on the '
    + 'unset mbdlocation, suiSupport.pmlobj:2388)',
  partGeometry: 'SCTN 24383_80215 has no usable section data (POSS / POSE / section points); skipped',
  viewIssue: '3 根型钢（SCTN / GENSEC）没有 SPRE（Nulref）：24383_80215、24383_80216、24383_80217。库里没有它们的截面规格（E3D 只画中心线），'
    + '没有截面点、PPLI 与目录原语，这几根的型钢尺寸出不了',
  archFloor: 'nothing to annotate on this arch floor: no wall near the slab; no room over the slab; no NXTR trench in the slab '
    + '(markCivil.drawarch L1691-1710 draws only wall names and doors, room numbers with their elevations, and trench openings)',
  templateWall: 'STWALL 15201_379 没有截面（SPRE 没设）：在 E3D 里没有实体，不标——PML 土建窗体在这种墙上读不出厚度，不出图',
} as const;

let issueSeq = 0;
function issue(refno: string, ruleId: string | undefined, message: string, overrides: Partial<MbdV2Issue> = {}): MbdV2Issue {
  issueSeq += 1;
  return {
    id: `${refno}:issue:${issueSeq}`,
    severity: 'info',
    category: 'data',
    message,
    refno,
    ...(ruleId === undefined ? {} : { rule_id: ruleId }),
    ...overrides,
  };
}

/** 146 个 EM4 空支架的那一种组合：服务端的中文一句 + 求解器的三种英文。 */
function em4SupportIssues(refno: string): MbdV2Issue[] {
  return [
    issue(refno, 'data.view_issue', WORDS.viewIssue, { severity: 'warning' }),
    issue(refno, 'support.em4_no_pipe_atta', WORDS.em4NoAtta),
    issue(refno, 'support.part_geometry_missing', WORDS.partGeometry),
    issue(refno, 'support.nothing_to_annotate', WORDS.supportNothing),
  ];
}

function source(
  refno: string,
  overrides: Partial<MbdDiagnosticsSourceSnapshot> = {},
): MbdDiagnosticsSourceSnapshot {
  return {
    refno,
    issues: [],
    skipped: [],
    layoutMode: null,
    notes: [],
    sourceVersion: null,
    isolines: [],
    loadError: null,
    ...overrides,
  };
}

async function show(sources: readonly MbdDiagnosticsSourceSnapshot[]): Promise<HTMLElement> {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  mocks.dimensionSystem.value = createSystem();
  const failed = sources.find(entry => entry.loadError !== null);
  useMbdDiagnosticsStore().set({
    channel: 'api',
    sourceId: sources.map(entry => entry.refno).join(','),
    issues: sources.flatMap(entry => entry.issues),
    skipped: sources.flatMap(entry => entry.skipped),
    sources,
    // 同步层的做法：有包装载失败时顶层也写一句。
    ...(failed ? { loadError: failed.loadError } : {}),
  });
  const host = mountPanel();
  await nextTick();
  return host;
}

const squeeze = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const reasons = (host: HTMLElement) => host.querySelector('[data-testid="mbd-empty-reasons"]');
const rowsOf = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="mbd-empty-reason"]')];
const linesOf = (row: Element) => [...row.querySelectorAll('[data-testid="mbd-empty-reason-line"]')];
const diagnosticsOf = (host: HTMLElement) =>
  host.querySelector('[data-testid="mbd-diagnostics"]') as HTMLDetailsElement | null;

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  mocks.dimensionSystem.value = null;
  useMbdDiagnosticsStore().clear();
  window.history.replaceState({}, '', '/');
});

/**
 * 票 134（#103）：标注包回 200 却一个图元都没有（空包）时，原因只写在缺省收起的诊断里，求解器的说明还全是英文
 * （建筑空楼板那句末尾带着 PML 的方法名与行号）。空包的提示条说「原因见尺寸面板的诊断」，用户打开面板还得自己找、自己读英文。
 * 要做成：面板在「BRAN 尺寸标注（MBD）」那一块的标题下直接写一两行中文的「为什么没有标注」，不用展开诊断区；
 * 原文与 PML 行号留在诊断区里给开发看，别的诊断不动。
 */
describe('DimensionPanelDock：空包时在标题下写为什么没有标注', () => {
  it('writes the Chinese reason right under the title, without opening the diagnostics', async () => {
    const host = await show([source('32573_1', {
      empty: true,
      issues: [issue('32573_1', 'data.empty_branch', WORDS.emptyBranch)],
    })]);

    const box = reasons(host);
    expect(box).not.toBeNull();
    // 在「BRAN 尺寸标注（MBD）」那一块里面、标题行的后面。
    const titleBlock = host.querySelector('[data-testid="mbd-refno"]')!;
    expect(titleBlock.contains(box)).toBe(true);
    const title = [...titleBlock.querySelectorAll('span')].find(node => squeeze(node.textContent) === 'BRAN 尺寸标注（MBD）')!;
    expect(title.compareDocumentPosition(box!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 一出现就读给读屏用户，不抢话。
    expect(box!.getAttribute('role')).toBe('status');

    const [row] = rowsOf(host);
    expect(squeeze(row!.textContent)).toBe('没有标注：这条支管下面没有任何管件，没有可标注的内容。');
    expect(row!.getAttribute('data-refno')).toBe('32573_1');
    expect(row!.getAttribute('data-reason')).toBe('given');
    expect(linesOf(row!).map(line => [line.getAttribute('data-rule-id'), line.getAttribute('data-origin')]))
      .toEqual([['data.empty_branch', 'rule']]);

    // 诊断区没有被动过：照旧收着，英文原话照旧在里面。
    const diagnostics = diagnosticsOf(host)!;
    expect(diagnostics.open).toBe(false);
    expect(squeeze(diagnostics.textContent)).toContain(WORDS.emptyBranch);
    // 标题下不带英文原话。
    expect(squeeze(box!.textContent)).not.toContain('branch has no members');
  });

  it('writes two lines at most: why it is empty first, then the server\'s own Chinese note', async () => {
    const host = await show([source('24383_80213', {
      empty: true,
      annotationType: 'em4_supp',
      issues: em4SupportIssues('24383_80213'),
    })]);

    const [row] = rowsOf(host);
    const lines = linesOf(row!);
    expect(lines.map(line => line.getAttribute('data-rule-id'))).toEqual(['support.nothing_to_annotate', 'data.view_issue']);
    expect(lines.map(line => line.getAttribute('data-origin'))).toEqual(['rule', 'server']);
    expect(squeeze(lines[0]!.textContent)).toBe('这个支架的构件出不了尺寸，也出不了标签，没有可标注的内容。');
    // 服务端的说明本来就是中文：一个字不改。
    expect(squeeze(lines[1]!.textContent)).toBe(WORDS.viewIssue);
    // 另两条细节（英文）不上来，留在诊断区。
    expect(squeeze(reasons(host)!.textContent)).not.toMatch(/ATTA on its pipes|has no usable section data|nothing to annotate/);
    const diagnostics = squeeze(diagnosticsOf(host)!.textContent);
    for (const words of [WORDS.viewIssue, WORDS.em4NoAtta, WORDS.partGeometry, WORDS.supportNothing]) {
      expect(diagnostics).toContain(words);
    }
  });

  it('keeps the PML method names and line numbers out of the line under the title', async () => {
    const host = await show([source('24381_37090', {
      empty: true,
      annotationType: 'arch',
      issues: [issue('24381_37090', 'civil.nothing_to_annotate', WORDS.archFloor)],
    })]);

    expect(squeeze(rowsOf(host)[0]!.textContent))
      .toBe('没有标注：这块建筑楼板上没有可标注的内容：建筑窗体只标墙名与门、房间号与标高、地沟开孔，这里三样都没有能标的。');
    expect(squeeze(reasons(host)!.textContent)).not.toMatch(/markCivil|L1691/);
    expect(squeeze(diagnosticsOf(host)!.textContent)).toContain('markCivil.drawarch L1691-1710');
  });

  it('uses the server\'s Chinese sentence as it is when that is the reason', async () => {
    const host = await show([source('15201_379', {
      empty: true,
      issues: [issue('15201_379', 'adapter.civil_wall_without_solid', WORDS.templateWall)],
    })]);

    expect(squeeze(rowsOf(host)[0]!.textContent)).toBe(`没有标注：${WORDS.templateWall}`);
    expect(linesOf(rowsOf(host)[0]!)[0]!.getAttribute('data-origin')).toBe('server');
  });

  it('says so, apart from the packages that have a reason, when the backend gave none', async () => {
    const host = await show([source('24381_1', { empty: true })]);

    const [row] = rowsOf(host);
    expect(squeeze(row!.textContent)).toBe('没有标注：后端没有给出原因。');
    // 与带原因的分开：另一种标记、另一个元素，不混在原因行里。
    expect(row!.getAttribute('data-reason')).toBe('none');
    expect(linesOf(row!)).toHaveLength(0);
    expect(row!.querySelector('[data-testid="mbd-empty-reason-none"]')).not.toBeNull();
  });

  it('shows the original text, without failing, for a rule id it has no Chinese for', async () => {
    const host = await show([source('X', {
      empty: true,
      issues: [issue('X', 'equi.some_future_rule', 'a reason this front end has never heard of')],
    })]);

    const [row] = rowsOf(host);
    expect(squeeze(row!.textContent)).toBe('没有标注：a reason this front end has never heard of');
    expect(linesOf(row!)[0]!.getAttribute('data-origin')).toBe('original');
    expect(row!.getAttribute('data-reason')).toBe('given');
  });

  it('does not write the line for a package that has primitives, even with the same diagnostics', async () => {
    const host = await show([source('24384_2031', {
      empty: false,
      issues: [
        issue('24384_2031', 'support.part_geometry_missing', WORDS.partGeometry),
        issue('24384_2031', 'data.view_issue', WORDS.viewIssue, { severity: 'warning' }),
      ],
    })]);

    expect(reasons(host)).toBeNull();
    // 没说是不是空包的老快照也不猜。
    const legacy = await show([source('OLD', { issues: [issue('OLD', 'data.empty_branch', WORDS.emptyBranch)] })]);
    expect(reasons(legacy)).toBeNull();
  });

  it('leaves a package that failed to load to the load-failure badge', async () => {
    const host = await show([source('24381_71247', { empty: false, loadError: 'MBD 负载契约错误：primitives[3].text_height 必须为正' })]);

    expect(reasons(host)).toBeNull();
    expect(host.querySelector('[data-testid="mbd-error-badge"]')).not.toBeNull();
  });

  it('names each empty package when several objects are on screen, in the order they were asked for', async () => {
    const host = await show([
      source('24383_80213', { empty: true, issues: em4SupportIssues('24383_80213') }),
      source('24381_145018', { empty: false }),
      source('24381_1', { empty: true }),
      source('32573_1', { empty: true, issues: [issue('32573_1', 'data.empty_branch', WORDS.emptyBranch)] }),
    ]);

    const rows = rowsOf(host);
    expect(rows.map(row => row.getAttribute('data-refno'))).toEqual(['24383_80213', '24381_1', '32573_1']);
    expect(rows.map(row => row.getAttribute('data-reason'))).toEqual(['given', 'none', 'given']);
    expect(squeeze(rows[0]!.textContent)).toMatch(/^24383_80213 没有标注：这个支架的构件出不了尺寸/);
    expect(squeeze(rows[1]!.textContent)).toBe('24381_1 没有标注：后端没有给出原因。');
    expect(squeeze(rows[2]!.textContent)).toBe('32573_1 没有标注：这条支管下面没有任何管件，没有可标注的内容。');
    // 有图元的那个对象不点名。
    expect(squeeze(reasons(host)!.textContent)).not.toContain('24381_145018');
  });

  it('names the empty package even when it is the only empty one among several', async () => {
    const host = await show([
      source('24381_145018', { empty: false }),
      source('32573_1', { empty: true, issues: [issue('32573_1', 'data.empty_branch', WORDS.emptyBranch)] }),
    ]);

    expect(squeeze(rowsOf(host)[0]!.textContent)).toBe('32573_1 没有标注：这条支管下面没有任何管件，没有可标注的内容。');
  });

  it('follows the package through the real sync layer: empty, drawn, gone', async () => {
    mocks.dimensionSystem.value = createSystem();
    const payload = (refno: string, primitives: MbdV2PipeData['primitives'], issues: readonly MbdV2Issue[]): MbdV2PipeData => ({
      version: 'v2',
      input_refno: refno,
      branch_refno: refno,
      primitives,
      meta: {
        geometry_space: 'source_mm',
        source_to_design: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        notes: [],
      },
      issues,
    });
    const dim = (refno: string): MbdV2PipeData['primitives'] => [{
      kind: 'linear_dim',
      id: `${refno}:dim-1`,
      start: [0, 0, 0],
      end: [1, 0, 0],
      text: '1000',
      extension_lines: [
        { from: [0, 0, 0], to: [0, 0.1, 0] },
        { from: [1, 0, 0], to: [1, 0.1, 0] },
      ],
      arrow_lines: [
        { from: [0, 0, 0], to: [0.1, 0.05, 0] },
        { from: [1, 0, 0], to: [0.9, 0.05, 0] },
      ],
      label_anchor: [0.5, 0.1, 0],
    }];
    const packages: Record<string, MbdV2PipeData> = {
      BRANCH: payload('BRANCH', [], [issue('BRANCH', 'data.empty_branch', WORDS.emptyBranch)]),
      SILENT: payload('SILENT', [], []),
      PIPE: payload('PIPE', dim('PIPE'), [issue('PIPE', 'support.part_geometry_missing', WORDS.partGeometry)]),
    };
    let search = '';
    const sync = createMbdExternalSync({
      fetchPipeData: async refno => ({ ok: true as const, data: packages[refno]!, diagnostics: [] }),
      diagnostics: useMbdDiagnosticsStore(),
      getSearch: () => search,
      emitToast: vi.fn(),
    });
    const target = { replaceExternalSource: vi.fn() };
    const open = async (next: string): Promise<void> => {
      search = next;
      await sync.sync(target);
      await nextTick();
    };
    const host = mountPanel();
    await nextTick();
    expect(reasons(host)).toBeNull();

    await open('?mbd_refno=BRANCH');
    expect(squeeze(rowsOf(host)[0]!.textContent)).toBe('没有标注：这条支管下面没有任何管件，没有可标注的内容。');

    // `mbd_kinds` 把一个有图元的包滤到一条不剩：那不是空包，不写。
    await open('?mbd_refno=PIPE&mbd_kinds=weld_mark');
    expect(target.replaceExternalSource).toHaveBeenLastCalledWith('mbd', []);
    expect(reasons(host)).toBeNull();

    await open('?mbd_refno=SILENT');
    expect(squeeze(rowsOf(host)[0]!.textContent)).toBe('没有标注：后端没有给出原因。');

    await open('?mbd_refno=PIPE,BRANCH');
    expect(rowsOf(host).map(row => squeeze(row.textContent)))
      .toEqual(['BRANCH 没有标注：这条支管下面没有任何管件，没有可标注的内容。']);

    // 清空来源：跟着没。
    await open('');
    expect(reasons(host)).toBeNull();
  });
});
