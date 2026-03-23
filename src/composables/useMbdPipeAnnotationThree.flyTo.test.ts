import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

import { Matrix4, PerspectiveCamera, Scene } from 'three';

import { computeMbdDimOffset } from './mbd/computeMbdDimOffset';
import { computePipeAlignedOffsetDirs } from './mbd/computePipeAlignedOffsetDirs';
import { useMbdPipeAnnotationThree } from './useMbdPipeAnnotationThree';

import type { MbdPipeData } from '@/api/mbdPipeApi';

describe('useMbdPipeAnnotationThree.flyTo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('默认显示施工视图相关标注', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    expect(vis.mbdViewMode.value).toBe('construction');
    expect(vis.dimMode.value).toBe('rebarviz');
    expect(vis.showDimSegment.value).toBe(true);
    expect(vis.showDimChain.value).toBe(false);
    expect(vis.showDimOverall.value).toBe(false);
    expect(vis.showDimPort.value).toBe(false);
    expect(vis.showCutTubis.value).toBe(false);
    expect(vis.showElbows.value).toBe(true);
    expect(vis.showBranches.value).toBe(true);
    expect(vis.showFlanges.value).toBe(true);
    expect(vis.showWelds.value).toBe(true);
    expect(vis.showSlopes.value).toBe(true);
    expect(vis.showBends.value).toBe(true);
    expect(vis.bendDisplayMode.value).toBe('size');
    expect(vis.showSegments.value).toBe(false);
  });

  it('applyModeDefaults 应切换 construction 与 inspection 的默认显示映射', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.applyModeDefaults('inspection');
    expect(vis.mbdViewMode.value).toBe('inspection');
    expect(vis.dimMode.value).toBe('rebarviz');
    expect(vis.showDimSegment.value).toBe(false);
    expect(vis.showDimChain.value).toBe(false);
    expect(vis.showDimOverall.value).toBe(false);
    expect(vis.showDimPort.value).toBe(true);
    expect(vis.showWelds.value).toBe(false);
    expect(vis.showSlopes.value).toBe(false);
    expect(vis.showBends.value).toBe(false);
    expect(vis.bendDisplayMode.value).toBe('size');
    expect(vis.showSegments.value).toBe(false);

    vis.applyModeDefaults('construction');
    expect(vis.mbdViewMode.value).toBe('construction');
    expect(vis.dimMode.value).toBe('rebarviz');
    expect(vis.showDimSegment.value).toBe(true);
    expect(vis.showDimChain.value).toBe(false);
    expect(vis.showDimOverall.value).toBe(false);
    expect(vis.showDimPort.value).toBe(false);
    expect(vis.showCutTubis.value).toBe(false);
    expect(vis.showWelds.value).toBe(true);
    expect(vis.showSlopes.value).toBe(true);
    expect(vis.showBends.value).toBe(true);
    expect(vis.bendDisplayMode.value).toBe('size');
  });

  it('应抑制与非 overall 尺寸共用同一 span 的 overall 标注', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.renderBranch({
      input_refno: '24381_145712',
      branch_refno: '24381_145712',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 'seg-1',
          refno: 'SEG-1',
          noun: 'STRA',
          arrive: [0, 0, 0],
          leave: [0, 0, 956],
          length: 956,
          straight_length: 956,
        },
      ],
      dims: [
        {
          id: 'dim-seg',
          kind: 'segment',
          text: '956',
          start: [0, 0, 0],
          end: [0, 0, 956],
        },
        {
          id: 'dim-overall',
          kind: 'overall',
          text: '2149',
          start: [0, 0, 0],
          end: [0, 0, 956],
        },
      ],
      cut_tubis: [],
      welds: [],
      slopes: [],
      bends: [],
      fittings: [],
      tags: [],
      stats: {
        segments_count: 1,
        dims_count: 2,
        cut_tubis_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        fittings_count: 0,
        tags_count: 0,
      },
    } as any);

    const overallDims = Array.from(vis.getDimAnnotations().entries()).filter(
      ([, dim]) => (dim.userData as any)?.mbdDimKind === 'overall',
    );
    const segmentDims = Array.from(vis.getDimAnnotations().entries()).filter(
      ([, dim]) => (dim.userData as any)?.mbdDimKind === 'segment',
    );

    expect(segmentDims).toHaveLength(1);
    expect(overallDims).toHaveLength(0);
  });

  it('resetToCurrentModeDefaults 应回到当前模式默认态', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.mbdViewMode.value = 'inspection';
    vis.showDimPort.value = false;
    vis.showWelds.value = true;
    vis.dimMode.value = 'classic';

    vis.resetToCurrentModeDefaults();

    expect(vis.mbdViewMode.value).toBe('inspection');
    expect(vis.dimMode.value).toBe('rebarviz');
    expect(vis.showDimPort.value).toBe(true);
    expect(vis.showWelds.value).toBe(false);
    expect(vis.showSlopes.value).toBe(false);
  });

  it('密集端口尺寸应自动错位排布标签', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: 'port-1',
          kind: 'port',
          start: [0, 0, 0],
          end: [220, 0, 0],
          length: 220,
          text: '220',
        },
        {
          id: 'port-2',
          kind: 'port',
          start: [260, 20, 0],
          end: [480, 20, 0],
          length: 220,
          text: '220',
        },
        {
          id: 'port-3',
          kind: 'port',
          start: [520, 40, 0],
          end: [740, 40, 0],
          length: 220,
          text: '220',
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 3,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);

    const p1 = vis.getDimAnnotations().get('port-1')?.getParams();
    const p2 = vis.getDimAnnotations().get('port-2')?.getParams();
    const p3 = vis.getDimAnnotations().get('port-3')?.getParams();

    expect(p1).toBeTruthy();
    expect(p2).toBeTruthy();
    expect(p3).toBeTruthy();
    expect(p1?.labelT).not.toBeCloseTo(p2?.labelT ?? 0.5, 6);
    expect(p2?.labelT).not.toBeCloseTo(p3?.labelT ?? 0.5, 6);
  });

  it('密集端口尺寸应自动稀疏显示', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );
    vis.showDimPort.value = true;

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        { id: 'p1', kind: 'port', start: [0, 0, 0], end: [210, 0, 0], length: 210, text: '210' },
        { id: 'p2', kind: 'port', start: [15, 10, 0], end: [225, 10, 0], length: 210, text: '210' },
        { id: 'p3', kind: 'port', start: [30, 20, 0], end: [240, 20, 0], length: 210, text: '210' },
        { id: 'p4', kind: 'port', start: [45, 30, 0], end: [255, 30, 0], length: 210, text: '210' },
      ],
      stats: {
        segments_count: 0,
        dims_count: 4,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);

    const visibleCount = [...vis.getDimAnnotations().values()].filter(
      (d) => d.visible,
    ).length;
    expect(visibleCount).toBeLessThan(4);
    expect(visibleCount).toBeGreaterThan(0);
  });

  it('带 layout_hint 的尺寸文字应固定在线中点并随 offsetScale 更新线层', async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: 'seg-layout-1',
          kind: 'segment',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            anchor_point: [500, 0, 0],
            primary_axis: [1, 0, 0],
            offset_dir: [0, 1, 0],
            char_dir: [0, 0, 1],
            label_role: 'segment',
            avoid_line_of_sight: true,
            owner_segment_id: 'seg-layout-owner',
            offset_level: 1,
          },
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);

    const before = vis.getDimAnnotations().get('seg-layout-1')?.getParams();
    expect(before?.labelT).toBe(0.5);
    expect(before?.labelOffsetWorld).toBeNull();
    expect(before?.offset ?? 0).toBeGreaterThan(150);

    vis.dimOffsetScale.value = 2;
    await nextTick();

    const after = vis.getDimAnnotations().get('seg-layout-1')?.getParams();
    expect(after?.labelT).toBe(0.5);
    expect(after?.labelOffsetWorld).toBeNull();
    expect(after?.offset ?? 0).toBeGreaterThan(before?.offset ?? 0);
  });

  it('同平面同方向的紫色 chain 尺寸应统一 offset，形成共线风格', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const layoutHint = {
      anchor_point: [500, 0, 0] as [number, number, number],
      primary_axis: [1, 0, 0] as [number, number, number],
      offset_dir: [0, 1, 0] as [number, number, number],
      char_dir: [0, 0, 1] as [number, number, number],
      label_role: 'chain',
      avoid_line_of_sight: true,
      owner_segment_id: 'seg-chain',
      offset_level: 0,
    };

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: 'chain-short',
          kind: 'chain',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: layoutHint,
        },
        {
          id: 'chain-long',
          kind: 'chain',
          start: [0, 300, 0],
          end: [2000, 300, 0],
          length: 2000,
          text: '2000',
          layout_hint: {
            ...layoutHint,
            anchor_point: [1000, 300, 0],
          },
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 2,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);

    const shortParams = vis.getDimAnnotations().get('chain-short')?.getParams();
    const longParams = vis.getDimAnnotations().get('chain-long')?.getParams();

    expect(shortParams).toBeTruthy();
    expect(longParams).toBeTruthy();
    expect(shortParams?.offset).toBeCloseTo(longParams?.offset ?? 0, 6);
  });

  it('partial layout_hint 应逐字段降级到 branch-driven 方向而不是整体失效', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const segments = [
      {
        id: 'seg-1',
        refno: 'seg-1',
        noun: 'STRA',
        arrive: [0, 0, 0],
        leave: [1000, 0, 0],
        length: 1000,
        straight_length: 1000,
      },
    ] as MbdPipeData['segments'];

    vis.renderBranch({
      input_refno: 'partial-layout-hint',
      branch_refno: 'partial-layout-hint',
      branch_name: 'BRAN-PARTIAL-HINT',
      branch_attrs: {},
      segments,
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: 'dim-partial-hint',
          kind: 'segment',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            offset_dir: [NaN, 0, 0] as any,
            primary_axis: [1, 0, 0],
            offset_level: 2,
          },
        },
      ],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    });

    const dim = vis.getDimAnnotations().get('dim-partial-hint');
    expect(dim).toBeTruthy();

    const params = dim?.getParams();
    const expectedDir = computePipeAlignedOffsetDirs(segments)[0]!;
    expect(params?.direction.angleTo(expectedDir)).toBeLessThan(1e-6);
    expect(params?.offset ?? 0).toBeGreaterThan(computeMbdDimOffset(1000));
  });

  it('chain 与 cut_tubi 同区域时应强制分层，避免文字挤在一起', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );
    vis.showDimChain.value = true;
    vis.showCutTubis.value = true;

    const hint = {
      anchor_point: [500, 0, 0] as [number, number, number],
      primary_axis: [1, 0, 0] as [number, number, number],
      offset_dir: [0, 1, 0] as [number, number, number],
      char_dir: [0, 0, 1] as [number, number, number],
      label_role: 'chain',
      avoid_line_of_sight: true,
      owner_segment_id: 'seg-1',
      offset_level: 1,
    };

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 'seg-1',
          refno: 'seg-1',
          noun: 'TUBI',
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: 'chain-1',
          kind: 'chain',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: hint,
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [
        {
          id: 'cut-1',
          segment_id: 'seg-1',
          refno: 'seg-1',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            ...hint,
            label_role: 'cut_tubi',
          },
        },
      ],
      fittings: [],
      tags: [],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 1,
        fittings_count: 0,
        tags_count: 0,
      },
    };

    vis.renderBranch(data);

    const chain = vis.getDimAnnotations().get('chain-1');
    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const cut = root?.children?.find(
      (child: any) => child?.userData?.mbdAuxKind === 'cut_tubi',
    );

    const chainPos = chain?.getLabelWorldPos();
    const cutPos = cut?.getLabelWorldPos?.();
    const cutParams = cut?.getParams?.();
    expect(chainPos).toBeTruthy();
    expect(cutPos).toBeTruthy();
    expect(cutParams?.labelT).toBe(0.5);
    expect(cutParams?.labelOffsetWorld).toBeNull();
    expect(chainPos!.distanceTo(cutPos)).toBeGreaterThan(0.35);
  });

  it('tag_tubi 应按 layout_hint 偏移且不附带焊缝副标题', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [],
      tags: [
        {
          id: 'tag-layout-1',
          refno: '24381_145018',
          noun: 'TUBI',
          role: 'tubi',
          text: 'L=1683',
          position: [500, 0, 0],
          layout_hint: {
            anchor_point: [500, 0, 0],
            primary_axis: [1, 0, 0],
            offset_dir: [0, 1, 0],
            char_dir: [0, 0, 1],
            label_role: 'tag_tubi',
            avoid_line_of_sight: true,
            owner_segment_id: 'seg-tag-owner',
            offset_level: 1,
          },
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);

    const tag = vis.getTagAnnotations().get('tag-layout-1');
    const params = tag?.getParams();
    expect(params?.crossSize).toBe(0);
    expect(params?.subtitle).toBe('');
    expect(Math.abs(params?.labelOffsetWorld?.x ?? 0)).toBeGreaterThan(20);
    expect(params?.labelOffsetWorld?.y ?? 0).toBeGreaterThan(120);
    expect(params?.labelOffsetWorld?.z ?? 0).toBeGreaterThan(0);
  });

  it('重叠的 fitting tags 应自动错开文字位置', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const hint = {
      anchor_point: [500, 0, 0] as [number, number, number],
      primary_axis: [1, 0, 0] as [number, number, number],
      offset_dir: [0, 1, 0] as [number, number, number],
      char_dir: [0, 0, 1] as [number, number, number],
      label_role: 'fitting_bend',
      avoid_line_of_sight: true,
      owner_segment_id: 'seg-tag-overlap',
      offset_level: 0,
    };

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [],
      tags: [
        {
          id: 'tag-elbow-a',
          refno: 'elbow-a',
          noun: 'ELBO',
          role: 'fitting_bend',
          text: 'ELBO A',
          position: [500, 0, 0],
          layout_hint: hint,
        },
        {
          id: 'tag-elbow-b',
          refno: 'elbow-b',
          noun: 'ELBO',
          role: 'fitting_bend',
          text: 'ELBO B',
          position: [500, 0, 0],
          layout_hint: hint,
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 0,
        tags_count: 2,
      },
    };

    vis.renderBranch(data);

    const tagA = vis.getTagAnnotations().get('tag-elbow-a');
    const tagB = vis.getTagAnnotations().get('tag-elbow-b');
    const posA = tagA?.getLabelWorldPos();
    const posB = tagB?.getLabelWorldPos();
    const paramsA = tagA?.getParams();
    const paramsB = tagB?.getParams();

    expect(posA).toBeTruthy();
    expect(posB).toBeTruthy();
    expect(posA!.distanceTo(posB!)).toBeGreaterThan(0.7);
    expect(paramsA?.labelOffsetWorld).toBeTruthy();
    expect(paramsB?.labelOffsetWorld).toBeTruthy();
    expect(
      paramsA!.labelOffsetWorld!.distanceTo(paramsB!.labelOffsetWorld!),
    ).toBeGreaterThan(0.1);
  });

  it('短段附近重复的 elbow tags 在无法拉开时应抑制低优先级项', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const hint = {
      anchor_point: [500, 0, 0] as [number, number, number],
      primary_axis: [1, 0, 0] as [number, number, number],
      offset_dir: [0, 1, 0] as [number, number, number],
      char_dir: [0, 0, 1] as [number, number, number],
      label_role: 'fitting_bend',
      avoid_line_of_sight: true,
      owner_segment_id: 'seg-tag-cluster',
      offset_level: 0,
    };

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 'seg-1',
          refno: 'seg-1',
          noun: 'TUBI',
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: 'chain-1',
          kind: 'chain',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            ...hint,
            label_role: 'chain',
            offset_level: 1,
          },
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [
        {
          id: 'cut-1',
          segment_id: 'seg-1',
          refno: 'seg-1',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            ...hint,
            label_role: 'cut_tubi',
          },
        },
      ],
      fittings: [],
      tags: [
        {
          id: 'tag-branch',
          refno: 'branch-1',
          noun: 'OLET',
          role: 'fitting_branch',
          text: 'OLET',
          position: [500, 0, 0],
          layout_hint: {
            ...hint,
            label_role: 'fitting_branch',
            offset_level: 2,
          },
        },
        {
          id: 'tag-elbow-a',
          refno: 'elbow-a',
          noun: 'ELBO',
          role: 'fitting_bend',
          text: 'ELBO 89.7° R0',
          position: [500, 0, 0],
          layout_hint: hint,
        },
        {
          id: 'tag-elbow-b',
          refno: 'elbow-b',
          noun: 'ELBO',
          role: 'fitting_bend',
          text: 'ELBO 89.7° R0',
          position: [500, 0, 0],
          layout_hint: hint,
        },
        {
          id: 'tag-elbow-c',
          refno: 'elbow-c',
          noun: 'ELBO',
          role: 'fitting_bend',
          text: 'ELBO 89.7° R0',
          position: [500, 0, 0],
          layout_hint: hint,
        },
      ],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 1,
        fittings_count: 0,
        tags_count: 4,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const visibleTagTexts = root.children
      .filter(
        (child: any) =>
          child?.userData?.mbdAuxKind === 'tag' && child.visible,
      )
      .map((child: any) => child.getParams?.().label ?? '')
      .filter((text: string) => text.includes('ELBO 89.7° R0'));

    expect(visibleTagTexts.length).toBeLessThan(3);
    expect(visibleTagTexts.length).toBeGreaterThan(0);
  });

  it('branch tag 在短段簇内应与 cut_tubi 保持更大间距', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.showDimChain.value = true;
    vis.showCutTubis.value = true;
    vis.showBranches.value = true;

    const hint = {
      anchor_point: [500, 0, 0] as [number, number, number],
      primary_axis: [1, 0, 0] as [number, number, number],
      offset_dir: [0, 1, 0] as [number, number, number],
      char_dir: [0, 0, 1] as [number, number, number],
      label_role: 'segment',
      avoid_line_of_sight: true,
      owner_segment_id: 'seg-branch-cut',
      offset_level: 0,
    };

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 'seg-1',
          refno: 'seg-1',
          noun: 'TUBI',
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: 'chain-1',
          kind: 'chain',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            ...hint,
            label_role: 'chain',
            offset_level: 1,
          },
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [
        {
          id: 'cut-1',
          segment_id: 'seg-1',
          refno: 'seg-1',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            ...hint,
            label_role: 'cut_tubi',
          },
        },
      ],
      fittings: [],
      tags: [
        {
          id: 'tag-branch-1',
          refno: 'branch-1',
          noun: 'OLET',
          role: 'fitting_branch',
          text: 'OLET',
          position: [500, 0, 0],
          layout_hint: {
            ...hint,
            label_role: 'fitting_branch',
            offset_level: 2,
          },
        },
        {
          id: 'tag-elbow-a',
          refno: 'elbow-a',
          noun: 'ELBO',
          role: 'fitting_bend',
          text: 'ELBO 89.7° R0',
          position: [500, 0, 0],
          layout_hint: hint,
        },
        {
          id: 'tag-elbow-b',
          refno: 'elbow-b',
          noun: 'ELBO',
          role: 'fitting_bend',
          text: 'ELBO 90.0° R0',
          position: [500, 0, 0],
          layout_hint: hint,
        },
      ],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 1,
        fittings_count: 0,
        tags_count: 3,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const cut = root?.children?.find(
      (child: any) => child?.userData?.mbdAuxKind === 'cut_tubi',
    );
    const tag = vis.getTagAnnotations().get('tag-branch-1');

    const cutPos = cut?.getLabelWorldPos?.();
    const tagPos = tag?.getLabelWorldPos();
    expect(cutPos).toBeTruthy();
    expect(tagPos).toBeTruthy();
    expect(cutPos!.distanceTo(tagPos!)).toBeGreaterThan(1.1);
  });

  it('存在 cut_tubis 时不应重复渲染 tubi tags', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [
        {
          id: 'cut-1',
          segment_id: 'seg-1',
          refno: '24381_145018',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
        },
      ],
      fittings: [],
      tags: [
        {
          id: 'tag-tubi-1',
          refno: '24381_145018',
          noun: 'TUBI',
          role: 'tubi',
          text: 'L=1000',
          position: [500, 0, 0],
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 1,
        fittings_count: 0,
        tags_count: 1,
      },
    };

    vis.renderBranch(data);

    expect(vis.getTagAnnotations().has('tag-tubi-1')).toBe(false);
  });

  it('branch fitting 缺少可渲染几何时不应再默认画十字锚点', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [
        {
          id: 'fit-branch-1',
          refno: 'fit-branch-1',
          noun: 'TEE',
          kind: 'tee',
          anchor_point: [100, 0, 0],
        },
      ],
      tags: [
        {
          id: 'tag-branch-1',
          refno: 'fit-branch-1',
          noun: 'TEE',
          role: 'fitting_branch',
          text: 'TEE',
          position: [100, 0, 0],
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 1,
        tags_count: 1,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const fittingObject = root?.children?.find(
      (child: any) => child?.userData?.mbdAuxKind === 'fitting',
    ) as any;
    expect(fittingObject).toBeFalsy();
    expect(vis.getTagAnnotations().has('tag-branch-1')).toBe(true);
    expect(vis.suppressedWrongLineCount.value).toBe(1);
  });

  it('缺少弯头几何时不应压制 elbow tag', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [
        {
          id: 'fit-elbow-1',
          refno: 'fit-elbow-1',
          noun: 'ELBO',
          kind: 'elbo',
          anchor_point: [100, 0, 0],
          angle: 90,
        },
      ],
      tags: [
        {
          id: 'tag-elbow-1',
          refno: 'fit-elbow-1',
          noun: 'ELBO',
          role: 'fitting_bend',
          text: 'ELBO 90°',
          position: [100, 0, 0],
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 1,
        tags_count: 1,
      },
    };

    vis.renderBranch(data);

    expect(vis.getTagAnnotations().has('tag-elbow-1')).toBe(true);
    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const fittingObject = root?.children?.find(
      (child: any) => child?.userData?.mbdAuxKind === 'fitting',
    ) as any;
    expect(fittingObject).toBeFalsy();
  });

  it('仅有 bends 数据时也应触发 flyTo', () => {
    const flyTo = vi.fn();
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo,
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-1',
          refno: '24381_145019',
          noun: 'ELBO',
          angle: 90,
          radius: 250,
          work_point: [0, 0, 0],
          face_center_1: [1000, 0, 0],
          face_center_2: [0, 1000, 0],
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    };

    vis.renderBranch(data);
    vis.flyTo();

    expect(flyTo).toHaveBeenCalledTimes(1);
  });

  it('bend 缺少 face_center 时应基于 radius 与相邻管段方向推导双尺寸标注', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145712',
      branch_refno: '24381_145712',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 'seg-vertical',
          refno: 'SEG-V',
          noun: 'STRA',
          arrive: [0, 0, 956],
          leave: [0, 0, 0],
          length: 956,
          straight_length: 956,
        },
        {
          id: 'seg-horizontal',
          refno: 'SEG-H',
          noun: 'STRA',
          arrive: [229, 0, 0],
          leave: [229, 1193, 0],
          length: 1193,
          straight_length: 1193,
        },
      ],
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-1',
          refno: 'ELBO-1',
          noun: 'ELBO',
          angle: 90,
          radius: 229,
          work_point: [0, 0, 0],
          face_center_1: null,
          face_center_2: null,
        },
      ],
      stats: {
        segments_count: 2,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    };

    vis.showBends.value = true;
    vis.renderBranch(data);

    const bend = vis.getBendAnnotations().get('bend-1');
    expect(bend).toBeTruthy();
    expect(bend?.getMode?.()).toBe('size');
    const distances = bend?.getDistances?.() ?? [];
    expect(distances).toHaveLength(2);
    expect(distances[0]).toBeCloseTo(229, 6);
    expect(distances[1]).toBeCloseTo(229, 6);
    expect(bend?.getDisplayTexts?.()).toEqual(['229', '229']);
  });

  it('bend 尺寸方向应与相邻 tubi 尺寸方向一致', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const segments = [
      {
        id: 'seg-vertical',
        refno: 'SEG-V',
        noun: 'STRA',
        arrive: [0, 0, 956],
        leave: [0, 0, 0],
        length: 956,
        straight_length: 956,
      },
      {
        id: 'seg-horizontal',
        refno: 'SEG-H',
        noun: 'STRA',
        arrive: [229, 0, 0],
        leave: [229, 1193, 0],
        length: 1193,
        straight_length: 1193,
      },
    ] as MbdPipeData['segments'];

    vis.renderBranch({
      input_refno: '24381_145712',
      branch_refno: '24381_145712',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments,
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-1',
          refno: 'ELBO-1',
          noun: 'ELBO',
          angle: 90,
          radius: 229,
          work_point: [0, 0, 0],
          face_center_1: null,
          face_center_2: null,
        },
      ],
      stats: {
        segments_count: 2,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    });

    const bend = vis.getBendAnnotations().get('bend-1') as any;
    expect(bend).toBeTruthy();
    const members = (bend?.members ?? []).filter(
      (member: any) => typeof member?.getParams === 'function',
    );
    expect(members).toHaveLength(2);

    const params = members.map((member: any) => member.getParams());
    const verticalLeg = params.find((item: any) => Math.abs(item.end.z ?? 0) > 200);
    const horizontalLeg = params.find((item: any) => Math.abs(item.end.x ?? 0) > 200);
    expect(verticalLeg).toBeTruthy();
    expect(horizontalLeg).toBeTruthy();

    const pipeOffsetDirs = computePipeAlignedOffsetDirs(segments ?? []);
    expect(verticalLeg.direction.angleTo(pipeOffsetDirs[0]!)).toBeLessThan(1e-6);
    expect(horizontalLeg.direction.angleTo(pipeOffsetDirs[1]!)).toBeLessThan(1e-6);
  });

  it('bend 尺寸标签应沿各自腿向外偏移，避免在弯头根部堆叠', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    vis.renderBranch({
      input_refno: '24381_145712',
      branch_refno: '24381_145712',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 'seg-vertical',
          refno: 'SEG-V',
          noun: 'STRA',
          arrive: [0, 0, 956],
          leave: [0, 0, 0],
          length: 956,
          straight_length: 956,
        },
        {
          id: 'seg-horizontal',
          refno: 'SEG-H',
          noun: 'STRA',
          arrive: [229, 0, 0],
          leave: [229, 1193, 0],
          length: 1193,
          straight_length: 1193,
        },
      ],
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-1',
          refno: 'ELBO-1',
          noun: 'ELBO',
          angle: 90,
          radius: 229,
          work_point: [0, 0, 0],
          face_center_1: null,
          face_center_2: null,
        },
      ],
      stats: {
        segments_count: 2,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    });

    const bend = vis.getBendAnnotations().get('bend-1') as any;
    expect(bend).toBeTruthy();
    const members = (bend?.members ?? []).filter(
      (member: any) => typeof member?.getParams === 'function',
    );
    expect(members).toHaveLength(2);

    for (const member of members) {
      const params = member.getParams();
      expect(params.labelT).toBeGreaterThan(0.65);
      const labelPos = member.getLabelWorldPos();
      expect(labelPos.distanceTo(params.start)).toBeGreaterThan(
        params.start.distanceTo(params.end) * 0.65,
      );
    }
  });

  it('bend 尺寸线 offset 应与相邻直段尺寸保持同一偏移基线', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const segments = [
      {
        id: 'seg-vertical',
        refno: 'SEG-V',
        noun: 'STRA',
        arrive: [0, 0, 956],
        leave: [0, 0, 0],
        length: 956,
        straight_length: 956,
      },
      {
        id: 'seg-horizontal',
        refno: 'SEG-H',
        noun: 'STRA',
        arrive: [229, 0, 0],
        leave: [229, 1193, 0],
        length: 1193,
        straight_length: 1193,
      },
    ] as MbdPipeData['segments'];

    vis.renderBranch({
      input_refno: '24381_145712',
      branch_refno: '24381_145712',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments,
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-1',
          refno: 'ELBO-1',
          noun: 'ELBO',
          angle: 90,
          radius: 229,
          work_point: [0, 0, 0],
          face_center_1: null,
          face_center_2: null,
        },
      ],
      stats: {
        segments_count: 2,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    });

    const bend = vis.getBendAnnotations().get('bend-1') as any;
    const members = (bend?.members ?? []).filter(
      (member: any) => typeof member?.getParams === 'function',
    );
    expect(members).toHaveLength(2);

    const params = members.map((member: any) => member.getParams());
    const verticalLeg = params.find((item: any) => Math.abs(item.end.z ?? 0) > 200);
    const horizontalLeg = params.find((item: any) => Math.abs(item.end.x ?? 0) > 200);
    expect(verticalLeg).toBeTruthy();
    expect(horizontalLeg).toBeTruthy();

    expect(verticalLeg.offset).toBeCloseTo(computeMbdDimOffset(956), 6);
    expect(horizontalLeg.offset).toBeCloseTo(computeMbdDimOffset(1193), 6);
  });

  it('长直段场景下 bend 尺寸 offset 不应被硬上限截断', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const segments = [
      {
        id: 'seg-long-z',
        refno: 'SEG-LZ',
        noun: 'STRA',
        arrive: [0, 0, 4000],
        leave: [0, 0, 0],
        length: 4000,
        straight_length: 4000,
      },
      {
        id: 'seg-long-x',
        refno: 'SEG-LX',
        noun: 'STRA',
        arrive: [500, 0, 0],
        leave: [4500, 0, 0],
        length: 4000,
        straight_length: 4000,
      },
    ] as MbdPipeData['segments'];

    vis.renderBranch({
      input_refno: 'LONG-BEND-CASE',
      branch_refno: 'LONG-BEND-CASE',
      branch_name: 'BRAN-LONG-BEND',
      branch_attrs: {},
      segments,
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-long-1',
          refno: 'ELBO-LONG',
          noun: 'ELBO',
          angle: 90,
          radius: 500,
          work_point: [0, 0, 0],
          face_center_1: null,
          face_center_2: null,
        },
      ],
      stats: {
        segments_count: 2,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    });

    const bend = vis.getBendAnnotations().get('bend-long-1') as any;
    const members = (bend?.members ?? []).filter(
      (member: any) => typeof member?.getParams === 'function',
    );
    expect(members).toHaveLength(2);

    const expectedOffset = computeMbdDimOffset(4000);
    for (const member of members) {
      const params = member.getParams();
      expect(params.offset).toBeCloseTo(expectedOffset, 6);
      expect(params.offset).toBeGreaterThan(260);
    }
  });

  it('face_center 与管段端点存在偏差时，bend 尺寸方向仍应与相邻直段对齐', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const segments = [
      {
        id: 'seg-z',
        refno: 'SEG-Z',
        noun: 'STRA',
        arrive: [0, 0, 800],
        leave: [0, 0, 0],
        length: 800,
        straight_length: 800,
      },
      {
        id: 'seg-x',
        refno: 'SEG-X',
        noun: 'STRA',
        arrive: [800, 0, 0],
        leave: [2000, 0, 0],
        length: 1200,
        straight_length: 1200,
      },
    ] as MbdPipeData['segments'];

    vis.renderBranch({
      input_refno: 'FACECENTER-DRIFT',
      branch_refno: 'FACECENTER-DRIFT',
      branch_name: 'BRAN-FACECENTER-DRIFT',
      branch_attrs: {},
      segments,
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-drift-1',
          refno: 'ELBO-DRIFT',
          noun: 'ELBO',
          angle: 90,
          radius: 400,
          work_point: [0, 0, 0],
          // 有意制造与真实管段端点的偏差（方向相似但并非严格共线）
          face_center_1: [800, 400, 0],
          face_center_2: [400, 0, 800],
        },
      ],
      stats: {
        segments_count: 2,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    });

    const bend = vis.getBendAnnotations().get('bend-drift-1') as any;
    const members = (bend?.members ?? []).filter(
      (member: any) => typeof member?.getParams === 'function',
    );
    expect(members).toHaveLength(2);

    const pipeOffsetDirs = computePipeAlignedOffsetDirs(segments);
    const params = members.map((member: any) => member.getParams());
    const zLeg = params.find((item: any) => Math.abs(item.end.z ?? 0) > 200);
    const xLeg = params.find((item: any) => Math.abs(item.end.x ?? 0) > 200);
    expect(zLeg).toBeTruthy();
    expect(xLeg).toBeTruthy();

    expect(zLeg.direction.angleTo(pipeOffsetDirs[0]!)).toBeLessThan(1e-6);
    expect(xLeg.direction.angleTo(pipeOffsetDirs[1]!)).toBeLessThan(1e-6);
  });

  it('bend 显示模式切到 angle 后应改为角度标注', async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145712',
      branch_refno: '24381_145712',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 'seg-vertical',
          refno: 'SEG-V',
          noun: 'STRA',
          arrive: [0, 0, 229],
          leave: [0, 0, 0],
          length: 229,
          straight_length: 229,
        },
        {
          id: 'seg-horizontal',
          refno: 'SEG-H',
          noun: 'STRA',
          arrive: [229, 0, 0],
          leave: [1422, 0, 0],
          length: 1193,
          straight_length: 1193,
        },
      ],
      dims: [],
      welds: [],
      slopes: [],
      bends: [
        {
          id: 'bend-1',
          refno: 'ELBO-1',
          noun: 'ELBO',
          angle: 90,
          radius: 229,
          work_point: [0, 0, 0],
          face_center_1: null,
          face_center_2: null,
        },
      ],
      stats: {
        segments_count: 2,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 1,
      },
    };

    vis.renderBranch(data);

    expect(vis.getBendAnnotations().get('bend-1')?.getMode?.()).toBe('size');

    vis.bendDisplayMode.value = 'angle';
    await nextTick();

    const bend = vis.getBendAnnotations().get('bend-1');
    expect(bend).toBeTruthy();
    expect(bend?.getMode?.()).toBe('angle');
    expect(bend?.getDisplayText()).toBe('90.0°');
  });

  it('construction 下 tubi 辅助 tag 应默认隐藏', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [],
      tags: [
        {
          id: 'tag-1',
          refno: 'tag-1',
          noun: 'TUBI',
          role: 'spec',
          text: 'DN50',
          position: [100, 0, 0],
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 0,
        tags_count: 1,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const tagObject = root?.children?.find(
      (child: any) => child?.userData?.mbdAuxKind === 'tag',
    );

    expect(tagObject).toBeTruthy();
    expect(tagObject?.visible).toBe(false);
  });

  it('fitting 缺少合法锚点时应抑制并计数', () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [
        {
          id: 'fit-1',
          refno: 'fit-1',
          noun: 'TEE',
          kind: 'tee',
          anchor_point: [Number.NaN, 0, 0] as any,
        },
      ],
      tags: [],
      stats: {
        segments_count: 0,
        dims_count: 0,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 1,
        tags_count: 0,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const fittingObject = root?.children?.find(
      (child: any) => child?.userData?.mbdAuxKind === 'fitting',
    );

    expect(fittingObject).toBeFalsy();
    expect(vis.suppressedWrongLineCount.value).toBe(1);
  });

  it('开启 showAnchorDebug 后应显示锚点调试几何', async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      dims: [
        {
          id: 'dim-1',
          kind: 'chain',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            anchor_point: [200, 100, 0],
            offset_dir: [0, 1, 0],
            primary_axis: [1, 0, 0],
            char_dir: [0, 0, 1],
            label_role: 'chain',
            avoid_line_of_sight: true,
            owner_segment_id: 'seg-1',
            offset_level: 1,
            suppress_reason: null,
          },
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [],
      tags: [],
      stats: {
        segments_count: 0,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 0,
        tags_count: 0,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const debugBefore = root?.children?.filter(
      (child: any) => child?.userData?.mbdAuxKind === 'debug-anchor',
    ) ?? [];
    expect(debugBefore.length).toBeGreaterThan(0);
    expect(debugBefore.every((child: any) => child.visible === false)).toBe(true);

    vis.showAnchorDebug.value = true;
    await nextTick();

    const debugAfter = root?.children?.filter(
      (child: any) => child?.userData?.mbdAuxKind === 'debug-anchor',
    ) ?? [];
    expect(debugAfter.length).toBeGreaterThan(0);
    expect(debugAfter.every((child: any) => child.visible === true)).toBe(true);
  });

  it('开启 showOwnerSegmentDebug 后应显示所属段调试几何', async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 'seg-1',
          refno: 'seg-1',
          noun: 'TUBI',
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: 'dim-1',
          kind: 'chain',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
          layout_hint: {
            anchor_point: [200, 100, 0],
            offset_dir: [0, 1, 0],
            primary_axis: [1, 0, 0],
            char_dir: [0, 0, 1],
            label_role: 'chain',
            avoid_line_of_sight: true,
            owner_segment_id: 'seg-1',
            offset_level: 1,
            suppress_reason: null,
          },
        },
      ],
      welds: [],
      slopes: [],
      bends: [],
      cut_tubis: [],
      fittings: [],
      tags: [],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
        cut_tubis_count: 0,
        fittings_count: 0,
        tags_count: 0,
      },
    };

    vis.renderBranch(data);

    const root = viewer.scene.children.find(
      (child: any) => child?.name === 'dtx-mbd-pipe-v2',
    ) as any;
    const debugBefore = root?.children?.filter(
      (child: any) => child?.userData?.mbdAuxKind === 'debug-owner-segment',
    ) ?? [];
    expect(debugBefore.length).toBe(1);
    expect(debugBefore[0]?.visible).toBe(false);

    vis.showOwnerSegmentDebug.value = true;
    await nextTick();

    const debugAfter = root?.children?.filter(
      (child: any) => child?.userData?.mbdAuxKind === 'debug-owner-segment',
    ) ?? [];
    expect(debugAfter.length).toBe(1);
    expect(debugAfter[0]?.visible).toBe(true);
  });

  it('切换 dimMode 重建后应保持当前高亮项', async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );
    vis.dimMode.value = 'rebarviz';
    await nextTick();
    await nextTick();

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: 'dim-1',
          kind: 'segment',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);
    vis.highlightItem('dim-1');

    const before = vis.getDimAnnotations().get('dim-1');
    expect(before).toBeTruthy();
    expect(before?.highlighted).toBe(true);

    vis.dimMode.value = 'classic';
    await nextTick();
    await nextTick();

    const after = vis.getDimAnnotations().get('dim-1');
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    expect(after?.highlighted).toBe(true);
  });

  it('切换 dimMode 时 dim/weld/slope/bend 文字样式应同步切换', async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [
        {
          id: 's1',
          refno: 'S:1',
          noun: 'STRA',
          arrive: [0, 0, 0],
          leave: [1000, 0, 0],
          length: 1000,
          straight_length: 1000,
        },
      ],
      dims: [
        {
          id: 'dim-1',
          kind: 'segment',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
        },
      ],
      welds: [
        {
          id: 'weld-1',
          position: [1000, 0, 0],
          weld_type: 'BW',
          is_shop: false,
          label: 'W1',
          left_refno: 'S:1',
          right_refno: 'S:2',
        },
      ],
      slopes: [
        {
          id: 'slope-1',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          slope: 0.01,
          text: '1%',
        },
      ],
      bends: [
        {
          id: 'bend-1',
          refno: 'B:1',
          noun: 'ELBO',
          angle: 90,
          radius: 250,
          work_point: [1000, 0, 0],
          face_center_1: [1100, 0, 0],
          face_center_2: [1000, 100, 0],
        },
      ],
      stats: {
        segments_count: 1,
        dims_count: 1,
        welds_count: 1,
        slopes_count: 1,
        bends_count: 1,
      },
    };

    const getLabelStyle = (a: any): string | null =>
      a?.getLabelRenderStyle?.()
      ?? a?.textLabel?.getRenderStyle?.()
      ?? a?.textLabel?.renderStyle
      ?? null;

    vis.renderBranch(data);

    expect(getLabelStyle(vis.getDimAnnotations().get('dim-1'))).toBe(
      'rebarviz',
    );
    expect(getLabelStyle(vis.getWeldAnnotations().get('weld-1'))).toBe(
      'rebarviz',
    );
    expect(getLabelStyle(vis.getSlopeAnnotations().get('slope-1'))).toBe(
      'rebarviz',
    );
    expect(getLabelStyle(vis.getBendAnnotations().get('bend-1'))).toBe(
      'rebarviz',
    );

    vis.dimMode.value = 'classic';
    await nextTick();
    await nextTick();

    expect(getLabelStyle(vis.getDimAnnotations().get('dim-1'))).toBe(
      'solvespace',
    );
    expect(getLabelStyle(vis.getWeldAnnotations().get('weld-1'))).toBe(
      'solvespace',
    );
    expect(getLabelStyle(vis.getSlopeAnnotations().get('slope-1'))).toBe(
      'solvespace',
    );
    expect(getLabelStyle(vis.getBendAnnotations().get('bend-1'))).toBe(
      'solvespace',
    );

    vis.dimMode.value = 'rebarviz';
    await nextTick();
    await nextTick();

    expect(getLabelStyle(vis.getDimAnnotations().get('dim-1'))).toBe(
      'rebarviz',
    );
    expect(getLabelStyle(vis.getWeldAnnotations().get('weld-1'))).toBe(
      'rebarviz',
    );
    expect(getLabelStyle(vis.getSlopeAnnotations().get('slope-1'))).toBe(
      'rebarviz',
    );
    expect(getLabelStyle(vis.getBendAnnotations().get('bend-1'))).toBe(
      'rebarviz',
    );
  });

  it('rebarviz 箭头参数调整后应即时刷新已渲染尺寸', async () => {
    const viewer = {
      canvas: {
        getBoundingClientRect: () => ({ width: 800, height: 600 }),
      },
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      flyTo: vi.fn(),
    } as any;

    const vis = useMbdPipeAnnotationThree(
      shallowRef(viewer),
      ref<HTMLElement | null>(null),
      { getGlobalModelMatrix: () => new Matrix4() },
    );
    vis.dimMode.value = 'rebarviz';
    await nextTick();
    await nextTick();

    const data: MbdPipeData = {
      input_refno: '24381_145018',
      branch_refno: '24381_145018',
      branch_name: 'BRAN-TEST',
      branch_attrs: {},
      segments: [],
      welds: [],
      slopes: [],
      bends: [],
      dims: [
        {
          id: 'dim-1',
          kind: 'segment',
          start: [0, 0, 0],
          end: [1000, 0, 0],
          length: 1000,
          text: '1000',
        },
      ],
      stats: {
        segments_count: 0,
        dims_count: 1,
        welds_count: 0,
        slopes_count: 0,
        bends_count: 0,
      },
    };

    vis.renderBranch(data);
    expect(vis.getDimAnnotations().get('dim-1')).toBeTruthy();

    (vis as any).rebarvizArrowStyle.value = 'tick';
    (vis as any).rebarvizArrowSizePx.value = 20;
    (vis as any).rebarvizArrowAngleDeg.value = 24;
    (vis as any).rebarvizLineWidthPx.value = 3;
    await nextTick();
    await nextTick();

    const updated = vis.getDimAnnotations().get('dim-1');
    expect(updated?.getParams().arrowStyle).toBe('tick');
    expect(updated?.getParams().arrowSizePx).toBe(20);
    expect(updated?.getParams().arrowAngleDeg).toBe(24);
    expect((updated as any)?.materialSet?.fatLine?.linewidth).toBe(3);
  });
});
