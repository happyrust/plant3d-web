/**
 * 模型树「房间」页签 · gen-model-v1 源真机回归（ADR 0068 第二批 PR-D；plan `docs/plans/2026-09-21-model-tree-room-tab-pr-d-closeout-plan.md` §P1-b）。
 *
 * 三条用例对应 09-21 真机十步（`docs/verification/spatial-room-hierarchy-tree-2026-09-20/README.md` §8）：
 * ① 切页签 / 在册计数 / 搜索 / 无匹配 / 切回 PDMS；② 展开一间房逐层计数 = `GET /api/v1/spatial/rooms/{refno}/tree` 响应 + 无盒房间的一句原因；
 * ③ 右键单元「加载模型（N 个构件）」→ 几何进场景 → 眼睛切显隐 → 切页签状态保留。
 * ④（收口计划 P3-a / P3-b）页签记忆：切到「房间」后整页刷新仍在「房间」；选中联动：外部 `setGlobalSelectedRefno` 一个已取过树的房里的构件 → 展开到它、选中、滚到可见；树内点选不反弹。
 *
 * 数量断言一律取自服务端响应，不写死；夹具房间优先 R432（`24381_35580`，AMS 7997），不在册就取清单第一间有盒的房。
 * 前置同抽屉那份：gen-model 在 `GEN_MODEL_V1_BASE_URL`、空间树 ready、认得 7997；房间体制不是 ready / degraded（`room_membership=false` 等）整文件跳过。
 * 页面走 Playwright `baseURL` 的 Vite dev server，不带 `show_refno`（场景一开始是空的，几何全靠页签自己加载）。
 * 跑法：`PLAYWRIGHT_PORT=3111 GEN_MODEL_V1_BASE_URL=http://127.0.0.1:8027 npx playwright test e2e/model-tree-room-tab-gen-model-v1.spec.ts --workers=1`。
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GEN_MODEL_BASE, openSpatialUiPage, probeGenModelForSpatialUi, sceneOverview, selectRefno } from './helpers/spatialQueryGenModelV1';

test.setTimeout(300_000);

const PREFERRED_ROOM = '24381_35580';

type RoomOption = { refno: string; room_num: string; name: string | null; dbnum?: number | null; panel_count: number };
type RoomsResponse = { status: string; reason?: string | null; rooms: RoomOption[] };
type TreeLeaf = { refno: string; noun: string; distance: number; shared_rooms?: number };
type TreeUnit = { refno: string; noun: string; name: string | null; count: number; min_distance: number; elements?: TreeLeaf[] };
type TreeUnitType = { noun: string; count: number; units: TreeUnit[] };
type TreeSpec = { spec_value: number; count: number; unit_types: TreeUnitType[]; others: { count: number; by_noun: { noun: string; count: number; elements?: TreeLeaf[] }[] } };
type RoomTreeResponse = { total_count: number; leaf_count: number; leaves_inline: boolean; rooms: { refno: string; room_num: string; name: string | null; count: number; specs: TreeSpec[] }[] };

async function fetchRooms(): Promise<RoomsResponse> {
  const response = await fetch(`${GEN_MODEL_BASE}/api/v1/spatial/rooms`);
  expect(response.ok, `/spatial/rooms HTTP ${response.status}`).toBe(true);
  return await response.json() as RoomsResponse;
}

async function fetchRoomTree(refno: string): Promise<{ status: number; body: RoomTreeResponse | null }> {
  const response = await fetch(`${GEN_MODEL_BASE}/api/v1/spatial/rooms/${encodeURIComponent(refno)}/tree`);
  return { status: response.status, body: response.ok ? await response.json() as RoomTreeResponse : null };
}

/** 夹具房：R432 在册且有盒就用它，否则清单里第一间 `rooms/{refno}/tree` 回 200 的房。 */
async function pickFixtureRoom(rooms: RoomOption[]): Promise<{ room: RoomOption; tree: RoomTreeResponse } | null> {
  const ordered = [...rooms].sort((a, b) => (a.refno === PREFERRED_ROOM ? -1 : b.refno === PREFERRED_ROOM ? 1 : b.panel_count - a.panel_count));
  for (const room of ordered.slice(0, 6)) {
    const { body } = await fetchRoomTree(room.refno);
    if (body && body.rooms.length === 1 && body.rooms[0]!.count > 0) return { room, tree: body };
  }
  return null;
}

