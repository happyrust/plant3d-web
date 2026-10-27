/**
 * 增量更新案例集合 K 组的端到端那一截（gen-model `docs/plans/2026-10-27-plant3d-web-incremental-linkage-test-cases.md`）：
 * gen-model 数据批次落库 → 状态栏更新提示 → 点「重载」→ 场景里的几何与 E3D TTY 导出的 RVM 对得上。
 *
 * - 回放（K13 / K14，本机 nightly）：后端由 gen-model `scripts/replay/Start-LinkageReplayStack.ps1 -Case <链>` 拉起，
 *   `LINKAGE_REPLAY_STACK` 指向它写出的 stack.json；每一步由本 spec 自己调 `db_session_fixture replay-step`。
 *   RVM 真值由 `scripts/e3d/Export-ReplayRvmTruth.ps1` 事先导好，放在链夹具旁的 `rvm-truth/<sesno>.json`。
 * - 现场（K15，发版前）：`LINKAGE_LIVE_STACK` 指向 `-Live` 模式写出的 stack.json；每一腿调
 *   `scripts/e3d/Invoke-LinkageE3dLeg.ps1`（E3D TTY 施加变化 + 导出 RVM + rvm_verify import）。
 *
 * 两个变量都没设就整档跳过。场景坐标按 `dtx_recenter=0` 取真坐标；DTX 世界单位到 mm 的倍数由
 * `LINKAGE_SCENE_TO_MM` 给（缺省 1000，10-26 联动验证里 DTX 包围盒是米）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

type Stack = {
  mode: 'replay' | 'live';
  case: string;
  dbnum: number;
  base_sesno: number;
  base_url: string;
  output_project: string;
  gen_model_repo: string;
  run_dir: string;
  /** replay */
  fixture_exe?: string;
  fixture_args?: string[];
  work_file?: string;
  rvm_truth_dir?: string;
  /** live */
  leg_script?: string;
};

type Box = [number, number, number, number, number, number];

type RvmSnapshot = {
  meta: { dbnum: number; export_scope?: string; unresolved?: number };
  /**
   * `name` 是 RVM 组名：命名元素是 NAME，无名元素是 `BOX 1 of EQUIPMENT /x` 这种默认名；默认名的名词（短形态）、
   * 属主描述与序号 import 时已拆好（`noun` / `owner_desc` / `ordinal`）。
   */
  members: {
    name: string;
    noun: string | null;
    owner_desc: string | null;
    ordinal: number | null;
    refno: string | null;
    aabb_world_mm: number[] | null;
  }[];
};

const REPLAY_STACK = process.env.LINKAGE_REPLAY_STACK || '';
const LIVE_STACK = process.env.LINKAGE_LIVE_STACK || '';
const SCENE_TO_MM = Number(process.env.LINKAGE_SCENE_TO_MM || 1000);
const TOLERANCE_MM = 1;
/** 配置里没设 actionTimeout：点不到（被遮罩挡住等）时要快点红，不要等到整条用例超时。 */
const ACTION = { timeout: 30_000 };
/** ams8000-equi-move-chain 的靶：EQUI /1-LNR-Q005-PJ，几何在成员 24384_24777 名下 */
const MOVE_ROOT = '24384_24776';
/** db8000-two-delete（issue-019 链）的靶：25 删子件、根重算；26 整根删掉 */
const DELETE_ROOT = '24384_24778';

// 录像关掉：本机录像收尾（ffmpeg）会卡住 browserContext.close，用例本体跑完 runner 也退不出来；这组又长，关键点自己截图。
test.use({ video: 'off' });

function readStack(file: string): Stack {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Stack;
}

function lastJsonLine(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split(/\r?\n/).at(-1) ?? '{}';
  return JSON.parse(line) as Record<string, unknown>;
}

/** E3D SAVEWORK 的替身：把会话链就地推进到 `to`（同一个文件追加 + 改头，夹具带字节补丁）。 */
function replayStep(stack: Stack, to: number): Record<string, unknown> {
  if (!stack.fixture_exe || !stack.work_file || !stack.fixture_args) throw new Error('stack.json 不是回放形态');
  const stdout = execFileSync(
    stack.fixture_exe,
    ['replay-step', '--work', stack.work_file, ...stack.fixture_args, '--to', String(to)],
    // 夹具挂住时不能无限等：用例自己的 setTimeout 管不到同步子进程
    { encoding: 'utf8', timeout: 10 * 60_000 },
  );
  const receipt = lastJsonLine(stdout);
  console.log(`[linkage] replay-step ${to} ${JSON.stringify(receipt)}`);
  return receipt;
}

