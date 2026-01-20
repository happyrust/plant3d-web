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
  aabb?: Aabb | null // 预计算的世界空间 AABB（来自 instances.json）
}

type NameEntry = {
  kind: string
  value: string
}

type Aabb = {
  min: number[]
  max: number[]
}

// V3 格式：geo_instance 使用 geo_trans_hash 引用
type GeoInstanceV3 = {
  geo_hash: string
  geo_trans_hash?: string  // V3: 引用 trans_table (几何体局部变换)
}

// V3 格式：child 使用 hash 引用
type ChildV3 = {
  refno: string
  noun?: string
  name?: string | null
  aabb_hash?: string | null  // V3: 引用 aabb_table
  trans_hash?: string        // V3: 引用 trans_table (refno_transform)
  lod_mask?: number
  spec_value?: number | null
  geo_instances?: GeoInstanceV3[]
}

// V3 格式：tubing 使用 hash 引用
type TubingV3 = {
  refno?: string
  noun?: string
  name?: string | null
  aabb_hash?: string | null  // V3: 引用 aabb_table
  trans_hash?: string        // V3: 引用 trans_table
  geo_hash: string
  order?: number
  lod_mask?: number
  spec_value?: number | null
}

// V3 格式：group 使用 hash 引用
type GroupV3 = {
  owner_refno?: string
  owner_noun?: string
  owner_name?: string
  owner_aabb_hash?: string | null  // V3: 引用 aabb_table
  children?: ChildV3[]
  tubings?: TubingV3[]
}

// V3 格式：instance 使用 hash 引用
type FlatInstanceV3 = {
  refno: string
  noun?: string
  name?: string | null
  aabb_hash?: string | null  // V3: 引用 aabb_table
  trans_hash?: string        // V3: 引用 trans_table
  geo_instances?: GeoInstanceV3[]
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
  // V3: hash lookup tables
  trans_table?: Record<string, number[]>   // hash -> matrix[16]
  aabb_table?: Record<string, Aabb>        // hash -> { min, max }
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

// V3 格式检测：version === 3 且有 trans_table/aabb_table
function isV3Format(manifest: InstanceManifest): boolean {
  return manifest.version === 3 && (manifest.trans_table !== undefined || manifest.aabb_table !== undefined)
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

  // V3 格式：使用 hash 引用
  if (isV3Format(manifest)) {
    const transTable = manifest.trans_table || {}
    const aabbTable = manifest.aabb_table || {}

    // 处理 groups
    for (const g of (manifest.groups || []) as GroupV3[]) {
      const ownerRefno = String(g?.owner_refno ?? '').trim() || undefined
      const ownerNoun = String(g?.owner_noun ?? '').trim()
      const ownerName = g?.owner_name ?? null

      // 处理 children
      for (const child of g?.children || []) {
        const refnoTransform = child.trans_hash ? (transTable[child.trans_hash] || IDENTITY_MATRIX) : IDENTITY_MATRIX
        const componentLodMask = child.lod_mask ?? 1
        const componentSpecValue = child.spec_value ?? 0
        const componentRefno = child.refno
        const componentNoun = child.noun || ''
        const componentName = child.name ?? null
        const childAabb = child.aabb_hash ? (aabbTable[child.aabb_hash] || null) : null

        for (const gi of child.geo_instances || []) {
          const geoTransform = gi.geo_trans_hash ? (transTable[gi.geo_trans_hash] || IDENTITY_MATRIX) : IDENTITY_MATRIX
          const matrix = multiplyMat4(refnoTransform, geoTransform)

          out.push({
            geo_hash: gi.geo_hash,
            matrix,
            geo_index: 0,
            color_index: 0,
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
            refno_transform: refnoTransform,
            aabb: childAabb,
          })
        }
      }

      // 处理 tubings
      for (const tubing of (g?.tubings || []) as TubingV3[]) {
        const tubingRefno = String(tubing?.refno ?? ownerRefno ?? '').trim() || undefined
        const matrix = tubing.trans_hash ? (transTable[tubing.trans_hash] || IDENTITY_MATRIX) : IDENTITY_MATRIX
        const tubingAabb = tubing.aabb_hash ? (aabbTable[tubing.aabb_hash] || null) : null

        out.push({
          geo_hash: tubing.geo_hash,
          matrix,
          geo_index: 0,
          color_index: 0,
          name_index: 0,
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: tubing.lod_mask ?? 1,
          uniforms: withRefno(
            {
              owner_noun: ownerNoun,
              owner_refno: ownerRefno,
              owner_name: ownerName,
              noun: tubing.noun ?? 'TUBI',
              name: tubing.name ?? null,
              spec_value: tubing.spec_value ?? 0,
            },
            tubingRefno
          ),
          aabb: tubingAabb,
        })
      }
    }

    // 处理 instances（非聚合类型）
    for (const inst of (manifest.instances || []) as FlatInstanceV3[]) {
      const refno = normalizeRefnoString(String(inst?.refno ?? ''))
      if (!refno) continue

      const refnoTransform = inst.trans_hash ? (transTable[inst.trans_hash] || IDENTITY_MATRIX) : IDENTITY_MATRIX
      const instAabb = inst.aabb_hash ? (aabbTable[inst.aabb_hash] || null) : null
      const noun = String(inst?.noun ?? '')
      const name = inst?.name ?? null

      for (const gi of inst.geo_instances || []) {
        const geoTransform = gi.geo_trans_hash ? (transTable[gi.geo_trans_hash] || IDENTITY_MATRIX) : IDENTITY_MATRIX
        const matrix = multiplyMat4(refnoTransform, geoTransform)

        out.push({
          geo_hash: gi.geo_hash,
          matrix,
          geo_index: 0,
          color_index: 0,
          name_index: 0,
          site_name_index: 0,
          zone_name_index: null,
          lod_mask: 1,
          uniforms: withRefno({ noun, name }, refno),
          refno_transform: refnoTransform,
          aabb: instAabb,
        })
      }
    }

    return out
  }

  // export_dbnum_instances_json 新格式：顶层 groups (V2)
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
        const childAabb = (child as any).aabb ?? null // 获取预计算的 AABB

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
            aabb: childAabb, // 保留预计算的 AABB
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
          aabb: tubing.aabb ?? null, // 保留预计算的 AABB
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
      const componentAabb = (component as any).aabb ?? null // 获取预计算的 AABB

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
          aabb: componentAabb, // 保留预计算的 AABB
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
              noun: tubing.noun || 'TUBI',
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
          aabb: (tubing as any).aabb ?? null, // 保留预计算的 AABB
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
      const componentAabb = (c as any).aabb ?? null // 获取组件级别的 AABB
      for (const raw of c.instances || []) {
        if (!raw || typeof raw !== 'object') continue
        if (isV2GeometryInstance(raw)) continue
        const inst = raw as InstanceEntry
        out.push({
          ...inst,
          uniforms: withRefno(inst.uniforms, c.refno),
          aabb: inst.aabb ?? componentAabb, // 优先使用实例级别的 AABB，否则使用组件级别的
        })
      }
    }
    for (const t of manifest.tubings || []) {
      for (const inst of t.instances || []) {
        out.push({
          ...inst,
          aabb: inst.aabb ?? null, // 保留实例级别的 AABB
        })
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
      const instAabb = inst?.aabb ?? null // 获取该 refno 级别的预计算 AABB
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
          aabb: instAabb, // 传递预计算的 AABB（注意：这是 refno 级别的，可能一个 refno 有多个 geo_instances）
        })
      }

      if (list.length > 0) index.set(refno, list)
    }
  }

  return index
}
