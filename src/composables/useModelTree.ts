export type CheckState = 'checked' | 'unchecked' | 'indeterminate'

export type TreeNode = {
  id: string
  refno?: string
  name: string
  type: string
  parentId: string | null
  childrenIds: string[]
  /** 所属库号；只有 gen-model-v1 数据源给（plan 2026-09-06 P2-4），legacy 源没有这一格 */
  dbnum?: number
}

export type FlatRow = {
  id: string
  refno?: string
  name: string
  type: string
  depth: number
  hasChildren: boolean
  /** 见 `TreeNode.dbnum`；行尾小徽标只在有值时画 */
  dbnum?: number
}