test.beforeEach(async () => {
  const reason = await probeGenModelForSpatialUi();
  test.skip(reason !== null, reason ?? '');
  const rooms = await fetchRooms();
  test.skip(rooms.status !== 'ready' && rooms.status !== 'degraded', `房间体制 ${rooms.status}（${rooms.reason ?? '无 reason'}），页签只会显示一句原因`);
  test.skip(rooms.rooms.length === 0, '在册房间为空');
});

const rowsIn = (page: Page) => page.locator('[data-testid="room-tree-body"] [data-testid="model-tree-row"]');
const rowById = (page: Page, id: string) => page.locator(`[data-testid="room-tree-body"] [data-testid="model-tree-row"][data-refno="${id}"]`);
const rowText = async (row: Locator): Promise<string> => ((await row.textContent()) ?? '').replace(/\s+/g, ' ').trim();
const roomLabel = (room: { room_num: string; name: string | null }, count: number | null) =>
  [room.room_num, room.name, count === null ? null : `${count} 个构件`].filter(Boolean).join(' · ');
/** `ModelTreeRow` 按 E3D 规矩把名字前导 `/` 去掉再显示。 */
const displayName = (name: string | null, refno: string) => (name || refno).replace(/^\//, '');

type AppModuleWindow = Window & { __appModuleUrl?: (path: string) => string };

/** 打开页面（不带模型）、确保模型树面板在前台、切到「房间」页签并等在册计数出现。 */
async function openRoomTab(page: Page): Promise<{ pageErrors: string[] }> {
  const { pageErrors } = await openSpatialUiPage(page, { mode: null, withModel: false });
  const tab = page.getByTestId('model-tree-tab-room');
  if (!(await tab.isVisible().catch(() => false))) {
    await page.evaluate(() =>
      import((window as AppModuleWindow).__appModuleUrl?.('/src/composables/useDockApi.ts') ?? '/src/composables/useDockApi.ts')
        .then((mod) => mod.ensurePanelAndActivate('modelTree')));
  }
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await expect(page.getByTestId('room-tree-status')).toContainText(/在册 \d+ 间房/, { timeout: 60_000 });
  return { pageErrors };
}

async function searchRoom(page: Page, text: string): Promise<void> {
  await page.getByTestId('room-tree-search').fill(text);
}

async function expandRow(page: Page, id: string): Promise<void> {
  const row = rowById(page, id);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.locator('button').first().click();
}

/** 搜到夹具房、展开它（等 `rooms/{refno}/tree` 那一发），返回响应体。 */
async function expandFixtureRoom(page: Page, room: RoomOption): Promise<RoomTreeResponse> {
  await searchRoom(page, room.room_num);
  await expect(rowById(page, room.refno)).toBeVisible();
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/api/v1/spatial/rooms/${room.refno}/tree`), { timeout: 60_000 });
  await expandRow(page, room.refno);
  const response = await pending;
  expect(response.status(), 'rooms/{refno}/tree 应 200').toBe(200);
  return await response.json() as RoomTreeResponse;
}

/** 树里第一个叶子已内联、构件数在 1–60 之间的单元（加载不至于太久），连同它所在的专业 / 单元类型。 */
function pickLoadableUnit(tree: RoomTreeResponse): { spec: TreeSpec; unitType: TreeUnitType; unit: TreeUnit } | null {
  for (const spec of tree.rooms[0]!.specs) {
    for (const unitType of spec.unit_types) {
      for (const unit of unitType.units) {
        if (unit.elements && unit.elements.length > 0 && unit.elements.length <= 60) return { spec, unitType, unit };
      }
    }
  }
  return null;
}

test('切到「房间」页签：状态句「在册 N 间房」N = /spatial/rooms 条数、搜索框 placeholder 同数；搜房间号只剩匹配的行；搜不着给「没有匹配的房间」；切回 PDMS 房间面板隐藏、再切回来还在；无 pageerror', async ({ page }) => {
  const rooms = await fetchRooms();
  const { pageErrors } = await openRoomTab(page);
  const total = rooms.rooms.length;

  await expect(page.getByTestId('room-tree-status')).toContainText(`在册 ${total} 间房`);
  await expect(page.getByTestId('room-tree-search')).toHaveAttribute('placeholder', `搜索房间号 / 名称（在册 ${total} 间）`);
  expect(await rowsIn(page).count(), '虚拟列表至少渲染一屏').toBeGreaterThan(0);

  const target = rooms.rooms.find((room) => room.refno === PREFERRED_ROOM) ?? rooms.rooms[0]!;
  const query = target.room_num;
  const expected = rooms.rooms.filter((room) =>
    room.room_num.toLowerCase().includes(query.toLowerCase())
    || (room.name ?? '').toLowerCase().includes(query.toLowerCase())
    || room.refno.includes(query)).length;
  await searchRoom(page, query);
  await expect(page.getByTestId('room-tree-status')).toContainText(`匹配 ${expected} / ${total} 间房`);
  await expect(rowsIn(page)).toHaveCount(expected);
  await expect(rowById(page, target.refno)).toContainText(roomLabel(target, null));

  await searchRoom(page, 'ZZZ-不存在的房间号');
  await expect(page.getByTestId('room-tree-status')).toContainText(`匹配 0 / ${total} 间房`);
  await expect(page.getByTestId('room-tree-body')).toContainText('没有匹配的房间');
  await expect(rowsIn(page)).toHaveCount(0);

  await page.getByTestId('model-tree-tab-pdms').click();
  await expect(page.getByTestId('room-tree-panel')).toBeHidden();
  await page.getByTestId('model-tree-tab-room').click();
  await expect(page.getByTestId('room-tree-panel')).toBeVisible();
  await expect(page.getByTestId('room-tree-search')).toHaveValue('ZZZ-不存在的房间号');

  expect(pageErrors).toEqual([]);
});

test('展开一间房：一发 rooms/{refno}/tree；房间 / 专业 / 单元类型 / 其他构件 / 前几个单元 / 构件 各行的文字与计数逐层等于响应；从没生成过面板模型的房间展开只给一句「还没有包围盒」', async ({ page }) => {
  const rooms = await fetchRooms();
  const fixture = await pickFixtureRoom(rooms.rooms);
  test.skip(fixture === null, '清单里前几间房都没有 rooms/{refno}/tree（都没生成过面板模型）');
  const { room } = fixture!;
  const { pageErrors } = await openRoomTab(page);

  const tree = await expandFixtureRoom(page, room);
  const node = tree.rooms[0]!;
  expect(node.refno).toBe(room.refno);
  await expect(rowById(page, room.refno)).toContainText(roomLabel(node, node.count), { timeout: 30_000 });

  // 专业一层：每个 spec_value 一行，行尾计数 = 响应
  for (const spec of node.specs) {
    const row = rowById(page, `spec:${room.refno}:${spec.spec_value}`);
    await expect(row).toBeVisible();
    expect(await rowText(row)).toMatch(new RegExp(`· ${spec.count}$`));
  }

  // 展开构件最多的那个专业：单元类型行「NOUN · n 个单元 · count」、其他构件行「其他构件 · count」
  const spec = [...node.specs].sort((a, b) => b.count - a.count)[0]!;
  await expandRow(page, `spec:${room.refno}:${spec.spec_value}`);
  for (const unitType of spec.unit_types) {
    await expect(rowById(page, `utype:${room.refno}:${spec.spec_value}:${unitType.noun}`))
      .toContainText(`${unitType.noun} · ${unitType.units.length} 个单元 · ${unitType.count}`);
  }
  if (spec.others.count > 0) {
    await expect(rowById(page, `others:${room.refno}:${spec.spec_value}`)).toContainText(`其他构件 · ${spec.others.count}`);
  }

  // 展开第一个单元类型：前 3 个单元行「名字（去前导 /）· count」；展开第一个单元：构件行按 refno 一行一个
  const unitType = spec.unit_types[0];
  test.skip(!unitType, `专业 ${spec.spec_value} 下没有最小交付单元，只有其他构件`);
  await expandRow(page, `utype:${room.refno}:${spec.spec_value}:${unitType!.noun}`);
  for (const unit of unitType!.units.slice(0, 3)) {
    await expect(rowById(page, unit.refno)).toContainText(`${displayName(unit.name, unit.refno)} · ${unit.count}`);
  }
  const first = unitType!.units[0]!;
  await expandRow(page, first.refno);
  if (first.elements) {
    for (const leaf of first.elements.slice(0, 5)) {
      await expect(rowById(page, leaf.refno)).toContainText(leaf.refno);
    }
    expect(first.elements.length, '单元行的计数 = 内联叶子数').toBe(first.count);
  } else {
    // 叶子没内联（整树超过 leaf_cap）：第一次展开去取那一组，取回后构件行才出现
    await expect(rowsIn(page).filter({ hasText: /^\S+ \d+_\d+$/ }).first()).toBeVisible({ timeout: 60_000 });
  }

  // 无盒房间：`panel_count` 为 0 的房展开时服务端 404，树上方一句原因、不出子级
  const noBox = rooms.rooms.find((candidate) => candidate.panel_count === 0 && candidate.refno !== room.refno);
  if (noBox) {
    await searchRoom(page, noBox.room_num);
    await expect(rowById(page, noBox.refno)).toBeVisible();
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/api/v1/spatial/rooms/${noBox.refno}/tree`), { timeout: 60_000 });
    await expandRow(page, noBox.refno);
    const status = (await pending).status();
    if (status === 404) {
      await expect(page.getByTestId('room-tree-node-errors')).toContainText('还没有包围盒', { timeout: 30_000 });
      await expect(rowById(page, `spec:${noBox.refno}:0`)).toHaveCount(0);
    } else {
      // 面板数为 0 的房也可能有盒（盒来自子树几何而不是面板）——那就当一间普通房，只要求不报错
      expect(status).toBe(200);
    }
  }

  expect(pageErrors).toEqual([]);
});

