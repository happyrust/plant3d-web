import { chromium } from 'playwright';

const FRONT = process.env.FRONT || 'http://127.0.0.1:5173';
const OUTDIR = 'D:/work/plant-code/plant3d-web';
const UNIT = '24381_145018';
const DBNUM = 7997;

const logs = [];
const findLog = (needle) => logs.some((l) => l.includes(needle));

const browser = await chromium.launch({
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 400)));

console.log('GOTO', `${FRONT}/?output_project=AvevaMarineSample`);
await page.goto(`${FRONT}/?output_project=AvevaMarineSample`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('canvas', { timeout: 60000 });
// let the Vue app + ViewerPanel (modelGenerationRef) fully mount
await page.waitForTimeout(10000);

async function dispatchUnit(sesno) {
  const reqId = `unit_${sesno}_${Date.now()}`;
  await page.evaluate(({ sesno, reqId, UNIT, DBNUM }) => {
    window.dispatchEvent(
      new CustomEvent('showModelByRefnos', {
        detail: { refnos: [UNIT], dbnum: DBNUM, sesno, flyTo: true, requestId: reqId },
      })
    );
  }, { sesno, reqId, UNIT, DBNUM });
  return reqId;
}

async function loadUnit(sesno, outName) {
  const marker = `unit version loaded dbno=${DBNUM} unit_refno=${UNIT} sesno=${sesno}`;
  const before = logs.length;
  await dispatchUnit(sesno);
  // wait for the handler to acknowledge; retry a couple times if the app wasn't ready
  let ok = false;
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(2000);
    if (findLog(marker)) { ok = true; break; }
    // if handler never even logged the event, re-dispatch
    const sawEvent = logs.slice(before).some((l) => l.includes('[vis][event] showModelByRefnos'));
    if (!sawEvent && i === 3) await dispatchUnit(sesno);
    if (i === 10 && !ok) await dispatchUnit(sesno);
  }
  await page.waitForTimeout(4000); // settle render + camera flyTo
  await page.screenshot({ path: `${OUTDIR}/${outName}` });
  return { sesno, ok, out: outName };
}

const results = [];
results.push(await loadUnit(791, 'bran-24381_145018-unit-v791.png'));
results.push(await loadUnit(898, 'bran-24381_145018-unit-v898.png'));

console.log('RESULTS', JSON.stringify(results));
console.log('--- relevant logs ---');
console.log(
  logs
    .filter((l) => /unit version loaded|showModelByRefnos|已加载|Model loaded|instance_count|tubi|Tubing|missing|错误|error|manifest/i.test(l))
    .slice(-70)
    .join('\n')
);

await browser.close();
