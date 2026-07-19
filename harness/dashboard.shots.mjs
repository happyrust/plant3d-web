// Scenario for harness/dashboard.html — dashboard family runtime evidence (#44).
// DashboardOverview data flows through real fetch paths; every backend endpoint
// it touches is mocked here (works for both same-origin and localhost:3100
// absolute URLs because routes match by pathname).

const j = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60_000).toISOString();

const task = (o) => ({
  modelId: 'model-1',
  modelName: 'AvevaMarineSample',
  requesterId: 'SJ',
  requesterName: '王设计师',
  checkerId: 'JH',
  checkerName: '张校对员',
  reviewerId: 'JH',
  reviewerName: '张校对员',
  createdAt: now - 86_400_000,
  updatedAt: now - 3_600_000,
  ...o,
});

const tasks = [
  task({ id: 'rt-1', title: '结构管廊 D 区补强校审', status: 'in_review', priority: 'high', currentNode: 'jd', updatedAt: now - 1_800_000 }),
  task({ id: 'rt-2', title: '管道坡度批量修订校审', status: 'submitted', priority: 'medium', currentNode: 'sj', updatedAt: now - 7_200_000 }),
  task({ id: 'rt-3', title: '设备基础调整校审', status: 'rejected', priority: 'low', currentNode: 'sj', updatedAt: now - 10_800_000 }),
];

const activities = [
  { id: 'act-1', source: 'review', userId: 'JH', userName: '张校对员', userType: 'human', actionTitle: '通过了校对', targetName: '结构管廊 D 区补强', actionDesc: '2 条批注待设计确认', createdAt: '30 分钟前' },
  { id: 'act-2', source: 'task', userId: 'bot', userName: 'ModelGen', userType: 'system_bot', actionTitle: '完成了模型生成', targetName: 'AvevaMarineSample DB1112', actionDesc: '', createdAt: '1 小时前' },
  { id: 'act-3', source: 'review', userId: 'SH', userName: '李审核员', userType: 'human', actionTitle: '驳回了审核', targetName: '设备基础调整', actionDesc: '基础间距不满足规范', createdAt: '2 小时前' },
];

export const viewport = { width: 1480, height: 1020 };

export async function routes(page) {
  // Playwright matches routes in REVERSE registration order — register the
  // generic catch-all FIRST so the specific endpoint mocks below win.
  await page.route((url) => url.pathname.startsWith('/api/'), (r) => r.fulfill(j({ success: true, data: null })));
  await page.route((url) => url.pathname === '/api/projects', (r) => r.fulfill(j({
    items: [
      { id: 'AvevaMarineSample', name: 'AvevaMarineSample', env: '船舶样例工程', updated_at: iso(40) },
      { id: 'PowerPlantDemo', name: 'PowerPlantDemo', env: '电厂演示工程', updated_at: iso(360) },
      { id: 'OffshoreModuleA', name: 'OffshoreModuleA', env: '海工模块 A', updated_at: iso(2880) },
    ],
    total: 3, page: 1, per_page: 50,
  })));
  await page.route((url) => url.pathname === '/api/users/me', (r) => r.fulfill(j({ success: false, error_message: 'harness: use local mock user' })));
  await page.route((url) => url.pathname === '/api/review/tasks', (r) => r.fulfill(j({ success: true, tasks })));
  await page.route((url) => url.pathname === '/api/status', (r) => r.fulfill(j({
    cpu_usage: 23.5, memory_usage: 41.8, active_tasks: 2, queued_task_count: 1,
    database_connected: true, surrealdb_connected: true, uptime: { secs: 86_400 },
  })));
  await page.route((url) => url.pathname === '/api/dashboard/activities', (r) => r.fulfill(j({ success: true, data: activities })));
}

export async function run({ page, shot }) {
  try {
    await page.waitForSelector('[data-testid="dashboard-quick-action-sites"]', { timeout: 15000 });
    // Metric cards leave the loading skeleton once /api/status lands.
    await page.waitForSelector('#host-overview >> text=运行中任务', { timeout: 15000 });
  } catch {
    console.log('!! overview missing; body:', (await page.locator('body').innerText()).slice(0, 300));
  }
  await page.waitForTimeout(800);

  await shot('01-overview-top', '#host-overview');

  // Task list with status/priority badges: designer sees own tasks under "我发起的任务".
  try {
    await page.locator('#host-overview button', { hasText: '我发起的任务' }).click();
    await page.waitForTimeout(400);
    await shot('02-overview-my-tasks', '#host-overview');
  } catch (e) {
    console.log('task tab step failed:', String(e).slice(0, 160));
  }

  // Scroll to recent projects section.
  try {
    await page.evaluate(() => {
      const scrollable = document.querySelector('#host-overview .overflow-y-auto');
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    });
    await page.waitForTimeout(300);
    await shot('03-overview-projects', '#host-overview');
  } catch (e) {
    console.log('scroll step failed:', String(e).slice(0, 160));
  }
}
