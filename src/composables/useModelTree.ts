export type CheckState = 'checked' | 'unchecked' | 'indeterminate'

export type TreeNode = {
  id: string
  refno?: string
  /** 显示名。有名字就是 NAME；gen-model-v1 下无名构件是 E3D 的整条默认全名（`ZONE 4 of SITE 2`） */
  name: string
  type: string
  parentId: string | null
  childrenIds: string[]
  /** 所属库号；只有 gen-model-v1 数据源给（plan 2026-09-06 P2-4），legacy 源没有这一格 */
  dbnum?: number
  /** 无名构件的短形态（`ZONE 4`），树默认显示它；有名字的构件、legacy 源没有这一格 */
  shortName?: string
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
  /** 见 `TreeNode.shortName` */
  shortName?: string
}

