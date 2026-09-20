/**
 * 空间查询抽屉 · gen-model-v1 源真机回归。
 *
 * 由 plan `docs/plans/2026-09-13-spatial-range-query-gen-model-v1-memory-tree-plan.md` §7
 * 「功能测试记录（2026-09-14 01:30）」那批 `%TEMP%\spatial-ui-*.mjs` 脚本（32 项自动检查 + headed 补核的「拾取中心」）
 * 整理而来，用例逐条对应那份记录：手输坐标 / 形状 / 排序、翻页、过滤、当前选中（BRAN 子树盒 · 叶子 · owner 兜底）、
 * 结果动作（全部显示 / 隔离 / 恢复 / 眼睛 / 飞行 / 复制 / 加载当前页）、大数量确认框、距离查询、错误路径、URL 入口、拾取中心。
 *
 * 数量断言一律**取自服务端响应**而不写死（记录里的 16 / 1387 项是当时那棵 54 979 条的树给的；换台服务数字就不同）：
 * 翻页 / 确认框这类要「结果够多」的用例在结果不够时 `test.skip` 说明原因。
 *
 * 前置：gen-model 在 `GEN_MODEL_V1_BASE_URL`（缺省 `http://127.0.0.1:8022`）、空间树 ready、服务认得 AvevaMarineSample（7997）；
 * 页面走 Playwright `baseURL` 的 Vite dev server。不满足就整文件跳过。想轻一点：`--workers=1`；「拾取中心」只在 `--headed` 下跑。
 *
 * 状态：**2026-09-20 真机跑过一遍**——dev `:3111` + `:8027`（`gen-model-model-cache@805170bd4` release、mem 档、`room_membership=true`、
 * 7997 整库 ensure 后 61 807 条），`--workers=1` 下 9 passed / 1 skipped（拾取中心要 `--headed`）。当天顺手修的三处不是功能问题：
 * 裸 `import('/src/…')` 在 HMR 过的 dev 上另起模块实例（改经 `__appModuleUrl`）、Windows 剪贴板 CRLF、
 * 树里同一 refno 多条条目时 store 按 refno 去重（比对按去重后的集合）。记录见
 * `docs/verification/spatial-query-room-discipline-2026-09-20/README.md` §3。
 */
import { expect, test } from '@playwright/test';

import {
  FIXTURE,
  GEN_MODEL_BASE,
  errorBanner,
  expandAdvanced,
  expandResults,
  expectPointClose,
  expectedRowOrder,
  fetchServerCenter,
  fillCenter,
  nextNearby,
  openSpatialUiPage,
  paramPoint,
  probeGenModelForSpatialUi,
  readNearby,
  readStoreState,
  readSummary,
  resultRow,
  resultRowRefnos,
  sceneObjectStates,
  sceneOverview,
  selectRefno,
  setPageLimit,
  setRadiusMeters,
  submitAndCapture,
  toSlashRefno,
  waitForSettled,
  type NearbyResponseBody,
} from './helpers/spatialQueryGenModelV1';

test.setTimeout(300_000);

test.beforeEach(async () => {
  const reason = await probeGenModelForSpatialUi();
  test.skip(reason !== null, reason ?? '');
});

/** 服务端页里的 refno（v1 一律 `a_b`）。 */
function serverRefnos(body: NearbyResponseBody): string[] {
  return (body.results ?? []).map((item) => item.refno);
}