test('页签记忆 + 选中联动：切到「房间」后刷新页面仍停在「房间」（localStorage）；外部选中一个已展开房里的构件 → 页签展开到它、选中、滚到可见；选中单元 refno 落在单元行；树内点选写回全局选中且不反弹', async ({ page }) => {
  const rooms = await fetchRooms();
  const fixture = await pickFixtureRoom(rooms.rooms);
  test.skip(fixture === null, '清单里前几间房都没有 rooms/{refno}/tree');
  const picked = pickLoadableUnit(fixture!.tree);
  test.skip(picked === null, '夹具房里没有叶子已内联的单元');
  const { room } = fixture!;
  const { spec, unitType, unit } = picked!;
  const { pageErrors } = await openRoomTab(page);

  // P3-a：切到「房间」已记进 localStorage；整页刷新后模型树面板直接停在「房间」
  expect(await page.evaluate(() => localStorage.getItem('plant3d.modelTree.activeTab'))).toBe('room');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await page.waitForFunction(() => !!(window as unknown as { __xeokitViewer?: { scene?: unknown } }).__xeokitViewer?.scene, null, { timeout: 60_000 });
  const onboardingClose = page.getByRole('button', { name: '关闭向导', exact: true });
  if (await onboardingClose.isVisible().catch(() => false)) await onboardingClose.click({ force: true }).catch(() => undefined);
  await expect(page.getByTestId('model-tree-tab-room')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('model-tree-tab-room')).toHaveClass(/shadow-sm/);
  await expect(page.getByTestId('model-tree-tab-pdms')).not.toHaveClass(/shadow-sm/);
  await expect(page.getByTestId('room-tree-panel')).toBeVisible();
  await expect(page.getByTestId('room-tree-status')).toContainText(/在册 \d+ 间房/, { timeout: 60_000 });

  // P3-b：只展开房间这一层，然后从外部选中该房里某个单元的一个构件
  await expandFixtureRoom(page, room);
  await expect(rowById(page, `spec:${room.refno}:${spec.spec_value}`)).toBeVisible();
  const target = unit.elements![unit.elements!.length - 1]!.refno;
  await expect(rowById(page, target)).toHaveCount(0);
  await selectRefno(page, target);
  const targetRow = rowById(page, target);
  await expect(targetRow).toBeVisible({ timeout: 10_000 });
  await expect(targetRow).toHaveAttribute('data-selected', 'true');
  await expect(targetRow).toBeInViewport();
  await expect(rowById(page, `utype:${room.refno}:${spec.spec_value}:${unitType.noun}`)).toBeVisible();
  await expect(rowById(page, unit.refno)).toBeVisible();
  await expect(page.locator('[data-testid="room-tree-body"] [data-testid="model-tree-row"][data-selected="true"]')).toHaveCount(1);

  // 单元的 refno → 单元行被选中（构件行不再选中）
  await selectRefno(page, unit.refno);
  await expect(rowById(page, unit.refno)).toHaveAttribute('data-selected', 'true');
  await expect(targetRow).toHaveAttribute('data-selected', 'false');

  // 树内点选另一个构件：全局选中跟着变，且行选中就是点的那一行（没有被联动反弹回去）
  const other = unit.elements![0]!.refno;
  await rowById(page, other).click();
  await expect(rowById(page, other)).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => page.evaluate(() =>
    import((window as unknown as { __appModuleUrl?: (path: string) => string }).__appModuleUrl?.('/src/composables/useSelectionStore.ts') ?? '/src/composables/useSelectionStore.ts')
      .then((mod) => mod.getGlobalSelectedRefno() as string | null)), { timeout: 5_000 }).toBe(other);
  await expect(page.locator('[data-testid="room-tree-body"] [data-testid="model-tree-row"][data-selected="true"]')).toHaveCount(1);

  // 切回 PDMS 也记住
  await page.getByTestId('model-tree-tab-pdms').click();
  expect(await page.evaluate(() => localStorage.getItem('plant3d.modelTree.activeTab'))).toBe('pdms');

  expect(pageErrors).toEqual([]);
});

