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

type Aabb = {
  min: number[]
  max: number[]
}

type FlatGeoInstanceV0 = {
  geo_hash: string | number
  transform?: number[] // V0 格式：合成后的世界变换
  geo_transform?: number[] // V2 格式：几何体相对 refno 的局部变换
}

type FlatInstanceV0 = {
  refno: string
  noun?: string
  name?: string | null
  aabb?: Aabb | null
  refno_transform?: number[] // V2 格式：refno 的世界变换
  geo_instances: FlatGeoInstanceV0[]
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
  /**
   * gen-model-fork instances 新格式（V0）：顶层 instances（每个 refno 下挂 geo_instances）
   * - 与旧格式的 components[].instances（InstanceEntry）不同：这里的 instances 是“构件实例列表”
   */
  instances?: FlatInstanceV0[]
  /** export_dbnum_instances_json 新格式：顶层 groups（与 bran_groups/equi_groups/ungrouped 并存兼容） */
  groups?: {
    owner_refno?: string
    owner_noun?: string
    owner_name?: string
    owner_aabb?: Aabb | null
    children?: (ComponentInstances & { aabb?: Aabb | null })[]
    tubings?: {
      refno?: string
      noun?: string
      name?: string | null
      aabb?: Aabb | null
      geo_hash: string
      matrix?: number[]
      order?: number
      lod_mask?: number
      spec_value?: number | null
      geo_index?: number
      color_index?: number
      uniforms?: Record<string, unknown> | null
    }[]
  }[]
}

function isNewGroupsInstances(manifest: InstanceManifest): boolean {
  return Array.isArray(manifest.groups) && manifest.groups.length > 0
}

function isFlatInstancesV0(manifest: InstanceManifest): manifest is InstanceManifest & { instances: FlatInstanceV0[] } {
  const insts = (manifest as any)?.instances
  if (!Array.isArray(insts) || insts.length === 0) return false
  const it = insts[0]
  if (!it || typeof it !== 'object') return false
  if (!Array.isArray((it as any).geo_instances)) return false
  const gi = (it as any).geo_instances[0]
  if (!gi || typeof gi !== 'object') return false
  // 支持 V0 格式（transform）和 V2 格式（geo_transform + refno_transform）
  return 'geo_hash' in gi && ('transform' in gi || 'geo_transform' in gi)
}

