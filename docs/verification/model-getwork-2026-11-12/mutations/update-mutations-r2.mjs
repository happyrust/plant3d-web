// 真实回放查出问题、改了代码之后：把三份清单里对不上的 3 条按新代码重写，并给新代码另起一份清单（mutations-replay.json）。
//   node fullrun/update-mutations-r2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cwd = '<plant3d-web-worktree>';
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
// 缩进照清单原来的写法（两个空格），免得整份文件都算改过
const write = (name, spec) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
const source = (file) => fs.readFileSync(path.join(cwd, file), 'utf8');

function rewrite(spec, id, patch) {
  const entry = spec.mutations.find((item) => item.id === id);
  if (!entry) throw new Error(`清单里没有 ${id}`);
  Object.assign(entry, patch);
}

const ENGINE = 'src/composables/modelGetWork.ts';
const WIRING = 'src/composables/useModelGetWork.ts';
const BUTTON = 'src/components/model-tree/ModelGetWorkButton.vue';

// ---- 三份旧清单里对不上的 3 条：说的事没变，照新代码的写法重写
const models = read('mutations-models.json');
rewrite(models, 'G45', {
  find: '        steps.push({ root, removed: new Set(members), after: null, reloadedIndex: null });\n        ports.forgetRoot(root.refno);',
  replace: '        steps.push({ root, removed: new Set(members), after: null, reloadedIndex: null });',
});
rewrite(models, 'G50', {
  find: "      if (!after || after.length === 0) {\n        for (const refno of outcome.before) removedAll.add(refno);\n        steps.push({ root, removed: outcome.before, after: null, reloadedIndex: null });\n        models.withdrawn.push({ refno: root.refno, refnos: outcome.before.size, why: 'empty' });\n        continue;\n      }",
  replace: '      if (!after) continue;',
});
write('mutations-models.json', models);

const round3 = read('mutations-round3.json');
rewrite(round3, 'H08', {
  find: '      models.componentsRemoved = [...removedAll].filter((refno) => !addedAll.has(refno) && !present.has(refno)).length + removedUnnamed;',
  replace: '      models.componentsRemoved = models.reloaded.reduce((sum, item) => sum + item.removed, 0) + models.withdrawn.reduce((sum, item) => sum + item.refnos, 0);',
});
write('mutations-round3.json', round3);

// ---- 第四份：这一轮新写的判断
const button = source(BUTTON);
const eol = button.includes('\r\n') ? '\r\n' : '\n';
const spanStart = button.indexOf('    <span v-if="last && !running"');
const spanEnd = button.indexOf('{{ last.summary }}</span>') + '{{ last.summary }}</span>'.length;
const buttonStart = button.indexOf('    <button type="button"');
const buttonEnd = button.indexOf('    </button>') + '    </button>'.length;
if (spanStart < 0 || buttonStart < 0 || spanEnd > buttonStart) throw new Error('按钮组件的模板和预想的不一样');
const spanBlock = button.slice(spanStart, spanEnd);
const buttonBlock = button.slice(buttonStart, buttonEnd);

