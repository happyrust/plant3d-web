export type CheckState = 'checked' | 'unchecked' | 'indeterminate'

export type TreeNode = {
  id: string
  name: string
  type: string
  parentId: string | null
  childrenIds: string[]
}

export type FlatRow = {
  id: string
  name: string
  type: string
  depth: number
  hasChildren: boolean
}