function isPrepackV2Instances(manifest: InstanceManifest): boolean {
  if (manifest.bran_groups !== undefined || manifest.equi_groups !== undefined || manifest.ungrouped !== undefined) return true
  // 某些版本可能只用 components + geo_transform/refno_transform 表示 V2
  for (const c of manifest.components || []) {
    if (Array.isArray((c as any).refno_transform) && (c as any).refno_transform.length >= 16) return true
    for (const inst of c.instances || []) {
      if (inst && typeof inst === 'object' && 'geo_transform' in inst && !('matrix' in inst)) return true
    }
  }
  return false
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

function normalizeRefnoString(refno: string): string {
  return String(refno || '').trim().replace('/', '_')
}

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

  // export_dbnum_instances_json 新格式：顶层 groups
  if (isNewGroupsInstances(manifest)) {
    for (const g of manifest.groups || []) {
      const ownerRefno = String(g?.owner_refno ?? '').trim() || undefined
      const ownerNoun = String(g?.owner_noun ?? '').trim()
      const ownerName = g?.owner_name ?? null

      for (const child of g?.children || []) {
        const refnoTransform = child.refno_transform || IDENTITY_MATRIX
        const componentColorIndex = (child as any).color_index ?? 0
        const componentLodMask = child.lod_mask ?? 1
        const componentSpecValue = child.spec_value ?? 0
        const componentRefno = child.refno
        const componentNoun = child.noun || ''
        const componentName = child.name ?? null

        for (const inst of child.instances || []) {
          let matrix: number[]
          let geoHash: string
          let geoIndex: number

          if (isV2GeometryInstance(inst as any)) {
            const v2 = inst as V2GeometryInstance
            matrix = multiplyMat4(refnoTransform, v2.geo_transform)
            geoHash = v2.geo_hash
            geoIndex = v2.geo_index
          } else {
            const v1 = inst as InstanceEntry
            matrix = v1.matrix
            geoHash = v1.geo_hash
            geoIndex = v1.geo_index ?? 0
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
                owner_name: ownerName,
                name: componentName,
                noun: componentNoun,
                spec_value: componentSpecValue,
              },
              componentRefno
            ),
            refno_transform: child.refno_transform,
          })
        }
      }

      for (const tubing of g?.tubings || []) {
        const tubingRefno = String(tubing?.refno ?? (tubing.uniforms as any)?.refno ?? ownerRefno ?? '').trim() || undefined
        const uniforms =
          withRefno(tubing.uniforms, tubingRefno) ||
          withRefno(
            {
              owner_noun: ownerNoun,
              owner_refno: ownerRefno,
              owner_name: ownerName,
              noun: tubing.noun ?? 'TUBI',
              name: tubing.name ?? null,
              spec_value: tubing.spec_value ?? 0,
            },
            tubingRefno
          )

        out.push({
          geo_hash: tubing.geo_hash,
          matrix: tubing.matrix || IDENTITY_MATRIX,
          geo_index: tubing.geo_index ?? 0,
          color_index: tubing.color_index ?? 0,
          name_index: 0,
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: tubing.lod_mask ?? 1,
          uniforms,
        })
      }
    }

    return out
  }

  if (isPrepackV2Instances(manifest)) {
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

export function buildInstanceIndexByRefno(manifest: InstanceManifest, refnoFilter?: Set<string>): Map<string, InstanceEntry[]> {
  const index = new Map<string, InstanceEntry[]>()

  // 1) 先把“结构化格式”(groups/prepack/旧 components)拍平进来
  const flat = flattenInstances(manifest)
  for (const instance of flat) {
    const refno = String(instance.uniforms?.refno ?? '')
    if (!refno) continue
    if (refnoFilter && !refnoFilter.has(refno)) continue
    const list = index.get(refno) || []
    list.push(instance)
    index.set(refno, list)
  }

  // 2) 再合并 gen-model-fork V0：manifest.instances[].geo_instances[].transform
  // export_dbnum_instances_json 可能同时包含 groups + instances（instances 通常是非聚合 refno 的补集），因此不能 early-return。
  if (isFlatInstancesV0(manifest)) {
    for (const inst of manifest.instances || []) {
      const refno = normalizeRefnoString(String(inst?.refno ?? ''))
      if (!refno) continue
      if (refnoFilter && !refnoFilter.has(refno)) continue

      const list = index.get(refno) || []
      const noun = String(inst?.noun ?? '')
      const name = inst?.name ?? null
      // V2 格式：refno_transform 为构件的世界变换
      const refnoTransform = Array.isArray(inst?.refno_transform) && inst.refno_transform.length === 16
        ? inst.refno_transform
        : IDENTITY_MATRIX

      for (const gi of inst.geo_instances || []) {
        const geoHash = String((gi as any)?.geo_hash ?? '').trim()
        if (!geoHash) continue

        // V2 格式：geo_transform + refno_transform → 最终 matrix = refno_transform * geo_transform
        // V0 格式：直接使用 transform
        let matrix: number[]
        if (Array.isArray((gi as any)?.geo_transform) && (gi as any).geo_transform.length === 16) {
          matrix = multiplyMat4(refnoTransform, (gi as any).geo_transform)
        } else if (Array.isArray((gi as any)?.transform) && (gi as any).transform.length === 16) {
          matrix = (gi as any).transform
        } else {
          matrix = IDENTITY_MATRIX
        }

        list.push({
          geo_hash: geoHash,
          matrix,
          geo_index: 0,
          color_index: 0,
          name_index: 0,
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: 1,
          uniforms: withRefno(
            {
              noun,
              name,
            },
            refno
          ),
          refno_transform: inst?.refno_transform,
        })
      }

      if (list.length > 0) index.set(refno, list)
    }
  }

  return index
}
