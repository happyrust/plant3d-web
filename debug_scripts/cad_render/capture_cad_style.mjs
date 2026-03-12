#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const base = process.argv[2] || 'http://127.0.0.1:5173/?output_project=AvevaMarineSample';
const outDir = resolve(__dirname, 'output', new Date().toISOString().replace(/[:.]/g, '-'));

const cases = [
  { name: '01-cad_weak-edges_on-20', camera: 'cad_weak', edges: '1', angle: '20' },
  { name: '02-cad_flat-edges_on-20', camera: 'cad_flat', edges: '1', angle: '20' },
  { name: '03-normal-edges_on-20', camera: 'normal', edges: '1', angle: '20' },
  { name: '04-cad_weak-edges_on-12', camera: 'cad_weak', edges: '1', angle: '12' },
  { name: '05-cad_weak-edges_on-30', camera: 'cad_weak', edges: '1', angle: '30' },
  { name: '06-cad_weak-edges_off', camera: 'cad_weak', edges: '0', angle: '20' },
];

function buildUrl(baseUrl, c) {
  const url = new URL(baseUrl);
  url.searchParams.set('dtx_camera_mode', c.camera);
  url.searchParams.set('dtx_global_edges', c.edges);
  url.searchParams.set('dtx_edge_angle', c.angle);
  return url.toString();
}

async function waitViewerStable(page) {
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await page.waitForTimeout(8_000);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  for (const c of cases) {
    const url = buildUrl(base, c);
    console.log('[capture]', c.name, url);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await waitViewerStable(page);

    const outPath = resolve(outDir, `${c.name}.png`);
    await page.screenshot({ path: outPath, fullPage: false });
  }

  await browser.close();
  console.log('[done]', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
