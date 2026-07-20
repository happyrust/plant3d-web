import { spawnSync } from 'node:child_process';

const command = 'npx';
const result = spawnSync(
  command,
  ['playwright', 'test', 'e2e/dimension-perf.spec.ts'],
  {
    cwd: process.cwd(),
    env: { ...process.env, DIMENSION_PERF_GATE: '1' },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  },
);

if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
