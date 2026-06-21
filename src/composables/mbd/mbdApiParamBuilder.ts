import type { MbdPipeQueryParams } from '@/api/mbdPipeApi';
import type { MbdAnnotationRequestAxes } from '@/composables/mbd/mbdPresetMapper';

export type BuildMbdPipeQueryParamsOptions = {
  axes: MbdAnnotationRequestAxes;
  debug: boolean;
  dbno?: number | null;
  batchId?: string | null;
};

export function buildMbdPipeQueryParams(
  options: BuildMbdPipeQueryParamsOptions,
): MbdPipeQueryParams {
  const { axes } = options;
  return {
    mode: axes.viewMode,
    source: 'parquet',
    debug: options.debug,
    dbno: options.dbno ?? undefined,
    batch_id: options.batchId ?? null,
    min_slope: 0.001,
    max_slope: 0.1,
    dim_min_length: 1.0,
    weld_merge_threshold: 1.0,
    include_dims: axes.dataScope.lengths.segment,
    include_chain_dims: axes.dataScope.lengths.chain,
    // 折线 BRAN 的 overall 是路径总长，layout_first 下不能用首尾直连的一条尺寸线表达。
    include_overall_dim: !axes.isLayoutFirst && axes.dataScope.lengths.overall,
    include_port_dims: axes.dataScope.lengths.port,
    include_cut_tubis: axes.dataScope.lengths.cutTubi,
    include_fittings: axes.dataScope.semantics.fittings,
    include_tags: axes.dataScope.semantics.tags,
    include_position_tags: axes.dataScope.semantics.positionTags,
    include_elevation_marks: axes.dataScope.semantics.elevationMarks,
    include_branch_label: axes.dataScope.semantics.branchLabel,
    include_material_balloons: axes.dataScope.semantics.materialBalloons,
    include_material_table: axes.dataScope.semantics.materialTable,
    include_layout_hints: true,
    include_layout_result: axes.isLayoutFirst,
    include_welds: axes.dataScope.semantics.welds,
    include_slopes: axes.dataScope.semantics.slopes,
    include_bends: axes.dataScope.semantics.bends,
    bend_mode: 'facecenter',
  };
}
