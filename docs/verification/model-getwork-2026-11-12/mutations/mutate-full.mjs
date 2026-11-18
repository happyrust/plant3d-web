// 全量改坏试验：在最终代码上把几份清单从头全跑一遍。
//
// 用法：node mutate-full.mjs [--resume] [--only=id1,id2] <清单1.json> [<清单2.json> …]
// 结果写到本脚本所在目录：<清单名>.result.json（每处跑完立刻落盘）、summary.json。
//
// 与 mutate.mjs 的差别：
//  1. 每份清单先在没改坏的代码上跑一遍（基线必须全绿，否则「红」没有意义），全部跑完再跑一遍，确认还原干净；
//  2. 每处记下退出码、信号、是否超时、耗时、vitest 的汇总行；超时不算红，单列出来事后重跑；
//  3. 红分两种：有具体用例变红（assertion），或者只有整份测试文件装不起来（suite-error，多半是改坏后编不过）；
//  4. 还原后回读核对，对不上立即停；
//  5. --resume 跳过结果文件里已经有的。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const resume = args.includes('--resume');
const onlyArg = args.find((arg) => arg.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
const specPaths = args.filter((arg) => !arg.startsWith('--')).map((arg) => path.resolve(arg));
const RUN_TIMEOUT_MS = 420_000;

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

function runTests(cwd, tests) {
  const startedAt = Date.now();
  const run = spawnSync(
    process.execPath,
    ['node_modules/vitest/vitest.mjs', 'run', ...tests, '--maxWorkers=2', '--no-cache'],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  const ms = Date.now() - startedAt;
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  const failed = [...output.matchAll(/^\s*[×✗]\s+(.+?)(?:\s+\d+\s*ms)?$/gm)].map((match) => match[1].trim());
  const filesLine = output.match(/^\s*Test Files\s+(.+)$/m)?.[1]?.trim() ?? '';
  const testsLine = output.match(/^\s*Tests\s+(.+)$/m)?.[1]?.trim() ?? '';
  const timedOut = run.error?.code === 'ETIMEDOUT' || (run.status === null && Boolean(run.signal));
  return {
    status: run.status,
    signal: run.signal ?? null,
    spawnError: run.error ? String(run.error.code ?? run.error.message) : null,
    timedOut,
    ms,
    failed: [...new Set(failed)],
    filesLine,
    testsLine,
    output,
  };
}

function tailOf(output, lines = 14) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-lines)
    .join('\n');
}

const summary = { startedAt: new Date().toISOString(), lists: [] };