/** 工作文件当前停在哪一版（`inspect` 的 JSON 里的 `latest_sesno`）；读不出来返回 null。 */
function workSesno(stack: Stack): number | null {
  if (!stack.fixture_exe || !stack.work_file) return null;
  try {
    const stdout = execFileSync(
      stack.fixture_exe,
      ['inspect', '--source', stack.work_file],
      { encoding: 'utf8', timeout: 2 * 60_000 },
    );
    const report = JSON.parse(stdout.trim()) as { latest_sesno?: number };
    return typeof report.latest_sesno === 'number' ? report.latest_sesno : null;
  } catch {
    return null;
  }
}

/**
 * 回放是就地推进同一个 `work_file`：用例中途失败会把栈停在 727 / 730 / 25 / 26，下一跑 `waitInSync(base_sesno)` 就空等。
 * 所以每条用例结束（成功或失败）都要把夹具退回基线会话。
 *
 * 夹具对「往回走」要求显式 `--rollback`（`db_session_fixture replay-step` 的 `--rollback` 只在 `from > to` 时接受，
 * 前进时给它会报错），所以先读当前会话判断方向，再带上对应参数。
 */
function restoreReplayBaseline(): void {
  if (!REPLAY_STACK) return;
  let stack: Stack;
  try {
    stack = readStack(REPLAY_STACK);
  } catch {
    return;
  }
  if (!stack.fixture_exe || !stack.work_file || !stack.fixture_args) return;
  const current = workSesno(stack);
  if (current === stack.base_sesno) return;
  const backwards = current !== null && current > stack.base_sesno;
  try {
    execFileSync(
      stack.fixture_exe,
      [
        'replay-step',
        '--work', stack.work_file,
        ...stack.fixture_args,
        '--to', String(stack.base_sesno),
        ...(backwards ? ['--rollback'] : []),
      ],
      { encoding: 'utf8', timeout: 10 * 60_000 },
    );
    console.log(`[linkage] 退回基线会话 ${stack.base_sesno}（从 ${current ?? '未知'}）`);
  } catch (error) {
    console.warn(`[linkage] 退回基线会话 ${stack.base_sesno} 失败：${String(error)}`);
  }
}

/** 现场一腿：E3D TTY 施加（apply / restore）→ 只读导出 RVM → rvm_verify import；返回快照 JSON 路径。 */
function liveLeg(stack: Stack, leg: 'apply' | 'restore'): string {
  if (!stack.leg_script) throw new Error('stack.json 不是现场形态');
  const stdout = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', stack.leg_script, '-Leg', leg, '-StackFile', LIVE_STACK],
    { encoding: 'utf8', timeout: 30 * 60_000 },
  );
  const receipt = lastJsonLine(stdout);
  console.log(`[linkage] e3d leg ${leg} ${JSON.stringify(receipt)}`);
  return String(receipt.snapshot);
}

type DbnumRow = { dbnum?: number; applied_sesno?: number; model_sesno?: number; file_latest_sesno?: number };

async function dbnumRow(stack: Stack): Promise<DbnumRow | null> {
  try {
    const resp = await fetch(`${stack.base_url}/api/v1/dbnums`);
    if (!resp.ok) return null;
    const body = await resp.json() as { dbnums?: DbnumRow[] };
    return body.dbnums?.find((row) => row.dbnum === stack.dbnum) ?? null;
  } catch {
    return null;
  }
}

async function watermarks(stack: Stack): Promise<string> {
  const row = await dbnumRow(stack);
  return row ? `${row.applied_sesno}/${row.model_sesno}/${row.file_latest_sesno}` : 'no-row';
}

async function waitInSync(stack: Stack, sesno: number): Promise<void> {
  await expect.poll(() => watermarks(stack), { timeout: 5 * 60_000, intervals: [1000, 2000] })
    .toBe(`${sesno}/${sesno}/${sesno}`);
}

