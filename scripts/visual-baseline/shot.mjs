#!/usr/bin/env node
// Generic visual-baseline shot runner (GitHub #45).
//
// Boots the project's Vite dev server on a dedicated port (5190-5199 range,
// see harness/README.md), opens a harness page in headless Chromium, applies
// the scenario's network mocks, runs its interaction steps, and saves PNG
// screenshots of the `.panel-host` element.
//
// Usage (run from repo root; no npm script on purpose — package.json is WIP):
//   node scripts/visual-baseline/shot.mjs <harness-html> [options]
//
//   node scripts/visual-baseline/shot.mjs harness/vt.html  --port 5190 --out scripts/pen-preview/out-vt
//   node scripts/visual-baseline/shot.mjs harness/mvc.html --port 5190 --out scripts/pen-preview/out-mvc --viewport 900x900
//
// Options:
//   --port <n>          dev-server port (default 5190, convention 5190-5199)
//   --out <dir>         output dir for PNGs (default scripts/visual-baseline/out-<name>)
//   --viewport <WxH>    viewport override, e.g. 1280x800 (default: scenario's, else 900x900)
//   --scenario <file>   scenario module (default: <harness-html> with .html -> .shots.mjs)
//
// Scenario module contract (all optional):
//   export const query = 'project=Foo&dbnum=1';          // URL search params
//   export const viewport = { width: 900, height: 900 }; // default viewport
//   export async function routes(page) { ... }           // page.route() mocks
//   export async function run({ page, shot, base }) { }  // steps; shot(name) saves <out>/<name>.png
// Without a scenario file the page is rendered as-is and one screenshot is taken.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();

function parseArgs(argv) {
  const args = { port: 5190, out: '', viewport: '', scenario: '', html: '' };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--viewport') args.viewport = argv[++i];
    else if (a === '--scenario') args.scenario = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else rest.push(a);
  }
  args.html = rest[0] || '';
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.html) {
  console.log('usage: node scripts/visual-baseline/shot.mjs <harness-html> [--port 5190] [--out <dir>] [--viewport WxH] [--scenario <file>]');
  process.exit(args.help ? 0 : 1);
}

const htmlAbs = path.resolve(ROOT, args.html);
if (!fs.existsSync(htmlAbs)) {
  console.error(`harness html not found: ${htmlAbs}`);
  process.exit(1);
}
const htmlRel = path.relative(ROOT, htmlAbs).split(path.sep).join('/');
const name = path.basename(htmlRel, '.html');

if (!Number.isInteger(args.port) || args.port <= 0) {
  console.error(`invalid --port: ${args.port}`);
  process.exit(1);
}

const outDir = path.resolve(ROOT, args.out || `scripts/visual-baseline/out-${name}`);
fs.mkdirSync(outDir, { recursive: true });

// Scenario module: default <harness>.shots.mjs next to the html.
const scenarioPath = path.resolve(ROOT, args.scenario || htmlRel.replace(/\.html$/, '.shots.mjs'));
let scenario = {};
if (fs.existsSync(scenarioPath)) {
  scenario = await import(pathToFileURL(scenarioPath).href);
  console.log('scenario', path.relative(ROOT, scenarioPath));
} else if (args.scenario) {
  console.error(`scenario not found: ${scenarioPath}`);
  process.exit(1);
} else {
  console.log('scenario none (plain render + single shot)');
}

let viewport = scenario.viewport || { width: 900, height: 900 };
if (args.viewport) {
  const m = /^(\d+)x(\d+)$/.exec(args.viewport);
  if (!m) {
    console.error(`invalid --viewport (expected WxH): ${args.viewport}`);
    process.exit(1);
  }
  viewport = { width: Number(m[1]), height: Number(m[2]) };
}

// 1) Vite dev server on the requested port (project vite.config.ts as-is).
const { createServer } = await import('vite');
const server = await createServer({
  configFile: path.resolve(ROOT, 'vite.config.ts'),
  root: ROOT,
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: args.port, strictPort: true },
});
await server.listen();
const base = server.config.base || '/';
const origin = `http://127.0.0.1:${args.port}`;
const query = scenario.query ? `?${scenario.query}` : '';
const url = `${origin}${base}${htmlRel}${query}`;

// 2) Headless Chromium via Playwright.
const { chromium } = await import('playwright');
const browser = await chromium.launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));

  if (typeof scenario.routes === 'function') await scenario.routes(page);

  console.log('goto', url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

  // shot(name)                       -> first `.panel-host` (or full page)
  // shot(name, selector)             -> specific element
  // shot(name, null, { clip })       -> page screenshot with options (e.g. clip region)
  const shot = async (shotName, selector = '.panel-host', options = {}) => {
    const file = path.join(outDir, `${shotName}.png`);
    if (selector) {
      const loc = page.locator(selector);
      const target = (await loc.count()) > 0 ? loc.first() : page;
      await target.screenshot({ path: file, ...options });
    } else {
      await page.screenshot({ path: file, ...options });
    }
    console.log('shot', path.relative(ROOT, file));
    return file;
  };

  if (typeof scenario.run === 'function') {
    await scenario.run({ page, shot, base: origin, outDir });
  } else {
    await page.waitForTimeout(800);
    await shot(name);
  }
} catch (e) {
  failed = true;
  console.error('run failed:', e);
} finally {
  await browser.close();
  await server.close();
}

console.log(failed ? 'FAILED' : `done -> ${path.relative(ROOT, outDir)}`);
process.exit(failed ? 1 : 0);
