// 第三轮改了代码之后：把旧清单里对不上的 7 条按新代码重写，并给这一轮新写的判断另起一份清单（mutations-r3.json）。
//   node fullrun-r3/update-mutations-r3.mjs
// 每条的 find 都要求在最终代码里恰好出现一次；对不上就报错、什么都不写。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cwd = '<plant3d-web-worktree>';
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const source = (file) => fs.readFileSync(path.join(cwd, file), 'utf8');

function rewrite(spec, id, patch) {
  const entry = spec.mutations.find((item) => item.id === id);
  if (!entry) throw new Error(`清单里没有 ${id}`);
  Object.assign(entry, patch);
}

function verify(name, spec) {
  for (const mutation of spec.mutations) {
    const text = source(mutation.file);
    const hits = text.split(mutation.find).length - 1;
    if (hits !== 1) throw new Error(`${name} ${mutation.id}：find 在 ${mutation.file} 里出现 ${hits} 次（要恰好 1 次）：${mutation.find.slice(0, 70)}`);
    if (mutation.find === mutation.replace) throw new Error(`${name} ${mutation.id}：find 与 replace 一样`);
  }
}

const ENGINE = 'src/composables/modelGetWork.ts';
const WIRING = 'src/composables/useModelGetWork.ts';
const DISPLAY = 'src/composables/useModelGeneration.ts';
const NOTICE = 'src/composables/useGenModelV1UpdateNotice.ts';
const BADGE = 'src/components/model-tree/GenModelV1HealthBadge.vue';
const VIEWER = 'src/components/dock_panels/ViewerPanel.vue';
const APP = 'src/App.vue';

// ------------------------------------------------------------------ 旧清单里对不上的 7 条
const models = read('mutations-models.json');
// 说的事没变，照新写法重写
rewrite(models, 'G19', {
  find: "      return { kind: 'keep', reason: '这个节点落后（模型生成之后又有会话改到了它），屏幕上的没有可换的新版；行上的「更新」可让后端追上' };",
  replace: "      return { kind: 'reload', note: null };",
});
rewrite(models, 'M05', {
  note: '护栏失效：服务端没有节点模型状态接口时不问模型树、直接撤',
  find: '      if (!facts) return await goneFromLibraryPerTree(root);',
  replace: "      if (!facts) return { removed: true, why: '' };",
});
// M08 原来是「别的重载入口也走护栏」——第三轮起这就是代码本来的行为了，这一条换成它的反面
rewrite(models, 'M08', {
  note: '护栏只有取最新发起的重载才过（状态栏、行上的「重载」和重新部署后的重装不过）',
  find: '          if (!notCollected) {\n            const confirmed = await emptyRefreshMeansRemoved(normalizedRoot);',
  replace: '          if (!notCollected && quiet) {\n            const confirmed = await emptyRefreshMeansRemoved(normalizedRoot);',
});
rewrite(models, 'M09', {
  find: '          if (!notCollected) {\n            const confirmed = await emptyRefreshMeansRemoved(normalizedRoot);',
  replace: '          if (refresh) {\n            const confirmed = await emptyRefreshMeansRemoved(normalizedRoot);',
});
rewrite(models, 'M12', {
  find: '            || scopeIncomplete.truncated_roots.length > 0\n            || Object.keys(scopeIncomplete.errors).length > 0\n          );\n          if (!notCollected) {',
  replace: '            || Object.keys(scopeIncomplete.errors).length > 0\n          );\n          if (!notCollected) {',
});
rewrite(models, 'M13', {
  find: '            || scopeIncomplete.truncated_roots.length > 0\n            || Object.keys(scopeIncomplete.errors).length > 0\n          );\n          if (!notCollected) {',
  replace: '            || scopeIncomplete.truncated_roots.length > 0\n          );\n          if (!notCollected) {',
});
rewrite(models, 'B06', {
  find: 'const noticeTitle = computed(() => `${updateNotice.title.value}\\n要把模型树和已装的模型一起同步到最新，点右边的「取最新」`);',
  replace: 'const noticeTitle = computed(() => updateNotice.title.value);',
});
verify('mutations-models.json', models);