const replay = {
  cwd,
  tests: [
    'src/composables/modelGetWork.test.ts',
    'src/composables/useModelGetWork.test.ts',
    'src/components/model-tree/ModelGetWorkButton.test.ts',
  ],
  out: 'mutations-replay.result.json',
  mutations: [
    // 不问节点版本表，库里的模型比本页新就重载
    {
      id: 'X01', file: WIRING, note: '库里的模型比本页装的新也不算有更新（不重载）',
      find: '  return [{ sesno: sesnoOf(row?.model_sesno) ?? sinceSesno + 1, time: null, unitsChanged: 0 }];',
      replace: '  return [];',
    },
    {
      id: 'X02', file: WIRING, note: '库状态里没有这个库的那一行时算不出有更新',
      find: 'sesnoOf(row?.model_sesno) ?? sinceSesno + 1',
      replace: 'sesnoOf(row?.model_sesno) ?? sinceSesno',
    },
    {
      id: 'X03', file: WIRING, note: '不看库的模型水位、一律记在起点的下一个会话上（旧后端下凭空判成落后）',
      find: 'sesnoOf(row?.model_sesno) ?? sinceSesno + 1',
      replace: 'sinceSesno + 1',
    },
    {
      id: 'X04', file: WIRING, note: '又去问节点版本表',
      find: '      listChangedSessions: async ({ sinceSesno }) => assumeChangedSince(sinceSesno, row),',
      replace: "      listChangedSessions: async ({ dbnum, refno, sinceSesno }) => {\n        const table = await (await loadModelSource()).getModelSource().versions.listNodeVersions(dbnum, refno, 'subtree', { sinceSesno });\n        return table.versions.filter((version) => version.impact !== 'noop').map((version) => ({ sesno: version.sesno, time: version.sessionTime, unitsChanged: version.unitsChanged }));\n      },",
    },
    // 构件在两个在册节点之间挪了位置：补重载
    {
      id: 'X05', file: ENGINE, note: '挪了位置、还在别的节点名下的构件也算撤下',
      find: '.filter((refno) => !addedAll.has(refno) && !present.has(refno))',
      replace: '.filter((refno) => !addedAll.has(refno))',
    },
    {
      id: 'X06', file: ENGINE, note: '被删节点撤走的构件不记账（先重载的节点名下的被它撤走也不补）',
      find: '        steps.push({ root, removed: new Set(members), after: null, reloadedIndex: null });\n',
      replace: '',
    },
    {
      id: 'X07', file: ENGINE, note: '查空撤下的节点拿掉的构件不记账',
      find: '        steps.push({ root, removed: outcome.before, after: null, reloadedIndex: null });\n',
      replace: '',
    },
    {
      id: 'X08', file: ENGINE, note: '重载拿掉的构件不记账',
      find: '      steps.push({ root, removed: new Set(removed), after: afterSet, reloadedIndex: models.reloaded.length });',
      replace: '      steps.push({ root, removed: new Set<string>(), after: afterSet, reloadedIndex: models.reloaded.length });',
    },
    {
      id: 'X09', file: ENGINE, note: '先处理的节点拿掉的也算（丢构件的在前时多补一次）',
      find: '      return steps.slice(index + 1).some((later) => [...later.removed].some((refno) => mine.has(refno)));',
      replace: '      return steps.some((later) => [...later.removed].some((refno) => mine.has(refno)));',
    },
    {
      id: 'X10', file: ENGINE, note: '撤下的节点也去补重载',
      find: '      if (!mine) return false;\n      return steps.slice(index + 1)',
      replace: '      if (!mine) return true;\n      return steps.slice(index + 1)',
    },
    {
      id: 'X11', file: ENGINE, note: '补装之前不等别的装载',
      find: "      if (!(await waitLoadIdle())) {\n        models.failed.push({ refno: root.refno, reason: '有别的装载一直没结束，它名下被别的节点撤掉的构件这次没补装' });\n        continue;\n      }\n",
      replace: '',
    },
    {
      id: 'X12', file: ENGINE, note: '补装没做成不记失败',
      find: "      if (!ok) {\n        models.failed.push({ refno: root.refno, reason: '它名下有构件被别的节点的重载撤掉了，补装没有完成' });\n        continue;\n      }\n",
      replace: '',
    },
    {
      id: 'X13', file: ENGINE, note: '补装抛错不记失败',
      find: '        models.failed.push({ refno: root.refno, reason: `补装出错：${errorText(error)}` });\n',
      replace: '',
    },
    {
      id: 'X14', file: ENGINE, note: '补完之后现有构件数不更新',
      find: '      if (entry && now) entry.total = now.length;',
      replace: '',
    },
    {
      id: 'X15', file: ENGINE, note: '不补装（先重载的节点名下的构件被后来者拿掉就丢了）',
      find: '    for (let index = 0; index < repairs.length; index++) {',
      replace: '    for (let index = 0; index < 0; index++) {',
    },
    {
      id: 'X16', file: ENGINE, note: '补装时不说在做什么',
      find: '      ports.onProgress(`补装挪了位置的构件 ${index + 1}/${repairs.length}…`);\n',
      replace: '',
    },
    // 那一句：撤下分两种说
    {
      id: 'X17', file: ENGINE, note: '查空撤下的也说成「已不存在」',
      find: "  const withdrawnDeleted = models.withdrawn.filter((item) => item.why === 'deleted').length;",
      replace: '  const withdrawnDeleted = models.withdrawn.length;',
    },
    {
      id: 'X18', file: ENGINE, note: '查空撤下的那一句里不说',
      find: "    withdrawnEmpty > 0 ? `撤下 ${withdrawnEmpty} 个名下已没有几何的节点` : '',",
      replace: "    '',",
    },
    {
      id: 'X19', file: ENGINE, note: '库里已经没有的节点那一句里不说',
      find: "    withdrawnDeleted > 0 ? `撤下 ${withdrawnDeleted} 个已不存在的节点` : '',",
      replace: "    '',",
    },
    // 按钮钉在最右端
    {
      id: 'X20', file: BUTTON, note: '那一句又画回按钮右边（按钮不在最右端，会被提示条盖住）',
      find: `${spanBlock}${eol}${buttonBlock}`,
      replace: `${buttonBlock}${eol}${spanBlock}`,
    },
  ],
};
write('mutations-replay.json', replay);

// 核一遍：每条的 find 恰好一处
let bad = 0;
for (const [name, spec] of [['mutations-models.json', models], ['mutations-round3.json', round3], ['mutations-replay.json', replay]]) {
  for (const mutation of spec.mutations) {
    const count = source(mutation.file).split(mutation.find).length - 1;
    if (count !== 1) { bad += 1; console.log(`${name} ${mutation.id}：find 出现 ${count} 次`); }
  }
  console.log(`${name}：${spec.mutations.length} 条`);
}
console.log(bad === 0 ? '都对得上' : `有 ${bad} 条对不上`);
process.exitCode = bad === 0 ? 0 : 1;
