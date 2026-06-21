import { describe, expect, it } from 'vitest';

import { buildMbdPipeQueryParams } from './mbdApiParamBuilder';
import { resolveMbdAnnotationRequestAxes } from './mbdPresetMapper';

describe('buildMbdPipeQueryParams', () => {
  it('builds full interactive layout-first query flags for lightweight 3D dimensions', () => {
    const axes = resolveMbdAnnotationRequestAxes({
      displayMode: 'full',
      viewMode: 'layout_first',
    });
    const params = buildMbdPipeQueryParams({
      axes,
      debug: true,
      dbno: 123,
      batchId: 'batch-1',
    });

    expect(params).toMatchObject({
      mode: 'layout_first',
      source: 'parquet',
      debug: true,
      dbno: 123,
      batch_id: 'batch-1',
      include_dims: false,
      include_chain_dims: true,
      include_overall_dim: false,
      include_port_dims: false,
      include_cut_tubis: true,
      include_fittings: false,
      include_tags: false,
      include_position_tags: false,
      include_elevation_marks: false,
      include_branch_label: false,
      include_material_balloons: false,
      include_material_table: false,
      include_layout_hints: true,
      include_layout_result: true,
      include_welds: false,
      include_slopes: false,
      include_bends: false,
      bend_mode: 'facecenter',
    });
  });

  it('keeps drawing layout-first query flags for complete MBD semantics', () => {
    const axes = resolveMbdAnnotationRequestAxes({
      displayMode: 'drawing',
      viewMode: 'layout_first',
    });
    const params = buildMbdPipeQueryParams({
      axes,
      debug: true,
    });

    expect(params.include_fittings).toBe(true);
    expect(params.include_tags).toBe(true);
    expect(params.include_material_balloons).toBe(true);
    expect(params.include_welds).toBe(true);
    expect(params.include_bends).toBe(true);
    expect(params.include_layout_result).toBe(true);
  });

  it('builds length-focus query flags without full semantic noise', () => {
    const axes = resolveMbdAnnotationRequestAxes({
      displayMode: 'length',
      viewMode: 'layout_first',
    });
    const params = buildMbdPipeQueryParams({
      axes,
      debug: false,
    });

    expect(params.include_chain_dims).toBe(true);
    expect(params.include_cut_tubis).toBe(true);
    expect(params.include_layout_result).toBe(true);
    expect(params.include_fittings).toBe(false);
    expect(params.include_tags).toBe(false);
    expect(params.include_material_balloons).toBe(false);
  });

  it('keeps non-layout-first queries on semantic fallback without layout result', () => {
    const axes = resolveMbdAnnotationRequestAxes({
      displayMode: 'full',
      viewMode: 'inspection',
    });
    const params = buildMbdPipeQueryParams({
      axes,
      debug: false,
      dbno: null,
      batchId: null,
    });

    expect(params.mode).toBe('inspection');
    expect(params.dbno).toBeUndefined();
    expect(params.batch_id).toBeNull();
    expect(params.include_layout_result).toBe(false);
    expect(params.include_overall_dim).toBe(true);
    expect(params.include_fittings).toBe(false);
  });
});
