import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import { buildPipeInformation, pipeInformationToExternalDimensions, validatePipeInformationRecord } from '../adapters/pipeInformation';
import { emptyDimensionDocument, linearRecord } from '../domain/testFixtures';
import { LffFont } from '../kernel/glyph/lffParser';
import { ExternalDimensionRegistry } from '../services/externalDimensionRegistry';

import DimensionPanelDock from './DimensionPanelDock.vue';

import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';

import * as v1Api from '@/api/genModelV1Api';
import { usePipeInformationStore } from '@/composables/usePipeInformationStore';

const mocks = vi.hoisted(() => ({
  currentUser: {
    value: { id: 'designer-1', role: 'designer' } as {
      id: string;
      role: string;
    } | null,
  },
  dimensionSystem: { value: null as any },
  emitToast: vi.fn(),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({ currentUser: mocks.currentUser }),
}));
vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ dimensionSystem: mocks.dimensionSystem }),
}));
vi.mock('@/ribbon/toastBus', () => ({
  emitToast: mocks.emitToast,
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
  const state = emptyDimensionDocument([
    linearRecord({ authorId: 'designer-1' }),
  ]);
  const external: ExternalDimensionRecord = {
    id: 'mbd-1',
    source: 'mbd',
    sourceLabel: 'MBD',
    role: 'external-reference',
    layout: {
      id: 'mbd-1',
      kind: 'linear',
      role: 'external-reference',
      labelPinned: false,
      a: [0, 1, 0],
      b: [1, 1, 0],
      placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    },
  };
  const externalRegistry = new ExternalDimensionRegistry();
  externalRegistry.replaceSource('mbd', [external]);
  const setSelection = vi.fn();
  const setDisplayMode = vi.fn();
  const layoutListeners = new Set<(layouts: readonly unknown[]) => void>();
  return {
    externalRegistry,
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
      setSelection,
      setDisplayMode,
      subscribeSelection: () => vi.fn(),
      getLayouts: () => [] as readonly unknown[],
      subscribeLayouts(listener: (layouts: readonly unknown[]) => void) {
        layoutListeners.add(listener);
        return () => layoutListeners.delete(listener);
      },
    },
    setDisplayMode,
    /** Test seam: push a layout batch as the real viewport would after a re-layout. */
    emitLayouts(layouts: readonly unknown[]) {
      layoutListeners.forEach(listener => listener(layouts));
    },
    pointer: { start: vi.fn() },
    snapPort: null,
    getRecoveryPreview: () => null,
    acceptRecovery: vi.fn(),
    discardRecovery: vi.fn(),
    exportSvg: vi.fn(() => '<svg/>'),
    setSelection,
  };
}

afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  document.body.innerHTML = '';
  mocks.dimensionSystem.value = null;
  mocks.emitToast.mockReset();
});

