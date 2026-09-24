/**
 * 审核面板「只显示任务构件」的纯逻辑（#84）。
 *
 * 校审单的模型清单记的多半是**单元**（BRAN / HANG / EQUI …）：DTX loader 把成员（ELBO / VALV / BEND / STRT …）各按自己的
 * refno 建对象、只把隐含管子 TUBI 挂到 BRAN 键下，单元键自己通常一个对象都没有；而 `scene.objectIds` 是 refno 状态表的键，
 * `showModelByRefno` 装单元时会给单元自己也建一条占位。所以「任务 refno 在 objectIds 里」不等于「它有几何」——
 * 先藏全部再只亮单元键，结果是整个视口空白（HVAC 支管）或只剩管子（管道 BRAN）。
 *
 * 这里改成：任务 refno 先经 `getSubtreeRefnos` 解成子树里真正装进场景的 refno；一个都没装就**不动场景**；
 * 亮的是子树、飞的是 `getSubtreeAABB`。只依赖 `DtxCompatScene` 的这几个方法，便于单测。
 */
export type TaskModelFilterAabb = [number, number, number, number, number, number];

export type TaskModelFilterScene = {
  readonly objectIds: string[];
  setObjectsVisible(refnos: string[], visible: boolean): void;
  getAABB(refnos: string[]): TaskModelFilterAabb | null;
  getSubtreeRefnos(refnos: string[]): string[];
  getSubtreeAABB(refnos: string[]): TaskModelFilterAabb | null;
};

export type TaskModelFilterResult =
  | { applied: false; reason: 'no-objects' | 'no-task-refnos' | 'task-not-loaded' }
  | { applied: true; shownRefnos: string[]; aabb: TaskModelFilterAabb | null };

function uniqueNonEmpty(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const value = String(raw ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * 把场景收成「只剩任务构件」。返回值告诉调用方有没有真动手：`applied:false` 时场景一个对象都没碰。
 *
 * - `no-objects`：场景状态表是空的（还没装过任何东西）。
 * - `no-task-refnos`：任务清单没有 refno。
 * - `task-not-loaded`：任务 refno 的子树里没有任何已装进场景的对象——藏全部会把无关模型清空却什么都亮不起来，所以不动。
 */
export function applyTaskModelFilter(scene: TaskModelFilterScene, taskRefnos: string[]): TaskModelFilterResult {
  const allObjectIds = Array.isArray(scene.objectIds) ? scene.objectIds : [];
  if (allObjectIds.length === 0) return { applied: false, reason: 'no-objects' };

  const wanted = uniqueNonEmpty(taskRefnos);
  if (wanted.length === 0) return { applied: false, reason: 'no-task-refnos' };

  const loadedSubtree = uniqueNonEmpty(scene.getSubtreeRefnos(wanted));
  if (loadedSubtree.length === 0) return { applied: false, reason: 'task-not-loaded' };

  // 先藏全部，再亮任务单元 + 它们子树里装了对象的构件。单元键本身一起亮：它在状态表里的 visible 也要对（没对象就只是记个状态）。
  const shownRefnos = uniqueNonEmpty([...wanted, ...loadedSubtree]);
  scene.setObjectsVisible(allObjectIds, false);
  scene.setObjectsVisible(shownRefnos, true);

  const aabb = scene.getSubtreeAABB(wanted) ?? scene.getAABB(loadedSubtree);
  return { applied: true, shownRefnos, aabb };
}
