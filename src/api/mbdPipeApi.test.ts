import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getMbdPipeV2Annotations,
  type MbdPipeResponse,
  type MbdV2LinearDimPrimitive,
  type MbdV2Response,
} from './mbdPipeApi';

function makeLinearDim(
  id: string,
  subKind: string,
  visible = true,
): MbdV2LinearDimPrimitive {
  const offset = subKind === 'cut_tubi' ? 40 : 80;
  return {
    kind: 'linear_dim',
    id,
    node_names: [`node-${id}`],
    source_refno: `source-${id}`,
    visible,
    suppressed_reason: visible ? null : 'too_short_for_layout',
    sub_kind: subKind,
    extension_1: {
      start: [0, 0, 0],
      end: [0, offset, 0],
    },
    extension_2: {
      start: [500, 0, 0],
      end: [500, offset, 0],
    },
    dim_line: {
      start: [0, offset, 0],
      end: [500, offset, 0],
    },
    arrows: [
      { position: [0, offset, 0], direction: [1, 0, 0] },
      { position: [500, offset, 0], direction: [-1, 0, 0] },
    ],
    text: {
      anchor: [240, offset + 15, 0],
      content: `${id} backend text`,
      height_mm: 2.5,
      orientation: [1, 0, 0],
      up: [0, 1, 0],
    },
    level: 0,
  };
}

