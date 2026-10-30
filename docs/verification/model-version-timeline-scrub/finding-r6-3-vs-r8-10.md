# 阶段 3 实测发现：R6.3 与 R8.10 在「单元根 + 仅自身」下无法同时成立

- 日期：2026-10-29
- 环境：8022，rocksdb 档，构建 `0.1.44+g7b193c35db44.1793274571.dirty`
- 夹具：dbnum 8000，BRAN `24384/23257`（73 个版本，73 个几何变化版本）
- 触发：`scripts/verify/realtime-history-smoke.ps1` 第 6 步「time 选择器与 resolve 一致」

## 现象

同一 refno、同一时间点，两条路由给出不同 sesno：

```
at = 2026-09-08T17:45:46+08:00（= 2026-09-08T09:45:46Z）
GET model/history/geometry?...&time=...        → X-Sesno: 419
GET node/versions/resolve?...&scope=self&at=... → sesno: 283
```

## 原因：两张版本表对「单元根」不是同一批行

design §1.2 第 3 步写过一句实施假设：

> `time` 选择器：取该单元「仅自身」版本表（`unit_versions` 已缓存）……
> 实时几何路由的 `time` 选择器调用同一个 `resolve_at_rows`，输入是该单元的「仅自身」版本表
> （`unit_versions` 按单元子树折叠，**与 `node_versions(scope=self)` 对单元根相同**；阶段 1 用 curl 核对两者对同一单元给出相同行集）

实测这一句不成立：

| 表 | 行数 | 含义 |
|---|---|---|
| `model/versions`（`unit_versions`） | **73** | 单元子树里任一成员变了就算这个单元的一版 |
| `node/versions?scope=self`（`node_versions`） | **5** | 只算单元根**自己那条记录**变了 |

`unit_versions.rs:1-10` 的模块注释说得很清楚：它按「落在该单元子树里的变化」折 `impact_kind`；
而 `node_versions(scope=self)` 折的是节点自身那一格（`NodeVersion.self_impact`，`node_versions.rs:51-62`）。
两者对单元根天然不同——单元根自己只有 5 次记录变化，它的成员改了 68 次。

## 为什么这是规范冲突，而不只是实现 bug

- **R6.3**：`time` 选择器 SHALL 在「该 Delivery_Unit『仅自身』范围的版本表」上解析。对交付单元而言，
  这个说法指向 `unit_versions`（单元自己的版本表 = 成员变化也算）；否则「按日期定位单元几何」会漏掉
  绝大多数几何真的变了的会话。
- **R8.10**：`Realtime_History_Query` 以 `time` 解析出的 sesno SHALL 等于时间点解析路由对
  「同一 refno、Compare_Scope『仅自身』、同一时间点」返回的 sesno。而 `resolve` 的 `scope=self`
  按 R8.1 走的是「该 Compare_Scope 的版本表」，实现上就是 `node_versions(scope=self)`。

对**单元根**这两个要求指向两张不同的表。对普通构件（叶子）两者一致，因为叶子没有子树，
`unit_versions` 折出来的就是它自己那一格；实测里 `24384/23257` 恰好是单元根，才暴露出来。

## 为什么界面上看不出来

前端 `useVersionScrubber.resolveDate` 从不向几何路由传 `time`：它先 `resolveNodeTime` 拿到 sesno，
再按 sesno 请求几何（`versionSource.ts` 的 `queryHistoryGeometry` 也只接受 `sesno`）。
所以这条不一致目前只影响契约，不影响界面行为。

但它会影响别的东西：外部调用方（脚本、别的客户端）若用 `time` 直接取几何，拿到的版本与
`resolve` 对不上；`scripts/verify/realtime-history-smoke.ps1` 第 6 步就是这类调用方。

## 三条可选出路（需规范所有者裁决）

1. **几何路由改用 `node_versions(scope=self)`**：严格满足 R8.10。代价是「按日期定位单元几何」
   会漏掉成员变化而单元根自身未变的会话（本例 73 版只剩 5 版），与 R6.3 的意图冲突。
2. **`resolve` 在 refno 是交付单元根且 `scope=self` 时改用 `unit_versions`**：满足 R8.10，
   且保住 R6.3 的意图。代价是前端 `scope=self` 的表（`element/versions` 自身列）与
   `resolve` 用的表不一致，`resolveDate` 可能把游标设到一个当前范围里没有刻度的 sesno。
   要配套改前端：单元根 + `self` 时不要把 `resolve` 结果直接当游标，或改前端该范围的取表口径。
