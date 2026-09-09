#!/usr/bin/env node
/**
 * 真·类型检查 + 基线比对（收口计划 `docs/plans/2026-09-09-gen-model-v1-closeout-and-next-steps-plan.md`
 * §4 P10-1，决策 D10 按 A）。
 *
 * 背景：根 `tsconfig.json` 是 `files: []` + `references`，`vue-tsc --noEmit` 对它一个文件都不查——
 * 之前的 `npm run type-check` 是假绿灯。真查要走 `vue-tsc --build --force`，但全仓有六百多条既有
 * 错误（按文件分桶的清单另立计划消化，P10-2），一刀切会让 `npm run build` 永远红。
 *
 * 做法：跑 `vue-tsc --build --force --pretty false`，把每条错误归一成 `文件|TS码|首行消息`
 * （去掉行列号——挪一行代码不该算新错），与 `scripts/type-check-baseline.txt` 里的多重集合比：
 * **只要出现基线之外的错误（或同一签名的条数超过基线）就红**；基线里的错误消失只提示、不红。
 *
 * 用法：
 *   node scripts/type-check.mjs                    # 比对基线（= npm run type-check）
 *   node scripts/type-check.mjs --update-baseline  # 用当前结果重写基线（修掉一批既有错误后收紧；不得用来放行新错误）
 *   node scripts/type-check.mjs --verbose          # 顺带打印全部当前错误（含行列号）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(repoRoot, 'scripts', 'type-check-baseline.txt');
const vueTscBin = path.join(repoRoot, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js');

const args = new Set(process.argv.slice(2));
const updateBaseline = args.has('--update-baseline');
const verbose = args.has('--verbose');

const BASELINE_HEADER = [
  '# vue-tsc --build --force 的既有类型错误基线，scripts/type-check.mjs 比对用（收口计划 2026-09-09 P10-1）。',
  '# 每行 = 文件|TS码|首行消息（不含行列号）；同一行重复 n 次 = 该签名当前出现 n 处。',
  '# 只许收紧：修掉一批既有错误后跑 `npm run type-check:update-baseline` 重写；新增错误不得靠改这个文件放行。',
];

/** 有位置的错误：`src/a.ts(12,5): error TS2322: ...`；无位置的全局错误：`error TS18003: ...` */
const LOCATED = /^(?<file>[^\s(][^(]*?)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<msg>.*)$/;
const GLOBAL = /^error (?<code>TS\d+): (?<msg>.*)$/;

function runVueTsc() {
  if (!existsSync(vueTscBin)) {
    console.error(`type-check: 找不到 ${path.relative(repoRoot, vueTscBin)}，先 npm install`);
    process.exit(1);
  }
  const result = spawnSync(
    process.execPath,
    [vueTscBin, '--build', '--force', '--pretty', 'false'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    },
  );
  if (result.error) {
    console.error('type-check: vue-tsc 起不来：', result.error);
    process.exit(1);
  }
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

/** @returns {{ signature: string, location: string, code: string, msg: string }[]} */
function parseErrors(output) {
  const errors = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const located = LOCATED.exec(line);
    if (located) {
      const { file, line: ln, col, code, msg } = located.groups;
      const normalizedFile = file.replace(/\\/g, '/');
      errors.push({
        signature: `${normalizedFile}|${code}|${msg.trim()}`,
        location: `${normalizedFile}(${ln},${col})`,
        code,
        msg: msg.trim(),
      });
      continue;
    }
    const global = GLOBAL.exec(line);
    if (global) {
      const { code, msg } = global.groups;
      errors.push({ signature: `(global)|${code}|${msg.trim()}`, location: '(global)', code, msg: msg.trim() });
    }
    // 其余行：多行消息的缩进续行、vue-tsc 自己的噪音（如 @vue/language-core 的 TypeError 栈）——不计。
  }
  return errors;
}

/** @param {string[]} signatures @returns {Map<string, number>} */
function toMultiset(signatures) {
  const counts = new Map();
  for (const signature of signatures) counts.set(signature, (counts.get(signature) ?? 0) + 1);
  return counts;
}

function readBaseline() {
  if (!existsSync(baselinePath)) return null;
  const lines = readFileSync(baselinePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return toMultiset(lines);
}

function writeBaseline(signatures) {
  const sorted = [...signatures].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  writeFileSync(baselinePath, `${[...BASELINE_HEADER, ...sorted].join('\n')}\n`, 'utf8');
}

function countFiles(errors) {
  return new Set(errors.map((error) => error.signature.split('|')[0])).size;
}

const { status, output } = runVueTsc();
const errors = parseErrors(output);

if (status !== 0 && errors.length === 0) {
  // vue-tsc 报了错却一条都解析不出来：配置错、进程崩了之类。宁红勿绿，把原文吐出来。
  console.error(`type-check: vue-tsc 退出码 ${status}，但输出里没有可解析的错误行，原文如下：\n${output.trim()}`);
  process.exit(1);
}

if (verbose) {
  for (const error of errors) console.log(`${error.location}: ${error.code}: ${error.msg}`);
  if (errors.length > 0) console.log('');
}

const current = toMultiset(errors.map((error) => error.signature));
const fileCount = countFiles(errors);

if (updateBaseline) {
  writeBaseline(errors.map((error) => error.signature));
  console.log(`type-check: 基线已重写 → ${path.relative(repoRoot, baselinePath)}：${errors.length} 条错误 / ${fileCount} 个文件`);
  process.exit(0);
}

const baseline = readBaseline();
if (baseline === null) {
  console.error(
    `type-check: 没有基线文件 ${path.relative(repoRoot, baselinePath)}。当前 ${errors.length} 条错误。`
    + '\n  先确认这些错误确实是既有的，再跑 `npm run type-check:update-baseline` 建基线。',
  );
  process.exit(1);
}

let baselineTotal = 0;
for (const count of baseline.values()) baselineTotal += count;

/** @type {{ signature: string, baselineCount: number, currentCount: number }[]} */
const exceeded = [];
for (const [signature, currentCount] of current) {
  const baselineCount = baseline.get(signature) ?? 0;
  if (currentCount > baselineCount) exceeded.push({ signature, baselineCount, currentCount });
}
let resolved = 0;
for (const [signature, baselineCount] of baseline) {
  const currentCount = current.get(signature) ?? 0;
  if (currentCount < baselineCount) resolved += baselineCount - currentCount;
}
const added = exceeded.reduce((sum, item) => sum + (item.currentCount - item.baselineCount), 0);

console.log(
  `type-check: 当前 ${errors.length} 条错误 / ${fileCount} 个文件；基线 ${baselineTotal} 条；新增 ${added}；已消失 ${resolved}`,
);

if (exceeded.length > 0) {
  console.error('\ntype-check: 出现基线之外的类型错误（修掉它们，不要改基线放行）：');
  exceeded.sort((a, b) => (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
  for (const item of exceeded) {
    const occurrences = errors.filter((error) => error.signature === item.signature);
    console.error(`\n  [基线 ${item.baselineCount} → 当前 ${item.currentCount}] ${item.signature}`);
    for (const occurrence of occurrences) console.error(`    ${occurrence.location}: ${occurrence.code}: ${occurrence.msg}`);
  }
  process.exit(1);
}

if (resolved > 0) {
  console.log(
    `type-check: 基线里有 ${resolved} 条错误已经不在了——跑 \`npm run type-check:update-baseline\` 收紧基线，别让它们回来。`,
  );
}
process.exit(0);
