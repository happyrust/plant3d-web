import { Matrix4, Vector3 } from 'three';

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
