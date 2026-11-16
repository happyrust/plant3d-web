// 改坏清单对着最终代码核一遍：每条的 find 还在不在、是不是恰好一处（不跑测试）。
//   node check-mutations.mjs <清单.json> [...]
import fs from 'node:fs';
import path from 'node:path';

let stale = 0;
for (const arg of process.argv.slice(2)) {
  const spec = JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8'));
  const bad = [];
  for (const mutation of spec.mutations) {
    const text = fs.readFileSync(path.join(spec.cwd, mutation.file), 'utf8');
    const count = text.split(mutation.find).length - 1;
    if (count !== 1) bad.push(`${mutation.id}（${count} 处）${mutation.note}`);
  }
  stale += bad.length;
  console.log(`${path.basename(arg)}：${spec.mutations.length} 条，对不上的 ${bad.length} 条`);
  for (const line of bad) console.log(`  ${line}`);
}
process.exitCode = stale > 0 ? 1 : 0;