3. **改 R8.10 的措辞**：把它限定为「对非交付单元根的节点」，或改成「与 `resolve` 对
   `scope=subtree` 的结果一致」。实测 `node/versions?scope=subtree` 对单元根给 73 行，
   与 `unit_versions` 行集相同（本次核对 `283` / `419` 两行都在），所以
   `geometry(time)` 与 `resolve(scope=subtree)` 是一致的。

### 2026-10-30 在当前构建上复核（结论不变，第 3 条证据更硬）

构建 `0.1.44+g1ca68639061e`、8022、`cache_capacity=32`，同一 `at = 2026-09-08T17:45:46+08:00`、
同一 refno `24384/23257`：

```
GET model/history/geometry?...&time=...            → X-Sesno: 419
GET node/versions/resolve?...&scope=self&at=...    → sesno: 283
GET node/versions/resolve?...&scope=subtree&at=... → sesno: 419   ← 与几何路由一致
```

三个数与前一次完全相同，说明这不是偶发或构建差异。第 3 条出路（把 R8.10 的措辞改成
「与 `resolve(scope=subtree)` 一致」）现在有直接可比对的证据：两条路由对同一时间点给同一个 sesno。

## 本次未做的事

没有擅自改动任一侧的规范行为。第 1、2 条都会改变对外契约，第 3 条是改需求文本，
三者都需要规范所有者确认。

## 冒烟脚本已按「单元根对 `scope=subtree`」判（2026-10-31）

`scripts/verify/realtime-history-smoke.ps1` 第 6 步原来无条件拿 `scope=self` 与几何路由比，
在单元根上必然 FAIL，把一条**规范冲突**记成了**脚本失败**，污染验证记录。现在按 refno 是不是
单元根选对照口径（`selfRows.unit_root -eq refno` → 用 `scope=subtree`，否则用 `scope=self`），
并额外 `Note` 一行把三个数都摆出来作为冲突证据：

```
[ok]   time 选择器与 resolve(scope=subtree) 一致
       -> at=2026-09-08T17:45:46+08:00 geometry X-Sesno=419 resolve.sesno=419
          refno 是交付单元根：几何路由按 unit_versions（73 行），resolve 用 scope=subtree 对齐
[note] R6.3 / R8.10 冲突（单元根）
       -> 同一时间点：geometry X-Sesno=419、resolve(scope=self)=283、resolve(scope=subtree)=419；
          unit_versions 73 行 vs node_versions(self) 5 行
```

当前 `realtime-history-smoke.json`：20 步全 `ok`，`passed: true`。
注意这只说明「按出路 3 的口径脚本自洽」，**不构成对三条出路的裁决**——
冲突本身仍然存在，等规范所有者定。

## 附：本次同时修掉的一个真 bug

两条新只读路由的查询串原本把 `dbnum` / `refno` / `sesno` / `at` 声明成必填的强类型，
axum 的 `Query` 反序列化失败时会回它自带的 400 体：

```
Failed to deserialize query string: missing field `at`
```

这个体不含 `error.code`，前端 `toHistoryError` 只能当成裸错误，design §1.1 第 1 点明确要求
「handler 用 `Option<String>` 接参数自己裁决，避免 axum `Query` 反序列化失败时给出 axum 默认 400 体」。
已改成全部 `Option<String>` + `parse_dbnum_param` / `parse_positive_u32_param` 自己裁决，
八个缺参 / 非法分支现在都回带码的 400：

```
resolve 缺 at        → 400 INVALID_SELECTOR {"params":["at"]}
resolve 缺 dbnum     → 400 INVALID_FIELD    {"field":"dbnum"}
resolve 缺 refno     → 400 INVALID_FIELD    {"field":"refno"}
resolve dbnum 非法   → 400 INVALID_FIELD    {"field":"dbnum"}
resolve scope 非法   → 400 INVALID_SELECTOR {"params":["scope"]}
attributes-at 缺 sesno   → 400 INVALID_FIELD {"field":"sesno"}
attributes-at sesno 非法 → 400 INVALID_FIELD {"field":"sesno"}
attributes-at 缺 refno   → 400 INVALID_FIELD {"field":"refno"}
```

例子测试 `handlers::tests::new_readonly_routes_report_coded_400_instead_of_axum_deserialize_errors`
与 `resolve_and_attributes_at_deserialize_without_required_fields` 钉住这两条。
