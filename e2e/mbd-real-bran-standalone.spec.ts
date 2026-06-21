import { mkdirSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

import { expect, test } from '@playwright/test';

import { MBD_DRAWING_STYLE_PROFILE } from '../src/composables/mbd/mbdDrawingStyleProfile';
import { isMbdDrawingPresetUrl } from '../src/utils/mbdStandaloneUrl';

const viewerUrl = process.env.MBD_REAL_VIEWER_URL?.trim() ?? '';
const outputProject = process.env.MBD_REAL_OUTPUT_PROJECT?.trim() || 'aps250160-mbd-cata2';
const primaryFixtureRefno = '2013286704_476';
const refnos = parseRealBranRefnos();
const drawingScreenMarginPx = 32;
const drawingPipeEmphasisCounts = {
  ringsPerSegment: MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringsPerSegment,
  bandsPerSegment: MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandsPerSegment,
  railsPerSegment: MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railsPerSegment,
  outlineRailsPerSegment: MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineRailsPerSegment,
  coreRingsPerFitting: MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreRingsPerFitting,
  minPortRingsPerFitting: MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.minPortRingsPerFitting,
  minArmsPerFitting: MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.minArmsPerFitting,
};

test.describe.configure({ mode: 'serial' });
test.skip(!viewerUrl, 'Set MBD_REAL_VIEWER_URL to run the real deployed BRAN MBD regression.');
test.setTimeout(120_000);

function parseRealBranRefnos(): string[] {
  const raw = process.env.MBD_REAL_REFNOS?.trim() ||
    process.env.MBD_REAL_REFNO?.trim() ||
    primaryFixtureRefno;
  const values = raw
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? [...new Set(values)] : [primaryFixtureRefno];
}

function normalizeRefnoForId(value: string): string {
  return value.trim().replace(/[\\/]/g, '_');
}

function isPrimaryFixtureRefno(value: string): boolean {
  return normalizeRefnoForId(value) === primaryFixtureRefno;
}

function toHexColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0').toLowerCase()}`;
}

function isCloseToProfile(value: unknown, expected: number, tolerance = 0.015): boolean {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Math.abs(numeric - expected) <= tolerance;
}

type DecodedPng = {
  width: number;
  height: number;
  data: Uint8Array;
};

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(buffer: Buffer): DecodedPng {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error('Unexpected PNG signature');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
    } else if (type === 'IDAT') {
      idatChunks.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const rgba = new Uint8Array(width * height * 4);
  let rawOffset = 0;
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset]!;
    rawOffset += 1;
    current.set(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels]! : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= channels ? previous[x - channels]! : 0;
      let value = current[x]!;
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) value = (value + paethPredictor(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      current[x] = value;
    }

    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      rgba[dst] = current[src]!;
      rgba[dst + 1] = current[src + 1]!;
      rgba[dst + 2] = current[src + 2]!;
      rgba[dst + 3] = colorType === 6 ? current[src + 3]! : 255;
    }
    previous.set(current);
  }

  return { width, height, data: rgba };
}

function isMbdRedPixel(r: number, g: number, b: number, a: number): boolean {
  return a > 180 && r >= 70 && g <= 80 && b <= 80 && r > g * 1.45 && r > b * 1.45;
}

function isMbdBluePixel(r: number, g: number, b: number, a: number): boolean {
  return a > 180 && b >= 95 && b > r * 1.35 && b >= g * 0.75 && (g > 45 || b > 150);
}

function countPixelsInBox(
  image: DecodedPng,
  box: any,
  predicate: (r: number, g: number, b: number, a: number) => boolean,
): number {
  const left = Math.max(0, Math.floor(Number(box.left) - 3));
  const right = Math.min(image.width, Math.ceil(Number(box.right) + 3));
  const top = Math.max(0, Math.floor(Number(box.top) - 3));
  const bottom = Math.min(image.height, Math.ceil(Number(box.bottom) + 3));
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * image.width + x) * 4;
      if (predicate(
        image.data[index]!,
        image.data[index + 1]!,
        image.data[index + 2]!,
        image.data[index + 3]!,
      )) {
        count += 1;
      }
    }
  }
  return count;
}

function buildBluePipePixelSummary(snapshot: any, image: DecodedPng): {
  segment_count: number;
  per_kind: {
    kind: string;
    item_count: number;
    min_items: number;
    blue_pixels: number;
    min_blue_pixels: number;
  }[];
  total_blue_pixels: number;
  min_total_blue_pixels: number;
} {
  const segmentCount = Math.max(1, Number(snapshot.data_counts?.segments ?? 0) || 1);
  const fittingCount = Math.max(0, Number(snapshot.data_counts?.fittings ?? 0) || 0);
  const required = [
    { kind: 'pipe-visual-body', minItems: segmentCount, minBluePixels: 4_000 * segmentCount },
    {
      kind: 'pipe-visual-ring',
      minItems: segmentCount * drawingPipeEmphasisCounts.ringsPerSegment,
      minBluePixels: 1_800 * segmentCount,
    },
    {
      kind: 'pipe-visual-band',
      minItems: segmentCount * drawingPipeEmphasisCounts.bandsPerSegment,
      minBluePixels: 2_200 * segmentCount,
    },
    {
      kind: 'pipe-visual-rail',
      minItems: segmentCount * drawingPipeEmphasisCounts.railsPerSegment,
      minBluePixels: 6_000 * segmentCount,
    },
    {
      kind: 'pipe-visual-outline',
      minItems: segmentCount * drawingPipeEmphasisCounts.outlineRailsPerSegment,
      minBluePixels: 3_600 * segmentCount,
    },
  ];
  if (fittingCount > 0) {
    required.push(
      {
        kind: 'fitting-visual-core',
        minItems: fittingCount * drawingPipeEmphasisCounts.coreRingsPerFitting,
        minBluePixels: 1_600 * fittingCount,
      },
      {
        kind: 'fitting-visual-port',
        minItems: fittingCount * drawingPipeEmphasisCounts.minPortRingsPerFitting,
        minBluePixels: 1_400 * fittingCount,
      },
      {
        kind: 'fitting-visual-arm',
        minItems: fittingCount * drawingPipeEmphasisCounts.minArmsPerFitting,
        minBluePixels: 1_400 * fittingCount,
      },
    );
  }
  const minTotalBluePixels = required.reduce(
    (sum, item) => sum + item.minBluePixels,
    0,
  );
  const perKind = required.map(({ kind, minItems, minBluePixels }) => {
    const items = (snapshot.line_object_states ?? []).filter((item: any) =>
      item.visible && item.aux_kind === kind && item.screen_box,
    );
    const bluePixels = items.reduce(
      (sum: number, item: any) => sum + countPixelsInBox(image, item.screen_box, isMbdBluePixel),
      0,
    );
    return { kind, item_count: items.length, min_items: minItems, blue_pixels: bluePixels, min_blue_pixels: minBluePixels };
  });
  const totalBluePixels = perKind.reduce((sum, item) => sum + item.blue_pixels, 0);
  return {
    segment_count: segmentCount,
    per_kind: perKind,
    total_blue_pixels: totalBluePixels,
    min_total_blue_pixels: minTotalBluePixels,
  };
}

function buildDimensionLinePixelSummary(snapshot: any, image: DecodedPng): {
  expected_linear_dim_count: number;
  main_line_count: number;
  extension_line_count: number;
  main_red_pixels: number;
  extension_red_pixels: number;
  min_main_red_pixels: number;
  min_extension_red_pixels: number;
} {
  const expectedLinearDimCount = Math.max(
    1,
    Number(snapshot.rendered_counts?.dims ?? 0) +
      Number(snapshot.rendered_counts?.cut_tubis ?? 0),
  );
  const states = (snapshot.line_object_states ?? []).filter((item: any) =>
    item.visible &&
    /^(dim|cut_tubi):/.test(String(item.annotation_id ?? '')) &&
    item.screen_box,
  );
  const mainLines = states.filter((item: any) =>
    ['dimensionLineA', 'dimensionLineB', 'dimensionLineOutside'].includes(
      String(item.line_role ?? ''),
    ),
  );
  const extensionLines = states.filter((item: any) =>
    ['extensionLine1', 'extensionLine2'].includes(String(item.line_role ?? '')),
  );

  const mainRedPixels = mainLines.reduce(
    (sum: number, item: any) => sum + countPixelsInBox(image, item.screen_box, isMbdRedPixel),
    0,
  );
  const extensionRedPixels = extensionLines.reduce(
    (sum: number, item: any) => sum + countPixelsInBox(image, item.screen_box, isMbdRedPixel),
    0,
  );
  return {
    expected_linear_dim_count: expectedLinearDimCount,
    main_line_count: mainLines.length,
    extension_line_count: extensionLines.length,
    main_red_pixels: mainRedPixels,
    extension_red_pixels: extensionRedPixels,
    min_main_red_pixels: 260 * expectedLinearDimCount,
    min_extension_red_pixels: 14 * expectedLinearDimCount,
  };
}

