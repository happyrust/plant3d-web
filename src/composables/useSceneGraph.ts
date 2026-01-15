import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer'

export function collectLoadedSubtreeIds(
  rootId: string,
  getChildrenIds: (id: string) => string[] | undefined,
  options?: { maxDepth?: number; maxNodes?: number },
): string[] {
  const maxDepth = options?.maxDepth ?? 256
  const maxNodes = options?.maxNodes ?? 200_000

  const out: string[] = []
  const visited = new Set<string>()
  const stack: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }]

  while (stack.length > 0 && out.length < maxNodes) {
    const cur = stack.pop()
    if (!cur) continue
    if (cur.depth > maxDepth) continue
    if (!cur.id) continue
    if (visited.has(cur.id)) continue
    visited.add(cur.id)
    out.push(cur.id)

    const children = getChildrenIds(cur.id)
    if (!children || children.length === 0) continue
    for (let i = children.length - 1; i >= 0; i--) {
      const childId = children[i]
      if (!childId) continue
      stack.push({ id: childId, depth: cur.depth + 1 })
    }
  }

  return out
}

export function useSceneGraphOps(viewerRef: { value: DtxCompatViewer | null }) {
  const pendingVisible = new Map<string, boolean>()
  const pendingSelected = new Map<string, boolean>()
  let rafId: number | null = null

  function schedule() {
    if (rafId !== null) return
    rafId = window.requestAnimationFrame(() => {
      rafId = null
      flush()
    })
  }

  function setVisible(ids: string[], visible: boolean) {
    if (!ids || ids.length === 0) return
    // 先把状态写入 compat scene（即使对象实例尚未加载，也能在 __dtxAfterInstancesLoaded 时回放）
    const viewer = viewerRef.value
    if (viewer) {
      viewer.scene.ensureRefnos(ids, { computeAabb: false })
      for (const id of ids) {
        const st = viewer.scene.objects[id]
        if (st) st.visible = visible
      }
    }
    for (const id of ids) {
      if (!id) continue
      pendingVisible.set(id, visible)
    }
    schedule()
  }

  function setSelected(ids: string[], selected: boolean) {
    if (!ids || ids.length === 0) return
    const viewer = viewerRef.value
    if (viewer) {
      viewer.scene.ensureRefnos(ids, { computeAabb: false })
      for (const id of ids) {
        const st = viewer.scene.objects[id]
        if (st) st.selected = selected
      }
    }
    for (const id of ids) {
      if (!id) continue
      pendingSelected.set(id, selected)
    }
    schedule()
  }

  function flush() {
    const viewer = viewerRef.value
    if (!viewer) {
      pendingVisible.clear()
      pendingSelected.clear()
      return
    }

    if (pendingVisible.size > 0) {
      const toShow: string[] = []
      const toHide: string[] = []
      for (const [id, visible] of pendingVisible.entries()) {
        ;(visible ? toShow : toHide).push(id)
      }
      pendingVisible.clear()
      if (toHide.length > 0) viewer.scene.setObjectsVisible(toHide, false)
      if (toShow.length > 0) viewer.scene.setObjectsVisible(toShow, true)
    }

    if (pendingSelected.size > 0) {
      const toSelect: string[] = []
      const toDeselect: string[] = []
      for (const [id, selected] of pendingSelected.entries()) {
        ;(selected ? toSelect : toDeselect).push(id)
      }
      pendingSelected.clear()
      if (toDeselect.length > 0) viewer.scene.setObjectsSelected(toDeselect, false)
      if (toSelect.length > 0) viewer.scene.setObjectsSelected(toSelect, true)
    }
  }

  function isolate(keepIds: string[]) {
    const viewer = viewerRef.value
    if (!viewer) return

    const all = viewer.scene.objectIds
    if (all && all.length > 0) viewer.scene.setObjectsXRayed(all, true)

    if (keepIds && keepIds.length > 0) {
      viewer.scene.setObjectsXRayed(keepIds, false)
      viewer.scene.setObjectsVisible(keepIds, true)
    }
  }

  function clearIsolation() {
    const viewer = viewerRef.value
    if (!viewer) return

    const all = viewer.scene.objectIds
    if (all && all.length > 0) viewer.scene.setObjectsXRayed(all, false)
  }

  return {
    setVisible,
    setSelected,
    flush,
    isolate,
    clearIsolation,
  }
}
