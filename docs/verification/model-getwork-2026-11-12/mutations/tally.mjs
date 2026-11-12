// 改坏试验的结果汇总：每份清单红 / 没红 / 超时 / 清单有误各多少，只有 1 条用例变红的有多少，和上一轮比。
//
//   node tally.mjs [这一遍的结果目录] [--thin=清单名]
//
// 这一遍缺省读 ./fullrun-r3-final（第三轮补用例之后那一遍）；上一轮读 ./fullrun-final（第二轮最终代码那一遍）；
// 第三轮新清单补用例之前那一遍读 ./fullrun-r3-before-thicken。--thin 列出那份清单里只有 1 条用例看着的各处。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dirArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const current = path.resolve(here, dirArg ?? 'fullrun-r3-final');
const previous = path.join(here, 'fullrun-final');
const beforeThicken = path.join(here, 'fullrun-r3-before-thicken');
const lists = ['mutations-tree', 'mutations-models', 'mutations-round3', 'mutations-replay', 'mutations-r3'];
const thinArg = process.argv.find((arg) => arg.startsWith('--thin='))?.slice('--thin='.length);
const load = (dir, name) => (existsSync(path.join(dir, `${name}.result.json`)) ? JSON.parse(readFileSync(path.join(dir, `${name}.result.json`), 'utf8')) : null);
const thin = (items) => items.filter((item) => item.outcome === 'killed' && item.killedBy === 'assertion' && item.failedCount === 1);

console.log(`这一遍：${path.relative(here, current) || '.'}`);
let total = 0;
let killed = 0;
let thinTotal = 0;
for (const name of lists) {
  const now = load(current, name);
  if (!now) { console.log(`${name}：没有结果`); continue; }
  const before = load(previous, name);
  const count = (outcome) => now.filter((item) => item.outcome === outcome).length;
  const suite = now.filter((item) => item.outcome === 'killed' && item.killedBy === 'suite-error');
  const thinNow = thin(now);
  total += now.length;
  killed += count('killed');
  thinTotal += thinNow.length;
  const beforeById = new Map((before ?? []).map((item) => [item.id, item]));
  const thicker = before ? now.filter((item) => (beforeById.get(item.id)?.failedCount ?? 0) === 1 && item.failedCount > 1).length : 0;
  console.log(
    `${name}：共 ${now.length}，红 ${count('killed')}（其中测试文件装不起来 ${suite.length}），没红 ${count('survived')}，超时 ${count('timeout')}，清单有误 ${count('invalid')}；`
    + `只有 1 条用例看着的 ${thinNow.length}${before ? `（上一轮 ${thin(before).length}/${before.length}；上一轮 1 条、这次多于 1 条的 ${thicker}）` : '（上一轮没有这份清单）'}`,
  );
  for (const item of now.filter((entry) => entry.outcome !== 'killed')) console.log(`   ${item.outcome} [${item.id}] ${item.file}：${item.note}${item.detail ? `（${item.detail}）` : ''}`);
  for (const item of suite) console.log(`   测试文件装不起来 [${item.id}] ${item.note}`);
  if (thinArg === name) for (const item of thinNow) console.log(`   1 条 [${item.id}] ${item.file}：${item.note} ← ${item.failedTests?.[0] ?? ''}`.slice(0, 260));
}
console.log(`合计：${total} 处，红 ${killed}；只有 1 条用例看着的 ${thinTotal}`);

// 第三轮新清单：补用例之前那一遍和这一遍并排
const before = load(beforeThicken, 'mutations-r3');
const now = load(current, 'mutations-r3');
if (before && now) {
  const nowById = new Map(now.map((item) => [item.id, item]));
  const thinBefore = thin(before);
  const stillThin = thinBefore.filter((item) => nowById.get(item.id)?.failedCount === 1);
  console.log(`mutations-r3 补用例之前只有 1 条看着的 ${thinBefore.length} 处；之后还剩 ${stillThin.length} 处：`);
  for (const item of stillThin) console.log(`   [${item.id}] ${item.file}：${item.note}`);
  const thicker = thinBefore.filter((item) => (nowById.get(item.id)?.failedCount ?? 0) > 1);
  console.log(`变厚的 ${thicker.length} 处：${thicker.map((item) => `${item.id}(${nowById.get(item.id).failedCount})`).join(' ')}`);
}