for (const specPath of specPaths) {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const cwd = spec.cwd;
  const name = path.basename(specPath, '.json');
  const outPath = path.join(here, `${name}.result.json`);
  const previous = resume && fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : [];
  const done = new Map(previous.map((item) => [item.id, item]));
  const results = [...previous];
  const save = () => fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');

  console.log(`[${stamp()}] ===== ${name}：${spec.mutations.length} 处 =====`);
  const before = runTests(cwd, spec.tests);
  console.log(
    `[${stamp()}] 基线（没改坏）：退出码 ${before.status}，${before.testsLine || '（没有汇总行）'}，${Math.round(before.ms / 1000)} 秒`,
  );
  if (before.status !== 0) {
    console.log(tailOf(before.output, 30));
    console.log(`[${stamp()}] 基线不是全绿，这份清单不跑（否则每一处都会被误记成红）`);
    summary.lists.push({ name, aborted: 'baseline-red', baseline: { status: before.status, tests: before.testsLine } });
    process.exitCode = 2;
    continue;
  }

  let index = 0;
  for (const mutation of spec.mutations) {
    index += 1;
    if (only && !only.has(mutation.id)) continue;
    if (done.has(mutation.id)) continue;
    const file = path.join(cwd, mutation.file);
    const original = fs.readFileSync(file, 'utf8');
    const count = original.split(mutation.find).length - 1;
    if (count !== 1) {
      results.push({ id: mutation.id, file: mutation.file, note: mutation.note, outcome: 'invalid', detail: `find 出现 ${count} 次，应恰好 1 次` });
      save();
      console.log(`[${stamp()}] [${index}/${spec.mutations.length}] [${mutation.id}] 清单有误：find 出现 ${count} 次`);
      continue;
    }
    let run;
    try {
      fs.writeFileSync(file, original.replace(mutation.find, mutation.replace), 'utf8');
      run = runTests(cwd, spec.tests);
    } finally {
      fs.writeFileSync(file, original, 'utf8');
    }
    if (fs.readFileSync(file, 'utf8') !== original) {
      console.log(`[${stamp()}] [${mutation.id}] 还原后回读对不上：${file}——停下`);
      process.exit(3);
    }
    let outcome;
    let killedBy = null;
    if (run.timedOut || run.spawnError) outcome = 'timeout';
    else if (run.status === 0) outcome = 'survived';
    else {
      outcome = 'killed';
      killedBy = run.failed.length > 0 ? 'assertion' : 'suite-error';
    }
    results.push({
      id: mutation.id,
      file: mutation.file,
      note: mutation.note,
      outcome,
      killedBy,
      status: run.status,
      signal: run.signal,
      spawnError: run.spawnError,
      ms: run.ms,
      filesLine: run.filesLine,
      testsLine: run.testsLine,
      failedCount: run.failed.length,
      failedTests: run.failed.slice(0, 6),
      tail: outcome === 'killed' && killedBy === 'assertion' ? '' : tailOf(run.output),
    });
    save();
    const label = outcome === 'killed' ? `红（${killedBy === 'assertion' ? `${run.failed.length} 条用例` : '测试文件装不起来'}）` : outcome === 'survived' ? '没红' : '超时';
    console.log(`[${stamp()}] [${index}/${spec.mutations.length}] [${mutation.id}] ${label} ${Math.round(run.ms / 1000)}s ${mutation.note}`);
  }

  const after = runTests(cwd, spec.tests);
  console.log(
    `[${stamp()}] 收尾（全部还原后）：退出码 ${after.status}，${after.testsLine || '（没有汇总行）'}，${Math.round(after.ms / 1000)} 秒`,
  );
  const tally = (outcome) => results.filter((item) => item.outcome === outcome);
  const entry = {
    name,
    total: spec.mutations.length,
    recorded: results.length,
    killed: tally('killed').length,
    killedByAssertion: results.filter((item) => item.outcome === 'killed' && item.killedBy === 'assertion').length,
    killedBySuiteError: results.filter((item) => item.outcome === 'killed' && item.killedBy === 'suite-error').map((item) => item.id),
    survived: tally('survived').map((item) => item.id),
    timeout: tally('timeout').map((item) => item.id),
    invalid: tally('invalid').map((item) => item.id),
    baseline: { status: before.status, tests: before.testsLine, ms: before.ms },
    closing: { status: after.status, tests: after.testsLine, ms: after.ms },
  };
  summary.lists.push(entry);
  console.log(
    `[${stamp()}] ${name} 小计：共 ${entry.recorded}/${entry.total}，红 ${entry.killed}（其中测试文件装不起来 ${entry.killedBySuiteError.length}），没红 ${entry.survived.length}，超时 ${entry.timeout.length}，清单有误 ${entry.invalid.length}`,
  );
  if (after.status !== 0) process.exitCode = 4;
}

const anyCwd = specPaths.length > 0 ? JSON.parse(fs.readFileSync(specPaths[0], 'utf8')).cwd : null;
if (anyCwd) {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: anyCwd, encoding: 'utf8' });
  summary.worktreeStatusAfter = (status.stdout ?? '').trim();
  console.log(`[${stamp()}] 跑完后工作树 git status：${summary.worktreeStatusAfter === '' ? '干净' : `\n${summary.worktreeStatusAfter}`}`);
}
summary.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(here, only ? 'summary.partial.json' : 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
console.log(`[${stamp()}] 全部结束`);
