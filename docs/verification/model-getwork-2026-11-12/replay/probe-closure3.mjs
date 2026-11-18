// 只读（GET 8022 /api/v1/health）：闭包成员逐个列出来（库号、类型、文件、大小），存成清单给沙箱复制用。
import fs from 'node:fs';
import path from 'node:path';
const h = await (await fetch('http://127.0.0.1:8022/api/v1/health')).json();
const c = h.mdb_closure;
const sample = c.projects[0];
console.log('project keys:', Object.keys(sample).join(','));
const dbnums = sample.dbnums;
console.log('dbnums is', Array.isArray(dbnums) ? `array[${dbnums.length}] first=${JSON.stringify(dbnums[0])}` : `object keys=${Object.keys(dbnums).slice(0, 5)} first=${JSON.stringify(Object.values(dbnums)[0])}`);
console.log('db_dirs:', JSON.stringify(sample.db_dirs));
console.log('sys:', c.sys, 'declaration_error:', c.declaration_error);
fs.writeFileSync(new URL('./closure-from-8022.json', import.meta.url), JSON.stringify({ takenAt: new Date().toISOString(), project: h.project, mdb: h.mdb, closure: c }, null, 1));
