# 增量测试「PML 触发 + 网页验收」：页面这一侧

这个目录管「开页面、采数、判定」：经带请求闸门的浏览器打开页面，装上用例要看的节点，等外面给的命令在 E3D 里存盘，
不碰页面等行上的信号，点一次「取最新」，然后逐项判 W1–W7。它不认识 E3D，也不带那一侧的路径。

开 E3D、管副本的起点、起隔离后端和页面服务、用例表，都在 gen-model 仓库的 `scripts/e3d/increment_suite/web/`；
平时从那边的 `Invoke-SuiteWeb.ps1` 一条命令跑，跑法、报告怎么读、红了怎么查见那边的 README。规格在 gen-model 的
`docs/plans/2026-11-17-increment-pml-web-acceptance-spec.md`。

## 文件

| 文件 | 做什么 |
|---|---|
| `run.mjs` | runner：读运行配置，一条一条跑用例，每条腿落一份证据，最后出 `report.json`、`report.md` |
| `serve.mjs` | 页面服务：把这棵工作树的页面代码起成只听本机回环的开发服务，接口只转到隔离后端 |
| `selftest-replay.mjs` | 取数层的回放自测：用录好的 E3D 会话代替存盘，把「一条腿」真跑一遍 |
| `lib/case-runner.mjs` | 一条用例的来回：前提、腿命令、W4（场景 = E3D）、和用例表对一遍（X）、腿点完之后加装节点再判一回、证据文件 |
| `lib/leg.mjs` | 一条腿的流程：存盘前记一遍 → 存盘 → 等信号 → 等后端跟上 → 点「取最新」→ 再记一遍 → 判；手动路径多一段点行上的「更新」；另有加装（`loadMore`）：腿判完之后在同一个页面里再装几个节点、再采一遍 |
| `lib/page.mjs` | 页面取数：请求闸门、开页面、装节点、读行状态、点「取最新」读回执、读场景对象和模型树、请求和报错清单 |
| `lib/backend.mjs` | 隔离后端的只读接口，外加按后端存盘前后的差算回执的预期 |
| `lib/rvm.mjs` | 读 E3D 只读导出的 RVM 快照（W4 的真值） |
| `lib/judge.mjs` | W1–W7 和 X 的判定，全是纯函数 |
| `lib/known-gaps.json` | 已知缺口的登记表：条件逐项命中才记，记了不算过、也不算不过 |
| `lib/judge.selftest.mjs` | 判定函数的自测：每个看点至少一个正例、一个反例 |

## 守着的几条

- 页面发的请求过闸门（`lib/page.mjs` 的 `createGuardedContext`）：发往现网后端的一律拦下并记数；写请求只放行发往隔离后端的
  几种只读查询；页面弹的框一律取消。只有手动路径点行上「更新」的那一下，临时放行一条发给隔离后端的更新请求和一个确认框。
- 脚本自己只问运行配置里的隔离后端（本机回环），只读。
- 存盘之后、行上的信号出来之前，脚本在页面上什么都不碰（每个操作都记在案，W1 会查）。
- 写的只有证据目录；证据里的地址和文本，像令牌、口令这一类参数的值一律打码。
- 预期不取页面自己的说法：回执的预期按后端存盘前后的差算，场景对后端记录、对 E3D 导出。

## 自测

在这棵工作树的根目录跑：

```powershell
# 判定函数的自测（不开浏览器、不连后端；反例必须判不过）
node --test e2e/increment-pml/lib/judge.selftest.mjs

# 只看一份运行配置写得对不对（不开浏览器、不问后端、不建目录）；写得对退出 0。
# runner 不肯把东西放在系统盘上：临时目录（TEMP）在系统盘的机器，先把它指到别的盘，否则退出 2
$env:TEMP = '<别的盘上的目录>'; $env:TMP = $env:TEMP
node e2e/increment-pml/run.mjs --config <运行配置.json> --out <证据目录> --check-config

# 代码检查
npx eslint e2e/increment-pml
```

