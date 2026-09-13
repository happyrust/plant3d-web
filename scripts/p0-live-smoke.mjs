#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const profile = process.argv[2];
const supportedProfiles = ['model', 'measurement', 'review', 'pms', 'all'];
const isWindows = process.platform === 'win32';
const npx = isWindows ? 'npx.cmd' : 'npx';

function fail(message) {
  console.error(`[p0-live-smoke] ${message}`);
  process.exitCode = 1;
}

function requiredEnv(name, purpose) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少 ${name}（${purpose}）`);
  }
  return value;
}

async function requireEndpoint(label, url) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`${label} 不可达：${url}；${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${label} 返回 HTTP ${response.status}：${url}；${body.slice(0, 200)}`);
  }
}

function run(command, args, env = {}) {
  console.log(`[p0-live-smoke] ${command} ${args.join(' ')}`);
  const options = {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: 'inherit',
  };
  // Node >= 20.12 / 22 在 shell:false 下拒绝直接 spawn .cmd/.bat（CVE-2024-27980，报 EINVAL），
  // Windows 必须经 shell 起 npx.cmd，且要整串下发（shell:true 再拆 args 触发 DEP0190）。
  // 这里的参数只有路径与 --flag，不含空格或 shell 元字符。
  const result = isWindows
    ? spawnSync([command, ...args].join(' '), { ...options, shell: true })
    : spawnSync(command, args, { ...options, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`命令退出码 ${result.status ?? 'unknown'}：${command} ${args.join(' ')}`);
  }
}

async function runModelGate() {
  const base = (process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022').replace(/\/$/, '');
  await requireEndpoint('gen-model health', `${base}/api/v1/health`);
  // 该 spec 含「服务重启」用例；playwright.config 是 fullyParallel，必须单 worker 顺序跑，
  // 否则重启会打断同时在跑的 show_refno / show_dbnum 用例。
  run(npx, ['playwright', 'test', 'e2e/gen-model-v1-p5-live.spec.ts', '--workers=1'], {
    GEN_MODEL_P5_LIVE: '1',
    GEN_MODEL_V1_BASE_URL: base,
  });
}

async function runMeasurementGate() {
  const base = (process.env.PLANT3D_API_BASE || 'http://127.0.0.1:3100').replace(/\/$/, '');
  await requireEndpoint(
    '模型版本 API',
    `${base}/api/model/units/24381_145018/versions?dbnum=7997`,
  );
  await requireEndpoint(
    'MBD V2 API',
    `${base}/api/mbd/v2/pipe/${encodeURIComponent('24381_145018')}`,
  );
  run(npx, [
    'playwright',
    'test',
    'e2e/dimension-real-ams-bran-version.spec.ts',
    'e2e/dimension-app-dev-smoke.spec.ts',
    'e2e/dimension-mbd-v2-fixture.spec.ts',
  ], {
    PLANT3D_API_BASE: base,
  });
}

async function runReviewGate() {
  const base = requiredEnv(
    'PLANT3D_API_BASE',
    '真实校审后端，例如 http://127.0.0.1:3910',
  ).replace(/\/$/, '');
  run(npx, ['tsx', 'scripts/review-annotation-flow-contract.ts'], {
    PLANT3D_API_BASE: base,
  });
}

async function runPmsGate() {
  requiredEnv('PMS_E2E_PASSWORD', 'PowerPMS 联调账号密码');
  requiredEnv('PMS_EMBEDDED_SITE_SUBSTRING', '已部署 plant3d-web 地址片段');
  run(npx, ['tsx', 'scripts/pms-chrome-devtools-flow.ts'], {
    PMS_CDP_FULL_FLOW: '1',
    PMS_CDP_EXTENDED_FLOW: '1',
    PMS_CDP_VERIFY_PMS_API: '1',
  });
}

const gates = {
  model: runModelGate,
  measurement: runMeasurementGate,
  review: runReviewGate,
  pms: runPmsGate,
};

async function main() {
  if (!profile || !supportedProfiles.includes(profile)) {
    throw new Error(`用法：node scripts/p0-live-smoke.mjs <${supportedProfiles.join('|')}>`);
  }
  const selected = profile === 'all'
    ? ['model', 'measurement', 'review', 'pms']
    : [profile];
  for (const gate of selected) {
    console.log(`\n[p0-live-smoke] ===== ${gate} =====`);
    await gates[gate]();
  }
  console.log(`\n[p0-live-smoke] 通过：${selected.join(', ')}`);
}

main().catch(error => {
  fail(error instanceof Error ? error.message : String(error));
});
