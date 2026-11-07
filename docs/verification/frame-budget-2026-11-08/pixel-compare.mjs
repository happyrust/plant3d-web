// 验收第 5 项：静止帧与改动前逐像素一致。
// 用法：node pixel-compare.mjs [newBase] [oldBase] [out.json]
// newBase 是当前工作区的开发服务；oldBase 是只把本功能的文件换回 HEAD 的副本（其余未提交改动相同，布局一致）。
// 新版采两次，给出同一版本两次加载之间的噪声底线。
import { mkdirSync, writeFileSync } from 'node:fs';

import { chromium } from 'playwright';

const [newBase = 'http://localhost:3101', oldBase = 'http://localhost:3111', outFile = 'pixel-compare.json'] = process.argv.slice(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// 设了就把新旧两版的截图写进这个目录（放仓库外）
const PNG_DIR = process.env.PIXEL_PNG_DIR || '';
if (PNG_DIR) mkdirSync(PNG_DIR, { recursive: true });

const COUNT = 2000;
const LOOKS = {
  e3d: 'dtx_look=sgl&dtx_look_preset=factory',
  pbr: 'dtx_look=pbr',
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

/** 连续两次截图完全相同才算画面停稳 */
async function stableShot(page) {
  const clip = await page.evaluate(() => {
    const r = window.__dtxViewer.renderer.domElement.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  let prev = null;
  for (let i = 0; i < 12; i += 1) {
    const buf = await page.screenshot({ clip });
    if (prev && buf.equals(prev)) return { png: buf.toString('base64'), stable: true, clip };
    prev = buf;
    await page.waitForTimeout(700);
  }
  return { png: prev.toString('base64'), stable: false, clip };
}

async function capture(base, look) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => log('pageerror', String(e).slice(0, 300)));
  const url = `${base}/?dtx_demo=primitives&dtx_demo_count=${COUNT}&${LOOKS[look]}`;
  log('goto', url);
  await page.goto(url, { timeout: 240_000, waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__dtxViewer, null, { timeout: 300_000, polling: 250 });
  await page.waitForTimeout(5000);
  const initial = await stableShot(page);
  // 绕 Z 轴（本视口 Z 朝上）转 30°：两版吃同一个相机输入，新版会经历一次「交互」，停稳后应回到全画质
  await page.evaluate(() => {
    const v = window.__dtxViewer;
    const t = v.controls.target;
    const p = v.camera.position;
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    const a = Math.PI / 6;
    p.set(t.x + dx * Math.cos(a) - dy * Math.sin(a), t.y + dx * Math.sin(a) + dy * Math.cos(a), p.z);
    v.camera.lookAt(t);
    v.controls.update();
    v.controls.dispatchEvent({ type: 'change' });
  });
  await page.waitForTimeout(2500);
  const rotated = await stableShot(page);
  const levelAfterRotate = await page.evaluate(() => window.__dtxDowngrade?.level ?? null);
  // 再要一帧但不动相机：状态机看到「已停」才会恢复；与 rotated 不同说明 rotated 是卡在降画质上的帧
  await page.evaluate(() => window.__dtxViewer.controls.dispatchEvent({ type: 'change' }));
  await page.waitForTimeout(1500);
  const settled = await stableShot(page);
  const levelAfterSettle = await page.evaluate(() => window.__dtxDowngrade?.level ?? null);
  await context.close();
  return { url, initial, rotated, settled, levelAfterRotate, levelAfterSettle };
}

async function diff(aB64, bB64) {
  const page = await browser.newPage();
  const res = await page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
    const [ia, ib] = await Promise.all([load(`data:image/png;base64,${a}`), load(`data:image/png;base64,${b}`)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { sizeMismatch: [ia.width, ia.height, ib.width, ib.height] };
    const c = document.createElement('canvas');
    c.width = ia.width;
    c.height = ia.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(0, 0, c.width, c.height).data;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, 0, c.width, c.height).data;
    let diffPixels = 0;
    let maxDiff = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
      if (d > 0) {
        diffPixels += 1;
        if (d > maxDiff) maxDiff = d;
      }
    }
    return { width: c.width, height: c.height, diffPixels, maxDiff };
  }, [aB64, bB64]);
  await page.close();
  return res;
}

const results = { newBase, oldBase, count: COUNT, startedAt: new Date().toISOString(), looks: {} };
try {
  for (const look of Object.keys(LOOKS)) {
    log('=== look', look);
    const n1 = await capture(newBase, look);
    const n2 = await capture(newBase, look);
    const o = await capture(oldBase, look);
    const entry = {
      levels: {
        new: { afterRotate: n1.levelAfterRotate, afterSettle: n1.levelAfterSettle },
        newRepeat: { afterRotate: n2.levelAfterRotate, afterSettle: n2.levelAfterSettle },
      },
      rotatedVsSettled: { new: await diff(n1.rotated.png, n1.settled.png), old: await diff(o.rotated.png, o.settled.png) },
      shots: {},
    };
    log(look, 'levels', JSON.stringify(entry.levels), 'rotatedVsSettled', JSON.stringify(entry.rotatedVsSettled));
    for (const shot of ['initial', 'rotated', 'settled']) {
      const noise = await diff(n1[shot].png, n2[shot].png);
      const vsOld = await diff(n1[shot].png, o[shot].png);
      entry.shots[shot] = {
        stable: { new: n1[shot].stable, newRepeat: n2[shot].stable, old: o[shot].stable },
        clip: n1[shot].clip,
        noise,
        vsOld,
      };
      log(look, shot, 'noise', JSON.stringify(noise), 'vsOld', JSON.stringify(vsOld), 'stable', JSON.stringify(entry.shots[shot].stable));
      if (PNG_DIR) {
        for (const [tag, cap] of [['new', n1], ['old', o]]) {
          writeFileSync(`${PNG_DIR}/${look}-${shot}-${tag}.png`, Buffer.from(cap[shot].png, 'base64'));
        }
      }
    }
    results.looks[look] = entry;
    writeFileSync(outFile, JSON.stringify(results, null, 2));
  }
} finally {
  results.finishedAt = new Date().toISOString();
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  await browser.close();
  log('wrote', outFile);
}