// ------------------------------------------------------------------ 这一轮新写的判断
const mutations = [];
const add = (id, file, note, find, replace) => mutations.push({ id, file, note, find, replace });

// ---- 第 2 项：取最新期间不弹每个节点各自的提示（quiet）
add('Y01', DISPLAY, 'quiet 不起作用：照旧弹', '      if (!quiet) emitToast(payload);', '      emitToast(payload);');
add('Y02', DISPLAY, 'quiet 反了：没要求不弹的反而不弹', "    const quiet = loadOptions?.quiet === true;", "    const quiet = loadOptions?.quiet !== true;");
add('Y03', DISPLAY, '查空撤下的那一句绕过静音的出口',
  '    toast({ message: `[提示] ${root} 在最新记录里已没有几何（已删除或成员已删光），已从场景撤下`, level: \'info\' });',
  '    emitToast({ message: `[提示] ${root} 在最新记录里已没有几何（已删除或成员已删光），已从场景撤下`, level: \'info\' });');
add('Y04', DISPLAY, '「已加载 N 个几何实例」绕过静音的出口',
  "          toast({ message: `[成功] 已从 gen-model 加载 ${v1Result.loadedObjects} 个几何实例`, level: 'success' });",
  "          emitToast({ message: `[成功] 已从 gen-model 加载 ${v1Result.loadedObjects} 个几何实例`, level: 'success' });");
add('Y05', DISPLAY, '「重载未完成」绕过静音的出口',
  "        toast({ message: `[警告] ${normalizedRoot} 重载未完成：${why}，场景保持原样`, level: 'warning' });",
  "        emitToast({ message: `[警告] ${normalizedRoot} 重载未完成：${why}，场景保持原样`, level: 'warning' });");
add('Y06', DISPLAY, '「模型加载失败」绕过静音的出口',
  "      toast({ message: `[错误] 模型加载失败：${msg}`, level: 'error' });",
  "      emitToast({ message: `[错误] 模型加载失败：${msg}`, level: 'error' });");
add('Y07', DISPLAY, '被叫停的那一句绕过静音的出口',
  '        toast({\n          message: update\n            ? `[提示] ${normalizedRoot}：已停止更新，屏幕上的没有动`',
  '        emitToast({\n          message: update\n            ? `[提示] ${normalizedRoot}：已停止更新，屏幕上的没有动`');
add('Y08', DISPLAY, '装载出错不进控制台（不弹的时候错在哪就查不到了）',
  "      consoleStore.addLog('error', `[model-load] refno=${normalizedRoot} 加载失败：${msg}`);\n", '');

// ---- 第 1 项：所有的重载都过查空的护栏
add('Y10', DISPLAY, '旧后端：模型树回任何失败都当成节点没了',
  "      if (!resp.success && isTreeNodeGoneMessage(resp.error_message)) return { removed: true, why: '' };",
  "      if (!resp.success) return { removed: true, why: '' };");
add('Y11', DISPLAY, '旧后端：模型树明说没有这个节点也不撤',
  "      if (!resp.success && isTreeNodeGoneMessage(resp.error_message)) return { removed: true, why: '' };",
  "      if (!resp.success && isTreeNodeGoneMessage(resp.error_message)) return { removed: false, why: '' };");
add('Y12', DISPLAY, '旧后端：确认不了也撤',
  "    return { removed: false, why: '后端没有节点模型状态接口，确认不了它名下是不是真的没有几何了' };",
  "    return { removed: true, why: '后端没有节点模型状态接口，确认不了它名下是不是真的没有几何了' };");
add('Y13', DISPLAY, '确认的那一会儿被叫停，照样往下撤',
  '            // 确认的这一会儿被叫停：还没开始撤，场景保持原样\n            session.throwIfStopped();\n',
  '            // 确认的这一会儿被叫停：还没开始撤，场景保持原样\n');