function mockV2Fetch(response: MbdV2Response) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockV2ThenLegacyFetch(
  v2Response: MbdV2Response,
  legacyResponse: MbdPipeResponse,
) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(v2Response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify(legacyResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('getMbdPipeV2Annotations adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests V2 layout-first dimensions with explicit per-kind intent by default', async () => {
    const response: MbdV2Response = {
      success: true,
      data: {
        version: 'v2',
        input_refno: '24381_145018',
        branch_refno: '24381_145018',
        primitives: [],
        meta: {
          segments_count: 0,
          welds_count: 0,
          dims_by_kind: {},
          branch_attrs: {
            BRANCH_NAME: '/PIPE-A/B1',
          },
          generated_at: '2026-06-09T00:00:00Z',
          layout_source: 'backend_v2_layout',
        },
        issues: [],
      },
    };
    const fetchMock = mockV2Fetch(response);

    const adapted = await getMbdPipeV2Annotations('24381_145018');

    const calledUrl = new URL(
      String(fetchMock.mock.calls[0]?.[0] ?? ''),
      'http://localhost',
    );
    expect(calledUrl.pathname).toContain('/api/mbd/v2/pipe/24381_145018');
    expect(calledUrl.searchParams.get('mode')).toBe('layout_first');
    expect(calledUrl.searchParams.get('include_layout_result')).toBe('true');
    expect(calledUrl.searchParams.get('include_dims')).toBe('false');
    expect(calledUrl.searchParams.get('include_chain_dims')).toBe('true');
    expect(calledUrl.searchParams.get('include_port_dims')).toBe('false');
    expect(calledUrl.searchParams.get('include_cut_tubis')).toBe('true');
    expect(calledUrl.searchParams.get('include_overall_dim')).toBe('false');
    expect(calledUrl.searchParams.get('include_fittings')).toBe('false');
    expect(calledUrl.searchParams.get('include_tags')).toBe('false');
    expect(calledUrl.searchParams.get('include_position_tags')).toBe('false');
    expect(calledUrl.searchParams.get('include_elevation_marks')).toBe('false');
    expect(calledUrl.searchParams.get('include_branch_label')).toBe('false');
    expect(calledUrl.searchParams.get('include_material_balloons')).toBe('false');
    expect(calledUrl.searchParams.get('include_material_table')).toBe('false');
    expect(calledUrl.searchParams.get('include_welds')).toBe('false');
    expect(calledUrl.searchParams.get('include_slopes')).toBe('false');
    expect(calledUrl.searchParams.get('include_bends')).toBe('false');
    expect(adapted.data?.debug_info?.requested_layers).toMatchObject({
      elevation_marks: false,
      material_table: false,
      tags: false,
    });
  });

  it('passes explicit drawing annotation switches through to V2', async () => {
    const fetchMock = mockV2Fetch({
      success: true,
      data: {
        version: 'v2',
        input_refno: '24381_145018',
        branch_refno: '24381_145018',
        primitives: [],
        meta: {
          segments_count: 0,
          welds_count: 0,
          dims_by_kind: {},
          branch_attrs: {
            BRANCH_NAME: '/PIPE-A/B1',
          },
        },
        issues: [],
      },
    });

    const adapted = await getMbdPipeV2Annotations('24381_145018', {
      include_welds: true,
      include_tags: true,
      include_position_tags: true,
      include_elevation_marks: true,
      include_branch_label: true,
      include_material_balloons: true,
      include_material_table: true,
    });

    const calledUrl = new URL(
      String(fetchMock.mock.calls[0]?.[0] ?? ''),
      'http://localhost',
    );
    expect(calledUrl.searchParams.get('include_welds')).toBe('true');
    expect(calledUrl.searchParams.get('include_tags')).toBe('true');
    expect(calledUrl.searchParams.get('include_position_tags')).toBe('true');
    expect(calledUrl.searchParams.get('include_elevation_marks')).toBe('true');
    expect(calledUrl.searchParams.get('include_branch_label')).toBe('true');
    expect(calledUrl.searchParams.get('include_material_balloons')).toBe('true');
    expect(calledUrl.searchParams.get('include_material_table')).toBe('true');
    expect(adapted.data?.debug_info?.requested_layers).toMatchObject({
      elevation_marks: true,
      material_table: true,
      tags: true,
    });
  });

  it('preserves V2 linear_dim primitives as backend-laid-out display data', async () => {
    const response: MbdV2Response = {
      success: true,
      data: {
        version: 'v2',
        input_refno: '24381_145018',
        branch_refno: '24381_145018',
        primitives: [
          makeLinearDim('segment-1', 'segment'),
          makeLinearDim('chain-1', 'chain', false),
          makeLinearDim('cut-1', 'cut_tubi'),
        ],
        meta: {
          segments_count: 0,
          welds_count: 0,
          dims_by_kind: {
            segment: 1,
            chain: 1,
            cut_tubi: 1,
          },
          branch_attrs: {
            BRANCH_NAME: '/PIPE-A/B1',
          },
          generated_at: '2026-06-09T00:00:00Z',
          layout_source: 'backend_v2_layout',
        },
        issues: [],
      },
    };
    const fetchMock = mockV2Fetch(response);

    const adapted = await getMbdPipeV2Annotations('24381_145018', {
      mode: 'layout_first',
      debug: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/mbd/v2/pipe/24381_145018?'),
      expect.any(Object),
    );
    expect(adapted.success).toBe(true);
    expect(adapted.data?.debug_info?.primitive_kinds).toEqual({
      linear_dim: 3,
    });
    expect(adapted.data?.debug_info?.layout_source).toBe('backend_v2_layout');
    expect(adapted.data?.layout_result?.debug_info?.layout_source).toBe('backend_v2_layout');
    expect(adapted.data?.branch_name).toBe('/PIPE-A/B1');
    expect(adapted.data?.stats.dims_count).toBe(2);
    expect(adapted.data?.stats.cut_tubis_count).toBe(1);

    const segment = adapted.data?.layout_result?.linear_dims.find(
      (item) => item.id === 'segment-1',
    );
    expect(segment).toMatchObject({
      id: 'segment-1',
      kind: 'segment',
      source_kind: 'linear_dim',
      source_primitive_id: 'segment-1',
      source_sub_kind: 'segment',
      backend_derived_geometry: true,
      text: 'segment-1 backend text',
      dim_line_start: [0, 80, 0],
      dim_line_end: [500, 80, 0],
      extension_line_1_start: [0, 0, 0],
      extension_line_1_end: [0, 80, 0],
      extension_line_2_start: [500, 0, 0],
      extension_line_2_end: [500, 80, 0],
      text_anchor: [240, 95, 0],
      backend_arrows: [
        { position: [0, 80, 0], direction: [1, 0, 0] },
        { position: [500, 80, 0], direction: [-1, 0, 0] },
      ],
    });

    const suppressed = adapted.data?.layout_result?.linear_dims.find(
      (item) => item.id === 'chain-1',
    );
    expect(suppressed?.visible).toBe(false);
    expect(suppressed?.suppressed_reason).toBe('too_short_for_layout');
    expect(
      adapted.data?.layout_result?.suppressed_items.some(
        (item) => item.id === 'chain-1' && item.reason === 'too_short_for_layout',
      ),
    ).toBe(true);

    const cut = adapted.data?.layout_result?.cut_tubis?.[0];
    expect(cut).toMatchObject({
      id: 'cut-1',
      kind: 'cut_tubi',
      source_kind: 'linear_dim',
      source_sub_kind: 'cut_tubi',
      backend_derived_geometry: true,
    });
  });

  it('does not invent an overall dimension when V2 primitives omit one', async () => {
    mockV2Fetch({
      success: true,
      data: {
        version: 'v2',
        input_refno: 'folded-bran',
        branch_refno: 'folded-bran',
        primitives: [
          makeLinearDim('segment-1', 'segment'),
          makeLinearDim('chain-1', 'chain'),
        ],
        meta: {
          segments_count: 0,
          welds_count: 0,
          dims_by_kind: {
            segment: 1,
            chain: 1,
          },
          branch_attrs: {},
          generated_at: '2026-06-09T00:00:00Z',
        },
        issues: [],
      },
    });

    const adapted = await getMbdPipeV2Annotations('folded-bran', {
      mode: 'layout_first',
      include_overall_dim: true,
    });

    const kinds = adapted.data?.layout_result?.linear_dims.map((item) => item.kind) ?? [];
    expect(kinds).toEqual(['segment', 'chain']);
    expect(kinds).not.toContain('overall');
    expect(adapted.data?.dims.map((item) => item.kind)).toEqual(['segment', 'chain']);
  });

  it('infers drawing label roles and builds material rows from V2 primitives', async () => {
    mockV2Fetch({
      success: true,
      data: {
        version: 'v2',
        input_refno: '24381_145018',
        branch_refno: '24381_145018',
        primitives: [
          makeLinearDim('cut-1', 'cut_tubi'),
          {
            kind: 'label',
            id: 'tag:material:1:source-cut-1',
            node_names: [],
            source_refno: 'source-cut-1',
            visible: true,
            anchor: [250, 0, 0],
            text_anchor: [250, 120, 0],
            content: '1',
            height_mm: 2.5,
            orientation: [1, 0, 0],
            up: [0, 1, 0],
            box_shape: 'rect',
            box_padding_mm: 1,
          },
          {
            kind: 'label',
            id: 'tag:elevation:source-cut-1:start',
            node_names: [],
            source_refno: 'source-cut-1',
            visible: true,
            anchor: [0, 0, -4400],
            text_anchor: [0, 100, -4400],
            content: 'PE -4400',
            height_mm: 2.5,
            orientation: [1, 0, 0],
            up: [0, 1, 0],
            box_shape: 'rect',
            box_padding_mm: 1,
          },
        ],
        meta: {
          segments_count: 0,
          welds_count: 0,
          dims_by_kind: { cut_tubi: 1 },
          branch_attrs: {},
        },
        issues: [],
      },
    });

    const adapted = await getMbdPipeV2Annotations('24381_145018');

    expect(adapted.data?.tags?.map((tag) => tag.role)).toEqual([
      'material_balloon',
      'elevation_tag',
    ]);
    expect(adapted.data?.layout_result?.tags.map((tag) => tag.role)).toEqual([
      'material_balloon',
      'elevation_tag',
    ]);
    expect(adapted.data?.material_rows).toEqual([
      expect.objectContaining({
        item_no: 1,
        item_code: 'TUBI',
        unit: 'm',
        refnos: ['source-cut-1'],
      }),
    ]);
    expect(adapted.data?.stats.material_rows_count).toBe(1);
  });

  it('can merge legacy V1 segments into V2 layout data for flow direction', async () => {
    const fetchMock = mockV2ThenLegacyFetch(
      {
        success: true,
        data: {
          version: 'v2',
          input_refno: '2013286704_476',
          branch_refno: '2013286704_476',
          primitives: [
            makeLinearDim('chain-1', 'chain'),
          ],
          meta: {
            segments_count: 0,
            welds_count: 0,
            dims_by_kind: {
              chain: 1,
            },
            branch_attrs: {},
          },
          issues: [],
        },
      },
      {
        success: true,
        data: {
          input_refno: '2013286704_476',
          branch_refno: '2013286704_476',
          branch_name: '/03SKID1-PIPE-SUCTION/B1',
          branch_attrs: {},
          segments: [
            {
              id: 'seg:2013286704_479:0',
              refno: '2013286704_479',
              noun: 'TUBI',
              arrive: [-287224.5, 291674.28, 100790],
              leave: [-287224.5, 291074.3, 100790],
              length: 599.96875,
              straight_length: 599.96875,
            },
            {
              id: 'seg:2013286704_480:1',
              refno: '2013286704_480',
              noun: 'TUBI',
              arrive: [-287224.5, 291074.3, 100790],
              leave: [-287110.2, 290960, 100790],
              length: 161.644,
              straight_length: 161.644,
            },
          ],
          dims: [],
          welds: [],
          slopes: [],
          bends: [
            {
              id: 'bend:2013286704_480',
              refno: '2013286704_480',
              noun: 'ELBO',
              angle: 90,
              radius: 0,
              work_point: [0, 0, 0],
              face_center_1: null,
              face_center_2: null,
            },
          ],
          fittings: [
            {
              id: 'fitting:2013286704_480',
              refno: '2013286704_480',
              noun: 'ELBO',
              kind: 'elbo',
              anchor_point: [-287037.7, 290960, 100790],
              text: 'ELBO 90.0°',
              angle: 90,
              radius: 0,
              face_center_1: null,
              face_center_2: null,
            },
          ],
          material_rows: [
            {
              item_no: 1,
              ns: '3"',
              item_code: 'TUBI',
              description: 'Cut pipe length',
              quantity: 0.6,
              unit: 'm',
              unit_weight: null,
              refnos: ['2013286704_479'],
            },
          ],
          stats: {
            segments_count: 2,
            dims_count: 0,
            welds_count: 0,
            slopes_count: 0,
            bends_count: 1,
            fittings_count: 1,
            material_rows_count: 1,
          },
        },
      },
    );

    const adapted = await getMbdPipeV2Annotations(
      '2013286704_476',
      { mode: 'layout_first' },
      { includeLegacySegments: true },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/mbd/v2/pipe/2013286704_476');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/api/mbd/pipe/2013286704_476');
    expect(adapted.success).toBe(true);
    expect(adapted.data?.layout_result?.linear_dims).toHaveLength(1);
    expect(adapted.data?.segments).toHaveLength(2);
    expect(adapted.data?.bends).toHaveLength(1);
    expect(adapted.data?.fittings).toHaveLength(1);
    expect(adapted.data?.fittings?.[0]).toMatchObject({
      refno: '2013286704_480',
      noun: 'ELBO',
      kind: 'elbo',
    });
    expect(adapted.data?.material_rows?.[0]?.ns).toBe('3"');
    expect(adapted.data?.stats.segments_count).toBe(2);
    expect(adapted.data?.stats.bends_count).toBe(1);
    expect(adapted.data?.stats.fittings_count).toBe(1);
    expect(adapted.data?.layout_result?.stats.bends_count).toBe(1);
    expect(adapted.data?.layout_result?.stats.fittings_count).toBe(1);
    expect(adapted.data?.stats.material_rows_count).toBe(1);
    expect(adapted.data?.debug_info?.legacy_segments_source).toBe('/api/mbd/pipe');
    expect(adapted.data?.debug_info?.legacy_bends_count).toBe(1);
    expect(adapted.data?.debug_info?.legacy_fittings_count).toBe(1);
    expect(adapted.data?.debug_info?.legacy_material_rows_count).toBe(1);
  });
});
