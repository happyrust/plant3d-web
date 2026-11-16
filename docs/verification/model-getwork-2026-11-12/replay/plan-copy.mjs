// 只读：按闭包清单算出要复制的库文件（<库目录>/<项目码><库号>_0001）和各目录里不是库号文件的那些。
import fs from 'node:fs';
import path from 'node:path';
const { closure: c } = JSON.parse(fs.readFileSync(new URL('./closure-from-8022.json', import.meta.url), 'utf8'));
let total = 0;
const plan = [];
for (const p of c.projects) {
  const dir = p.db_dirs[0];
  const names = fs.readdirSync(dir);
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const code = p.codes[0].toLowerCase();
  let bytes = 0; const missing = []; const files = [];
  for (const dbnum of p.dbnums) {
    const want = `${code}${dbnum}_0001`;
    const real = lower.get(want);
    if (!real) { missing.push(dbnum); continue; }
    const size = fs.statSync(path.join(dir, real)).size;
    bytes += size; files.push({ dbnum, name: real, size });
  }
  const special = names.filter((n) => !/^[a-z]{3}\d+_\d{4}$/i.test(n));
  const specialBytes = special.reduce((s, n) => { try { const st = fs.statSync(path.join(dir, n)); return s + (st.isFile() ? st.size : 0); } catch { return s; } }, 0);
  console.log(`${p.name} ${dir}: 闭包成员 ${files.length} 个 ${(bytes / 1048576).toFixed(1)} MB，缺 ${missing.length}${missing.length ? ' ' + missing.join(',') : ''}；非库号文件 ${special.length} 个 ${(specialBytes / 1048576).toFixed(1)} MB：${special.slice(0, 12).join(' ')}`);
  total += bytes + specialBytes;
  plan.push({ project: p.name, code, dir, files, special });
}
console.log('合计 MB', (total / 1048576).toFixed(1));
fs.writeFileSync(new URL('./copy-plan.json', import.meta.url), JSON.stringify(plan, null, 1));
