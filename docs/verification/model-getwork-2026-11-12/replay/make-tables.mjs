// 把回放结果整理成验证记录里用的表（Markdown），免得手抄出错。
//   node make-tables.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(fs.readFileSync(path.join(here, 'out', name), 'utf8'));
const run = read('replay-result.run4.json');
const whole = read('replay-showdbnum-result.final.json');
const seconds = (ms) => (ms === null || ms === undefined ? '—' : (ms / 1000).toFixed(1));
const hms = (iso) => (iso ? iso.slice(11, 19) : '—');
const batchMs = (task) => (task?.created_at && task?.finished_at ? new Date(task.finished_at) - new Date(task.created_at) : null);

console.log('### 节点装载的那一轮（最终代码）\n');
console.log(`起止 ${run.startedAt} → ${run.finishedAt}；后端 ${run.backendHealth.build_id}；核对 ${run.checks.length} 项，过 ${run.checks.filter((item) => item.pass).length}。\n`);
console.log('| 步 | 库 | 会话 | 后端：文件写完到三枚水位齐（秒） | 其中批次自己（秒） | 完成帧到页面（秒） | 点之前状态栏的提示 | 取最新（秒） | 那一句 | 树：对了几层 | 场景：对了几个矩阵 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const step of run.steps) {
  if (step.id === 'R1') continue;
  const task = step.task;
  console.log(`| ${step.id} | ${step.dbnum} | ${task ? `${task.start_sesno}–${task.end_sesno}` : `→${step.to}`} | ${seconds(step.caughtUp?.modelMs)} | ${seconds(batchMs(task))} | ${step.push ? seconds(step.push.terminalAfterMs) : '（没等，直接点）'} | ${step.noticeBeforeClick ?? (step.push ? '没有' : '—')} | ${seconds(step.getWork.ms)}${step.report?.waited ? `（其中等后台 ${seconds(step.report.waited.ms)}）` : ''} | ${step.getWork.summary} | ${step.treeCompare.compared} | ${step.sceneCompare.matricesCompared} |`);
}
const r1 = run.steps.find((step) => step.id === 'R1');
console.log('\nR1：', JSON.stringify({ restart: r1.restart, rowsAfterRestart: r1.rowsAfterRestart, rows: r1.rows, caughtUp: { appliedMs: r1.caughtUp.appliedMs, modelMs: r1.caughtUp.modelMs }, getWorkMs: r1.getWork.ms, summary: r1.getWork.summary, detail: r1.getWork.detail, named: r1.named7998, notice: r1.noticeBeforeClick }, null, 1));

console.log('\n每步的回执（模型）：');
for (const step of run.steps) {
  const m = step.report.models;
  console.log(`- ${step.id}：在册 ${m.rootsTotal}，核对 ${m.checked}，重载 ${m.reloaded.map((item) => `${item.refno}(+${item.added}/−${item.removed}，现有 ${item.total})`).join('、') || '无'}；撤下 ${m.withdrawn.map((item) => `${item.refno}(${item.why}，${item.refnos} 件)`).join('、') || '无'}；没动 ${m.kept.map((item) => item.refno).join('、') || '无'}；合计 +${m.componentsAdded}/−${m.componentsRemoved}`);
}
console.log('\n每步后端自己的差：');
for (const step of run.steps) console.log(`- ${step.id}：${[...step.backendDiff.tree, ...step.backendDiff.records].join('；').slice(0, 900) || '看着的层和根没有差'}`);

console.log('\n请求（整轮，按路径）：', run.guard.byPath.filter(([name]) => !/tasks\/db-/.test(name)).map(([name, count]) => `${name} ${count}`).join('；'));
console.log('耗时：', run.guard.timings.slice(0, 10).map(([name, t]) => `${name} ${t.count} 次、最长 ${t.maxMs} ms、共 ${t.totalMs} ms`).join('；'));
console.log('护栏：发往现网', run.guard.toLive.length, '；拦下', run.guard.blocked.length, '；放行的只读 POST', JSON.stringify(run.guard.allowedPost), '；发往沙箱', run.guard.requestsToSandbox);
console.log('窄窗口：', JSON.stringify(run.narrow));
console.log('提示条与按钮（S3）：', JSON.stringify(run.steps.find((step) => step.id === 'S3').toast));

console.log('\n### 整库显示的那一轮\n');
console.log(`起止 ${whole.startedAt} → ${whole.finishedAt}；核对 ${whole.checks.length} 项，过 ${whole.checks.filter((item) => item.pass).length}。`);
console.log('基线：', JSON.stringify({ loadMs: whole.baseline.loadMs, loadResult: whole.baseline.loadResult, row: whole.baseline.row, sceneObjects: whole.baseline.sceneObjects, sites: whole.baseline.sites.map((site) => `${site.name}(${site.refno}) ${site.records} 条`) }, null, 1));
console.log('\n| 步 | 会话 | 后端追上（秒） | 取最新（秒） | 在册 / 核对 / 重载 | 记录请求（个 / 共毫秒） | 那一句 | 场景：对了几个矩阵 |');
console.log('|---|---|---|---|---|---|---|---|');
for (const step of whole.steps) {
  const g = step.getWork;
  console.log(`| ${step.id} | →${step.to} | ${seconds(step.caughtUp.ms)} | ${seconds(g.ms)} | ${g.rootsTotal} / ${g.checked} / ${g.reloaded} | ${g.recordsRequests} / ${g.recordsMs} | ${g.summary} | ${step.compare.compared} |`);
}
for (const step of whole.steps) console.log(`- ${step.id}：新装入 ${JSON.stringify(step.getWork.loadedNew)}；撤下 ${JSON.stringify(step.getWork.withdrawn)}；后端 SITE ${step.backend.sitesBefore}→${step.backend.sitesAfter}，带几何的构件 ${step.backend.componentsBefore}→${step.backend.componentsAfter}；页面对象 ${step.page.objects}；最慢 ${g(step)}`);
function g(step) { return step.getWork.slowest.join('；'); }
console.log('护栏：', JSON.stringify(whole.guard));