describe('DimensionPanelDock', () => {
  it('loads business pipe tags, preserves provenance and missing fields, and isolates persisted/late responses', async () => {
    const store = usePipeInformationStore();
    store.detachPersistence(); store.clear();
    const raw = new Map<string,string>();
    const storage = { getItem: (key: string) => raw.get(key) ?? null, setItem: (key: string, value: string) => { raw.set(key, value); } };
    store.bindPersistence('pipe-info-A', storage);
    const attr = (name: string, value: unknown) => ({ name, value, display: String(value), is_unset: false, is_uda: false, editable: false, value_type: 'stored' });
    const attributes = { source: 'e3d-io', refno: '7997/1', noun: 'BRAN', sesno: 42, complete: true,
      attributes: [attr('NAME', '/PIPE-A'), attr('HBOR', 100), attr('TBOR', 50), attr('MATR', '0/0'), attr('ISPE', '0/0')] };
    const centerline = { refno: '7997_1', dbnum: 7997, segment_count: 2, outside_diameter_mm: 110, centerline_bbox: null, warnings: [],
      segments: [{ refno: '7997_1~7997_2', order: 0, implicit: true, noun: 'TUBI', start: { x: 1000, y: 2000, z: 3000 }, end: { x: 2000, y: 2000, z: 3000 }, length_mm: 1000, outside_diameter_mm: null },
        { refno: '7997_2', order: 1, implicit: false, noun: 'ELBO', start: { x: 2000, y: 2000, z: 3000 }, end: { x: 2100, y: 2100, z: 3000 }, length_mm: 141.42, outside_diameter_mm: 110 }] };
    const attrsSpy = vi.spyOn(v1Api, 'genModelV1ElementAttributes').mockResolvedValue(attributes);
    const centerSpy = vi.spyOn(v1Api, 'genModelV1SpatialCenterline').mockResolvedValue(centerline);
    const boundsSpy = vi.spyOn(v1Api, 'genModelV1ModelBounds').mockRejectedValue(new Error('no generated geometry'));
    try {
      expect(await store.refresh('7997/1')).toBe(true);
      const record = store.records.value[0]!;
      expect(record.fields.find(field => field.key === 'head-bore')?.text).toBe('100 mm');
      expect(record.fields.find(field => field.key === 'material')).toMatchObject({ text: '未设置', status: 'missing' });
      expect(record.fields.find(field => field.key === 'outer-diameter')?.status).toBe('unconfirmed');
      expect(record.fields.find(field => field.key === 'envelope')?.status).toBe('unconfirmed');
      expect(record.fields.find(field => field.key === 'straight-length')?.text).toBe('1000 mm');
      expect(record.warnings.join('；')).toContain('模型边界不可用');
      const external = pipeInformationToExternalDimensions([record])[0]!;
      expect(external.source).toBe('pipe-information');
      expect((external.layout as any).tag.target).toEqual([1,2,3]);
      expect((external.layout as any).tag.lines.map((line: any) => line.text).join(' ')).toContain('业务材质：未设置');
      const system = createSystem(); mocks.dimensionSystem.value = system;
      const host = mountPanel(); host.querySelector('details')?.setAttribute('open', '');
      expect(host.textContent).toContain('属性会话 42');
      expect(host.textContent).toContain('业务材质');
      expect(record.memberDiameters?.map(member => member.source)).toEqual(['missing', 'unknown']);
      // A varying branch must retain implicit-tube diameter and distinguish estimates.
      const enrichedLine = { ...centerline, segments: [
        { ...centerline.segments[0]!, outside_diameter_mm: 114.3, diameter_evidence: { source: 'catalogue' as const, catalogue_od_mm: 114.3, arrive_bore_mm: 100 } },
        { ...centerline.segments[1]!, outside_diameter_mm: 55, diameter_evidence: { source: 'bore-estimate' as const, catalogue_od_mm: null, arrive_bore_mm: 50 } },
      ] };
      const enriched = buildPipeInformation({ refno: '7997_1', attributes, centerline: enrichedLine });
      expect(enriched.fields.find(field => field.key === 'outer-diameter')).toMatchObject({ text: '55 mm ～ 114.3 mm（2/2段）', status: 'unconfirmed' });
      expect(enriched.memberDiameters?.map(member => member.source)).toEqual(['catalogue', 'bore-estimate']);
      expect(enriched.memberDiameters?.[1]?.sourceText).toContain('到达通径 50 mm');
      const inconsistent = buildPipeInformation({ refno: '7997_1', attributes, centerline: { ...enrichedLine, segments: [
        { ...enrichedLine.segments[0]!, diameter_evidence: { source: 'catalogue', catalogue_od_mm: 999, arrive_bore_mm: 100 } },
      ] } });
      expect(inconsistent.memberDiameters?.[0]?.source).toBe('unknown');
      centerSpy.mockResolvedValueOnce(enrichedLine);
      expect(await store.refresh('7997_1')).toBe(true);
      await nextTick();
      expect(host.textContent).toContain('逐段外径及来源');
      expect(host.textContent).toContain('管子目录 PARA[2]');
      expect(host.textContent).toContain('估算：min');
      store.setHidden('7997_1', true); store.persistRecords();
      store.bindPersistence('pipe-info-B', storage); expect(store.records.value).toEqual([]);
      store.bindPersistence('pipe-info-A', storage); expect(store.records.value[0]?.stale).toBe(true);
      expect(store.records.value[0]?.memberDiameters?.map(member => member.source)).toEqual(['catalogue', 'bore-estimate']);
      expect(store.hiddenRefnos.value).toEqual(['7997_1']);
      expect((pipeInformationToExternalDimensions(store.records.value)[0]!.layout as any).tag.lines[0].text).toContain('过期');
      const retained = JSON.parse(JSON.stringify(store.records.value));
      centerSpy.mockRejectedValueOnce(new Error('HVAC branch'));
      expect(await store.refresh('7997_1')).toBe(false); expect(store.records.value).toEqual(retained);
      let finish!: (value: typeof attributes) => void;
      attrsSpy.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const pending = store.refresh('7997_1'); store.bindPersistence('pipe-info-B', storage); finish(attributes);
      expect(await pending).toBe(false); expect(store.records.value).toEqual([]);
      attrsSpy.mockResolvedValue({ ...attributes, attributes: [...attributes.attributes, attr('MATN','ASTM A106 Gr.B')] });
      expect(await store.refresh('7997_1')).toBe(true);
      expect(store.records.value[0]?.fields.find(field => field.key === 'material')?.text).toBe('ASTM A106 Gr.B');
      attrsSpy.mockImplementation(async refno => {
        if (refno.replace('_','/') === '7997/10') return { ...attributes, refno: '7997/10', noun: 'PIPE', attributes: [attr('MATR','7997/20')] };
        if (refno.replace('_','/') === '7997/20') return { ...attributes, refno: '7997/20', noun: 'MATE', attributes: [attr('DESC','A312 TP316L')] };
        return { ...attributes, attributes: [...attributes.attributes, attr('OWNER','7997/10')] };
      });
      expect(await store.refresh('7997_1')).toBe(true);
      expect(store.records.value[0]?.fields.find(field => field.key === 'material')).toMatchObject({ text: 'A312 TP316L', source: '7997/10@42:MATR → 7997/20@42' });
      expect(() => buildPipeInformation({ refno: '7997_2', attributes, centerline })).toThrow('这根 BRAN');
      const version = { dbnum: 7997, sesno: 42, databases: [{ dbnum: 7997, sesno: 42, db_type: 'DESI' }] };
      const currentAttrs = { ...attributes, dbnum: 7997 };
      const currentLine = { ...enrichedLine, source_version: version };
      const matched = buildPipeInformation({ refno: '7997_1', attributes: currentAttrs, centerline: currentLine });
      expect(matched.sourceVersion).toEqual(version);
      expect(matched.fields.find(field => field.key === 'source-version')?.text).toContain('属性与中心线同版本');
      expect(() => buildPipeInformation({ refno: '7997_1', attributes: { ...currentAttrs, sesno: 41 }, centerline: currentLine })).toThrow('版本不一致');
      expect(() => buildPipeInformation({ refno: '7997_1', attributes: currentAttrs, centerline: { ...currentLine, source_version: { ...version, databases: [...version.databases, ...version.databases] } } })).toThrow('版本信息无效');
      const oldBox = { refno: '7997_1', scope: 'subtree' as const, min_mm: [0,0,0] as [number,number,number], max_mm: [3000,3000,3000] as [number,number,number],
        model_count: 2, source: 'model-memory', stale: null, publication_status: 'unsupported', record_source_sessions: [{ dbnum: 7997, sesno: 41 }] };
      const versioned = buildPipeInformation({ refno: '7997_1', attributes: currentAttrs, centerline: currentLine, bounds: oldBox });
      expect(versioned.warnings.join('；')).toContain('不同源版本');
      const font = LffFont.fromText(gunzipSync(readFileSync('public/fonts/unicode.lff.bin')).toString('utf8'));
      const cardText = (pipeInformationToExternalDimensions([versioned])[0]!.layout as any).tag.lines.map((line: any) => line.text).join('');
      expect([...cardText].filter(character => font.getGlyph(character.codePointAt(0)!) === font.getGlyph(0xfffd))).toEqual([]);
      centerSpy.mockResolvedValue(currentLine);
      attrsSpy.mockImplementation(async refno => refno.replace('_','/') === '7997/2'
        ? { ...currentAttrs, refno: '7997/2', noun: 'ELBO', attributes: [attr('MATN','A312 TP316L')] }
        : currentAttrs);
      expect(await store.refresh('7997_1')).toBe(true);
      expect(store.records.value[0]?.memberMaterials).toEqual([
        { refno: '7997_1~7997_2', noun: 'TUBI', implicit: true, text: '未设置', source: '7997/1@42:HSTU', status: 'missing' },
        { refno: '7997_2', noun: 'ELBO', text: 'A312 TP316L', source: '7997/2@42:MATN', status: 'read' }]);
      const good = JSON.parse(JSON.stringify(store.records.value));
      attrsSpy.mockResolvedValueOnce({ ...currentAttrs, sesno: 43 });
      expect(await store.refresh('7997_1')).toBe(false); expect(store.records.value).toEqual(good);
      expect(store.error.value).toContain('版本不一致');
      store.persistRecords(); store.bindPersistence('pipe-info-A', storage); store.bindPersistence('pipe-info-B', storage);
      expect(store.records.value[0]?.sourceVersion).toEqual(version);
      const elbow = () => store.records.value[0]?.memberMaterials?.find(member => member.refno === '7997_2');
      const tube = () => store.records.value[0]?.memberMaterials?.find(member => member.implicit);
      expect(elbow()?.text).toBe('A312 TP316L');
      // Unset MATN/MATR: the member's own spec chain SPRE -> SPCO.MATX -> SMTE.XTEX, the head tube's BRAN HSTU chain,
      // never the BRAN material.
      centerSpy.mockResolvedValue({ ...currentLine, source_version: { ...version, databases: [...version.databases, { dbnum: 5054, sesno: 48, db_type: 'CATA' }] } });
      const spec = { member: [attr('OWNER','7997/1'), attr('SPRE','13246/1'), attr('ANGL', 90)], spco: [attr('MATX','13246/2')], smteDbnum: 5054, smteSesno: 48 };
      attrsSpy.mockImplementation(async refno => {
        const key = refno.replace('_','/');
        if (key === '7997/2') return { ...currentAttrs, refno: '7997/2', noun: 'ELBO', attributes: spec.member };
        if (key === '13246/1') return { ...currentAttrs, refno: '13246/1', noun: 'SPCO', dbnum: 5054, sesno: 48, attributes: spec.spco };
        if (key === '13246/3') return { ...currentAttrs, refno: '13246/3', noun: 'SPCO', dbnum: 5054, sesno: 48, attributes: [attr('MATX','13246/2')] };
        if (key === '13246/2') return { ...currentAttrs, refno: '13246/2', noun: 'SMTE', dbnum: spec.smteDbnum, sesno: spec.smteSesno, attributes: [attr('XTEX','Z2CN1810 RCCM 01')] };
        return { ...currentAttrs, attributes: [...currentAttrs.attributes, attr('MATN','BRAN ONLY'), attr('HSTU','13246/3')] };
      });
      expect(await store.refresh('7997_1')).toBe(true);
      const catalogued = store.records.value[0]!;
      expect(catalogued.memberMaterials).toEqual([
        { refno: '7997_1~7997_2', noun: 'TUBI', implicit: true, text: 'Z2CN1810 RCCM 01', status: 'read', source: '7997/1@42:HSTU → 13246/3@48:MATX → 13246/2@48:XTEX' },
        { refno: '7997_2', noun: 'ELBO', text: 'Z2CN1810 RCCM 01', status: 'read', source: '7997/2@42:SPRE → 13246/1@48:MATX → 13246/2@48:XTEX' }]);
      expect(catalogued.fields.find(field => field.key === 'member-materials')).toMatchObject({ text: 'Z2CN1810 RCCM 01（2/2段）', status: 'read' });
      // 90° ELBO with a 141.42 mm port chord: R = 100 mm, arc = 50π mm, added to the 1000 mm implicit tube.
      expect(catalogued.bendArcs).toHaveLength(1);
      expect(catalogued.bendArcs![0]).toMatchObject({ refno: '7997_2', noun: 'ELBO', angleDeg: 90, source: '7997/2@42:ANGL + 中心线端口弦长' });
      expect(catalogued.bendArcs![0]!.radiusMm).toBeCloseTo(100, 6);
      expect(catalogued.bendArcs![0]!.arcMm).toBeCloseTo(50 * Math.PI, 6);
      expect(catalogued.fields.find(field => field.key === 'straight-length')?.text).toBe('1000 mm');
      expect(catalogued.fields.find(field => field.key === 'length-with-bends')).toMatchObject({ text: '1157.08 mm', status: 'unconfirmed' });
      expect(catalogued.fields.find(field => field.key === 'top-bottom-elevation')?.text).toBe('管顶最高 3057.15 mm，管底最低 2942.85 mm（1/1段）');
      const catalogueCard = (pipeInformationToExternalDimensions([catalogued])[0]!.layout as any).tag.lines.map((line: any) => line.text).join('');
      expect([...catalogueCard].filter(character => font.getGlyph(character.codePointAt(0)!) === font.getGlyph(0xfffd))).toEqual([]);
      await nextTick();
      expect(host.textContent).toContain('成员材质及来源');
      expect(host.textContent).toContain('7997_1~7997_2 · 隐式直管 · Z2CN1810 RCCM 01');
      expect(host.textContent).toContain('7997/2@42:SPRE → 13246/1@48:MATX → 13246/2@48:XTEX');
      expect(host.textContent).toContain('弯头弧长及来源');
      expect(host.textContent).toContain('弧长 157.08 mm · 推算半径 100 mm');
      expect(host.textContent).toContain('直管段标高');
      expect(host.textContent).toContain('中心线 3000 mm → 3000 mm · 管顶 3057.15 mm · 管底 2942.85 mm · 外径 114.3 mm');
      store.persistRecords(); store.bindPersistence('pipe-info-A', storage); store.bindPersistence('pipe-info-B', storage);
      expect(store.records.value[0]?.bendArcs?.[0]?.arcMm).toBeCloseTo(50 * Math.PI, 6);
      expect(tube()).toMatchObject({ implicit: true, status: 'read' });
      spec.smteSesno = 47;
      expect(await store.refresh('7997_1')).toBe(true);
      expect(elbow()).toMatchObject({ text: '未核实', status: 'unconfirmed' });
      expect(elbow()?.source).toContain('版本不一致');
      expect(tube()).toMatchObject({ text: '未核实', status: 'unconfirmed' });
      spec.smteSesno = 48; spec.smteDbnum = 5055;
      expect(await store.refresh('7997_1')).toBe(true);
      expect(elbow()).toMatchObject({ text: 'Z2CN1810 RCCM 01', status: 'unconfirmed' });
      spec.smteDbnum = 5054; spec.spco = [];
      expect(await store.refresh('7997_1')).toBe(true);
      expect(elbow()).toMatchObject({ text: '未设置', status: 'missing' });
      expect(tube()).toMatchObject({ text: 'Z2CN1810 RCCM 01', status: 'read' });
      spec.member = [attr('OWNER','7997/1')];
      expect(await store.refresh('7997_1')).toBe(true);
      expect(elbow()).toEqual({ refno: '7997_2', noun: 'ELBO', text: '未设置', status: 'missing', source: '7997/2@42:MATN/MATR/SPRE' });
      expect(store.records.value[0]?.fields.find(field => field.key === 'member-materials')).toMatchObject({ text: 'Z2CN1810 RCCM 01（1/2段）', status: 'unconfirmed' });
      expect(store.records.value[0]?.bendArcs?.[0]).toMatchObject({ angleDeg: null, arcMm: null });
      expect(store.records.value[0]?.fields.find(field => field.key === 'length-with-bends')).toMatchObject({ text: '未设置', status: 'missing' });
      expect(store.records.value[0]?.warnings.join('；')).toContain('1 个弯头/弯管缺少有效角度或端口');
      // Top/bottom of a straight tube: ±r for horizontal, 0 offset for vertical, r·√(1 − dz²) when sloped; no value without OD.
      const elevationLine = { ...centerline, segments: [
        { refno: 'Head~7997_2', order: 0, implicit: true, noun: 'TUBI', start: { x: 0, y: 0, z: 3000 }, end: { x: 1000, y: 0, z: 3000 }, length_mm: 1000, outside_diameter_mm: 100 },
        { refno: '7997_2~7997_3', order: 1, implicit: true, noun: 'TUBI', start: { x: 1000, y: 0, z: 3000 }, end: { x: 1000, y: 0, z: 5000 }, length_mm: 2000, outside_diameter_mm: 100 },
        { refno: '7997_3~Tail', order: 2, implicit: true, noun: 'TUBI', start: { x: 1000, y: 0, z: 5000 }, end: { x: 2000, y: 0, z: 4990 }, length_mm: 1000.05, outside_diameter_mm: null },
      ] };
      const elevated = buildPipeInformation({ refno: '7997_1', attributes, centerline: elevationLine });
      expect(elevated.straightElevations?.map(item => [item.slope, item.topMm, item.bottomMm])).toEqual([['horizontal', 3050, 2950], ['vertical', 5000, 3000], ['sloped', null, null]]);
      expect(elevated.fields.find(field => field.key === 'centerline-elevation')?.text).toBe('3000 mm ～ 5000 mm');
      expect(elevated.fields.find(field => field.key === 'top-bottom-elevation')).toMatchObject({ text: '管顶最高 5000 mm，管底最低 2950 mm（2/3段）', status: 'unconfirmed' });
      const sloped = buildPipeInformation({ refno: '7997_1', attributes, centerline: { ...elevationLine, segments: [{ ...elevationLine.segments[2]!, outside_diameter_mm: 100 }] } });
      expect(sloped.straightElevations?.[0]?.topMm).toBeCloseTo(5000 + 50 * Math.sqrt(1 - (10 / Math.hypot(1000, 10)) ** 2), 9);
      const elevationCard = (pipeInformationToExternalDimensions([elevated])[0]!.layout as any).tag.lines.map((line: any) => line.text).join('');
      expect([...elevationCard].filter(character => font.getGlyph(character.codePointAt(0)!) === font.getGlyph(0xfffd))).toEqual([]);
      expect(validatePipeInformationRecord(JSON.parse(JSON.stringify(elevated))).straightElevations).toEqual(elevated.straightElevations);
    } finally { attrsSpy.mockRestore(); centerSpy.mockRestore(); boundsSpy.mockRestore(); store.detachPersistence(); store.clear(); }
  });
  it('merges external records with the document and keeps hide state visible', async () => {
    const system = createSystem();
    mocks.dimensionSystem.value = system;
    const host = mountPanel();

    expect(host.querySelector('[data-dimension-id="linear-1"]')).not.toBeNull();
    const externalRow = host.querySelector<HTMLElement>(
      '[data-dimension-id="mbd-1"]',
    );
    expect(externalRow?.textContent).toContain('只读');
    externalRow?.click();
    expect(system.viewport.setSelection).toHaveBeenCalledWith('mbd-1');

    const hide = externalRow?.querySelector<HTMLButtonElement>(
      '[data-action="hide-external"]',
    );
    hide?.click();
    await nextTick();

    expect(system.externalRegistry.isHidden('mbd-1')).toBe(true);
    expect(hide?.textContent).toContain('临时显示');
  });

  it('orders annotation records behind dimensions', async () => {
    const system = createSystem();
    system.externalRegistry.replaceSource('mbd', [
      {
        id: 'weld-1',
        source: 'mbd',
        sourceLabel: 'MBD: weld-1',
        role: 'external',
        category: 'annotation',
        layout: {
          id: 'weld-1',
          role: 'external',
          labelPinned: true,
          formattedLabel: '',
          lines: [],
          labelAnchor: [0, 0, 0],
          arrowLines: [],
          markers: [{ at: [0, 0, 0], shape: 'circle', radiusPx: 5 }],
        },
      },
      {
        id: 'mbd-1',
        source: 'mbd',
        sourceLabel: 'MBD',
        role: 'external-reference',
        layout: {
          id: 'mbd-1',
          kind: 'linear',
          role: 'external-reference',
          labelPinned: false,
          a: [0, 1, 0],
          b: [1, 1, 0],
          placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
        },
      },
    ]);
    mocks.dimensionSystem.value = system;

    const host = mountPanel();
    await nextTick();

    const rowIds = [...host.querySelectorAll('[data-dimension-id]')]
      .map(node => node.getAttribute('data-dimension-id'));
    expect(rowIds).toEqual(['linear-1', 'mbd-1', 'weld-1']);
  });

  it('switches the display mode on the viewport directly and reports occluded dimensions', async () => {
    const system = createSystem();
    const mbdRecord = (id: string) => ({
      id,
      source: 'mbd' as const,
      sourceLabel: 'MBD',
      role: 'external' as const,
      layout: {
        id,
        role: 'external' as const,
        labelPinned: true,
        formattedLabel: '100',
        lines: [],
        labelAnchor: [0, 0, 0] as const,
        arrowLines: [],
      },
    });
    system.externalRegistry.replaceSource('mbd', [mbdRecord('mbd-a'), mbdRecord('mbd-b'), mbdRecord('mbd-c')]);
    mocks.dimensionSystem.value = system;
    window.history.replaceState({}, '', '/');
    let popstates = 0;
    const onPopstate = () => { popstates += 1; };
    window.addEventListener('popstate', onPopstate);
    try {
      const host = mountPanel();
      await nextTick();
      // A viewport that shows up starts in engineering unless the URL says otherwise.
      expect(system.setDisplayMode).toHaveBeenLastCalledWith('engineering');
      const state = () => host.querySelector('[data-testid="mbd-mode-state"]')?.textContent?.replace(/\s+/g, ' ').trim();
      const radio = (mode: string) => host.querySelector<HTMLInputElement>(`[data-testid="mbd-mode-${mode}"]`)!;
      expect(state()).toBe('每条尺寸照工程图样全画');
      expect(radio('engineering').checked).toBe(true);

      // Inspection: the viewport is told directly, the URL only records it — no
      // popstate, so the sync layer does not refetch the payload.
      radio('inspection').checked = true;
      radio('inspection').dispatchEvent(new Event('change'));
      await nextTick();
      expect(system.setDisplayMode).toHaveBeenLastCalledWith('inspection');
      expect(new URLSearchParams(window.location.search).get('mbd_mode')).toBe('inspection');
      expect(popstates).toBe(0);
      expect(radio('inspection').checked).toBe(true);

      const drawn = (id: string, occluded?: boolean) => ({
        dimensionId: id,
        scenePrimitives: [],
        primitives: [{ kind: 'line', from: [0, 0], to: [1, 1], part: 'dimension', styleRole: 'external' }],
        hitRegions: [],
        labelBounds: { x: 0, y: 0, width: 0, height: 0 },
        labelPinned: true,
        derived: { formattedLabel: id, ...(occluded === undefined ? {} : { occluded }) },
      });
      system.emitLayouts([
        drawn('mbd-a', true),
        drawn('mbd-b', false),
        { ...drawn('mbd-c'), primitives: [], derived: { formattedLabel: 'mbd-c', lodHidden: 'short-line' } },
        drawn('user-1', true),
      ]);
      await nextTick();
      // user-1 counts too: the occlusion summary covers every drawn dimension, not only external ones
      expect(state()).toBe('被遮挡 2 条 / 可见 1 条');

      radio('engineering').checked = true;
      radio('engineering').dispatchEvent(new Event('change'));
      await nextTick();
      expect(system.setDisplayMode).toHaveBeenLastCalledWith('engineering');
      expect(new URLSearchParams(window.location.search).get('mbd_mode')).toBeNull();
      expect(state()).toBe('每条尺寸照工程图样全画');

      // Browser navigation (popstate) brings the mode back in line with the URL.
      window.history.replaceState({}, '', '/?mbd_mode=inspection');
      window.dispatchEvent(new Event('popstate'));
      await nextTick();
      expect(system.setDisplayMode).toHaveBeenLastCalledWith('inspection');
      expect(radio('inspection').checked).toBe(true);
    } finally {
      window.removeEventListener('popstate', onPopstate);
      window.history.replaceState({}, '', '/');
    }
  });

});
