import {
  FileValidationError,
  describeValue,
  failFileValidation,
  parseJsonText,
} from './fileValidation';

export type ParsedGlbGeometry = {
  positions: number[];
  indices: number[];
  normals?: number[];
};

export type GlbGeometryParseResult =
  | Readonly<{ ok: true; data: ParsedGlbGeometry }>
  | Readonly<{ ok: false; error: FileValidationError }>;

type JsonRecord = Record<string, unknown>;

type AccessorLayout = Readonly<{
  at: number;
  count: number;
  componentCount: number;
  componentType: 5123 | 5125 | 5126;
  stride: number;
  elementBytes: number;
}>;

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asNonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function failGlb(
  source: string,
  reason: string,
  expected: string,
  actual: string,
  byteOffset?: number,
): never {
  return failFileValidation({
    source,
    format: 'glb',
    reason,
    expected,
    actual,
    ...(byteOffset === undefined ? {} : { byteOffset }),
  });
}

function getRecordAt(value: unknown, index: number): JsonRecord | null {
  if (!Array.isArray(value)) return null;
  const item = value[index];
  return isRecord(item) ? item : null;
}

function validateAccessor(
  gltf: JsonRecord,
  accessorIndex: number,
  binDataOffset: number,
  binByteLength: number,
  source: string,
  semantic: 'position' | 'normal' | 'indices',
): AccessorLayout {
  const accessor = getRecordAt(gltf.accessors, accessorIndex);
  if (!accessor) {
    failGlb(source, `${semantic} accessor 不存在`, `accessors[${accessorIndex}] 对象`, '缺失');
  }
  const bufferViewIndex = asNonNegativeInteger(accessor.bufferView);
  const bufferView = bufferViewIndex === null
    ? null
    : getRecordAt(gltf.bufferViews, bufferViewIndex);
  if (!bufferView) {
    failGlb(source, `${semantic} bufferView 不存在`, '有效的 bufferView 索引', describeValue(accessor.bufferView));
  }
  if (accessor.sparse !== undefined) {
    failGlb(source, `${semantic} 使用了暂不支持的 sparse accessor`, '连续二进制 accessor', 'sparse accessor');
  }

  const count = asNonNegativeInteger(accessor.count);
  if (count === null || count === 0) {
    failGlb(source, `${semantic} accessor 数量无效`, '大于 0 的整数', describeValue(accessor.count));
  }

  const expectedType = semantic === 'indices' ? 'SCALAR' : 'VEC3';
  if (accessor.type !== expectedType) {
    failGlb(source, `${semantic} accessor 类型无效`, expectedType, describeValue(accessor.type));
  }

  const componentType = accessor.componentType;
  const validComponent = semantic === 'indices'
    ? componentType === 5123 || componentType === 5125
    : componentType === 5126;
  if (!validComponent) {
    failGlb(
      source,
      `${semantic} accessor 分量类型无效`,
      semantic === 'indices' ? 'UNSIGNED_SHORT(5123) 或 UNSIGNED_INT(5125)' : 'FLOAT(5126)',
      describeValue(componentType),
    );
  }

  const componentCount = semantic === 'indices' ? 1 : 3;
  const componentBytes = componentType === 5123 ? 2 : 4;
  const elementBytes = componentCount * componentBytes;
  const viewOffset = asNonNegativeInteger(bufferView.byteOffset ?? 0);
  const viewLength = asNonNegativeInteger(bufferView.byteLength);
  const accessorOffset = asNonNegativeInteger(accessor.byteOffset ?? 0);
  const stride = asNonNegativeInteger(bufferView.byteStride ?? elementBytes);
  if (
    viewOffset === null
    || viewLength === null
    || accessorOffset === null
    || stride === null
    || stride < elementBytes
    || stride % componentBytes !== 0
  ) {
    failGlb(
      source,
      `${semantic} 二进制布局无效`,
      `非负 offset/length，且 stride ≥ ${elementBytes} 并按 ${componentBytes} 字节对齐`,
      `viewOffset=${String(bufferView.byteOffset)}, viewLength=${String(bufferView.byteLength)}, `
      + `accessorOffset=${String(accessor.byteOffset)}, stride=${String(bufferView.byteStride)}`,
    );
  }

  const relativeEnd = accessorOffset + ((count - 1) * stride) + elementBytes;
  if (!Number.isSafeInteger(relativeEnd) || relativeEnd > viewLength) {
    failGlb(
      source,
      `${semantic} accessor 超出 bufferView`,
      `末端不超过 bufferView ${viewLength} 字节`,
      `末端 ${relativeEnd}`,
      binDataOffset + viewOffset + accessorOffset,
    );
  }
  if (viewOffset + relativeEnd > binByteLength) {
    failGlb(
      source,
      `${semantic} accessor 超出 BIN chunk`,
      `末端不超过 BIN ${binByteLength} 字节`,
      `末端 ${viewOffset + relativeEnd}`,
      binDataOffset + viewOffset + accessorOffset,
    );
  }

  return {
    at: binDataOffset + viewOffset + accessorOffset,
    count,
    componentCount,
    componentType: componentType as 5123 | 5125 | 5126,
    stride,
    elementBytes,
  };
}