function getBackendLinearDimensionExpectations(v2Body: any): {
  id: string;
  text: string;
  isCutTubi: boolean;
  subKind: string;
  duplicateKey: string | null;
}[] {
  const primitives = Array.isArray(v2Body?.data?.primitives)
    ? v2Body.data.primitives
    : [];
  return primitives
    .filter((primitive: any) =>
      primitive?.kind === 'linear_dim' &&
      primitive.visible !== false &&
      String(primitive.id ?? '').trim().length > 0,
    )
    .map((primitive: any) => ({
      id: String(primitive.id),
      text: String(primitive.text?.content ?? '').trim(),
      isCutTubi: String(primitive.sub_kind ?? '').trim().toLowerCase() === 'cut_tubi',
      subKind: String(primitive.sub_kind ?? '').trim().toLowerCase() || 'segment',
      duplicateKey: buildBackendLinearDimensionDuplicateKey(primitive),
    }))
    .filter((item: { text: string }) => item.text.length > 0);
}

function roundBackendCoord(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return (Math.round(n * 100) / 100).toFixed(2);
}

function buildBackendPointKey(point: unknown): string | null {
  if (!Array.isArray(point) || point.length !== 3) return null;
  const coords = point.map(roundBackendCoord);
  if (coords.some((item) => item == null)) return null;
  return coords.join(',');
}

