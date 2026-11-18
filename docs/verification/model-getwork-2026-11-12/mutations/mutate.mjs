// 改坏试验：一次只改坏一处，跑相关单测，看有没有测试变红；跑完把文件还原。
//
// 用法（在任意目录）：node mutate.mjs <清单.json>
// 清单：{ "cwd": "<工作树>", "tests": ["src/…test.ts"], "out": "<结果.json>", "mutations": [{ "id", "file", "find", "replace", "note" }] }
// `find` 必须在文件里恰好出现一次。结果：killed = 有测试红；survived = 全绿（要补测试）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const specPath = path.resolve(process.argv[2] ?? '');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const cwd = spec.cwd;
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const results = [];

function runTests() {
  const run = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', ...spec.tests, '--maxWorkers=2', '--no-cache'],
    { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }, timeout: 300_000 },
  );
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  const failed = [...output.matchAll(/^\s*[×✗]\s+(.+?)(?:\s+\d+ms)?$/gm)].map((match) => match[1].trim());
  return { status: run.status, failed: [...new Set(failed)], output };
}

for (const mutation of spec.mutations) {
  if (only && !only.has(mutation.id)) continue;
  const file = path.join(cwd, mutation.file);
  const original = fs.readFileSync(file, 'utf8');
  const count = original.split(mutation.find).length - 1;
  if (count !== 1) {
    results.push({ id: mutation.id, note: mutation.note, outcome: 'invalid', detail: `find 出现 ${count} 次，应恰好 1 次` });
    console.log(`[${mutation.id}] 清单有误：find 出现 ${count} 次`);
    continue;
  }
  try {
    fs.writeFileSync(file, original.replace(mutation.find, mutation.replace), 'utf8');
    const { status, failed, output } = runTests();
    const outcome = status === 0 ? 'survived' : 'killed';
    const tail = failed.length === 0 && status !== 0 ? output.split('\n').filter((line) => /Error|error/.test(line)).slice(0, 3).join(' | ') : '';
    results.push({ id: mutation.id, file: mutation.file, note: mutation.note, outcome, failedTests: failed.slice(0, 6), failedCount: failed.length, detail: tail });
    console.log(`[${mutation.id}] ${outcome}${failed.length ? `（红 ${failed.length} 条）` : ''} ${mutation.note}`);
  } finally {
    fs.writeFileSync(file, original, 'utf8');
  }
}

if (spec.out) {
  const outPath = path.resolve(path.dirname(specPath), spec.out);
  let merged = results;
  if (only && fs.existsSync(outPath)) {
    const previous = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const byId = new Map(previous.map((item) => [item.id, item]));
    for (const item of results) byId.set(item.id, item);
    merged = [...byId.values()];
  }
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf8');
}
const survived = results.filter((item) => item.outcome !== 'killed');
console.log(`共 ${results.length} 处：红 ${results.length - survived.length}，没红 ${survived.length}${survived.length ? `（${survived.map((item) => item.id).join('、')}）` : ''}`);
process.exitCode = survived.length > 0 ? 1 : 0;