test('右键单元「加载模型（N 个构件）」：ensure + records 后单元的构件几何都进场景；构件行眼睛切显隐落到 scene.objects[refno].visible；切到 PDMS 再切回房间展开态与已加载行都还在', async ({ page }) => {
  const rooms = await fetchRooms();
  const fixture = await pickFixtureRoom(rooms.rooms);
  test.skip(fixture === null, '清单里前几间房都没有 rooms/{refno}/tree');
  const picked = pickLoadableUnit(fixture!.tree);
  test.skip(picked === null, '夹具房里没有叶子已内联、构件数 ≤ 60 的单元');
  const { room } = fixture!;
  const { spec, unitType, unit } = picked!;
  const refnos = unit.elements!.map((leaf) => leaf.refno);
  const { pageErrors } = await openRoomTab(page);

  await expandFixtureRoom(page, room);
  await expandRow(page, `spec:${room.refno}:${spec.spec_value}`);
  await expandRow(page, `utype:${room.refno}:${spec.spec_value}:${unitType.noun}`);
  await expandRow(page, unit.refno);
  await expect(rowById(page, refnos[0]!)).toBeVisible();

  const before = await sceneOverview(page);
  expect(refnos.every((refno) => !before.loadedRefnos.includes(refno)), '页面不带 show_refno，单元的构件一开始没有几何').toBe(true);

  await rowById(page, unit.refno).click({ button: 'right' });
  const menu = page.locator('[data-room-tree-context-menu="true"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('button')).toHaveText(['聚焦飞行', '隔离（XRAY 其它）', '取消隔离', '显示', '隐藏', `加载模型（${unit.count} 个构件）`, '查看属性']);

  const loadRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/v1\/model\/(ensure|records)$/.test(new URL(request.url()).pathname)) loadRequests.push(request.url());
  });
  await page.getByTestId('room-tree-load-models').click();
  const confirm = page.getByRole('button', { name: /^加载 \d+ 个$/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect.poll(async () => {
    const overview = await sceneOverview(page);
    return refnos.filter((refno) => overview.loadedRefnos.includes(refno)).length;
  }, { timeout: 240_000, intervals: [1000, 2000, 5000] }).toBe(refnos.length);
  expect(loadRequests.some((url) => url.endsWith('/model/ensure')), '加载走 ensure').toBe(true);
  expect(loadRequests.some((url) => url.endsWith('/model/records')), '加载走 records').toBe(true);
  await expect(menu).toBeHidden();

  // 眼睛：先隐再显，落到场景对象的 visible
  const target = refnos[0]!;
  const visibleOf = () => page.evaluate((refno) => {
    const object = (window as unknown as { __xeokitViewer: { scene: { objects: Record<string, { visible?: boolean } | undefined> } } }).__xeokitViewer.scene.objects[refno];
    return object ? object.visible !== false : null;
  }, target);
  await rowById(page, target).hover();
  await rowById(page, target).locator('button').last().click();
  await expect.poll(visibleOf, { timeout: 10_000 }).toBe(false);
  await rowById(page, target).hover();
  await rowById(page, target).locator('button').last().click();
  await expect.poll(visibleOf, { timeout: 10_000 }).toBe(true);

  // 切页签状态保留：两棵树 v-show 常驻
  await page.getByTestId('model-tree-tab-pdms').click();
  await expect(page.getByTestId('room-tree-panel')).toBeHidden();
  await page.getByTestId('model-tree-tab-room').click();
  await expect(rowById(page, unit.refno)).toBeVisible();
  await expect(rowById(page, target)).toBeVisible();
  await expect(rowById(page, room.refno)).toContainText(`${fixture!.tree.rooms[0]!.count} 个构件`);

  expect(pageErrors).toEqual([]);
});