function buildBackendSpanKey(a: unknown, b: unknown): string | null {
  const keyA = buildBackendPointKey(a);
  const keyB = buildBackendPointKey(b);
  if (!keyA || !keyB) return null;
  return keyA <= keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

function normalizeBackendDimDuplicateText(text: unknown): string {
  return String(text ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function buildBackendLinearDimensionDuplicateKey(primitive: any): string | null {
  const text = normalizeBackendDimDuplicateText(primitive?.text?.content);
  const spanKey = buildBackendSpanKey(
    primitive?.extension_1?.start,
    primitive?.extension_2?.start,
  );
  if (!text || !spanKey) return null;
  return `${text}|${spanKey}`;
}

function isPrimaryBackendLengthDimForDrawingDedupe(item: {
  isCutTubi: boolean;
  subKind: string;
}): boolean {
  return !item.isCutTubi && ['segment', 'chain', 'overall'].includes(item.subKind);
}

function getBackendLinearDimDedupePriority(item: {
  isCutTubi: boolean;
  subKind: string;
}): number {
  if (item.isCutTubi) return 0;
  if (item.subKind === 'chain') return 40;
  if (item.subKind === 'segment') return 30;
  if (item.subKind === 'overall') return 20;
  if (item.subKind === 'port') return 10;
  return 0;
}

function collapseBackendLinearDimsForDrawing(
  expected: ReturnType<typeof getBackendLinearDimensionExpectations>,
): ReturnType<typeof getBackendLinearDimensionExpectations> {
  const bestByKey = new Map<string, { index: number; priority: number }>();
  expected.forEach((item, index) => {
    if (!item.duplicateKey) return;
    const priority = getBackendLinearDimDedupePriority(item);
    if (priority <= 0) return;
    const prev = bestByKey.get(item.duplicateKey);
    if (!prev || priority > prev.priority) {
      bestByKey.set(item.duplicateKey, { index, priority });
    }
  });
  if (bestByKey.size <= 0) return expected;
  return expected.filter((item, index) => {
    if (!item.duplicateKey) return true;
    const priority = getBackendLinearDimDedupePriority(item);
    if (priority <= 0) return true;
    return bestByKey.get(item.duplicateKey)?.index === index;
  });
}

function getRenderedBackendLinearDimensionExpectations(
  v2Body: any,
  drawingPreset: boolean,
): ReturnType<typeof getBackendLinearDimensionExpectations> {
  const expected = getBackendLinearDimensionExpectations(v2Body);
  if (!drawingPreset) return expected;
  const collapsedLinearDims = collapseBackendLinearDimsForDrawing(expected);
  const drawingLinearDims = collapsedLinearDims.filter((item) => !item.isCutTubi);

  const primaryKeys = new Set(
    drawingLinearDims
      .filter(isPrimaryBackendLengthDimForDrawingDedupe)
      .map((item) => item.duplicateKey)
      .filter((item): item is string => !!item),
  );
  if (primaryKeys.size <= 0) return drawingLinearDims;

  return drawingLinearDims.filter((item) =>
    !item.isCutTubi ||
    !item.duplicateKey ||
    !primaryKeys.has(item.duplicateKey),
  );
}

function assertBackendLinearDimensionCoverage(
  snapshot: any,
  v2Body: any,
  drawingPreset: boolean,
): void {
  const rawExpected = getBackendLinearDimensionExpectations(v2Body);
  const expected = getRenderedBackendLinearDimensionExpectations(v2Body, drawingPreset);
  const mainDims = rawExpected.filter((item) => !item.isCutTubi);
  const cutTubis = rawExpected.filter((item) => item.isCutTubi);
  const renderedMainDims = expected.filter((item) => !item.isCutTubi);
  const renderedCutTubis = expected.filter((item) => item.isCutTubi);
  const screenItems = snapshot.screen_items ?? [];
  const lineStates = snapshot.line_object_states ?? [];
  const perDim = expected.map((dim) => {
    const screenItem = screenItems.find((item: any) => item.id === dim.id);
    const visibleLineStates = lineStates.filter((item: any) =>
      item.visible && item.annotation_id === dim.id,
    );
    const mainLines = visibleLineStates.filter((item: any) =>
      ['dimensionLineA', 'dimensionLineB', 'dimensionLineOutside'].includes(
        String(item.line_role ?? ''),
      ) && Number(item.screen_span_px) > 8,
    );
    const extensionLines = visibleLineStates.filter((item: any) =>
      ['extensionLine1', 'extensionLine2'].includes(String(item.line_role ?? '')) &&
      Number(item.screen_span_px) > 8,
    );
    return {
      id: dim.id,
      text: dim.text,
      is_cut_tubi: dim.isCutTubi,
      screen_item_found: !!screenItem,
      screen_item_in_viewport: screenItem?.in_viewport === true,
      screen_item_text: String(screenItem?.text ?? ''),
      main_line_count: mainLines.length,
      extension_line_count: extensionLines.length,
    };
  });
  const debugPayload = {
    raw_expected_linear_dim_count: rawExpected.length,
    expected_rendered_linear_dim_count: expected.length,
    expected_main_dim_count: mainDims.length,
    expected_cut_tubi_count: cutTubis.length,
    expected_rendered_main_dim_count: renderedMainDims.length,
    expected_rendered_cut_tubi_count: renderedCutTubis.length,
    rendered_counts: snapshot.rendered_counts,
    data_counts: snapshot.data_counts,
    per_dim: perDim,
  };

  expect(rawExpected.length, JSON.stringify(debugPayload, null, 2)).toBeGreaterThan(0);
  expect(expected.length, JSON.stringify(debugPayload, null, 2)).toBeGreaterThan(0);
  expect(snapshot.data_counts?.layout_linear_dims, JSON.stringify(debugPayload, null, 2))
    .toBe(mainDims.length);
  expect(snapshot.data_counts?.cut_tubis, JSON.stringify(debugPayload, null, 2))
    .toBe(cutTubis.length);
  expect(snapshot.rendered_counts?.dims, JSON.stringify(debugPayload, null, 2))
    .toBe(renderedMainDims.length);
  expect(snapshot.rendered_counts?.cut_tubis, JSON.stringify(debugPayload, null, 2))
    .toBe(renderedCutTubis.length);
  expect(
    perDim.every((item) =>
      item.screen_item_found &&
      item.screen_item_in_viewport &&
      item.screen_item_text.trim() === item.text &&
      item.main_line_count >= 1 &&
      item.extension_line_count >= 2,
    ),
    JSON.stringify(debugPayload, null, 2),
  ).toBe(true);
}

function buildBackendLinearDimensionPixelSummary(
  snapshot: any,
  v2Body: any,
  image: DecodedPng,
  drawingPreset: boolean,
): {
  per_dim: {
    id: string;
    text: string;
    is_cut_tubi: boolean;
    red_pixels: number;
    min_red_pixels: number;
  }[];
} {
  const expected = getRenderedBackendLinearDimensionExpectations(v2Body, drawingPreset);
  return {
    per_dim: expected.map((dim) => {
      const screenItem = (snapshot.screen_items ?? []).find((item: any) => item.id === dim.id);
      const redPixels = screenItem?.box
        ? countPixelsInBox(image, screenItem.box, isMbdRedPixel)
        : 0;
      return {
        id: dim.id,
        text: dim.text,
        is_cut_tubi: dim.isCutTubi,
        red_pixels: redPixels,
        min_red_pixels: 24,
      };
    }),
  };
}

function assertRenderedBackendLinearDimensionPixels(
  snapshot: any,
  v2Body: any,
  image: DecodedPng,
  drawingPreset: boolean,
): void {
  const summary = buildBackendLinearDimensionPixelSummary(
    snapshot,
    v2Body,
    image,
    drawingPreset,
  );
  const perDim = summary.per_dim;

  expect(
    perDim.length > 0 && perDim.every((item) => item.red_pixels >= item.min_red_pixels),
    JSON.stringify(perDim, null, 2),
  ).toBe(true);
}

function assertRenderedRedAnnotationPixels(snapshot: any, image: DecodedPng): void {
  const requiredItems = (snapshot.screen_items ?? []).filter((item: any) => {
    const id = String(item.id ?? '');
    return item.in_viewport === true &&
      item.box &&
      (
        id.startsWith('dim:chain:') ||
        id.startsWith('tag:branch:') ||
        id.startsWith('tag:elevation:') ||
        id.startsWith('tag:material:')
      );
  });
  const perFragment = requiredItems.map((item: any) => {
    const redPixels = countPixelsInBox(image, item.box, isMbdRedPixel);
    return {
      id: String(item.id ?? ''),
      text: String(item.text ?? ''),
      red_pixels: redPixels,
    };
  });
  expect(
    perFragment.length > 0 && perFragment.every((item) => item.red_pixels >= 24),
    JSON.stringify(perFragment, null, 2),
  ).toBe(true);

  const totalRedPixels = perFragment.reduce((sum, item) => sum + item.red_pixels, 0);
  expect(totalRedPixels, JSON.stringify(perFragment, null, 2)).toBeGreaterThan(450);
}

function getBackendLabelText(primitive: any): string {
  return String(
    primitive?.content ??
    primitive?.text?.content ??
    primitive?.label ??
    '',
  ).trim();
}

function isBackendDrawingTubiLengthLabel(primitive: any): boolean {
  const raw = `${primitive?.id ?? ''} ${primitive?.role ?? ''} ${primitive?.function ?? ''}`
    .toUpperCase();
  if (!raw.includes('TUBI')) return false;
  return /^L\s*=\s*[-+]?\d+(?:\.\d+)?(?:\s*(?:MM|M))?$/i.test(
    getBackendLabelText(primitive),
  );
}

function getBackendLabelPrimitives(v2Body: any): any[] {
  const primitives = Array.isArray(v2Body?.data?.primitives)
    ? v2Body.data.primitives
    : [];
  return primitives.filter((primitive: any) =>
    primitive?.kind === 'label' &&
    primitive.visible !== false &&
    String(primitive.id ?? '').trim().length > 0 &&
    getBackendLabelText(primitive).length > 0,
  );
}

function getSuppressedDrawingTubiLengthLabelIds(
  v2Body: any,
  drawingPreset: boolean,
): Set<string> {
  if (!drawingPreset) return new Set();
  return new Set(
    getBackendLabelPrimitives(v2Body)
      .filter(isBackendDrawingTubiLengthLabel)
      .map((primitive: any) => String(primitive.id)),
  );
}

function getExpectedRenderedTagCount(
  v2Body: any,
  drawingPreset: boolean,
  fallbackRawCount: number,
): number {
  const labels = getBackendLabelPrimitives(v2Body);
  if (labels.length <= 0) return fallbackRawCount;
  const suppressedIds = getSuppressedDrawingTubiLengthLabelIds(v2Body, drawingPreset);
  return labels.filter((primitive: any) => !suppressedIds.has(String(primitive.id))).length;
}

function getExpectedRenderedLeaderLineCount(
  v2Body: any,
  drawingPreset: boolean,
  fallbackRawCount: number,
): number {
  const primitives = Array.isArray(v2Body?.data?.primitives)
    ? v2Body.data.primitives
    : [];
  const leaders = primitives.filter((primitive: any) =>
    primitive?.kind === 'leader_line' &&
    primitive.visible !== false &&
    String(primitive.id ?? '').trim().length > 0,
  );
  if (leaders.length <= 0) return fallbackRawCount;
  const suppressedIds = getSuppressedDrawingTubiLengthLabelIds(v2Body, drawingPreset);
  return leaders.filter((leader: any) =>
    !suppressedIds.has(String(leader.source_refno ?? '')),
  ).length;
}

function assertRenderedBluePipePixels(snapshot: any, image: DecodedPng): void {
  const summary = buildBluePipePixelSummary(snapshot, image);

  expect(
    summary.per_kind.every((item) => item.item_count >= item.min_items && item.blue_pixels > 0),
    JSON.stringify(summary, null, 2),
  ).toBe(true);

  expect(
    summary.per_kind
      .filter((item) => item.kind === 'pipe-visual-body' || item.kind === 'pipe-visual-rail')
      .every((item) => item.blue_pixels >= item.min_blue_pixels),
    JSON.stringify(summary, null, 2),
  ).toBe(true);

  expect(summary.total_blue_pixels, JSON.stringify(summary, null, 2))
    .toBeGreaterThan(summary.min_total_blue_pixels);
}

function assertRenderedDimensionLinePixels(snapshot: any, image: DecodedPng): void {
  const debugPayload = buildDimensionLinePixelSummary(snapshot, image);

  expect(debugPayload.main_line_count, JSON.stringify(debugPayload, null, 2))
    .toBeGreaterThanOrEqual(debugPayload.expected_linear_dim_count);
  expect(debugPayload.extension_line_count, JSON.stringify(debugPayload, null, 2))
    .toBeGreaterThanOrEqual(debugPayload.expected_linear_dim_count * 2);
  expect(debugPayload.main_red_pixels, JSON.stringify(debugPayload, null, 2))
    .toBeGreaterThan(debugPayload.min_main_red_pixels);
  expect(debugPayload.extension_red_pixels, JSON.stringify(debugPayload, null, 2))
    .toBeGreaterThan(debugPayload.min_extension_red_pixels);
}

function summarizePrimitiveKinds(v2Body: any): Record<string, number> {
  const primitives = Array.isArray(v2Body?.data?.primitives)
    ? v2Body.data.primitives
    : [];
  return primitives.reduce<Record<string, number>>((acc, primitive: any) => {
    const kind = String(primitive?.kind ?? 'unknown');
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});
}

function buildScreenMarginSummary(snapshot: any, minMarginPx = drawingScreenMarginPx): {
  viewport: { width: number; height: number } | null;
  min_margin_px: number | null;
  min_required_margin_px: number;
  aggregate_box: any;
  violations: {
    id: string;
    text: string;
    margins: { left: number; top: number; right: number; bottom: number };
    box: any;
  }[];
} {
  const viewport = snapshot.viewport;
  const items = (snapshot.screen_items ?? []).filter((item: any) => item.box);
  if (
    !viewport ||
    !Number.isFinite(Number(viewport.width)) ||
    !Number.isFinite(Number(viewport.height)) ||
    items.length <= 0
  ) {
    return {
      viewport: null,
      min_margin_px: null,
      min_required_margin_px: minMarginPx,
      aggregate_box: null,
      violations: [],
    };
  }

  const width = Number(viewport.width);
  const height = Number(viewport.height);
  const aggregate = items.reduce(
    (acc: any, item: any) => ({
      left: Math.min(acc.left, Number(item.box.left)),
      right: Math.max(acc.right, Number(item.box.right)),
      top: Math.min(acc.top, Number(item.box.top)),
      bottom: Math.max(acc.bottom, Number(item.box.bottom)),
    }),
    { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, top: Number.POSITIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY },
  );
  const itemMargins = items.map((item: any) => {
    const margins = {
      left: Number(item.box.left),
      top: Number(item.box.top),
      right: width - Number(item.box.right),
      bottom: height - Number(item.box.bottom),
    };
    return {
      id: String(item.id ?? ''),
      text: String(item.text ?? ''),
      margins,
      box: item.box,
      min: Math.min(margins.left, margins.top, margins.right, margins.bottom),
    };
  });
  const minMargin = Math.min(...itemMargins.map((item) => item.min));
  return {
    viewport: { width, height },
    min_margin_px: Number(minMargin.toFixed(2)),
    min_required_margin_px: minMarginPx,
    aggregate_box: {
      left: Number(aggregate.left.toFixed(2)),
      right: Number(aggregate.right.toFixed(2)),
      top: Number(aggregate.top.toFixed(2)),
      bottom: Number(aggregate.bottom.toFixed(2)),
      margins: {
        left: Number(aggregate.left.toFixed(2)),
        top: Number(aggregate.top.toFixed(2)),
        right: Number((width - aggregate.right).toFixed(2)),
        bottom: Number((height - aggregate.bottom).toFixed(2)),
      },
    },
    violations: itemMargins
      .filter((item) => item.min < minMarginPx)
      .map(({ id, text, margins, box }) => ({
        id,
        text,
        margins: {
          left: Number(margins.left.toFixed(2)),
          top: Number(margins.top.toFixed(2)),
          right: Number(margins.right.toFixed(2)),
          bottom: Number(margins.bottom.toFixed(2)),
        },
        box,
      })),
  };
}

function assertDrawingScreenMargins(snapshot: any, minMarginPx = drawingScreenMarginPx): void {
  const summary = buildScreenMarginSummary(snapshot, minMarginPx);
  expect(summary.viewport, JSON.stringify(summary, null, 2)).not.toBeNull();
  expect(summary.min_margin_px, JSON.stringify(summary, null, 2)).not.toBeNull();
  expect(summary.min_margin_px!, JSON.stringify(summary, null, 2))
    .toBeGreaterThanOrEqual(minMarginPx);
  expect(summary.violations, JSON.stringify(summary, null, 2)).toHaveLength(0);
}

function segmentIntersectsBox(
  segment: { x1: number; y1: number; x2: number; y2: number },
  box: any,
  paddingPx = 0,
): boolean {
  const left = Number(box.left) - paddingPx;
  const right = Number(box.right) + paddingPx;
  const top = Number(box.top) - paddingPx;
  const bottom = Number(box.bottom) + paddingPx;
  if (![left, right, top, bottom].every(Number.isFinite)) return false;
  if (left > right || top > bottom) return false;

  const pointInside = (x: number, y: number) =>
    x >= left && x <= right && y >= top && y <= bottom;
  if (pointInside(segment.x1, segment.y1) || pointInside(segment.x2, segment.y2)) {
    return true;
  }

  const intersects = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
  ) => {
    const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
      (qx - px) * (ry - py) - (qy - py) * (rx - px);
    const onSegment = (
      px: number,
      py: number,
      qx: number,
      qy: number,
      rx: number,
      ry: number,
    ) =>
      qx >= Math.min(px, rx) - 1e-6 &&
      qx <= Math.max(px, rx) + 1e-6 &&
      qy >= Math.min(py, ry) - 1e-6 &&
      qy <= Math.max(py, ry) + 1e-6;
    const o1 = orient(ax, ay, bx, by, cx, cy);
    const o2 = orient(ax, ay, bx, by, dx, dy);
    const o3 = orient(cx, cy, dx, dy, ax, ay);
    const o4 = orient(cx, cy, dx, dy, bx, by);
    if (o1 * o2 < 0 && o3 * o4 < 0) return true;
    if (Math.abs(o1) <= 1e-6 && onSegment(ax, ay, cx, cy, bx, by)) return true;
    if (Math.abs(o2) <= 1e-6 && onSegment(ax, ay, dx, dy, bx, by)) return true;
    if (Math.abs(o3) <= 1e-6 && onSegment(cx, cy, ax, ay, dx, dy)) return true;
    return Math.abs(o4) <= 1e-6 && onSegment(cx, cy, bx, by, dx, dy);
  };

  return (
    intersects(segment.x1, segment.y1, segment.x2, segment.y2, left, top, right, top) ||
    intersects(segment.x1, segment.y1, segment.x2, segment.y2, right, top, right, bottom) ||
    intersects(segment.x1, segment.y1, segment.x2, segment.y2, right, bottom, left, bottom) ||
    intersects(segment.x1, segment.y1, segment.x2, segment.y2, left, bottom, left, top)
  );
}

function pointToSegmentDistancePx(
  point: { x: number; y: number },
  segment: { x1: number; y1: number; x2: number; y2: number },
): number {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const lenSq = dx * dx + dy * dy;
  if (!Number.isFinite(lenSq) || lenSq <= 1e-9) {
    return Math.hypot(point.x - segment.x1, point.y - segment.y1);
  }
  const t = Math.max(0, Math.min(1, ((point.x - segment.x1) * dx + (point.y - segment.y1) * dy) / lenSq));
  return Math.hypot(point.x - (segment.x1 + dx * t), point.y - (segment.y1 + dy * t));
}

function buildMaterialLeaderDistanceSummary(snapshot: any): {
  max_distance_px: number;
  max_allowed_px: number;
  per_material: {
    id: string;
    text: string;
    leader_id: string | null;
    distance_px: number | null;
  }[];
} {
  const lineStates = snapshot.line_object_states ?? [];
  const perMaterial = (snapshot.screen_items ?? [])
    .filter((item: any) =>
      item.in_viewport === true &&
      String(item.id ?? '').startsWith('tag:material:') &&
      Number.isFinite(Number(item.x)) &&
      Number.isFinite(Number(item.y)),
    )
    .map((item: any) => {
      const extension = lineStates.find((line: any) =>
        line.visible &&
        String(line.aux_kind ?? '') === 'v2_leader_extension' &&
        String(line.target_tag_id ?? '') === String(item.id),
      );
      const leaderId = extension?.leader_id ? String(extension.leader_id) : null;
      const leaderSegments = lineStates
        .filter((line: any) =>
          line.visible &&
          String(line.aux_kind ?? '') === 'v2_leader_line' &&
          String(line.leader_id ?? '') === String(leaderId) &&
          Array.isArray(line.screen_segments),
        )
        .flatMap((line: any) => line.screen_segments ?? [])
        .filter((segment: any) =>
          [segment.x1, segment.y1, segment.x2, segment.y2].every((value) =>
            Number.isFinite(Number(value)),
          ),
        );
      const extensionSegments = Array.isArray(extension?.screen_segments)
        ? (extension.screen_segments ?? []).filter((segment: any) =>
          [segment.x1, segment.y1, segment.x2, segment.y2].every((value) =>
            Number.isFinite(Number(value)),
          ),
        )
        : [];
      const measuredSegments = leaderSegments.length > 0 ? leaderSegments : extensionSegments;
      const point = { x: Number(item.x), y: Number(item.y) };
      const distance = measuredSegments.length > 0
        ? Math.min(...measuredSegments.map((segment: any) => pointToSegmentDistancePx(point, segment)))
        : null;
      return {
        id: String(item.id),
        text: String(item.text ?? ''),
        leader_id: leaderId,
        distance_px: distance == null ? null : Number(distance.toFixed(2)),
      };
    });
  const distances = perMaterial
    .map((item) => item.distance_px)
    .filter((value): value is number => value != null);
  return {
    max_distance_px: distances.length > 0 ? Math.max(...distances) : 0,
    max_allowed_px: 340,
    per_material: perMaterial,
  };
}

function assertMaterialBalloonsNearLeaders(snapshot: any): void {
  const summary = buildMaterialLeaderDistanceSummary(snapshot);
  expect(summary.per_material.length, JSON.stringify(summary, null, 2)).toBeGreaterThan(0);
  expect(
    summary.per_material.every((item) =>
      item.leader_id != null &&
      item.distance_px != null &&
      item.distance_px <= summary.max_allowed_px,
    ),
    JSON.stringify(summary, null, 2),
  ).toBe(true);
}

type LeaderTextCrossing = {
  line_name: string;
  aux_kind: string | null;
  leader_id: string | null;
  target_tag_id: string | null;
  item_id: string;
  item_text: string;
  segment_index: number;
};

function buildLeaderTextCrossingSummary(snapshot: any): {
  crossing_count: number;
  crossings: LeaderTextCrossing[];
} {
  const screenItems = snapshot.screen_items ?? [];
  const leaderLines = (snapshot.line_object_states ?? []).filter((item: any) =>
    item.visible &&
    ['v2_leader_line', 'v2_leader_extension'].includes(String(item.aux_kind ?? '')) &&
    Array.isArray(item.screen_segments) &&
    item.screen_segments.length > 0,
  );
  const crossings: LeaderTextCrossing[] = [];
  for (const line of leaderLines) {
    for (const [segmentIndex, segment] of line.screen_segments.entries()) {
      for (const item of screenItems) {
        if (!item?.box || item.in_viewport !== true) continue;
        if (line.target_tag_id && String(line.target_tag_id) === String(item.id)) continue;
        if (!segmentIntersectsBox(segment, item.box, 1)) continue;
        crossings.push({
          line_name: String(line.name ?? ''),
          aux_kind: line.aux_kind ?? null,
          leader_id: line.leader_id ?? null,
          target_tag_id: line.target_tag_id ?? null,
          item_id: String(item.id ?? ''),
          item_text: String(item.text ?? ''),
          segment_index: segmentIndex,
        });
      }
    }
  }
  return {
    crossing_count: crossings.length,
    crossings,
  };
}

type LineModelCrossing = {
  line_name: string;
  aux_kind: string | null;
  annotation_id: string | null;
  line_role: string | null;
  leader_id: string | null;
  model_name: string;
  model_aux_kind: string | null;
  segment_index: number;
};

function buildLineModelCrossingSummary(
  snapshot: any,
  lineFilter: (item: any) => boolean,
): {
  crossing_count: number;
  crossings: LineModelCrossing[];
} {
  const modelBoxes = (snapshot.line_object_states ?? []).filter((item: any) =>
    item.visible &&
    item.aux_kind === 'pipe-visual-body' &&
    item.screen_box,
  );
  const lines = (snapshot.line_object_states ?? []).filter((item: any) =>
    item.visible &&
    Array.isArray(item.screen_segments) &&
    item.screen_segments.length > 0 &&
    lineFilter(item),
  );
  const crossings: LineModelCrossing[] = [];
  for (const line of lines) {
    for (const [segmentIndex, segment] of line.screen_segments.entries()) {
      for (const model of modelBoxes) {
        if (!segmentIntersectsBox(segment, model.screen_box, -8)) continue;
        crossings.push({
          line_name: String(line.name ?? ''),
          aux_kind: line.aux_kind ?? null,
          annotation_id: line.annotation_id ?? null,
          line_role: line.line_role ?? null,
          leader_id: line.leader_id ?? null,
          model_name: String(model.name ?? ''),
          model_aux_kind: model.aux_kind ?? null,
          segment_index: segmentIndex,
        });
      }
    }
  }
  return {
    crossing_count: crossings.length,
    crossings,
  };
}

function buildDrawingModelCrossingSummary(snapshot: any): {
  leader_extensions: ReturnType<typeof buildLineModelCrossingSummary>;
  dimension_main_lines: ReturnType<typeof buildLineModelCrossingSummary>;
} {
  return {
    leader_extensions: buildLineModelCrossingSummary(snapshot, (item) =>
      item.aux_kind === 'v2_leader_extension',
    ),
    dimension_main_lines: buildLineModelCrossingSummary(snapshot, (item) =>
      /^(dim|cut_tubi):/.test(String(item.annotation_id ?? '')) &&
      ['dimensionLineA', 'dimensionLineB', 'dimensionLineOutside'].includes(
        String(item.line_role ?? ''),
      ),
    ),
  };
}

function expectedDrawingLeaderExtensionCount(snapshot: any): number {
  const leaderLineCount = Math.max(0, Number(snapshot.data_counts?.v2_leader_lines ?? 0) || 0);
  const candidateTagCount = (snapshot.screen_items ?? []).filter((item: any) => {
    const id = String(item.id ?? '');
    return id.startsWith('tag:material:') || id.startsWith('tag:fitting:');
  }).length;
  if (leaderLineCount <= 0) return 0;
  return Math.min(leaderLineCount, Math.max(1, candidateTagCount));
}

function writeMbdRegressionDiagnostics(args: {
  refno: string;
  targetRefnoId: string;
  screenshotPath: string;
  diagnosticsPath: string;
  drawingPreset: boolean;
  snapshot: any;
  v2: { url: string; status: number; body: any } | undefined;
  legacy: { url: string; status: number; body: any } | undefined;
  drawingModelStyleSnapshot: any;
  drawingModelEdgeSnapshot: any;
  pixelSummary: any;
}): void {
  mkdirSync('e2e/screenshots', { recursive: true });
  const backendLinearDims = getBackendLinearDimensionExpectations(args.v2?.body);
  const payload = {
    generated_at: new Date().toISOString(),
    refno: args.refno,
    normalized_refno: args.targetRefnoId,
    output_project: outputProject,
    viewer_url: viewerUrl,
    drawing_preset: args.drawingPreset,
    screenshot_path: args.screenshotPath,
    viewport: args.snapshot.viewport,
    screen_margin: buildScreenMarginSummary(args.snapshot),
    leader_text_crossing: buildLeaderTextCrossingSummary(args.snapshot),
    model_crossing: buildDrawingModelCrossingSummary(args.snapshot),
    data_counts: args.snapshot.data_counts,
    rendered_counts: args.snapshot.rendered_counts,
    severe_screen_overlap_count: args.snapshot.severe_screen_overlap_count,
    out_of_viewport: (args.snapshot.screen_items ?? [])
      .filter((item: any) => item.in_viewport !== true)
      .map((item: any) => ({ id: item.id, text: item.text, box: item.box })),
    backend: {
      v2: {
        url: args.v2?.url ?? null,
        status: args.v2?.status ?? null,
        success: args.v2?.body?.success ?? null,
        version: args.v2?.body?.data?.version ?? null,
        primitive_count: Array.isArray(args.v2?.body?.data?.primitives)
          ? args.v2?.body?.data?.primitives.length
          : 0,
        primitive_kinds: summarizePrimitiveKinds(args.v2?.body),
        linear_dims: backendLinearDims,
        issues: args.v2?.body?.data?.issues ?? [],
      },
      legacy: {
        url: args.legacy?.url ?? null,
        status: args.legacy?.status ?? null,
        success: args.legacy?.body?.success ?? null,
        stats: args.legacy?.body?.data?.stats ?? null,
        material_rows: args.legacy?.body?.data?.material_rows ?? [],
      },
    },
    drawing_model_style: args.drawingModelStyleSnapshot,
    drawing_model_edge: args.drawingModelEdgeSnapshot,
    pixel_summary: args.pixelSummary,
    screen_items: args.snapshot.screen_items ?? [],
    line_object_states: args.snapshot.line_object_states ?? [],
    dimension_arrow_states: args.snapshot.dimension_arrow_states ?? [],
  };
  writeFileSync(args.diagnosticsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function buildStandaloneUrl(targetRefno: string): string {
  const url = new URL(viewerUrl);
  url.searchParams.set('output_project', outputProject);
  url.searchParams.set('mbd_refno', targetRefno);
  url.searchParams.set('mbd_debug', '1');
  url.searchParams.set('cache_bust', String(Date.now()));
  return url.toString();
}

for (const refno of refnos) {
  test(`real BRAN ${normalizeRefnoForId(refno)} standalone MBD renders drawing annotations`, async ({ page }) => {
    const targetRefnoId = normalizeRefnoForId(refno);
    const primaryFixture = isPrimaryFixtureRefno(refno);
    const drawingPreset = isMbdDrawingPresetUrl(new URL(buildStandaloneUrl(refno)).search);
    await page.setViewportSize({ width: 1600, height: 1000 });

    const responses: { url: string; status: number; body: any }[] = [];
    const fontResponses: { url: string; status: number }[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('unicode.lff')) {
        fontResponses.push({ url, status: response.status() });
      }
      if (!url.includes('/api/mbd/v2/pipe/') && !url.includes('/api/mbd/pipe/')) return;
      let body: any = null;
      try {
        body = await response.json();
      } catch {
      // ignore non-json diagnostics
      }
      responses.push({ url, status: response.status(), body });
    });

    await page.goto(buildStandaloneUrl(refno), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction((targetRefno) => {
      const normalize = (value: unknown) => String(value ?? '').trim().replace(/[\\/]/g, '_');
      const snapshot = (window as any).__plant3dMbdE2E?.getSnapshot?.();
      const renderedLinearDims =
      Number(snapshot?.rendered_counts?.dims ?? 0) +
      Number(snapshot?.rendered_counts?.cut_tubis ?? 0);
      const renderedTagCount = Number(snapshot?.rendered_counts?.tags ?? 0);
      const expectedScreenItemCount = renderedLinearDims + Math.max(1, renderedTagCount);
      return normalize(snapshot?.branch_refno) === targetRefno
      && renderedLinearDims >= 1
      && renderedTagCount >= 1
      && (snapshot.screen_items || []).length >= expectedScreenItemCount;
    }, targetRefnoId, { timeout: 70_000 });

    await page.waitForFunction(({ isDrawingPreset, maxModelOpacity, modelEdgeStyle, pipeVisualCounts, targetRefnoId }) => {
      const snapshot = (window as any).__plant3dMbdE2E?.getSnapshot?.();
      const screenItems = snapshot?.screen_items || [];
      const renderedCountsForScreenItems = snapshot?.rendered_counts || {};
      const renderedLinearDims =
        Number(renderedCountsForScreenItems.dims ?? 0) +
        Number(renderedCountsForScreenItems.cut_tubis ?? 0);
      const renderedTagCount = Number(renderedCountsForScreenItems.tags ?? 0);
      const expectedScreenItemCount = renderedLinearDims + Math.max(1, renderedTagCount);
      if (
        !snapshot ||
      snapshot.severe_screen_overlap_count > 0 ||
      screenItems.length < expectedScreenItemCount ||
      !screenItems.every((item: any) => item.in_viewport)
      ) {
        return false;
      }

      if (isDrawingPreset) {
        const renderedCounts = snapshot.rendered_counts || {};
        const lineObjectStates = snapshot.line_object_states || [];
        const segmentCount = Math.max(1, Number(snapshot.data_counts?.segments ?? 0) || 1);
        const leaderLineCount = Math.max(0, Number(renderedCounts.v2_leader_lines ?? 0) || 0);
        const candidateTagCount = screenItems.filter((item: any) => {
          const id = String(item.id ?? '');
          return id.startsWith('tag:material:') || id.startsWith('tag:fitting:');
        }).length;
        const leaderExtensionCount = leaderLineCount <= 0
          ? 0
          : Math.min(leaderLineCount, Math.max(1, candidateTagCount));
        const modelStyleSnapshot =
        (window as any).__plant3dMbdE2E?.getDrawingModelStyleSnapshot?.();
        const modelEdgeSnapshot =
        (window as any).__plant3dMbdE2E?.getDrawingModelEdgeSnapshot?.();
        const modelObjectCount = Number(modelStyleSnapshot?.object_count ?? 0) || 0;
        const modelStyleOk = modelObjectCount <= 0 || (
          Number.isFinite(Number(modelStyleSnapshot?.max_opacity)) &&
          Number(modelStyleSnapshot?.max_opacity) <= Number(maxModelOpacity) + 0.005
        );
        const modelEdgeOk = !modelEdgeSnapshot
          ? false
          : modelEdgeSnapshot.enabled === true &&
            Number(modelEdgeSnapshot.style?.edge_color) === Number(modelEdgeStyle.color) &&
            Math.abs(Number(modelEdgeSnapshot.style?.edge_opacity) - Number(modelEdgeStyle.opacity)) <= 0.005 &&
            Math.abs(Number(modelEdgeSnapshot.style?.edge_line_width_px) - Number(modelEdgeStyle.lineWidthPx)) <= 0.005 &&
            Math.abs(Number(modelEdgeSnapshot.style?.edge_threshold_angle_deg) - Number(modelEdgeStyle.thresholdAngleDeg)) <= 0.005 &&
            modelEdgeSnapshot.style?.edge_always_on_top === false &&
            (modelObjectCount <= 0 || Number(modelEdgeSnapshot.object_count) > 0);
        const vectorTextRebuildCount =
        (window as any).__plant3dMbdE2E?.getVectorTextRebuildCount?.();
        const countAux = (kind: string) =>
          lineObjectStates.filter((item: any) => item.aux_kind === kind && item.visible).length;
        const minRings = segmentCount * Number(pipeVisualCounts.ringsPerSegment);
        const minBands = segmentCount * Number(pipeVisualCounts.bandsPerSegment);
        const minRails = segmentCount * Number(pipeVisualCounts.railsPerSegment);
        const minOutlines = segmentCount * Number(pipeVisualCounts.outlineRailsPerSegment);
        const fittingCount = Math.max(0, Number(snapshot.data_counts?.fittings ?? 0) || 0);
        const minFittingCores = fittingCount * Number(pipeVisualCounts.coreRingsPerFitting);
        const minFittingPorts = fittingCount * Number(pipeVisualCounts.minPortRingsPerFitting);
        const minFittingArms = fittingCount * Number(pipeVisualCounts.minArmsPerFitting);
        if (
          Number(renderedCounts.pipe_visual_bodies) < segmentCount ||
        Number(renderedCounts.pipe_visual_rings) < minRings ||
        Number(renderedCounts.pipe_visual_bands) < minBands ||
        Number(renderedCounts.pipe_visual_rails) < minRails ||
        Number(renderedCounts.pipe_visual_outlines) < minOutlines ||
        Number(renderedCounts.fitting_visual_cores ?? 0) < minFittingCores ||
        Number(renderedCounts.fitting_visual_ports ?? 0) < minFittingPorts ||
        Number(renderedCounts.fitting_visual_arms ?? 0) < minFittingArms ||
        !modelStyleSnapshot ||
        !modelStyleOk ||
        !modelEdgeOk ||
        Number(vectorTextRebuildCount) <= 0 ||
        countAux('v2_leader_line_tube') < leaderLineCount ||
        countAux('v2_leader_extension_tube') < leaderExtensionCount ||
        countAux('pipe-visual-body') < segmentCount ||
        countAux('pipe-visual-ring') < minRings ||
        countAux('pipe-visual-band') < minBands ||
        countAux('pipe-visual-rail') < minRails ||
        countAux('pipe-visual-outline') < minOutlines ||
        countAux('fitting-visual-core') < minFittingCores ||
        countAux('fitting-visual-port') < minFittingPorts ||
        countAux('fitting-visual-arm') < minFittingArms
        ) {
          return false;
        }
      }

      const head = screenItems.find((item: any) => item.id === `tag:position:${targetRefnoId}:head`);
      const tail = screenItems.find((item: any) => item.id === `tag:position:${targetRefnoId}:tail`);
      if (!head || !tail) return false;
      return Math.hypot(Number(head.x) - Number(tail.x), Number(head.y) - Number(tail.y)) > 120;
    }, {
      isDrawingPreset: drawingPreset,
      maxModelOpacity: MBD_DRAWING_STYLE_PROFILE.modelMaterials.pipeOpacity,
      modelEdgeStyle: {
        color: MBD_DRAWING_STYLE_PROFILE.modelEdges.color,
        opacity: MBD_DRAWING_STYLE_PROFILE.modelEdges.opacity,
        lineWidthPx: MBD_DRAWING_STYLE_PROFILE.modelEdges.lineWidthPx,
        thresholdAngleDeg: MBD_DRAWING_STYLE_PROFILE.modelEdges.thresholdAngleDeg,
      },
      pipeVisualCounts: drawingPipeEmphasisCounts,
      targetRefnoId,
    }, { timeout: 25_000 });

    const snapshot = await page.evaluate(() => (window as any).__plant3dMbdE2E.getSnapshot());
    const drawingModelStyleSnapshot = drawingPreset
      ? await page.evaluate(() =>
        (window as any).__plant3dMbdE2E.getDrawingModelStyleSnapshot?.() ?? null,
      )
      : null;
    const drawingModelEdgeSnapshot = drawingPreset
      ? await page.evaluate(() =>
        (window as any).__plant3dMbdE2E.getDrawingModelEdgeSnapshot?.() ?? null,
      )
      : null;
    const v2 = responses.find((item) => item.url.includes('/api/mbd/v2/pipe/'));
    const legacy = responses.find((item) => item.url.includes('/api/mbd/pipe/') && !item.url.includes('/api/mbd/v2/'));

    expect(v2?.status).toBe(200);
    expect(legacy?.status).toBe(200);
    expect(fontResponses).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 200 }),
    ]));
    expect(v2?.body?.success).toBe(true);
    expect(legacy?.body?.success).toBe(true);

    const v2Url = new URL(v2!.url);
    expect(v2Url.searchParams.get('include_tags')).toBe('true');
    expect(v2Url.searchParams.get('include_position_tags')).toBe('true');
    expect(v2Url.searchParams.get('include_elevation_marks')).toBe('true');
    expect(v2Url.searchParams.get('include_branch_label')).toBe('true');
    expect(v2Url.searchParams.get('include_material_balloons')).toBe('true');
    expect(v2Url.searchParams.get('include_material_table')).toBe('true');
    expect(v2Url.searchParams.get('include_bends')).toBe('true');

    expect(snapshot.render_source).toBe('layout_result');
    assertBackendLinearDimensionCoverage(snapshot, v2?.body, drawingPreset);
    const rawExpectedTagCount = Number(
      snapshot.data_counts?.layout_tags ?? snapshot.data_counts?.tags ?? 0,
    );
    const rawExpectedLeaderLineCount = Number(snapshot.data_counts?.v2_leader_lines ?? 0);
    const expectedTagCount = getExpectedRenderedTagCount(
      v2?.body,
      drawingPreset,
      rawExpectedTagCount,
    );
    const expectedLeaderLineCount = getExpectedRenderedLeaderLineCount(
      v2?.body,
      drawingPreset,
      rawExpectedLeaderLineCount,
    );
    const expectedSegmentCount = Math.max(1, Number(snapshot.data_counts?.segments ?? 0) || 1);
    const expectedLinearDimCount =
    Number(snapshot.rendered_counts?.dims ?? 0) +
    Number(snapshot.rendered_counts?.cut_tubis ?? 0);
    const expectedFittingCount = Math.max(0, Number(snapshot.data_counts?.fittings ?? 0) || 0);
    expect(snapshot.rendered_counts.tags).toBe(expectedTagCount);
    if (drawingPreset) {
      expect(snapshot.rendered_counts.v2_leader_lines).toBeLessThanOrEqual(expectedLeaderLineCount);
    } else {
      expect(snapshot.rendered_counts.v2_leader_lines).toBe(expectedLeaderLineCount);
    }
    expect(expectedTagCount).toBeGreaterThan(0);
    expect(expectedLinearDimCount).toBeGreaterThan(0);
    if (drawingPreset) {
      const expectedLeaderExtensionCount = expectedDrawingLeaderExtensionCount(snapshot);
      expect(snapshot.rendered_counts.v2_leader_extensions)
        .toBeGreaterThanOrEqual(expectedLeaderExtensionCount);
      expect(snapshot.rendered_counts.pipe_visual_bodies)
        .toBeGreaterThanOrEqual(expectedSegmentCount);
      expect(snapshot.rendered_counts.pipe_visual_bands)
        .toBeGreaterThanOrEqual(
          expectedSegmentCount * drawingPipeEmphasisCounts.bandsPerSegment,
        );
      expect(snapshot.rendered_counts.pipe_visual_rails)
        .toBeGreaterThanOrEqual(
          expectedSegmentCount * drawingPipeEmphasisCounts.railsPerSegment,
        );
      expect(snapshot.rendered_counts.pipe_visual_outlines)
        .toBeGreaterThanOrEqual(
          expectedSegmentCount * drawingPipeEmphasisCounts.outlineRailsPerSegment,
        );
      expect(snapshot.rendered_counts.pipe_visual_rings)
        .toBeGreaterThanOrEqual(
          expectedSegmentCount * drawingPipeEmphasisCounts.ringsPerSegment,
        );
      expect(snapshot.rendered_counts.pipe_visual_spines)
        .toBeGreaterThanOrEqual(expectedSegmentCount);
      if (expectedFittingCount > 0) {
        expect(snapshot.rendered_counts.fitting_visual_cores)
          .toBeGreaterThanOrEqual(
            expectedFittingCount * drawingPipeEmphasisCounts.coreRingsPerFitting,
          );
        expect(snapshot.rendered_counts.fitting_visual_ports)
          .toBeGreaterThanOrEqual(
            expectedFittingCount * drawingPipeEmphasisCounts.minPortRingsPerFitting,
          );
        expect(snapshot.rendered_counts.fitting_visual_arms)
          .toBeGreaterThanOrEqual(
            expectedFittingCount * drawingPipeEmphasisCounts.minArmsPerFitting,
          );
      }

      const lineObjectStates = snapshot.line_object_states ?? [];
      const leaderLineTubes = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'v2_leader_line_tube' && item.visible,
      );
      const leaderExtensions = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'v2_leader_extension' && item.visible,
      );
      const leaderExtensionTubes = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'v2_leader_extension_tube' && item.visible,
      );
      expect(leaderLineTubes.length).toBeGreaterThanOrEqual(
        Number(snapshot.rendered_counts.v2_leader_lines ?? 0),
      );
      expect(leaderLineTubes.every((item: any) =>
        Number(item.screen_span_px) >= 2
      && Number(item.opacity) >= MBD_DRAWING_STYLE_PROFILE.leader.tubeOpacity,
      )).toBe(true);
      expect(leaderExtensions.length).toBeGreaterThanOrEqual(expectedLeaderExtensionCount);
      expect(leaderExtensionTubes.length).toBeGreaterThanOrEqual(expectedLeaderExtensionCount);
      expect(leaderExtensionTubes.every((item: any) =>
        Number(item.screen_span_px) >= 36
      && Number(item.opacity) >= MBD_DRAWING_STYLE_PROFILE.leader.tubeOpacity,
      )).toBe(true);

      const dimensionLineStates = lineObjectStates.filter((item: any) =>
        item.visible
      && /^(dim|cut_tubi):/.test(String(item.annotation_id ?? ''))
      && ['dimensionLineA', 'dimensionLineB', 'dimensionLineOutside'].includes(
        String(item.line_role ?? ''),
      ),
      );
      const extensionLineStates = lineObjectStates.filter((item: any) =>
        item.visible
      && /^(dim|cut_tubi):/.test(String(item.annotation_id ?? ''))
      && ['extensionLine1', 'extensionLine2'].includes(String(item.line_role ?? '')),
      );
      const expectedExtensionWidth =
      MBD_DRAWING_STYLE_PROFILE.dimension.lineWidthPx *
      MBD_DRAWING_STYLE_PROFILE.dimension.extensionLineWidthRatio;
      expect(dimensionLineStates.length).toBeGreaterThanOrEqual(expectedLinearDimCount);
      expect(extensionLineStates.length).toBeGreaterThanOrEqual(expectedLinearDimCount * 2);
      expect(dimensionLineStates.every((item: any) =>
        Number(item.line_width_px) >= MBD_DRAWING_STYLE_PROFILE.dimension.lineWidthPx,
      )).toBe(true);
      const extensionLineStyleSummary = {
        expected_width: expectedExtensionWidth,
        expected_opacity: MBD_DRAWING_STYLE_PROFILE.dimension.extensionLineOpacity,
        failing: extensionLineStates
          .filter((item: any) =>
            Number(item.line_width_px) + 0.005 < expectedExtensionWidth ||
            Number(item.opacity) + 0.005 < MBD_DRAWING_STYLE_PROFILE.dimension.extensionLineOpacity,
          )
          .map((item: any) => ({
            annotation_id: item.annotation_id,
            line_role: item.line_role,
            line_width_px: item.line_width_px,
            opacity: item.opacity,
            screen_span_px: item.screen_span_px,
          })),
      };
      expect(extensionLineStates.every((item: any) =>
        Number(item.line_width_px) + 0.005 >= expectedExtensionWidth
      && Number(item.opacity) + 0.005 >= MBD_DRAWING_STYLE_PROFILE.dimension.extensionLineOpacity,
      ), JSON.stringify(extensionLineStyleSummary, null, 2)).toBe(true);

      const pipeBodies = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'pipe-visual-body' && item.visible,
      );
      const pipeRings = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'pipe-visual-ring' && item.visible,
      );
      const pipeBands = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'pipe-visual-band' && item.visible,
      );
      const pipeRails = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'pipe-visual-rail' && item.visible,
      );
      const pipeOutlines = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'pipe-visual-outline' && item.visible,
      );
      const fittingCores = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'fitting-visual-core' && item.visible,
      );
      const fittingPorts = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'fitting-visual-port' && item.visible,
      );
      const fittingArms = lineObjectStates.filter(
        (item: any) => item.aux_kind === 'fitting-visual-arm' && item.visible,
      );
      expect(pipeBodies.length).toBeGreaterThanOrEqual(expectedSegmentCount);
      expect(pipeRings.length).toBeGreaterThanOrEqual(
        expectedSegmentCount * drawingPipeEmphasisCounts.ringsPerSegment,
      );
      expect(pipeBands.length).toBeGreaterThanOrEqual(
        expectedSegmentCount * drawingPipeEmphasisCounts.bandsPerSegment,
      );
      expect(pipeRails.length).toBeGreaterThanOrEqual(
        expectedSegmentCount * drawingPipeEmphasisCounts.railsPerSegment,
      );
      expect(pipeOutlines.length).toBeGreaterThanOrEqual(
        expectedSegmentCount * drawingPipeEmphasisCounts.outlineRailsPerSegment,
      );
      if (expectedFittingCount > 0) {
        expect(fittingCores.length).toBeGreaterThanOrEqual(
          expectedFittingCount * drawingPipeEmphasisCounts.coreRingsPerFitting,
        );
        expect(fittingPorts.length).toBeGreaterThanOrEqual(
          expectedFittingCount * drawingPipeEmphasisCounts.minPortRingsPerFitting,
        );
        expect(fittingArms.length).toBeGreaterThanOrEqual(
          expectedFittingCount * drawingPipeEmphasisCounts.minArmsPerFitting,
        );
      }
      expect(pipeBodies.every((item: any) =>
        Number(item.screen_span_px) >= 40
      && isCloseToProfile(item.opacity, MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bodyOpacity)
      && item.color_hex === toHexColor(MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bodyColor),
      )).toBe(true);
      if (primaryFixture) {
        expect(pipeBodies.some((item: any) => Number(item.screen_span_px) >= 120)).toBe(true);
      }
      expect(pipeRings.every((item: any) =>
        Number(item.screen_span_px) >= 10
      && isCloseToProfile(item.opacity, MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringOpacity)
      && item.color_hex === toHexColor(MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.ringColor),
      )).toBe(true);
      expect(pipeBands.every((item: any) =>
        Number(item.screen_span_px) >= 10
      && isCloseToProfile(item.opacity, MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandOpacity)
      && item.color_hex === toHexColor(MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.bandColor),
      )).toBe(true);
      expect(pipeRails.every((item: any) =>
        Number(item.screen_span_px) >= 24
      && isCloseToProfile(item.opacity, MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railOpacity)
      && item.color_hex === toHexColor(MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.railColor),
      )).toBe(true);
      expect(pipeOutlines.every((item: any) =>
        Number(item.screen_span_px) >= 24
      && isCloseToProfile(item.opacity, MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineOpacity)
      && item.color_hex === toHexColor(MBD_DRAWING_STYLE_PROFILE.pipeEmphasis.outlineColor),
      )).toBe(true);
      if (expectedFittingCount > 0) {
        expect(fittingCores.every((item: any) =>
          Number(item.screen_span_px) >= 10
        && isCloseToProfile(item.opacity, MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreOpacity)
        && item.color_hex === toHexColor(MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.coreColor),
        )).toBe(true);
        expect(fittingPorts.every((item: any) =>
          Number(item.screen_span_px) >= 10
        && isCloseToProfile(item.opacity, MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portOpacity)
        && item.color_hex === toHexColor(MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.portColor),
        )).toBe(true);
        expect(fittingArms.every((item: any) =>
          Number(item.screen_span_px) >= 8
        && isCloseToProfile(item.opacity, MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armOpacity)
        && item.color_hex === toHexColor(MBD_DRAWING_STYLE_PROFILE.fittingEmphasis.armColor),
        )).toBe(true);
      }
      const pipeVisualMaxSpanPx = Math.max(
        ...[
          ...pipeBodies,
          ...pipeRings,
          ...pipeBands,
          ...pipeRails,
          ...pipeOutlines,
          ...fittingCores,
          ...fittingPorts,
          ...fittingArms,
        ].map((item: any) => Number(item.screen_span_px) || 0),
      );
      expect(pipeVisualMaxSpanPx).toBeGreaterThanOrEqual(120);
      if (primaryFixture) {
        expect(pipeRails.filter((item: any) => Number(item.screen_span_px) >= 120).length)
          .toBeGreaterThanOrEqual(drawingPipeEmphasisCounts.railsPerSegment);
      }

      const drawingModelObjectCount = Number(drawingModelStyleSnapshot?.object_count ?? 0) || 0;
      if (drawingModelObjectCount > 0) {
        expect(Number(drawingModelStyleSnapshot?.max_opacity))
          .toBeLessThanOrEqual(MBD_DRAWING_STYLE_PROFILE.modelMaterials.pipeOpacity + 0.005);
        const minExpectedModelOpacity = Math.min(
          MBD_DRAWING_STYLE_PROFILE.modelMaterials.pipeOpacity,
          MBD_DRAWING_STYLE_PROFILE.modelMaterials.fittingOpacity,
          MBD_DRAWING_STYLE_PROFILE.modelMaterials.flangeOpacity,
          MBD_DRAWING_STYLE_PROFILE.modelMaterials.valveOpacity,
          MBD_DRAWING_STYLE_PROFILE.modelMaterials.defaultOpacity,
        );
        expect(Number(drawingModelStyleSnapshot?.min_opacity))
          .toBeGreaterThanOrEqual(minExpectedModelOpacity - 0.005);
      }
      expect(drawingModelEdgeSnapshot?.enabled).toBe(true);
      if (drawingModelObjectCount > 0) {
        expect(Number(drawingModelEdgeSnapshot?.object_count)).toBeGreaterThan(0);
      }
      expect(Number(drawingModelEdgeSnapshot?.style?.edge_color))
        .toBe(MBD_DRAWING_STYLE_PROFILE.modelEdges.color);
      expect(Number(drawingModelEdgeSnapshot?.style?.edge_opacity))
        .toBeCloseTo(MBD_DRAWING_STYLE_PROFILE.modelEdges.opacity, 3);
      expect(Number(drawingModelEdgeSnapshot?.style?.edge_line_width_px))
        .toBeCloseTo(MBD_DRAWING_STYLE_PROFILE.modelEdges.lineWidthPx, 3);
      expect(Number(drawingModelEdgeSnapshot?.style?.edge_threshold_angle_deg))
        .toBeCloseTo(MBD_DRAWING_STYLE_PROFILE.modelEdges.thresholdAngleDeg, 3);
      expect(drawingModelEdgeSnapshot?.style?.edge_always_on_top).toBe(false);
      expect(await page.evaluate(() =>
        (window as any).__plant3dMbdE2E.getVectorTextRebuildCount?.() ?? 0,
      )).toBeGreaterThan(0);

      const arrowStates = snapshot.dimension_arrow_states ?? [];
      expect(arrowStates.length).toBeGreaterThanOrEqual(
        Math.max(1, Number(snapshot.rendered_counts?.dims ?? 0)),
      );
      expect(arrowStates.every((item: any) =>
        item.arrow1_visible === true
      && item.arrow2_visible === true
      && item.open1_visible === true
      && item.open2_visible === true
      && Number(item.arrow1_screen_area) >= 90
      && Number(item.arrow2_screen_area) >= 90,
      )).toBe(true);
    }
    const rows = legacy?.body?.data?.material_rows ?? [];
    expect(snapshot.data_counts.material_rows).toBe(rows.length);
    const outOfViewportItems = snapshot.screen_items.filter((item: any) => !item.in_viewport);
    expect(outOfViewportItems, JSON.stringify(outOfViewportItems, null, 2)).toHaveLength(0);
    expect(snapshot.screen_items.every((item: any) =>
      item.box
    && Number.isFinite(item.box.left)
    && Number.isFinite(item.box.right)
    && item.box.width > 0
    && item.box.height > 0,
    )).toBe(true);
    expect(snapshot.severe_screen_overlap_count).toBeLessThanOrEqual(15);
    if (drawingPreset) {
      assertDrawingScreenMargins(snapshot);
      const leaderTextCrossing = buildLeaderTextCrossingSummary(snapshot);
      expect(
        leaderTextCrossing.crossings,
        JSON.stringify(leaderTextCrossing, null, 2),
      ).toHaveLength(0);
      const modelCrossing = buildDrawingModelCrossingSummary(snapshot);
      expect(
        modelCrossing.leader_extensions.crossings,
        JSON.stringify(modelCrossing, null, 2),
      ).toHaveLength(0);
      expect(
        modelCrossing.dimension_main_lines.crossings,
        JSON.stringify(modelCrossing, null, 2),
      ).toHaveLength(0);
    }

    const visibleText = (text: string) =>
      snapshot.screen_items.some((item: any) => item.in_viewport && String(item.text).includes(text));
    const headPositionTag = snapshot.screen_items.find(
      (item: any) => item.id === `tag:position:${targetRefnoId}:head`,
    );
    const tailPositionTag = snapshot.screen_items.find(
      (item: any) => item.id === `tag:position:${targetRefnoId}:tail`,
    );
    expect(headPositionTag).toBeTruthy();
    expect(tailPositionTag).toBeTruthy();
    expect(Math.hypot(
      Number(headPositionTag.x) - Number(tailPositionTag.x),
      Number(headPositionTag.y) - Number(tailPositionTag.y),
    )).toBeGreaterThan(120);

    const materialItems = snapshot.screen_items.filter((item: any) => String(item.id).startsWith('tag:material:'));
    expect(materialItems).toHaveLength(rows.length);
    expect(materialItems.every((item: any) => item.in_viewport === true)).toBe(true);
    if (drawingPreset) {
      assertMaterialBalloonsNearLeaders(snapshot);
    }
    expect(rows.every((row: any) =>
      String(row.item_code ?? '').trim().length > 0 &&
    Number.isFinite(Number(row.quantity)) &&
    Number(row.quantity) > 0,
    )).toBe(true);

    if (primaryFixture) {
      for (const text of ['1073', '783', targetRefnoId, 'PE 100790']) {
        expect(visibleText(text), `${text} should be projected inside the viewport`).toBe(true);
      }
      expect(visibleText('L=600'), 'redundant tubi length tag should be suppressed').toBe(false);
      expect(visibleText('L=145'), 'redundant tubi length tag should be suppressed').toBe(false);

      expect(snapshot.screen_items).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'tag:material:1:2013286704_479', text: '1', in_viewport: true }),
        expect.objectContaining({ id: 'tag:material:2:2013286704_480', text: '2', in_viewport: true }),
      ]));
      expect(snapshot.screen_items.some((item: any) =>
        String(item.id ?? '').startsWith('tag:fitting:'),
      )).toBe(false);

      expect(rows).toHaveLength(2);
      expect(String(rows[0].item_code ?? '').trim().length).toBeGreaterThan(0);
      expect(rows[0].quantity).toBeCloseTo(0.59996873, 5);
      expect(String(rows[1].item_code ?? '').trim().length).toBeGreaterThan(0);
      expect(rows[1].quantity).toBeCloseTo(0.145, 5);

      expect(Number(legacy?.body?.data?.stats?.fittings_count ?? 0)).toBeGreaterThan(0);
      expect(Number(legacy?.body?.data?.stats?.tags_count ?? 0)).toBeGreaterThanOrEqual(6);
      expect((legacy?.body?.data?.tags ?? []).some((tag: any) =>
        String(tag.id ?? '').startsWith('tag:fitting:'),
      )).toBe(false);
    }

    if (!drawingPreset) {
      const overviewText = await page.locator('body').innerText();
      expect(overviewText).toContain('弯头: 1');
      expect(overviewText).toContain('管件: 1');
      expect(overviewText).toContain('fittings: elbow=1');

      await page.getByText('材质', { exact: true }).click();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).toContain('PA100');
      expect(bodyText).toContain('3"');
    }

    const screenshotPath = `e2e/screenshots/mbd-real-bran-${targetRefnoId}.png`;
    const diagnosticsPath = `e2e/screenshots/mbd-real-bran-${targetRefnoId}.json`;
    const finalScreenshot = await page.screenshot({
      path: screenshotPath,
      fullPage: false,
    });
    const finalImage = drawingPreset ? decodePngRgba(finalScreenshot) : null;
    const pixelSummary = finalImage
      ? {
        pipe: buildBluePipePixelSummary(snapshot, finalImage),
        dimension_lines: buildDimensionLinePixelSummary(snapshot, finalImage),
        backend_linear_dimensions: buildBackendLinearDimensionPixelSummary(
          snapshot,
          v2?.body,
          finalImage,
          drawingPreset,
        ),
      }
      : null;
    writeMbdRegressionDiagnostics({
      refno,
      targetRefnoId,
      screenshotPath,
      diagnosticsPath,
      drawingPreset,
      snapshot,
      v2,
      legacy,
      drawingModelStyleSnapshot,
      drawingModelEdgeSnapshot,
      pixelSummary,
    });
    if (drawingPreset) {
      if (primaryFixture) {
        assertRenderedRedAnnotationPixels(snapshot, finalImage!);
      }
      assertRenderedBluePipePixels(snapshot, finalImage!);
      assertRenderedDimensionLinePixels(snapshot, finalImage!);
      assertRenderedBackendLinearDimensionPixels(
        snapshot,
        v2?.body,
        finalImage!,
        drawingPreset,
      );
    }
  });
}
