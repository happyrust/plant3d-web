import fs from 'node:fs/promises';
import process from 'node:process';

const file = process.argv[2] ?? 'docs/verification/acceptance-record.json';
const required = Array.from({ length: 19 }, (_, index) => `V${String(index + 1).padStart(2, '0')}`);
let record;
try {
  record = JSON.parse(await fs.readFile(file, 'utf8'));
} catch (error) {
  console.error(`无法读取验收记录 ${file}: ${error.message}`);
  process.exit(2);
}
const byId = new Map((record.items ?? []).map((item) => [item.id, item]));
const problems = [];
let passed = 0;
for (const id of required) {
  const item = byId.get(id);
  if (!item) { problems.push(`${id}: missing`); continue; }
  const itemProblems = [];
  if (item.status !== '通过') itemProblems.push(`status=${item.status ?? 'missing'}`);
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) itemProblems.push('evidence missing');
  if (!item.owner || !item.date) itemProblems.push('owner/date missing');
  if (itemProblems.length === 0) passed += 1;
  else for (const problem of itemProblems) problems.push(`${id}: ${problem}`);
}
const summary = { file, runId: record.runId ?? null, total: required.length, passed, gate: problems.length === 0 ? 'PASS' : 'BLOCKED', problems };
console.log(JSON.stringify(summary, null, 2));
process.exitCode = problems.length ? 2 : 0;