运行配置由 gen-model 那边的 `Invoke-SuiteWeb.ps1` 按用例表生成（`-PlanOnly` 只生成不跑），不手写。

回放自测要一套回放数据和对着它起的隔离后端，平时不跑：
`node e2e/increment-pml/selftest-replay.mjs --config <配置.json> [--out <目录>]`。

## 腿点完之后再装节点

运行配置里一条腿可以带 `thenLoad`：`roots`（要加装的节点：参考号、库号、名字）和 `truth.groups`（加装之后拿去和这条腿的 E3D 导出比的节点和比法）。
用在「节点开头装不进场景（名下没有几何）、这条腿改完才有」的地方，比如换上级的目标设备。

- 这条腿点完「取最新」、采完数、记完相机之后，runner 在同一个页面里把这些节点装上（点树上的眼睛），再采一遍页面和后端，再判一回：
  W3 判装着的全部节点，W4 判 `truth.groups` 里的节点。
- 这一回并进这条腿原有的 W3、W4 两格（`lib/judge.mjs` 的 `joinJudgements`：问题前面加「加装 … 之后：」，后一回的事实在 `facts.afterLoad`），
  格子数不变；W6 的范围延到装完；这条腿的用时里包着加装。
- 装不上不中断：W3 记「不过」，写明是哪个节点没装进场景。
- 加装的节点之后一直装着，后面的腿把它当成已装的节点：存盘前后都采，回执的预期里有它，`affected` 里可以写它。
- 限制：要加装的节点开头不能已经装着；库号要在开头装的节点所在的库里；这条腿要判 W3（`truth.groups` 不空时还要判 W4）；
  手动路径的腿不支持。写法不对，开跑之前就拦下（退出 2，`--check-config` 也查）。

## 直接调 runner

```powershell
node e2e/increment-pml/run.mjs --config <运行配置.json> --out <证据目录> [--case K16,K17] [--headed]
```

退出码：0 跑完了，没有「不过」（已知缺口不算）；1 跑完了，有「不过」；2 没跑完（参数或运行配置不对也是 2）。
一条用例没跑完就停，后面的不跑：副本这时可能不在起点上。所以平时由编排脚本一条用例调一次，没跑完就回起点再接着跑下一条。
直接调的时候，隔离后端、页面服务、副本在起点这几样要自己先备好（gen-model 那边的 `Reset-StartPackage.ps1 -Copy <副本名> -Start`、
`Invoke-PageService.ps1 -Action start`）。存盘由运行配置里每条腿的命令去做（那边的 `Invoke-WebLeg.ps1`，经套件入口起 E3D），runner 自己不起 E3D。
证据目录、浏览器缓存目录（运行配置里的 `browser.cacheDir`，不写就在证据目录下）、临时目录（TEMP）有一个在系统盘上就拒绝（退出 2）；
证据目录里已经有一份报告也拒绝，不覆盖。经编排脚本跑的时候，这几样它都安排好了。

## 证据（每条用例一个目录）

```
<证据目录>\
  report.json  report.md
  _browser-cache\                   浏览器缓存（运行配置没有另指目录时在这里）
  <用例号>\
    00-baseline.png                 装好节点、还没存盘
    <腿>-1-before-click.png         信号出来了、还没点「取最新」（手动路径另有 <腿>-0-before-update.png）
    <腿>-2-after.png                点了之后
    <腿>-3-after-load.png           这条腿带 thenLoad 时：加装之后
    <腿>.judgements.json            各看点的判定：问题、实际值和预期值、行状态的时间线
    <腿>.leg.json                   腿命令交回的结果：各步、会话号、导出的快照
    <腿>.record.json                存盘前后采的数（行、场景、树、后端记录和水位）
    <腿>.requests.json              这条腿页面发的请求和失败的响应
    case.json  requests.json
```
