export type InstanceEntry = {
  geo_hash: string
  matrix: number[]
  geo_index: number
  color_index: number
  name_index: number
  site_name_index: number
  zone_name_index?: number | null
  lod_mask: number
  uniforms: Record<string, unknown> | null
  refno_transform?: number[] // 构件的世界变换矩阵（V2 格式）
}

type NameEntry = {
  kind: string
  value: string
}

type V2GeometryInstance = {
  geo_hash: string
  geo_index: number
  geo_transform: number[] // 几何体相对于 refno 的局部变换
}

type ComponentInstances = {
  refno?: string
  noun?: string
  name?: string | null
  name_index?: number
  color_index?: number // V2: 颜色索引在 component 级别
  lod_mask?: number // V2: LOD 掩码在 component 级别
  spec_value?: number | null // V2: 规格值
  refno_transform?: number[] // V2: 构件的世界变换矩阵
  instances: (InstanceEntry | V2GeometryInstance)[]
}

type HierarchyGroup = {
  refno?: string
  noun?: string
  name?: string | null
  name_index?: number
  children?: ComponentInstances[]
  tubings?: {
    geo_hash: string
    matrix?: number[] // V1 格式
    geo_index: number
    color_index: number
    name_index?: number // V1 格式
    name?: string | null // V2 格式
    lod_mask: number
    uniforms?: Record<string, unknown> | null // V1 格式
    refno?: string
    noun?: string
    order?: number
    spec_value?: number | null // V2 格式
  }[]
}

export type InstanceManifest = {
  version?: number
  generated_at: string
  colors?: number[][]
  names?: NameEntry[]
  components?: ComponentInstances[]
  tubings?: { instances: InstanceEntry[] }[]
  bran_groups?: HierarchyGroup[]
  equi_groups?: HierarchyGroup[]
  ungrouped?: ComponentInstances[]
}

function isV2Instances(manifest: InstanceManifest): boolean {
  return (
    manifest.version === 2 ||
    manifest.bran_groups !== undefined ||
    manifest.equi_groups !== undefined ||
    manifest.ungrouped !== undefined
  )
}

function isV2GeometryInstance(inst: InstanceEntry | V2GeometryInstance): inst is V2GeometryInstance {
  return 'geo_transform' in inst && !('matrix' in inst)
}

// 4x4 矩阵乘法（列优先）
function multiplyMat4(a: number[], b: number[]): number[] {
  const out: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        const aVal = a[k * 4 + i]
        const bVal = b[j * 4 + k]
        if (aVal !== undefined && bVal !== undefined) {
          sum += aVal * bVal
        }
      }
      out[j * 4 + i] = sum
    }
  }
  return out
}

const IDENTITY_MATRIX: number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]

function withRefno(
  uniforms: Record<string, unknown> | null | undefined,
  refno: string | undefined
): Record<string, unknown> | null {
  const r = String(refno ?? '').trim()
  if (!uniforms) return r ? { refno: r } : null
  if (!r) return uniforms
  if (uniforms.refno === undefined || uniforms.refno === null || String(uniforms.refno).trim() === '') {
    return { ...uniforms, refno: r }
  }
  return uniforms
}

function flattenInstances(manifest: InstanceManifest): InstanceEntry[] {
  const out: InstanceEntry[] = []

  if (isV2Instances(manifest)) {
    const pushComponentInstances = (ownerNoun: string, ownerRefno: string | undefined, component: ComponentInstances): void => {
      const refnoTransform = component.refno_transform || IDENTITY_MATRIX
      const componentColorIndex = component.color_index ?? 0
      const componentLodMask = component.lod_mask ?? 1
      const componentSpecValue = component.spec_value ?? 0
      const componentRefno = component.refno
      const componentNoun = component.noun || ''
      const componentName = component.name ?? null

      for (const inst of component.instances || []) {
        let matrix: number[]
        let geoHash: string
        let geoIndex: number

        if (isV2GeometryInstance(inst)) {
          matrix = multiplyMat4(refnoTransform, inst.geo_transform)
          geoHash = inst.geo_hash
          geoIndex = inst.geo_index
        } else {
          matrix = inst.matrix
          geoHash = inst.geo_hash
          geoIndex = inst.geo_index
        }

        out.push({
          geo_hash: geoHash,
          matrix,
          geo_index: geoIndex,
          color_index: componentColorIndex,
          name_index: 0,
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: componentLodMask,
          uniforms: withRefno(
            {
              owner_noun: ownerNoun,
              owner_refno: ownerRefno,
              name: componentName,
              noun: componentNoun,
              spec_value: componentSpecValue,
            },
            componentRefno
          ),
          refno_transform: component.refno_transform,
        })
      }
    }

    const pushGroup = (defaultOwnerNoun: string, group: HierarchyGroup): void => {
      const ownerRefno = group.refno
      const ownerNoun = String(group.noun || defaultOwnerNoun)

      for (const child of group.children || []) {
        pushComponentInstances(ownerNoun, ownerRefno, child)
      }

      for (const tubing of group.tubings || []) {
        const fallbackRefno = String((tubing.uniforms as any)?.refno ?? tubing.refno ?? ownerRefno ?? '')
        const uniforms =
          withRefno(tubing.uniforms, fallbackRefno) ||
          withRefno(
            {
              owner_noun: ownerNoun,
              owner_refno: ownerRefno,
              noun: tubing.noun ?? '',
              name: tubing.name ?? null,
              spec_value: tubing.spec_value ?? 0,
            },
            fallbackRefno
          )

        out.push({
          geo_hash: tubing.geo_hash,
          matrix: tubing.matrix || IDENTITY_MATRIX,
          geo_index: tubing.geo_index,
          color_index: tubing.color_index,
          name_index: tubing.name_index ?? 0,
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: tubing.lod_mask ?? 1,
          uniforms,
        })
      }
    }

    for (const g of manifest.bran_groups || []) pushGroup('BRAN', g)
    for (const g of manifest.equi_groups || []) pushGroup('EQUI', g)
    for (const c of manifest.ungrouped || []) pushComponentInstances('', undefined, c)
    for (const c of manifest.components || []) pushComponentInstances('', undefined, c)
    for (const t of manifest.tubings || []) {
      for (const inst of t.instances || []) {
        out.push({
          ...inst,
          uniforms: withRefno(inst.uniforms, String((inst.uniforms as any)?.refno ?? '')) || inst.uniforms,
        })
      }
    }

    return out
  }

  for (const c of manifest.components || []) {
    for (const raw of c.instances || []) {
      if (!raw || typeof raw !== 'object') continue
      if (isV2GeometryInstance(raw)) continue
      const inst = raw as InstanceEntry
      out.push({
        ...inst,
        uniforms: withRefno(inst.uniforms, c.refno),
      })
    }
  }
  for (const t of manifest.tubings || []) {
    for (const inst of t.instances || []) {
      out.push(inst)
    }
  }

  return out
}

export function buildInstanceIndexByRefno(
  manifest: InstanceManifest,
  refnoFilter?: Set<string>
): Map<string, InstanceEntry[]> {
  const index = new Map<string, InstanceEntry[]>()
  const flat = flattenInstances(manifest)
  for (const instance of flat) {
    const refno = String(instance.uniforms?.refno ?? '')
    if (!refno) continue
    if (refnoFilter && !refnoFilter.has(refno)) continue
    const list = index.get(refno) || []
    list.push(instance)
    index.set(refno, list)
  }
  return index
}

