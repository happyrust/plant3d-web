export type ParsedGlbGeometry = {
  positions: number[]
  indices: number[]
  normals?: number[]
}

export async function parseGlbGeometry(glbData: ArrayBuffer): Promise<ParsedGlbGeometry | null> {
  try {
    const dataView = new DataView(glbData);
    const magic = dataView.getUint32(0, true);
    if (magic !== 0x46546c67) return null;

    const jsonChunkLength = dataView.getUint32(12, true);
    const jsonBytes = new Uint8Array(glbData, 20, jsonChunkLength);
    const gltf = JSON.parse(new TextDecoder().decode(jsonBytes));

    const binChunkOffset = 20 + jsonChunkLength;
    const binChunkLength = dataView.getUint32(binChunkOffset, true);
    const binBuffer = glbData.slice(
      binChunkOffset + 8,
      binChunkOffset + 8 + binChunkLength
    );

    const mesh = gltf.meshes?.[0];
    const primitive = mesh?.primitives?.[0];
    if (!primitive) return null;

    const accessorPosIndex = primitive.attributes?.POSITION;
    const accessorNorIndex = primitive.attributes?.NORMAL;
    const accessorIdxIndex = primitive.indices;
    if (accessorPosIndex === undefined || accessorIdxIndex === undefined) return null;

    const accessors = gltf.accessors || [];
    const bufferViews = gltf.bufferViews || [];

    function readAccessor(accessorIndex: number): Float32Array | Uint32Array | Uint16Array | null {
      const accessor = accessors[accessorIndex];
      if (!accessor) return null;
      const bufferView = bufferViews[accessor.bufferView];
      if (!bufferView) return null;

      const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
      const count = accessor.count || 0;
      const type = accessor.type;
      const componentType = accessor.componentType;

      const componentCount = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : type === 'SCALAR' ? 1 : 1;
      const totalCount = count * componentCount;

      if (componentType === 5126) {
        return new Float32Array(binBuffer, byteOffset, totalCount);
      }
      if (componentType === 5125) {
        return new Uint32Array(binBuffer, byteOffset, totalCount);
      }
      if (componentType === 5123) {
        return new Uint16Array(binBuffer, byteOffset, totalCount);
      }
      return null;
    }

    const positionsArr = readAccessor(accessorPosIndex);
    const indicesArr = readAccessor(accessorIdxIndex);
    if (!positionsArr || !indicesArr) return null;

    const positions = Array.from(positionsArr as Float32Array);
    const indices = Array.from(indicesArr as Uint32Array | Uint16Array);

    let normals: number[] | undefined;
    if (accessorNorIndex !== undefined) {
      const normalsArr = readAccessor(accessorNorIndex);
      if (normalsArr) normals = Array.from(normalsArr as Float32Array);
    }

    return { positions, indices, normals };
  } catch {
    return null;
  }
}