test('范围 · 手输坐标：球形 2 m 发 x/y/z + shape + per_page，摘要与行序对得上服务端页，v1 源有覆盖面提示、专业筛选 / 房间块 / 「按专业」在（ADR 0067）；立方体 ≥ 球形；排序参数透传：按距离非降、按专业发 spec_distance 且页内 spec_value 非降', async ({ page }) => {
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'range' });
  const center = await fetchServerCenter(FIXTURE.bran);
  expect(center, `nearby?refno=${toSlashRefno(FIXTURE.bran)} 应给出 refno_aabb_center`).not.toBeNull();

  await fillCenter(page, center!);
  await setRadiusMeters(page, 2);
  await setPageLimit(page, 20);

  const sphere = await submitAndCapture(page);
  expect(sphere.status).toBe(200);
  expectPointClose(paramPoint(sphere.params), center!, 0.01);
  expect(sphere.params.get('radius')).toBe('2000');
  expect(sphere.params.get('shape')).toBe('sphere');
  expect(sphere.params.get('per_page')).toBe('20');
  expect(sphere.params.get('page')).toBe('1');
  expect(sphere.params.has('refno')).toBe(false);
  expect(sphere.body.total_count ?? 0).toBeGreaterThan(0);

  // 摘要 = 服务端 total_count + 本地独有项（已加载但树里没有的 TUBI，P5 追加在第 1 页末尾）
  const summary = await readSummary(page);
  const store = await readStoreState(page);
  const viewerLocal = store.items.filter((item) => item.matchedBy === 'viewer-local');
  expect(summary.total).toBe((sphere.body.total_count ?? 0) + viewerLocal.length);
  expect(summary.currentPage).toBe((sphere.body.returned_count ?? 0) + viewerLocal.length);
  // store 里服务端条目沿用服务端页序，本地独有接在后面。按 refno 去重后比：整库 ensure 过的树里同一 refno 会有多条条目
  // （2026-09-20 :8027 上 61 807 条 / 47 751 个 refno，见 docs/verification/spatial-query-room-discipline-2026-09-20），store 按 refno 合并成一条
  const serverPageUnique = [...new Set(serverRefnos(sphere.body))];
  expect(store.items.slice(0, serverPageUnique.length).map((item) => item.refno)).toEqual(serverPageUnique);

  await expandResults(page);
  expect(await resultRowRefnos(page)).toEqual(expectedRowOrder(store.items));
  await expect(page.getByTestId('spatial-coverage-hint')).toBeVisible();

  // 立方体：边长 2r 的盒包住同半径的球，命中只多不少
  await expandAdvanced(page);
  // ADR 0067（2026-09-20）：v1 源也有专业维度（服务端按 SITE 名派生）与房间过滤块——此前这里断言两者**不存在**。
  // 房间块画不画只看源认不认（v1 认）；服务端此刻能不能（room_membership 开关 / 模型就绪）是块里的一句话，不在这里断言。
  await expect(page.getByTestId('spec-filter')).toBeVisible();
  await expect(page.getByTestId('room-filter')).toHaveCount(1);
  await expect(page.getByTestId('spatial-sort-specThenDistance')).toBeVisible();
  await page.getByRole('button', { name: '立方体', exact: true }).click();
  const cube = await submitAndCapture(page, (params) => params.get('shape') === 'cube');
  expect(cube.status).toBe(200);
  expect(cube.body.total_count ?? 0).toBeGreaterThanOrEqual(sphere.body.total_count ?? 0);
  await page.getByRole('button', { name: '球形', exact: true }).click();

  // 改排序：已有结果时立刻沿用同一请求重查（P1），只换 sort
  const byName = nextNearby(page, (params) => params.get('sort') === 'name');
  await page.getByTestId('spatial-sort-nameAsc').click();
  expect((await byName).status).toBe(200);
  // v1 只为本页补名字、全集按 Noun / Refno 近似排：按钮下方有提示
  await expect(page.getByTestId('spatial-sort-name-hint')).toBeVisible();

  const byDistance = nextNearby(page, (params) => params.get('sort') === 'distance');
  await page.getByTestId('spatial-sort-distanceAsc').click();
  const distances = ((await byDistance).body.results ?? []).map((item) => item.distance);
  for (let i = 1; i < distances.length; i += 1) {
    expect(distances[i]!, `距离序第 ${i} 项`).toBeGreaterThanOrEqual(distances[i - 1]!);
  }
  await expect(page.getByTestId('spatial-sort-name-hint')).toHaveCount(0);

  // 「按专业」：适配器同名直通 sort=spec_distance（2026-09-20 起服务端认这一档），页内 spec_value 非降、同专业内距离非降
  const bySpec = nextNearby(page, (params) => params.get('sort') === 'spec_distance');
  await page.getByTestId('spatial-sort-specThenDistance').click();
  const specPage = (await bySpec).body.results ?? [];
  for (let i = 1; i < specPage.length; i += 1) {
    const prev = specPage[i - 1]!;
    const next = specPage[i]!;
    expect(next.spec_value ?? 0, `专业序第 ${i} 项`).toBeGreaterThanOrEqual(prev.spec_value ?? 0);
    if ((next.spec_value ?? 0) === (prev.spec_value ?? 0)) {
      expect(next.distance, `同专业第 ${i} 项按距离`).toBeGreaterThanOrEqual(prev.distance);
    }
  }
  await page.getByTestId('spatial-sort-distanceAsc').click();

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('翻页：下一页发 page=2、首条换了、总数不变；上一页回到 page=1 首条复原', async ({ page }) => {
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'range' });
  const center = (await fetchServerCenter(FIXTURE.bran))!;
  await fillCenter(page, center);
  await setRadiusMeters(page, 5);
  await setPageLimit(page, 5);

  const first = await submitAndCapture(page);
  expect(first.status).toBe(200);
  test.skip(!first.body.has_more, `5 m 内只有 ${first.body.total_count} 项，不够翻页`);
  const firstSummary = await readSummary(page);
  const firstRefnos = serverRefnos(first.body);
  // 第 1 页的「共 N 项」= 服务端 total_count + 本地独有项（P5 只追加在第 1 页）
  const firstLocal = (await readStoreState(page)).items.filter((item) => item.matchedBy === 'viewer-local').length;
  expect(firstSummary.total).toBe((first.body.total_count ?? 0) + firstLocal);

  await expandResults(page);
  const next = nextNearby(page, (params) => params.get('page') === '2');
  await page.getByTestId('spatial-result-page-next').click();
  const second = await next;
  expect(second.status).toBe(200);
  expect(second.params.get('per_page')).toBe('5');
  expectPointClose(paramPoint(second.params), center, 0.01);
  expect(serverRefnos(second.body)[0]).not.toBe(firstRefnos[0]);
  // 服务端总数不变；第 2 页不再追加本地独有项，摘要就是服务端的数
  expect(second.body.total_count).toBe(first.body.total_count);
  expect((await readSummary(page)).total).toBe(second.body.total_count);
  await expect(page.getByText(/第 2 \/ \d+ 页/)).toBeVisible();

  const prev = nextNearby(page, (params) => params.get('page') === '1');
  await page.getByTestId('spatial-result-page-prev').click();
  const back = await prev;
  expect(serverRefnos(back.body)).toEqual(firstRefnos);
  await expect(page.getByText(/第 1 \/ \d+ 页/)).toBeVisible();

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('过滤：Noun 类型透传且 total_count = filter_options 里该 noun 的计数；关键字只命中含它的 refno；「显示负实体」翻 include_negative', async ({ page }) => {
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'range' });
  const center = (await fetchServerCenter(FIXTURE.bran))!;
  await fillCenter(page, center);
  await setRadiusMeters(page, 5);
  await setPageLimit(page, 20);

  const baseline = await submitAndCapture(page);
  expect(baseline.status).toBe(200);
  expect(baseline.params.get('include_negative')).toBe('false');
  expect(baseline.params.has('nouns')).toBe(false);
  expect(baseline.params.has('keyword')).toBe(false);
  const total = baseline.body.total_count ?? 0;
  const nounOptions = (baseline.body.filter_options?.nouns ?? []).filter((noun) => noun.count > 0 && noun.count < total);
  test.skip(nounOptions.length === 0, '5 m 内只有一种 noun，过滤前后没差别可断');
  const noun = nounOptions.sort((a, b) => b.count - a.count)[0]!;

  await expandAdvanced(page);
  await page.getByLabel('Noun 类型（逗号分隔）').fill(noun.value.toLowerCase());
  const filtered = await submitAndCapture(page, (params) => params.has('nouns'));
  expect(filtered.params.get('nouns')).toBe(noun.value);
  expect(filtered.body.total_count).toBe(noun.count);
  expect((filtered.body.results ?? []).every((item) => item.noun.toUpperCase() === noun.value.toUpperCase())).toBe(true);
  expect(filtered.body.total_count!).toBeLessThan(total);

  await page.getByLabel('Noun 类型（逗号分隔）').fill('');
  const target = serverRefnos(baseline.body)[0]!;
  await page.getByTestId('spatial-keyword-input').fill(target);
  const keyword = await submitAndCapture(page, (params) => params.get('keyword') === target);
  expect(keyword.params.has('nouns')).toBe(false);
  expect(serverRefnos(keyword.body)).toContain(target);
  expect(serverRefnos(keyword.body).every((refno) => refno.includes(target))).toBe(true);

  await page.getByTestId('spatial-keyword-input').fill('');
  await page.getByTestId('include-negative-checkbox').check();
  const negative = await submitAndCapture(page, (params) => params.get('include_negative') === 'true');
  expect(negative.status).toBe(200);
  expect(negative.params.has('keyword')).toBe(false);

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('当前选中：BRAN 取子树盒中心 = 服务端 refno_aabb_center；叶子 VALV 同理；没加载几何的 PIPE 走 refno 兜底由服务端解中心，解完摘要回到坐标', async ({ page }) => {
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'range' });
  await setRadiusMeters(page, 1);
  await setPageLimit(page, 20);
  await page.getByRole('button', { name: '当前选中', exact: true }).click();

  // BRAN：查看器 getSubtreeAABB（自己的隐含管子 ∪ 成员）= 服务端子树并集盒（plan §7 B4 追查后 `11d21e8`）
  const branCenter = (await fetchServerCenter(FIXTURE.bran))!;
  await selectRefno(page, FIXTURE.bran);
  await page.getByRole('button', { name: '使用当前选中', exact: true }).click();
  let store = await readStoreState(page);
  expect(store.selectedCenterRefno).toBeNull();
  expectPointClose(store.center, branCenter, 1);
  const branQuery = await submitAndCapture(page);
  expect(branQuery.status).toBe(200);
  expect(branQuery.params.has('refno')).toBe(false);
  expectPointClose(paramPoint(branQuery.params), branCenter, 1);
  expect(branQuery.params.get('radius')).toBe('1000');

  // 叶子：只有自己一个对象，两边的盒就是同一个
  const valvCenter = await fetchServerCenter(FIXTURE.leafValv);
  expect(valvCenter, `VALV ${FIXTURE.leafValv} 应在服务端空间树里`).not.toBeNull();
  await selectRefno(page, FIXTURE.leafValv);
  await page.getByRole('button', { name: '使用当前选中', exact: true }).click();
  store = await readStoreState(page);
  expectPointClose(store.center, valvCenter!, 1);

  // owner 兜底：PIPE 自身与成员都没加载几何 → 记 refno，摘要说明，提交发 refno= 让服务端解中心（方案 3，`12ac0f7`）
  await selectRefno(page, FIXTURE.ownerPipe);
  await page.getByRole('button', { name: '使用当前选中', exact: true }).click();
  await expect(page.getByText(`${FIXTURE.ownerPipe} · 未加载几何，查询时由服务端解中心`)).toBeVisible();
  store = await readStoreState(page);
  expect(store.selectedCenterRefno).toBe(FIXTURE.ownerPipe);

  const pipeQuery = await submitAndCapture(page, (params) => params.has('refno'));
  expect(pipeQuery.status).toBe(200);
  expect(pipeQuery.params.get('refno')).toBe(toSlashRefno(FIXTURE.ownerPipe));
  expect(pipeQuery.params.get('include_self')).toBe('false');
  expect(pipeQuery.params.has('x')).toBe(false);
  expect(pipeQuery.body.center?.source).toBe('refno_aabb_center');
  // 服务端 center 写回草稿、标记清掉，摘要改显示坐标
  await expect(page.getByText('未加载几何，查询时由服务端解中心')).toHaveCount(0);
  store = await readStoreState(page);
  expect(store.selectedCenterRefno).toBeNull();
  expectPointClose(store.center, pipeQuery.body.center!, 0.01);
  await readSummary(page);

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('结果动作：全部显示 → 结果全可见；隔离 → 其余 X-Ray；恢复 → X-Ray 清零；单行眼睛；飞行定位选中目标；复制当前页 Refno；加载当前页把未加载清零；全程无错误横幅', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'range' });
  const center = (await fetchServerCenter(FIXTURE.bran))!;
  await fillCenter(page, center);
  await setRadiusMeters(page, 2);
  await setPageLimit(page, 100);

  const query = await submitAndCapture(page);
  expect(query.status).toBe(200);
  const summary = await readSummary(page);
  expect(summary.total).toBeGreaterThan(0);
  await expandResults(page);

  const items = (await readStoreState(page)).items;
  const refnos = items.map((item) => item.refno);
  const resultSet = new Set(refnos);

  // 全部显示：每个结果 refno 在场景里都有对象且可见
  await page.getByRole('button', { name: '全部显示', exact: true }).click();
  await expect.poll(async () => {
    const states = await sceneObjectStates(page, refnos);
    return refnos.every((refno) => states[refno]!.present && states[refno]!.visible);
  }, { timeout: 30_000 }).toBe(true);

  // 隔离结果：结果之外的对象全部 X-Ray，结果自己不 X-Ray
  await page.getByRole('button', { name: '隔离结果', exact: true }).click();
  await expect.poll(async () => {
    const overview = await sceneOverview(page);
    const others = overview.objectIds.filter((id) => !resultSet.has(id));
    const xrayed = new Set(overview.xrayedIds);
    return others.length > 0 && others.every((id) => xrayed.has(id)) && refnos.every((refno) => !xrayed.has(refno));
  }, { timeout: 15_000 }).toBe(true);

  // 恢复场景：X-Ray 清零
  await page.getByRole('button', { name: '恢复场景', exact: true }).click();
  await expect.poll(async () => (await sceneOverview(page)).xrayedIds.length, { timeout: 15_000 }).toBe(0);

  // 单行眼睛：隐藏一项再放回
  const loadedItem = items.find((item) => item.loaded) ?? items[0]!;
  const row = resultRow(page, loadedItem.refno);
  await row.getByTitle('隐藏').click();
  await expect.poll(async () => (await sceneObjectStates(page, [loadedItem.refno]))[loadedItem.refno]!.visible).toBe(false);
  await row.getByTitle('显示').click();
  await expect.poll(async () => (await sceneObjectStates(page, [loadedItem.refno]))[loadedItem.refno]!.visible).toBe(true);

  // 飞行定位：目标被选中且可见
  await page.locator(`[data-testid="locate-spatial-result"][data-refno="${loadedItem.refno}"]`).click();
  await expect.poll(async () => {
    const state = (await sceneObjectStates(page, [loadedItem.refno]))[loadedItem.refno]!;
    return state.selected && state.visible;
  }, { timeout: 30_000 }).toBe(true);

  // 复制当前页 Refno：剪贴板一行一个，按 store 里当前页的顺序（服务端页序 + 末尾的本地独有项；`copyCurrentPageRefnos` 取
  // `pagedResultItems`，不是分组后的 DOM 顺序——按专业分组时两者不同），条数与结果区行数相同
  const rows = await resultRowRefnos(page);
  await page.getByTestId('copy-current-page-refnos').click();
  await expect(page.getByText(`已复制 ${rows.length} 个当前页 Refno`)).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  // Windows 上 Chrome 剪贴板回读的是 CRLF
  const copied = clipboard.split(/\r?\n/);
  expect(copied).toEqual(refnos);
  expect([...copied].sort()).toEqual([...rows].sort());

  // 加载当前页：这一页的未加载全部补上
  await page.getByRole('button', { name: '加载当前页', exact: true }).click();
  await expect.poll(async () => (await readSummary(page)).unloaded, { timeout: 180_000, intervals: [1000, 2000, 5000] }).toBe(0);
  const after = await readSummary(page);
  // 「已加载」按 store 里的条目数（按 refno 去重）算；摘要的「当前页 N 项」是服务端 returned_count，树里同一 refno 有多条条目时
  // 两个数不相等（2026-09-20 :8027 上 37 vs 22，见 docs/verification/spatial-query-room-discipline-2026-09-20 的顺手发现），不是没加载完
  expect(after.loaded).toBe((await readStoreState(page)).items.length);

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('大数量确认：「只加载未加载」超过 200 项先弹确认框并显示数量；取消后不发 ensure / records、摘要不变', async ({ page }) => {
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'range' });
  const center = (await fetchServerCenter(FIXTURE.bran))!;
  await fillCenter(page, center);
  await setRadiusMeters(page, 100);
  await setPageLimit(page, 20);

  const query = await submitAndCapture(page);
  expect(query.status).toBe(200);
  const summary = await readSummary(page);
  const loadedInViewer = (await sceneOverview(page)).loadedRefnos.length;
  test.skip(summary.total - loadedInViewer <= 200, `100 m 内共 ${summary.total} 项、已加载 ${loadedInViewer}，凑不出 > 200 个待加载`);
  const fullCount = (await readStoreState(page)).fullMatchesCount;
  expect(fullCount, '有翻页时应先取回完整命中集合').not.toBeNull();

  const loadRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/api\/v1\/(model\/ensure|model\/records|meshes\/)/.test(url) || /\/api\/v1\/dbnums\/\d+\/model\//.test(url)) {
      loadRequests.push(url);
    }
  });

  await page.getByRole('button', { name: '只加载未加载', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('加载数量较多');
  const message = (await dialog.textContent()) ?? '';
  const matched = message.match(/将加载 (\d+) 个模型（超过 200 个）/);
  expect(matched, `确认框正文应带数量：${message}`).toBeTruthy();
  const count = Number(matched![1]);
  expect(count).toBeGreaterThan(200);
  expect(count).toBeLessThanOrEqual(fullCount!);
  await expect(dialog.getByRole('button', { name: `加载 ${count} 个` })).toBeVisible();

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(1_500);
  expect(loadRequests, loadRequests.join('\n')).toEqual([]);
  expect(await readSummary(page)).toEqual(summary);

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('距离 · 通过 Refno：发 refno= + include_self=false，中心行给 refno_aabb_center，结果不含源构件，每行带净距标注按钮；通过坐标走点模式', async ({ page }) => {
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'distance' });
  await page.getByRole('button', { name: '通过 Refno', exact: true }).click();
  await page.getByPlaceholder(/例如：24381_100818/).fill(FIXTURE.bran);
  await setRadiusMeters(page, 5);
  await setPageLimit(page, 20);

  const byRefno = await submitAndCapture(page, (params) => params.has('refno'));
  expect(byRefno.status).toBe(200);
  expect(byRefno.params.get('refno')).toBe(toSlashRefno(FIXTURE.bran));
  expect(byRefno.params.get('include_self')).toBe('false');
  expect(byRefno.params.has('x')).toBe(false);
  expect(byRefno.body.center?.source).toBe('refno_aabb_center');
  const summary = await readSummary(page);
  expect(summary.total).toBeGreaterThan(0);

  await expandResults(page);
  const centerRow = page.getByTestId('spatial-result-center');
  await expect(centerRow).toContainText('refno_aabb_center');
  await expect(centerRow).toContainText(FIXTURE.bran);
  await expect(centerRow).toContainText(`中心 ${byRefno.body.center!.x.toFixed(0)}, ${byRefno.body.center!.y.toFixed(0)}, ${byRefno.body.center!.z.toFixed(0)}`);
  const rows = await resultRowRefnos(page);
  expect(rows).not.toContain(FIXTURE.bran);
  expect(serverRefnos(byRefno.body)).not.toContain(FIXTURE.bran);
  await expect(page.locator('[data-testid="spatial-result-group"] button[title="按管径净距标注"]')).toHaveCount(rows.length);

  // 通过坐标：点模式，发 x/y/z 不发 refno
  const center = byRefno.body.center!;
  await fillCenter(page, center, { source: '通过坐标' });
  const byPoint = await submitAndCapture(page, (params) => params.has('x'));
  expect(byPoint.status).toBe(200);
  expect(byPoint.params.has('refno')).toBe(false);
  expectPointClose(paramPoint(byPoint.params), center, 0.01);
  expect(byPoint.body.center?.source).toBe('position');

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('错误路径：树里没有的 refno 折成「…还没生成过模型」提示；refno 为空时「执行空间查询」禁用；整轮无 pageerror', async ({ page }) => {
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'distance', withModel: false });
  await page.getByRole('button', { name: '通过 Refno', exact: true }).click();
  const refnoInput = page.getByPlaceholder(/例如：24381_100818/);
  await refnoInput.fill(FIXTURE.missing);
  await setRadiusMeters(page, 5);

  const missing = await submitAndCapture(page, (params) => params.get('refno') === toSlashRefno(FIXTURE.missing));
  expect(missing.status).toBe(404);
  await expect(page.getByText(`构件 ${FIXTURE.missing} 还没有生成过模型，空间索引里没有它的包围盒；请先显示该构件，再按距离查询`)).toBeVisible();

  await refnoInput.fill('');
  await expect(page.getByRole('button', { name: '执行空间查询', exact: true })).toBeDisabled();
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('URL 入口：spatial_refno + spatial_radius(m) + spatial_autorun 自动打开抽屉并按 refno / 2000 mm 发一次查询', async ({ page }) => {
  const pending = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v1/spatial/nearby') && url.searchParams.get('refno') === toSlashRefno(FIXTURE.bran);
  }, { timeout: 120_000 });
  const { pageErrors } = await openSpatialUiPage(page, {
    mode: null,
    withModel: false,
    extraParams: {
      spatial_refno: FIXTURE.bran,
      spatial_radius: '2',
      spatial_radius_unit: 'm',
      spatial_autorun: '1',
    },
  });

  const autorun = await readNearby(await pending);
  await waitForSettled(page);
  expect(autorun.status).toBe(200);
  expect(autorun.params.get('radius')).toBe('2000');
  expect(autorun.params.get('shape')).toBe('sphere');
  await expect(page.getByRole('button', { name: '执行空间查询', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByPlaceholder(/例如：24381_100818/)).toHaveValue(FIXTURE.bran);
  await readSummary(page);

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

test('拾取中心（仅 headed）：点到构件表面后摘要换成拾取点，查 1 m 的请求中心就是它，被点的构件在结果里且距离 0', async ({ page }) => {
  test.skip(test.info().project.use.headless !== false, 'headless SwiftShader 下拾取无命中（plan §7 01:38 记录），要 --headed 跑');
  const { pageErrors } = await openSpatialUiPage(page, { mode: 'range' });
  await setRadiusMeters(page, 1);
  await setPageLimit(page, 20);
  await page.getByRole('button', { name: '拾取中心', exact: true }).click();

  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  // 相机已由 show_refno 对准 BRAN：在画布上按 5×5 网格采样。未命中时工具模式保持 pick_query_center，不用重新武装；
  // 命中的若是隐含管子（entityId 归到 BRAN，树里只存叶子、没有 BRAN 的盒）就重新武装再采下一点，直到点到服务端认得的构件。
  const fractions = [0.5, 0.4, 0.6, 0.3, 0.7];
  const samples = fractions.flatMap((fy) => fractions.map((fx) => ({ x: box.width * fx, y: box.height * fy })));
  const readPicked = () => page.evaluate(() =>
    import((window as Window & { __appModuleUrl?: (path: string) => string }).__appModuleUrl?.('/src/composables/useToolStore.ts') ?? '/src/composables/useToolStore.ts').then((mod) => (mod.useToolStore().pickedQueryCenter.value ?? null) as { entityId: string } | null),
  );
  const hits: string[] = [];
  let pickedRefno: string | null = null;
  for (const position of samples) {
    await canvas.click({ position, force: true });
    const picked = await readPicked();
    if (!picked) continue;
    const refno = picked.entityId.startsWith('o:') ? picked.entityId.split(':')[1]! : picked.entityId;
    hits.push(refno);
    if (await fetchServerCenter(refno, { waitMs: 0 })) {
      pickedRefno = refno;
      break;
    }
    await page.getByRole('button', { name: '拾取中心', exact: true }).click();
  }
  expect(pickedRefno, `${samples.length} 个采样点没点到服务端认得的构件（命中过：${hits.join(', ') || '无'}）`).not.toBeNull();

  const store = await readStoreState(page);
  expect(store.rangeCenterSource).toBe('pick');
  expect(Math.hypot(store.center.x, store.center.y, store.center.z)).toBeGreaterThan(0);

  const query = await submitAndCapture(page);
  expect(query.status).toBe(200);
  expectPointClose(paramPoint(query.params), store.center, 0.01);
  expect(query.params.get('radius')).toBe('1000');

  // 表面点落在该构件盒内 → 服务端距离 0；同距的别的构件可能排前面，看全集
  const params = new URLSearchParams({ x: String(store.center.x), y: String(store.center.y), z: String(store.center.z), radius: '1000', per_page: '1000' });
  const full = await (await fetch(`${GEN_MODEL_BASE}/api/v1/spatial/nearby?${params.toString()}`)).json() as NearbyResponseBody;
  const hit = (full.results ?? []).find((item) => item.refno === pickedRefno);
  expect(hit, `被拾取的 ${pickedRefno} 应在 1 m 结果里`).toBeTruthy();
  // 表面点落在盒上 / 盒内：盒到点的表面距离为 0，留 1 mm 给浮点
  expect(hit!.distance).toBeLessThanOrEqual(1);

  await expect(errorBanner(page)).toHaveCount(0);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});