add('Y14', DISPLAY, '护栏挡住了却不告诉人',
  '              toast({\n                message: `[警告] ${normalizedRoot} 重载未完成：记录查空，但${confirmed.why}——没有当成已删除，场景保持原样`,\n                level: \'warning\',\n              });\n',
  '');
add('Y15', DISPLAY, '护栏挡住之后不叫行上的状态重问',
  '              // 行上的状态多半还是重启之前问到的：重问一次，让它照实说（未生成的会给「生成」）\n              recheckLoadedNode(normalizedRoot);\n',
  '              // 行上的状态多半还是重启之前问到的：重问一次，让它照实说（未生成的会给「生成」）\n');
add('Y16', DISPLAY, '「后端判不了」说成「没有完整模型」', "          : facts.verdict === 'unknown'\n", "          : facts.verdict === 'unknown-'\n");
add('Y17', DISPLAY, '「库正在更新」的原因说反了', "        why: facts.verdict === 'updating'\n", "        why: facts.verdict !== 'updating'\n");

// ---- 第 4 项：一次重载几个节点时的次序
add('Y20', DISPLAY, '不记这一轮里已经装上的构件',
  '      if (refresh && loadOptions?.round) for (const key of loadRefnos) loadOptions.round.installed.add(key);\n', '');
add('Y21', DISPLAY, '成员差集不看这一轮的账：先重载的节点刚装上的构件照撤',
  '    const stale = previousLeaves.filter((refno) => !keep.has(refno) && !round?.installed.has(refno));',
  '    const stale = previousLeaves.filter((refno) => !keep.has(refno));');
add('Y22', DISPLAY, '整个节点查空撤下时不看这一轮的账',
  '      .filter((refno) => !round?.installed.has(refno));', '      .filter(() => true);');
add('Y23', DISPLAY, '这一轮的账没有交给成员差集',
  '      if (refresh && !scopeIncomplete) evictMembersMissingFromRefresh(dbno, normalizedRoot, previousLeaves, loadRefnos, loadOptions?.round);',
  '      if (refresh && !scopeIncomplete) evictMembersMissingFromRefresh(dbno, normalizedRoot, previousLeaves, loadRefnos, undefined);');
add('Y24', DISPLAY, '这一轮的账没有交给查空的收尾',
  '          return finishRefreshOfEmptyRoot(dbno, normalizedRoot, previousLeaves, scopeIncomplete, visibleSource, toast, loadOptions?.round);',
  '          return finishRefreshOfEmptyRoot(dbno, normalizedRoot, previousLeaves, scopeIncomplete, visibleSource, toast, undefined);');
add('Y25', DISPLAY, '记账时把正在重载的节点自己也记上', '      if (other === root) continue;\n', '');
add('Y26', DISPLAY, '成员差集：按「想撤的」而不是「真撤掉对象的」去找别的节点',
  '    flagRootsLosingRefnos(root, evicted);\n    consoleStore.addLog(\n      \'info\',\n      `[model-load] 重载 ${root}：${stale.length} 个构件已不在最新记录里',
  '    flagRootsLosingRefnos(root, stale);\n    consoleStore.addLog(\n      \'info\',\n      `[model-load] 重载 ${root}：${stale.length} 个构件已不在最新记录里');
add('Y27', DISPLAY, '成员差集撤掉了别的节点名下的构件却不记账',
  '    flagRootsLosingRefnos(root, evicted);\n    consoleStore.addLog(\n      \'info\',\n      `[model-load] 重载 ${root}：${stale.length} 个构件已不在最新记录里',
  '    consoleStore.addLog(\n      \'info\',\n      `[model-load] 重载 ${root}：${stale.length} 个构件已不在最新记录里');
add('Y28', DISPLAY, '整个节点查空撤下：按「想撤的」而不是「真撤掉对象的」去找别的节点',
  '    flagRootsLosingRefnos(root, evicted);\n    statusMessage.value = `refno=${root} 最新记录里已没有几何，已从场景撤下`;',
  '    flagRootsLosingRefnos(root, targets);\n    statusMessage.value = `refno=${root} 最新记录里已没有几何，已从场景撤下`;');
