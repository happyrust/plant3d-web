import { Matrix4, Vector3 } from 'three';

import type { MbdV2LinearDim, MbdV2PipeData } from './mbdV2Contract';
import type {
  ExternalDimensionMappingResult,
  ExternalDimensionRecord,
} from './normalizeExternalDimensions';
import type { Vec3 } from '../domain/types';
import type { ScreenLinePart } from '../kernel/types';

export type MbdDimensionDto = Readonly<{
  id: string;
  reference?: boolean;
  formattedLabel: string;
  dimensionLine: Readonly<{ from: Vec3; to: Vec3 }>;
  extensionLines?: readonly Readonly<{ from: Vec3; to: Vec3 }>[];
  arrowLines?: readonly Readonly<{ from: Vec3; to: Vec3 }>[];
  labelAnchor: Vec3;
  sourceToDesign: readonly number[];
}>;

function finiteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

function matrixFrom(value: readonly number[]): Matrix4 | null {
  if (value.length !== 16 || value.some(item => !Number.isFinite(item))) return null;
  const matrix = new Matrix4().fromArray([...value]);
  return Math.abs(matrix.determinant()) > 1e-18 ? matrix : null;
}

function transform(point: Vec3, matrix: Matrix4): Vec3 {
  const value = new Vector3(...point).applyMatrix4(matrix);
  return [value.x, value.y, value.z];
}

/**
 * Convert parquet-loaded MBD dimension DTOs into the frozen V2 contract shape
 * so both channels (HTTP API and parquet) enter the same
 * `mbdV2ToExternalRecords` mapper (ADR 0043). Applies the per-row
 * source-to-design transform, producing design-space metres.
 */
export function mbdDtosToV2PipeData(
  values: readonly MbdDimensionDto[],
  context: Readonly<{ inputRefno: string; branchRefno?: string }>,
): Readonly<{
  data: MbdV2PipeData;
  skipped: readonly Readonly<{ id: string; reason: string }>[];
}> {
  const primitives: MbdV2LinearDim[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const value of values) {
    const matrix = matrixFrom(value.sourceToDesign);
    const allPoints = [
      value.labelAnchor,
      value.dimensionLine.from,
      value.dimensionLine.to,
      ...(value.extensionLines ?? []).flatMap(line => [line.from, line.to]),
      ...(value.arrowLines ?? []).flatMap(line => [line.from, line.to]),
    ];
    if (!matrix || !allPoints.every(finiteVec3)) {
      skipped.push({
        id: value.id,
        reason: 'Invalid sourceToDesign matrix or explicit geometry',
      });
      continue;
    }
    primitives.push({
      kind: 'linear_dim',
      id: value.id,
      start: transform(value.dimensionLine.from, matrix),
      end: transform(value.dimensionLine.to, matrix),
      text: value.formattedLabel,
      extension_lines: (value.extensionLines ?? []).map(line => ({
        from: transform(line.from, matrix),
        to: transform(line.to, matrix),
      })),
      arrow_lines: (value.arrowLines ?? []).map(line => ({
        from: transform(line.from, matrix),
        to: transform(line.to, matrix),
      })),
      label_anchor: transform(value.labelAnchor, matrix),
      ...(value.reference ? { reference: true } : {}),
    });
  }
  return {
    data: {
      version: 'v2',
      input_refno: context.inputRefno,
      branch_refno: context.branchRefno ?? context.inputRefno,
      primitives,
      meta: { notes: ['converted from mbd_dimensions.parquet'] },
      issues: [],
    },
    skipped,
  };
}

/**
 * @deprecated Superseded by `mbdDtosToV2PipeData` + `mbdV2ToExternalRecords`
 * (single contract entry, ADR 0043). Kept until the remaining callers and
 * tests migrate.
 */
export function mbdToExternalDimensions(
  values: readonly MbdDimensionDto[],
): ExternalDimensionMappingResult {
  const records: ExternalDimensionRecord[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const value of values) {
    const matrix = matrixFrom(value.sourceToDesign);
    const lines = [
      { ...value.dimensionLine, part: 'dimension' as ScreenLinePart },
      ...(value.extensionLines ?? []).map(line => ({
        ...line,
        part: 'extension' as ScreenLinePart,
      })),
    ];
    const allPoints = [
      value.labelAnchor,
      ...lines.flatMap(line => [line.from, line.to]),
      ...(value.arrowLines ?? []).flatMap(line => [line.from, line.to]),
    ];
    if (!matrix || !allPoints.every(finiteVec3)) {
      skipped.push({
        id: value.id,
        reason: 'Invalid sourceToDesign matrix or explicit geometry',
      });
      continue;
    }
    records.push({
      id: value.id,
      source: 'mbd',
      sourceLabel: `MBD: ${value.id}`,
      role: value.reference ? 'external-reference' : 'external',
      layout: {
        id: value.id,
        role: value.reference ? 'external-reference' : 'external',
        labelPinned: true,
        formattedLabel: value.formattedLabel,
        lines: lines.map(line => ({
          from: transform(line.from, matrix),
          to: transform(line.to, matrix),
          part: line.part,
        })),
        labelAnchor: transform(value.labelAnchor, matrix),
        arrowLines: (value.arrowLines ?? []).map(line => ({
          from: transform(line.from, matrix),
          to: transform(line.to, matrix),
        })),
      },
    });
  }
  return { records, skipped };
}
