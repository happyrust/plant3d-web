import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getMbdPipeV2Annotations,
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

describe('getMbdPipeV2Annotations adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
          branch_attrs: {},
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
});