add('Y29', DISPLAY, '整个节点查空撤下时带走了别的节点名下的构件却不记账',
  '    flagRootsLosingRefnos(root, evicted);\n    statusMessage.value = `refno=${root} 最新记录里已没有几何，已从场景撤下`;',
  '    statusMessage.value = `refno=${root} 最新记录里已没有几何，已从场景撤下`;');
add('Y30', DISPLAY, '记的那一笔没有写原因',
  '        markLoadedNodeStale(other, LOST_MEMBERS_STALE_REASON);', "        markLoadedNodeStale(other, '');");
add('Y31', DISPLAY, '同一个节点丢了几个构件就记几笔',
  '        markLoadedNodeStale(other, LOST_MEMBERS_STALE_REASON);\n        break;\n', '        markLoadedNodeStale(other, LOST_MEMBERS_STALE_REASON);\n');
add('Y32', DISPLAY, '记账时不管那个构件是不是真在它名下：见到别的节点就记',
  '        if (!gone.has(member)) continue;\n', '');

// ---- 查看器面板里的接线（源码钉看着）
add('Y40', VIEWER, '取最新发起的重载不带 quiet',
  '      await modelGenerationRef.value?.showModelByRefno(refno, { refresh: true, flyTo: false, quiet: true })',
  '      await modelGenerationRef.value?.showModelByRefno(refno, { refresh: true, flyTo: false })');
add('Y41', VIEWER, '一次事件重载几个根：不开那份账',
  '        const reloadRound = (detail as any)?.refreshModel ? createModelReloadRound() : undefined;',
  '        const reloadRound = undefined;');
add('Y42', VIEWER, '一次事件重载几个根：开了账却不带给每个根', '            round: reloadRound,\n', '');
add('Y43', VIEWER, '提示的场景探针不报页面上装着节点的库', '    loadedDbnums: loadedModelDbnums,', '    loadedDbnums: () => [],');

// ---- 第 3 项：「数据已更新」的提示不漏报
add('Y50', NOTICE, '探针不认页面上装着节点的库（只认激活的那个）',
  '      const out = new Set<number>(deps.loadedDbnums());', '      const out = new Set<number>();');
add('Y51', NOTICE, '探针不认当前激活的库了（空间查询这类不进登记表的装法会漏）',
  '      if (active !== null) out.add(active);\n', '');
add('Y52', WIRING, '装着节点的库：漏掉已加载节点表和登记的直装根',
  '  for (const root of currentRoots()) out.add(root.dbnum);\n', '');
add('Y53', WIRING, '装着节点的库：漏掉整库显示过的库',
  '  for (const scope of getWorkRegisteredScopes()) out.add(scope.dbnum);\n', '');
add('Y54', NOTICE, '认不出可重载的根时仍说「受影响的构件都不在场景里，不用重载」',
  "    : '这一批改到的单元里没有本页单独装过的（经上层的 SITE / ZONE 装进来的在这里认不出），所以没有「重载」可点');",
  "    : '受影响的构件都不在场景里，不用重载');");
add('Y55', NOTICE, '有「重载」时不说明名单不全',
  '；不重新生成、不动相机（经上层的 SITE / ZONE 装进来的单元不在这份名单里）`', '；不重新生成、不动相机`');
add('Y56', BADGE, '没有「重载」可点时不画那句「点「取最新」同步」',
  '      <span v-else\n        data-testid="gen-model-v1-update-notice-getwork-hint"',
  '      <span v-if="false"\n        data-testid="gen-model-v1-update-notice-getwork-hint"');
add('Y57', BADGE, '有「重载」可点时也画那句引导（两样一起出）',
  '      <span v-else\n        data-testid="gen-model-v1-update-notice-getwork-hint"',
  '      <span v-if="updateNotice.notice.value"\n        data-testid="gen-model-v1-update-notice-getwork-hint"');