function readAccessor(view: DataView, layout: AccessorLayout): number[] {
  const values = new Array<number>(layout.count * layout.componentCount);
  const componentBytes = layout.componentType === 5123 ? 2 : 4;
  let outputIndex = 0;
  for (let element = 0; element < layout.count; element++) {
    const elementOffset = layout.at + element * layout.stride;
    for (let component = 0; component < layout.componentCount; component++) {
      const offset = elementOffset + component * componentBytes;
      values[outputIndex++] = layout.componentType === 5126
        ? view.getFloat32(offset, true)
        : layout.componentType === 5125
          ? view.getUint32(offset, true)
          : view.getUint16(offset, true);
    }
  }
  return values;
}

function validateAndParseGlb(glbData: ArrayBuffer, source: string): ParsedGlbGeometry {
  const total = glbData.byteLength;
  if (total < GLB_HEADER_BYTES + CHUNK_HEADER_BYTES) {
    failGlb(source, '文件短于 GLB 头和首个 chunk 头', '至少 20 字节', `${total} 字节`, total);
  }

  const view = new DataView(glbData);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    failGlb(source, '文件头魔数无效', 'glTF', `0x${magic.toString(16).padStart(8, '0')}`, 0);
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    failGlb(source, 'GLB 版本不受支持', '2', String(version), 4);
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== total) {
    failGlb(source, 'GLB 声明长度与实际长度不一致', `${declaredLength} 字节`, `${total} 字节`, 8);
  }

  const jsonChunkLength = view.getUint32(12, true);
  const jsonChunkType = view.getUint32(16, true);
  const jsonDataOffset = 20;
  if (jsonChunkType !== JSON_CHUNK_TYPE) {
    failGlb(source, '首个 chunk 不是 JSON', 'JSON chunk (0x4E4F534A)', `0x${jsonChunkType.toString(16)}`, 16);
  }
  const jsonEnd = jsonDataOffset + jsonChunkLength;
  if (jsonChunkLength === 0 || jsonEnd + CHUNK_HEADER_BYTES > total) {
    failGlb(
      source,
      'JSON chunk 截断或缺少后续 BIN chunk',
      '非空 JSON chunk，后接 8 字节 BIN chunk 头',
      `JSON 末端 ${jsonEnd}，文件末端 ${total}`,
      12,
    );
  }

  let jsonText: string;
  try {
    jsonText = new TextDecoder('utf-8', { fatal: true })
      .decode(new Uint8Array(glbData, jsonDataOffset, jsonChunkLength));
  } catch (error) {
    failGlb(
      source,
      'JSON chunk 不是有效 UTF-8',
      'UTF-8 编码 JSON',
      error instanceof Error ? error.message : '解码失败',
      jsonDataOffset,
    );
  }
  const gltf = parseJsonText<JsonRecord>(jsonText, {
    source: `${source}#JSON`,
    expectedRoot: 'object',
  });
  if (!isRecord(gltf.asset) || typeof gltf.asset.version !== 'string' || !gltf.asset.version.startsWith('2')) {
    failGlb(source, 'glTF asset 版本无效', 'asset.version 以 2 开头', describeValue(gltf.asset));
  }

  const binChunkLength = view.getUint32(jsonEnd, true);
  const binChunkType = view.getUint32(jsonEnd + 4, true);
  const binDataOffset = jsonEnd + CHUNK_HEADER_BYTES;
  if (binChunkType !== BIN_CHUNK_TYPE) {
    failGlb(source, '第二个 chunk 不是 BIN', 'BIN chunk (0x004E4942)', `0x${binChunkType.toString(16)}`, jsonEnd + 4);
  }
  if (binDataOffset + binChunkLength > total) {
    failGlb(
      source,
      'BIN chunk 超出文件边界',
      `末端不超过 ${total}`,
      `末端 ${binDataOffset + binChunkLength}`,
      jsonEnd,
    );
  }

  const mesh = getRecordAt(gltf.meshes, 0);
  const primitive = mesh ? getRecordAt(mesh.primitives, 0) : null;
  if (!primitive) {
    failGlb(source, '缺少首个网格图元', 'meshes[0].primitives[0]', '缺失');
  }
  if (primitive.mode !== undefined && primitive.mode !== 4) {
    failGlb(source, '网格图元不是三角形模式', 'TRIANGLES(4)', describeValue(primitive.mode));
  }
  const attributes = isRecord(primitive.attributes) ? primitive.attributes : null;
  const positionIndex = attributes ? asNonNegativeInteger(attributes.POSITION) : null;
  const normalIndex = attributes?.NORMAL === undefined
    ? null
    : asNonNegativeInteger(attributes.NORMAL);
  const indexIndex = asNonNegativeInteger(primitive.indices);
  if (positionIndex === null || indexIndex === null) {
    failGlb(
      source,
      '网格图元缺少位置或索引',
      'POSITION accessor 与 indices accessor',
      `POSITION=${describeValue(attributes?.POSITION)}, indices=${describeValue(primitive.indices)}`,
    );
  }
  if (attributes?.NORMAL !== undefined && normalIndex === null) {
    failGlb(source, 'NORMAL accessor 索引无效', '非负整数', describeValue(attributes.NORMAL));
  }

  const positionsLayout = validateAccessor(
    gltf,
    positionIndex,
    binDataOffset,
    binChunkLength,
    source,
    'position',
  );
  const indicesLayout = validateAccessor(
    gltf,
    indexIndex,
    binDataOffset,
    binChunkLength,
    source,
    'indices',
  );
  const normalsLayout = normalIndex === null
    ? null
    : validateAccessor(gltf, normalIndex, binDataOffset, binChunkLength, source, 'normal');
  if (normalsLayout && normalsLayout.count !== positionsLayout.count) {
    failGlb(
      source,
      '法向量数量与顶点数量不一致',
      `${positionsLayout.count} 个法向量`,
      `${normalsLayout.count} 个法向量`,
    );
  }
  if (indicesLayout.count % 3 !== 0) {
    failGlb(source, '索引不能组成三角形', '索引数为 3 的倍数', `${indicesLayout.count} 个索引`);
  }

  const positions = readAccessor(view, positionsLayout);
  const indices = readAccessor(view, indicesLayout);
  const normals = normalsLayout ? readAccessor(view, normalsLayout) : undefined;
  const invalidPosition = positions.findIndex(value => !Number.isFinite(value));
  if (invalidPosition >= 0) {
    failGlb(
      source,
      '顶点坐标包含非有限数',
      '有限浮点数',
      String(positions[invalidPosition]),
      positionsLayout.at + Math.floor(invalidPosition / 3) * positionsLayout.stride,
    );
  }
  const invalidNormal = normals?.findIndex(value => !Number.isFinite(value)) ?? -1;
  if (invalidNormal >= 0) {
    failGlb(
      source,
      '法向量包含非有限数',
      '有限浮点数',
      String(normals?.[invalidNormal]),
      (normalsLayout?.at ?? 0) + Math.floor(invalidNormal / 3) * (normalsLayout?.stride ?? 0),
    );
  }
  const invalidIndex = indices.findIndex(index => index >= positionsLayout.count);
  if (invalidIndex >= 0) {
    failGlb(
      source,
      '索引引用了不存在的顶点',
      `0..${positionsLayout.count - 1}`,
      String(indices[invalidIndex]),
      indicesLayout.at + invalidIndex * indicesLayout.stride,
    );
  }

  return { positions, indices, normals };
}

export async function parseGlbGeometry(glbData: ArrayBuffer): Promise<ParsedGlbGeometry | null> {
  const result = await parseGlbGeometryResult(glbData);
  return result.ok ? result.data : null;
}

export async function parseGlbGeometryResult(
  glbData: ArrayBuffer,
  source = '<memory>.glb',
): Promise<GlbGeometryParseResult> {
  try {
    return { ok: true, data: validateAndParseGlb(glbData, source) };
  } catch (error) {
    if (error instanceof FileValidationError) return { ok: false, error };
    return {
      ok: false,
      error: new FileValidationError({
        source,
        format: 'glb',
        reason: error instanceof Error ? error.message : '读取二进制结构失败',
        expected: '完整且符合 glTF 2.0 的 GLB',
        actual: `${glbData.byteLength} 字节缓冲区`,
      }),
    };
  }
}

