import fs from 'node:fs/promises';
import process from 'node:process';

const file = process.argv[2] ?? 'docs/verification/d17-build-provenance.json';
let manifest;
try { manifest = JSON.parse(await fs.readFile(file, 'utf8')); }
catch (error) { console.error(`无法读取构建来源记录 ${file}: ${error.message}`); process.exit(2); }
const required = ['frontendCommit', 'backendCommit', 'ciRun', 'buildId', 'frontendSha256', 'backendSha256', 'sha256sumsPath'];
const blockers = required.filter((key) => !manifest[key] || String(manifest[key]).includes('待填写'));
if (manifest.dirty === true) blockers.push('dirty build is forbidden');
for (const port of ['80', '3100']) {
  const endpoints = manifest.versionEndpoints?.[port];
  if (!endpoints || Object.values(endpoints).some((value) => !value || String(value).includes('待填写'))) blockers.push(`${port}: version/health endpoint evidence missing`);
}
const result = { file, gate: blockers.length ? 'BLOCKED' : 'PASS', blockers };
console.log(JSON.stringify(result, null, 2));
process.exitCode = blockers.length ? 2 : 0;