add('Y58', BADGE, '那句引导会跟着前面的字一起被截断',
  '        class="shrink-0 text-muted-foreground">点「取最新」同步</span>', '        class="text-muted-foreground">点「取最新」同步</span>');

// ---- 第 5 项：提示条不压状态栏（源码钉看着）
add('Y60', APP, '提示条不抬（回到贴着底边）', '  margin-bottom: calc(1.75rem + 8px);', '  margin-bottom: 8px;');
add('Y61', APP, '提示条抬得比状态栏矮', '  margin-bottom: calc(1.75rem + 8px);', '  margin-bottom: calc(1rem + 8px);');
add('Y62', APP, '样式带了 scoped（够不着挂在页面最外层的提示条）', '<style>\n.ribbon-app-bar {', '<style scoped>\n.ribbon-app-bar {');
add('Y63', APP, '状态栏变高了、提示条没跟着抬',
  '<div class="flex h-7 shrink-0 items-center border-t border-border bg-background px-2"',
  '<div class="flex h-10 shrink-0 items-center border-t border-border bg-background px-2"');

add('Y64', APP, '装着停靠布局和状态栏的那一列不能随窗口变窄（去掉 min-w-0）',
  '<div class="flex-1 min-h-0 min-w-0 flex flex-col">', '<div class="flex-1 min-h-0 flex flex-col">');

// ---- 第 7 项：取最新自己的句子里的叫法
add('Y70', ENGINE, '点名的那一句退回「监听范围」',
  'text: `库 ${dbnum} 不在后端更新范围里：模型停在会话 ${model}，库文件已到 ${fileLatest}（树已是最新，模型不会自动跟上）`,',
  'text: `库 ${dbnum} 不在后台的监听范围里：模型停在会话 ${model}，库文件已到 ${fileLatest}（树已是最新，模型不会自动跟上）`,');
add('Y71', ENGINE, '「水位」又单说了',
  'text: `库 ${dbnum} 的三枚水位（库文件最新会话、数据入库到的会话、模型生成所按的会话）对不上，新旧判不了` };',
  'text: `库 ${dbnum} 的水位对不上，新旧判不了` };');
add('Y72', ENGINE, '节点落后的那一句退回「后台的模型落后于库文件」',
  "      const behind = '这个节点落后（模型生成之后又有会话改到了它）：这次换上的是后台现有的那一版；行上的「更新」可让后端追上';",
  "      const behind = '后台的模型落后于库文件，这次换上的是后台现有的那一版；行上的「更新」可让后端追上';");

// ---- 真实后端上查出的那一处：头一轮取最新就认得出重启
add('Y80', ENGINE, '头一轮不拿页面打开时的服务代次比（退回只和上一轮比）',
  '  let lastGeneration: number | null = ports.initialGeneration ?? null;', '  let lastGeneration: number | null = null;');
add('Y81', WIRING, '接线没有把页面打开时的服务代次交给引擎', '  initialGeneration: getGenModelV1ServiceGeneration(),\n', '');
add('Y82', ENGINE, '认出重启了却不在细节里说',
  "  if (report.backendRestarted) detail.push('这次取最新之前后端重启过');\n", '');

const r3 = {
  cwd,
  tests: [
    'src/composables/useModelGeneration.genModelV1.test.ts',
    'src/components/dock_panels/ViewerPanel.getwork.test.ts',
    'src/composables/useGenModelV1UpdateNotice.test.ts',
    'src/composables/useModelGetWork.test.ts',
    'src/composables/modelGetWork.test.ts',
    'src/components/model-tree/GenModelV1HealthBadge.test.ts',
    'src/App.statusBar.test.ts',
  ],
  out: 'mutations-r3.result.json',
  mutations,
};
verify('mutations-r3.json', r3);

const write = (name, spec) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
write('mutations-models.json', models);
write('mutations-r3.json', r3);
console.log(`mutations-models.json：重写 7 条（G19、M05、M08、M09、M12、M13、B06）；mutations-r3.json：${mutations.length} 条`);