/**
 * 现场一腿写几个会话不定（SAVEWORK、QUIT 尾会话、导出那次登录的尾会话）：等三水位越过 `after`、齐平、且 10 s 内不再变，
 * 返回齐平时的会话号。只看「越过且齐平」会在上一腿迟到的尾会话上提前过关。
 */
async function waitQuiescentInSync(stack: Stack, after: number): Promise<number> {
  let last = '';
  let since = 0;
  let settled = 0;
  await expect.poll(async () => {
    const row = await dbnumRow(stack);
    const applied = row?.applied_sesno ?? 0;
    const inSync = !!row && applied > after && applied === row.model_sesno && applied === row.file_latest_sesno;
    const key = inSync ? String(applied) : '';
    const now = Date.now();
    if (key !== last) {
      last = key;
      since = now;
    }
    if (inSync && now - since >= 10_000) settled = applied;
    return settled > 0;
  }, { timeout: 10 * 60_000, intervals: [2000] }).toBe(true);
  return settled;
}

async function openViewer(page: Page, stack: Stack, refno: string): Promise<void> {
  const params = new URLSearchParams({
    output_project: stack.output_project,
    gm_backend: stack.base_url,
    show_refno: refno,
    dtx_recenter: '0',
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas', { timeout: 60_000 });
}

/** 场景里这个单元名下每个有可见对象的构件的世界包围盒（mm），按 refno（`a_b`）。 */
async function unitBoxesMm(page: Page, dbnum: number, root: string): Promise<Record<string, Box>> {
  return page.evaluate(async ({ dbnum: db, root: unit, scale }) => {
    // @ts-expect-error -- Vite dev server 上的浏览器端模块，和应用共用同一份运行时索引
    const loader = await import('/src/composables/useDbnoInstancesDtxLoader.ts');
    type Bounds = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number }; isEmpty(): boolean };
    const layer = (window as unknown as {
      __dtxLayer?: { getObjectBoundingBox(id: string): Bounds | null; isObjectVisible(id: string): boolean };
    }).__dtxLayer;
    const out: Record<string, [number, number, number, number, number, number]> = {};
    if (!layer) return out;
    for (const refno of loader.resolveDtxRefnosByUnitRefno(db, unit) as string[]) {
      let box: [number, number, number, number, number, number] | null = null;
      for (const id of loader.resolveDtxObjectIdsByRefno(db, refno) as string[]) {
        if (!layer.isObjectVisible(id)) continue;
        const b = layer.getObjectBoundingBox(id);
        if (!b || b.isEmpty()) continue;
        const next: [number, number, number, number, number, number] = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
        box = box
          ? [
            Math.min(box[0], next[0]), Math.min(box[1], next[1]), Math.min(box[2], next[2]),
            Math.max(box[3], next[3]), Math.max(box[4], next[4]), Math.max(box[5], next[5]),
          ]
          : next;
      }
      if (box) out[refno] = box.map((v) => v * scale) as [number, number, number, number, number, number];
    }
    return out;
  }, { dbnum, root, scale: SCENE_TO_MM });
}

function readRvmSnapshot(file: string): RvmSnapshot {
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8')) as RvmSnapshot;
  expect(snapshot.meta.export_scope, `${file} 的导出口径`).toBe('narrow');
  return snapshot;
}

