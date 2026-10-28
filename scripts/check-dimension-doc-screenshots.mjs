#!/usr/bin/env node
/**
 * 尺寸文档截图的可复现校验。
 *
 * 用 `e2e/dimension-doc-screenshots.spec.ts` 重新生成四张 PNG 到 `test-results/`
 * （已忽略，不覆盖 `docs/` 下的基线），再逐张与 HEAD 里的入库 PNG 做 sha256
 * 比对。差异说明「当前代码 + 当前浏览器不再产出与入库基线相同的图」：
 *
 *   - 预期内的视觉变更 → `npm run gen:dimension-screenshots` 重新生成，人工
 *     审阅后连图一起提交；
 *   - 非预期差异 → 先核对 Chromium 版本与 GPU 档位（`PLAYWRIGHT_SOFTWARE_GL`
 *     会让 ANGLE 走 SwiftShader），这两项不同会直接改变像素。
 *
 * 用法：npm run verify:dimension-screenshots
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = resolve(ROOT, 'test-results/dimension-doc-screenshots');
const BASELINE_DIR = 'docs/verification/dimensions/screenshots';
/** 与 `CASES` in e2e/dimension-doc-screenshots.spec.ts 一一对应。 */
const CASES = ['linear', 'projected', 'angular', 'radial'];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 入库基线取 HEAD，不取工作区：工作区可能带着未提交的截图改动。 */
function readBaseline(name) {
  try {
    return execFileSync('git', ['show', `HEAD:${BASELINE_DIR}/${name}.png`], {
      cwd: ROOT,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const cli = resolve(ROOT, 'node_modules/@playwright/test/cli.js');
const run = spawnSync(
  process.execPath,
  [
    cli,
    'test',
    'e2e/dimension-doc-screenshots.spec.ts',
    '--config=playwright.novideo.config.ts',
    '--workers=1',
  ],
  {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, DIMENSION_DOC_SCREENSHOT_OUT_DIR: OUT_DIR },
  },
);
if (run.status !== 0) {
  console.error('\n生成失败：先修好 e2e/dimension-doc-screenshots.spec.ts 再谈比对。');
  process.exit(run.status ?? 1);
}

let failed = 0;
for (const name of CASES) {
  const generatedPath = resolve(OUT_DIR, `${name}.png`);
  if (!existsSync(generatedPath)) {
    console.error(`FAIL  ${name}.png  未生成`);
    failed += 1;
    continue;
  }
  const baseline = readBaseline(name);
  if (!baseline) {
    console.error(`FAIL  ${name}.png  HEAD 里没有入库基线（先提交一次基线）`);
    failed += 1;
    continue;
  }
  const generated = readFileSync(generatedPath);
  const expectedHash = sha256(baseline);
  const actualHash = sha256(generated);
  if (expectedHash === actualHash) {
    console.log(`ok    ${name}.png  ${actualHash.slice(0, 12)}`);
  } else {
    console.error(
      `FAIL  ${name}.png  入库 ${expectedHash.slice(0, 12)} ≠ 生成 ${actualHash.slice(0, 12)}`,
    );
    failed += 1;
  }
}

if (failed > 0) {
  console.error(
    `\n${failed} 张与入库基线不一致。预期内的视觉变更请跑 npm run gen:dimension-screenshots`
      + ' 复核后提交；否则先核对 Chromium 版本与 GPU 档位。',
  );
  process.exit(1);
}
console.log(`\n${CASES.length} 张截图与 HEAD 基线逐字节一致。`);