type TreeTubeBody = { ordinal: number; from: string; to: string; from_noun: string; to_noun: string; distance: number; length: number; invalid: boolean };
type RoomTreeTubesResponse = RoomTreeResponse & {
  total_tube_count?: number;
  rooms: { refno: string; count: number; tube_count?: number; specs: (TreeSpec & { unit_types: { noun: string; count: number; units: (TreeUnit & { tube_count?: number; tubes?: TreeTubeBody[] })[] }[] })[] }[];
};

test('直段行（方案 B）：页签的 rooms/{refno}/tree 恒带 tubes=1；房间行「N 个构件 · M 段直管」、BRAN 单元行尾「M 段直管」、展开后构件行之后的 TUBI 行数 = 响应里该单元 tubes.length；点它 = 选中所属 BRAN、右键聚焦 / 显示 / 隐藏 / 查看属性；逐段眼睛（T4）：未加载先提示，加载 BRAN 后只藏那一段（scene.isTubeSegmentVisible）、单元级眼睛整条覆盖并清掉逐段隐藏；老服务端整条跳过', async ({ page }) => {
  const rooms = await fetchRooms();
  const fixture = await pickFixtureRoom(rooms.rooms);
  test.skip(fixture === null, '清单里前几间房都没有 rooms/{refno}/tree');
  const { room } = fixture!;
  const probe = await fetch(`${GEN_MODEL_BASE}/api/v1/spatial/rooms/${encodeURIComponent(room.refno)}/tree?tubes=1`);
  expect(probe.ok).toBe(true);
  const truth = await probe.json() as RoomTreeTubesResponse;
  test.skip(typeof truth.total_tube_count !== 'number', '服务端不认 tubes=1（老构建），树里没有直段信息');
  const node = truth.rooms[0]!;
  // 虚拟列表一屏约 18 行：挑构件 + 直段最少的那个 BRAN 单元，展开后它的子行能同时在屏上
  type PickedUnit = { spec: TreeSpec; unitType: { noun: string }; unit: TreeUnit & { tube_count?: number; tubes?: TreeTubeBody[] } };
  const candidates: PickedUnit[] = [];
  for (const spec of node.specs) {
    for (const unitType of spec.unit_types) {
      if (unitType.noun !== 'BRAN') continue;
      for (const unit of unitType.units) {
        if ((unit.tubes?.length ?? 0) > 0 && Array.isArray(unit.elements) && unit.elements.length > 0) candidates.push({ spec, unitType, unit });
      }
    }
  }
  candidates.sort((a, b) => (a.unit.elements!.length + a.unit.tubes!.length) - (b.unit.elements!.length + b.unit.tubes!.length));
  const picked = candidates.find((candidate) => candidate.unit.elements!.length + candidate.unit.tubes!.length <= 12) ?? null;
  test.skip(picked === null, '夹具房里没有带直段、叶子已内联且子行 ≤ 12 的 BRAN 单元');
  const { spec, unitType, unit } = picked!;
  const { pageErrors } = await openRoomTab(page);

  // 页签自己那一发也带 tubes=1
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/api/v1/spatial/rooms/${room.refno}/tree`), { timeout: 60_000 });
  await searchRoom(page, room.room_num);
  await expandRow(page, room.refno);
  const response = await pending;
  expect(new URL(response.url()).searchParams.get('tubes')).toBe('1');
  await expect(rowById(page, room.refno)).toContainText(`${node.count} 个构件 · ${node.tube_count} 段直管`, { timeout: 30_000 });

  await expandRow(page, `spec:${room.refno}:${spec.spec_value}`);
  await expandRow(page, `utype:${room.refno}:${spec.spec_value}:${unitType.noun}`);
  await expect(rowById(page, unit.refno)).toContainText(`${displayName(unit.name, unit.refno)} · ${unit.count} · ${unit.tube_count} 段直管`);
  await expandRow(page, unit.refno);
  await rowById(page, unit.refno).scrollIntoViewIfNeeded();
  await expect(rowById(page, unit.elements![0]!.refno)).toBeVisible();

  const tubeRows = page.locator(`[data-testid="room-tree-body"] [data-testid="model-tree-row"][data-refno^="tube:${room.refno}:${unit.refno}#"]`);
  await expect(tubeRows).toHaveCount(unit.tubes!.length);
  const first = unit.tubes![0]!;
  const firstRow = tubeRows.first();
  await expect(firstRow).toHaveAttribute('data-node-type', 'TUBI');
  await expect(firstRow).not.toHaveAttribute('data-read-only', 'true');
  await expect(firstRow).toContainText(`${first.from_noun} → ${first.to_noun}`);
  expect(await firstRow.locator('button').count(), '直段行没有展开箭头，只有一颗逐段的眼睛').toBe(1);
  // 直段行紧跟在该单元最后一个构件行之后
  const lastLeaf = rowById(page, unit.elements![unit.elements!.length - 1]!.refno);
  expect(await lastLeaf.evaluate((el, tubeKeyPrefix) => {
    const rows = Array.from(el.closest('[data-testid="room-tree-body"]')!.querySelectorAll<HTMLElement>('[data-testid="model-tree-row"]'));
    const leafIndex = rows.indexOf(el as HTMLElement);
    return rows[leafIndex + 1]?.dataset.refno?.startsWith(tubeKeyPrefix) ?? false;
  }, `tube:${room.refno}:${unit.refno}#`)).toBe(true);

  // 点直段行：行选中、全局选中 = 所属 BRAN
  await firstRow.click();
  await expect(firstRow).toHaveAttribute('data-selected', 'true');
  await expect.poll(() => page.evaluate(() =>
    import((window as AppModuleWindow).__appModuleUrl?.('/src/composables/useSelectionStore.ts') ?? '/src/composables/useSelectionStore.ts')
      .then((mod) => mod.getGlobalSelectedRefno() as string | null)), { timeout: 10_000 }).toBe(unit.refno);

  // 右键：聚焦飞行 / 显示 / 隐藏（逐段）/ 查看属性——没有隔离与加载（那是单元级的事）
  await firstRow.click({ button: 'right' });
  const menu = page.locator('[data-room-tree-context-menu="true"]');
  await expect(menu).toBeVisible();
  await expect(menu.locator('button')).toHaveText(['聚焦飞行', '显示', '隐藏', '查看属性']);
  await expect(page.getByTestId('room-tree-load-models')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(menu).toBeHidden();

  // 逐段眼睛（T4）：身份键 = tubeKey(BRAN, 段)，与 model/records 记录一级的 tube 同一个四元组
  const tubeKey = `${unit.refno}#${first.from}-${first.to}#${first.ordinal}`;
  type TubeWindow = Window & {
    __appModuleUrl?: (path: string) => string;
    __xeokitViewer: { scene: { objects: Record<string, { visible?: boolean } | undefined>; isTubeSegmentVisible?: (key: string) => boolean | null } };
  };
  const tubeState = () => page.evaluate(async (key) => {
    const w = window as unknown as TubeWindow;
    const mod = await import(w.__appModuleUrl?.('/src/composables/useDbnoInstancesDtxLoader.ts') ?? '/src/composables/useDbnoInstancesDtxLoader.ts');
    return {
      loaded: mod.isDtxTubeSegmentLoadedAcrossAllDbnos(key) as boolean,
      hidden: mod.isDtxTubeSegmentHidden(key) as boolean,
      sceneVisible: w.__xeokitViewer.scene.isTubeSegmentVisible?.(key) ?? null,
    };
  }, tubeKey);
  // 未加载：点眼睛 → 提示先加载所属 BRAN，什么都没藏
  expect(await tubeState()).toEqual({ loaded: false, hidden: false, sceneVisible: null });
  await firstRow.hover();
  await firstRow.locator('button').last().click();
  await expect(page.getByText('这段直管还没装进场景').first()).toBeVisible({ timeout: 10_000 });
  expect((await tubeState()).hidden).toBe(false);

  // 给所属 BRAN 单元「加载模型」→ 直管对象进场景（服务端 T2 起 records 带 tube，加载链据此登记直段键）
  await rowById(page, unit.refno).click({ button: 'right' });
  await page.getByTestId('room-tree-load-models').click();
  const confirm = page.getByRole('button', { name: /^加载 \d+ 个$/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect.poll(async () => (await tubeState()).loaded, { timeout: 240_000, intervals: [1000, 2000, 5000] }).toBe(true);
  expect((await tubeState()).sceneVisible, '刚装进来：这一段可见').toBe(true);

  // 点直段行的眼睛：只这一段隐；所属 BRAN 的 refno 状态仍 visible；再点回来
  await firstRow.hover();
  await firstRow.locator('button').last().click();
  await expect.poll(async () => (await tubeState()).sceneVisible, { timeout: 10_000 }).toBe(false);
  expect((await tubeState()).hidden).toBe(true);
  expect(await page.evaluate((refno) => {
    const object = (window as unknown as TubeWindow).__xeokitViewer.scene.objects[refno];
    return object ? object.visible !== false : null;
  }, unit.refno), '所属 BRAN 的 refno 级状态不动').not.toBe(false);
  await firstRow.hover();
  await firstRow.locator('button').last().click();
  await expect.poll(async () => (await tubeState()).sceneVisible, { timeout: 10_000 }).toBe(true);

  // 再藏一段，然后单元级眼睛隐 → 显：整条 BRAN 照 refno 走，逐段隐藏被清掉、这一段跟着亮回来
  await firstRow.hover();
  await firstRow.locator('button').last().click();
  await expect.poll(async () => (await tubeState()).hidden, { timeout: 10_000 }).toBe(true);
  const unitRow = rowById(page, unit.refno);
  await unitRow.hover();
  await unitRow.locator('button').last().click();
  await expect.poll(async () => (await tubeState()).sceneVisible, { timeout: 10_000 }).toBe(false);
  await unitRow.hover();
  await unitRow.locator('button').last().click();
  await expect.poll(async () => (await tubeState()).sceneVisible, { timeout: 10_000 }).toBe(true);
  expect((await tubeState()).hidden, '单元级动作一来逐段隐藏作废').toBe(false);

  expect(pageErrors).toEqual([]);
});