function rvmTruthFile(stack: Stack, sesno: number): string {
  const file = path.join(stack.rvm_truth_dir ?? '', `${sesno}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`没有 RVM 真值 ${file}：先在 gen-model 跑 scripts/e3d/Export-ReplayRvmTruth.ps1 -Case ${stack.case} -Steps ${sesno}`);
  }
  return file;
}

const DEFAULT_NAME = /^(\S+)\s+(\d+)\s+of\s+(.+)$/;
const NAMED_OWNER = /^\S+\s+(\/.+)$/;

/** 服务当前会话的模型树里某节点的成员，按属主成员表的顺序。 */
async function treeChildren(stack: Stack, refno: string): Promise<{ refno: string; noun: string }[]> {
  const resp = await fetch(`${stack.base_url}/api/v1/tree/children?refno=${encodeURIComponent(refno.replace('_', '/'))}`);
  if (!resp.ok) return [];
  const body = await resp.json() as { nodes?: { refno: string; noun: string; order?: number }[] };
  return [...(body.nodes ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * E3D 默认名 `<名词> <n> of <属主>` → refno：属主是命名元素就查快照里已解析的名字，属主又是默认名就递归一层；
 * 再取属主成员表里同名词的第 n 个（与 gen-model `rvm_baseline::resolve` 同一口径，只是走 HTTP 树而不是直连库）。
 */
async function resolveDefaultName(
  stack: Stack,
  noun: string,
  ordinal: number,
  ownerDesc: string,
  named: Map<string, string>,
): Promise<string | null> {
  let owner: string | null = null;
  const nested = DEFAULT_NAME.exec(ownerDesc);
  if (nested) {
    owner = await resolveDefaultName(stack, nested[1]!.slice(0, 4).toUpperCase(), Number(nested[2]), nested[3]!, named);
  } else {
    const namedOwner = NAMED_OWNER.exec(ownerDesc);
    owner = namedOwner ? named.get(namedOwner[1]!) ?? null : null;
  }
  if (!owner) return null;
  const sameNoun = (await treeChildren(stack, owner)).filter((child) => child.noun.toUpperCase() === noun.toUpperCase());
  return sameNoun[ordinal - 1]?.refno.replace('/', '_') ?? null;
}

/** RVM 快照里带几何的成员 → refno（`a_b`）→ 包围盒（mm）。身份先用快照里已解析的 refno，再按默认名对模型树；解不出来的不放宽。 */
async function rvmBoxes(stack: Stack, snapshot: RvmSnapshot, what: string): Promise<Record<string, Box>> {
  const named = new Map<string, string>();
  for (const member of snapshot.members) {
    if (member.refno) named.set(member.name, member.refno.replace('/', '_'));
  }
  const out: Record<string, Box> = {};
  const unresolved: string[] = [];
  for (const member of snapshot.members) {
    if (!member.aabb_world_mm || member.aabb_world_mm.length !== 6) continue;
    let refno = member.refno ? member.refno.replace('/', '_') : null;
    if (!refno && member.noun && member.ordinal && member.owner_desc) {
      refno = await resolveDefaultName(stack, member.noun, member.ordinal, member.owner_desc, named);
    }
    if (refno) out[refno] = member.aabb_world_mm as Box;
    else unresolved.push(member.name);
  }
  expect(unresolved, `${what}：RVM 里带几何的成员对不上模型树`).toEqual([]);
  return out;
}

async function rvmTruth(stack: Stack, sesno: number): Promise<Record<string, Box>> {
  return rvmBoxes(stack, readRvmSnapshot(rvmTruthFile(stack, sesno)), `RVM@${sesno}`);
}

function fmt(box: Box): string {
  return `[${box.map((v) => v.toFixed(1)).join(', ')}]`;
}

/** 场景 vs RVM：构件一一对上、每个包围盒六个分量都在 1 mm 内。返回问题清单，空 = 对上。 */
function diffBoxes(scene: Record<string, Box>, truth: Record<string, Box>): string[] {
  const problems: string[] = [];
  for (const refno of Object.keys(truth).sort()) {
    if (!scene[refno]) problems.push(`场景里缺 ${refno}（RVM 有）`);
  }
  for (const refno of Object.keys(scene).sort()) {
    if (!truth[refno]) problems.push(`场景里多 ${refno}（RVM 没有）`);
  }
  for (const [refno, expected] of Object.entries(truth)) {
    const actual = scene[refno];
    if (!actual) continue;
    const worst = Math.max(...actual.map((v, i) => Math.abs(v - expected[i]!)));
    if (worst > TOLERANCE_MM) problems.push(`${refno} 包围盒差 ${worst.toFixed(2)} mm（场景 ${fmt(actual)} / RVM ${fmt(expected)}）`);
  }
  return problems;
}

async function expectSceneMatchesRvm(
  page: Page,
  stack: Stack,
  root: string,
  truth: Record<string, Box>,
  what: string,
  timeout = 60_000,
): Promise<void> {
  await expect.poll(async () => diffBoxes(await unitBoxesMm(page, stack.dbnum, root), truth), {
    message: `${what}：场景与 RVM 对拍`,
    timeout,
    intervals: [500, 1000, 2000],
  }).toEqual([]);
}

/** 属性面板的 POS 行（与 10-26 联动验证同一个读法）；还没渲染出来就是 null。 */
async function readPos(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // 只在属性面板里找：全文扫 tr/li/div 会把任何带 POS 的短元素都算成属性行
    const panel = document.querySelector('[data-testid="properties-panel"]');
    if (!panel) return null;
    for (const el of Array.from(panel.querySelectorAll('tr'))) {
      const text = ((el as HTMLElement).innerText ?? '').trim();
      if (/^POS\b/.test(text) && text.length < 120 && !text.includes('\n\n')) return text.replace(/\s+/g, ' ');
    }
    return null;
  });
}

/** show_refno 选中之后属性还要再拉一拍，场景对上时面板未必已经有 POS 行。 */
async function waitPos(page: Page, timeout = 60_000): Promise<string | null> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const pos = await readPos(page);
    if (pos || Date.now() > deadline) return pos;
    await page.waitForTimeout(500);
  }
}

/** 状态栏更新提示（testid 在 GenModelV1HealthBadge 上）。 */
function notice(page: Page) {
  return page.getByTestId('gen-model-v1-update-notice');
}

async function logNotice(page: Page, what: string): Promise<void> {
  const text = await page.getByTestId('gen-model-v1-update-notice-text').innerText();
  const title = (await notice(page).getAttribute('title')) ?? '';
  console.log(`[linkage] notice ${what}: ${text} | ${title.replace(/\n/g, ' / ')}`);
}

/**
 * 底部居中的 toast 盖在状态栏的更新提示上，而 Vuetify snackbar 在指针悬停时不计时：点完「重载」指针还停在状态栏，
 * 重载的 toast 恰好出在它底下、一直不消失。像人一样把指针挪开，等 toast 消失再点提示条。
 * 挪到视口右上角而不是固定 (640,300)：视口尺寸变了固定坐标可能仍落在状态栏上。
 */
async function clearToast(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.move(Math.round(size.width / 2), Math.round(size.height / 4));
  await expect(page.locator('.v-snackbar__wrapper').first()).toBeHidden({ timeout: 15_000 });
}

async function reloadFromNotice(page: Page): Promise<void> {
  await expect(notice(page)).toBeVisible({ timeout: 3 * 60_000 });
  await clearToast(page);
  await page.getByTestId('gen-model-v1-update-notice-reload').click(ACTION);
  await expect(notice(page)).toBeHidden({ timeout: 10_000 });
  await clearToast(page);
}

/** 视图 → 模型生成 → 按库。Ribbon 再点一次当前标签会把面板折起来，所以按钮已经看得见就不点标签。 */
async function openDbnumTab(page: Page): Promise<void> {
  const command = page.locator('[data-command="panel.modelGeneration"]').first();
  if (!(await command.isVisible())) await page.locator('[data-ribbon-tab="view"]').first().click(ACTION);
  await command.click(ACTION);
  await page.getByTestId('model-generation-tab-dbnum').click(ACTION);
}

/** 模型生成对话框是模态的，遮罩会挡住状态栏的「重载」。 */
async function closeDialog(page: Page): Promise<void> {
  await page.getByTestId('dialog-close').click(ACTION);
  await expect(page.getByTestId('model-generation-dialog')).toBeHidden();
}

/** 水位格：按 testid 定位，不按列下标——列顺序一变下标就读到别的格。 */
function dbRowWatermark(page: Page, dbnum: number) {
  return page.getByTestId(`model-generation-db-watermark-${dbnum}`);
}

/** 重载不生成：盯住 model/generate 与 model/ensure 的 POST。 */
function watchGenerateCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const pathname = new URL(request.url()).pathname;
    if (/\/api\/v1\/model\/(generate|ensure)$/.test(pathname) || /\/api\/v1\/dbnums\/\d+\/model\/ensure$/.test(pathname)) {
      calls.push(pathname);
    }
  });
  return calls;
}

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('增量更新 K 组：回放（L2）', () => {
  test.beforeEach(() => {
    test.skip(!REPLAY_STACK, '设 LINKAGE_REPLAY_STACK=<gen-model Start-LinkageReplayStack.ps1 写出的 stack.json> 才跑');
  });

  // 回放就地推进夹具：不管成功失败都要退回基线，否则下一跑 waitInSync(base_sesno) 空等。
  // afterEach 与用例共用同一份超时预算：用例挂到超时时剩余预算为 0，同步的恢复子进程会被同一个超时打断，
  // 恰好是这条修复要治的场景。给 hook 自己续一段预算。
  // Playwright 要求 hook 第一个参数是 fixture 解构模式（不能省略、也不能给空对象模式），这里不取 fixture，故禁用该规则。
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(({}, testInfo) => {
    if (testInfo.status === 'skipped') return;
    testInfo.setTimeout(testInfo.timeout + 10 * 60_000);
    restoreReplayBaseline();
  });

  test('K13 EQUI 上移 500 → 提示 → 重载 → 与 RVM@727 对拍；移回 → 提示、水位行自动到 730 → 重载 → 与 RVM@730 对拍', async ({ page }) => {
    const stack = readStack(REPLAY_STACK);
    test.skip(stack.case !== 'ams8000-equi-move-chain', `这条要 ams8000-equi-move-chain 的栈，当前是 ${stack.case}`);
    test.setTimeout(20 * 60_000);
    const pageErrors = watchPageErrors(page);
    const generateCalls = watchGenerateCalls(page);
    for (const sesno of [stack.base_sesno, 727, 730]) rvmTruthFile(stack, sesno);

    await waitInSync(stack, stack.base_sesno);
    const truthBase = await rvmTruth(stack, stack.base_sesno);
    await openViewer(page, stack, MOVE_ROOT);
    await expectSceneMatchesRvm(page, stack, MOVE_ROOT, truthBase, `${stack.base_sesno} 基线`, 3 * 60_000);
    const posBefore = await waitPos(page);
    expect(posBefore, '属性面板的 POS 行（show_refno 选中的 EQUI）').toMatch(/,\s*1400(\.0+)?$/);
    const generateBeforeReload = generateCalls.length;

    replayStep(stack, 727);
    await waitInSync(stack, 727);
    const truthUp = await rvmTruth(stack, 727);
    await expect(notice(page)).toBeVisible({ timeout: 3 * 60_000 });
    await expect(page.getByTestId('gen-model-v1-update-notice-text')).toContainText('库 8000 已更新到会话');
    await expect(page.getByTestId('gen-model-v1-update-notice-text')).toContainText('场景内 1 根受影响');
    await logNotice(page, '727');
    // 不点重载，场景不动：只提示、不被动重载
    expect(diffBoxes(await unitBoxesMm(page, stack.dbnum, MOVE_ROOT), truthBase)).toEqual([]);

    await reloadFromNotice(page);
    await expectSceneMatchesRvm(page, stack, MOVE_ROOT, truthUp, '727 重载后');
    expect(generateCalls.length, '重载不该触发生成').toBe(generateBeforeReload);
    await expect.poll(() => readPos(page), { timeout: 30_000 }).toMatch(/,\s*1900(\.0+)?$/);
    console.log(`[linkage] POS ${posBefore} -> ${await readPos(page)}`);

    await openDbnumTab(page);
    await expect(dbRowWatermark(page, stack.dbnum)).toContainText('727/727/727', { timeout: 60_000 });
    replayStep(stack, 730);
    await waitInSync(stack, 730);
    const truthBack = await rvmTruth(stack, 730);
    // 不点「刷新」，水位行跟着非本会话的批次自己变
    await expect(dbRowWatermark(page, stack.dbnum)).toContainText('730/730/730', { timeout: 60_000 });
    await expect(page.getByTestId('gen-model-v1-update-notice-text')).toContainText('→730', { timeout: 3 * 60_000 });
    await logNotice(page, '730');

    await closeDialog(page);
    await reloadFromNotice(page);
    await expectSceneMatchesRvm(page, stack, MOVE_ROOT, truthBack, '730 重载后');
    expect(generateCalls.length, '重载不该触发生成').toBe(generateBeforeReload);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    await page.screenshot({ path: path.join(stack.run_dir, 'k13-after-730-reload.png'), ...ACTION });
  });

  // issue-019 链里 EQUI 只有一个 BOX 子件：25 删掉它之后 EQUI 名下一条几何也不剩（RVM@25 几何 0），重载走的是「记录查空且收齐 → 撤下」；
  // 26 再删 EQUI 时场景里已没有它的对象，提示只说数据变了、不给重载。删掉的根还挂在场景里那条路由 L0 的 K08 覆盖。
  test('K14 删子件（根重算）→ 重载后子件撤下、与 RVM@25 对拍；整根删掉 → 只提示、无可重载、不生成', async ({ page }) => {
    const stack = readStack(REPLAY_STACK);
    test.skip(stack.case !== 'db8000-two-delete', `这条要 db8000-two-delete 的栈，当前是 ${stack.case}`);
    test.setTimeout(15 * 60_000);
    const pageErrors = watchPageErrors(page);
    const generateCalls = watchGenerateCalls(page);
    for (const sesno of [stack.base_sesno, 25]) rvmTruthFile(stack, sesno);

    await waitInSync(stack, stack.base_sesno);
    const truthBase = await rvmTruth(stack, stack.base_sesno);
    await openViewer(page, stack, DELETE_ROOT);
    await expectSceneMatchesRvm(page, stack, DELETE_ROOT, truthBase, `${stack.base_sesno} 基线`, 3 * 60_000);
    const generateBeforeReload = generateCalls.length;

    replayStep(stack, 25);
    await waitInSync(stack, 25);
    const truthChildDeleted = await rvmTruth(stack, 25);
    await reloadFromNotice(page);
    await expectSceneMatchesRvm(page, stack, DELETE_ROOT, truthChildDeleted, '25 重载后（子件已删）');

    replayStep(stack, 26);
    await waitInSync(stack, 26);
    await expect(notice(page)).toBeVisible({ timeout: 3 * 60_000 });
    await expect(page.getByTestId('gen-model-v1-update-notice-reload')).toHaveCount(0);
    await logNotice(page, '26');
    expect(await notice(page).getAttribute('title')).toContain('受影响的构件都不在场景里');
    expect(await unitBoxesMm(page, stack.dbnum, DELETE_ROOT)).toEqual({});
    await clearToast(page);
    await page.getByTestId('gen-model-v1-update-notice-dismiss').click(ACTION);
    await expect(notice(page)).toBeHidden();
    expect(generateCalls.length, '重载不该触发生成').toBe(generateBeforeReload);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    await page.screenshot({ path: path.join(stack.run_dir, 'k14-after-26-dismiss.png'), ...ACTION });
  });
});

test.describe('增量更新 K 组：现场（L3）', () => {
  test.beforeEach(() => {
    test.skip(!LIVE_STACK, '设 LINKAGE_LIVE_STACK=<Start-LinkageReplayStack.ps1 -Live 写出的 stack.json> 才跑');
  });

  test('K15 E3D TTY 上移 / 下移 500 → 提示 → 重载 → 与同一会话 TTY 导出的 RVM 对拍', async ({ page }) => {
    const stack = readStack(LIVE_STACK);
    test.setTimeout(60 * 60_000);
    const pageErrors = watchPageErrors(page);
    const generateCalls = watchGenerateCalls(page);

    const start = await dbnumRow(stack);
    const startSesno = start?.applied_sesno ?? 0;
    await waitInSync(stack, startSesno);
    await openViewer(page, stack, MOVE_ROOT);
    await expect.poll(async () => Object.keys(await unitBoxesMm(page, stack.dbnum, MOVE_ROOT)).length, { timeout: 3 * 60_000 })
      .toBeGreaterThan(0);
    const generateBeforeReload = generateCalls.length;

    let after = startSesno;
    for (const leg of ['apply', 'restore'] as const) {
      const snapshot = liveLeg(stack, leg);
      after = await waitQuiescentInSync(stack, after);
      const truth = await rvmBoxes(stack, readRvmSnapshot(snapshot), `${leg} 腿 RVM`);
      await reloadFromNotice(page);
      await expectSceneMatchesRvm(page, stack, MOVE_ROOT, truth, `${leg} 腿重载后（会话 ${after}）`);
    }
    expect(generateCalls.length, '重载不该触发生成').toBe(generateBeforeReload);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
