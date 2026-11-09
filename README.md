# plant3d-web

Plant3D-Web is a Vue 3, Vuetify, TypeScript, and Three.js application for Plant 3D visualization, measurement, annotation, and review.

## PTSET Measurement Consistency

PTSET measurement uses parquet package data as the source of truth for BRAN `2013286704/476` from `aps250160_0001`. PTSET display, snap, and capture share transform semantics; measurement endpoints preserve source metadata for PTSET and mesh picks; measurement UI labels and threshold controls are aligned for validation.

## Group Rule Members (SCOSEL)

A GPSET rule group stores its members as an `SCOSEL` rule instead of GPITEM slots. When the backend evaluates those rules, `/api/v1/tree/children?refno=<GPSET>&resolved=1` returns the matched design elements with `secondary: true`, `via: null` and `rule: true`, and the model tree renders them as ordinary rows.

What the user sees:

- A row matched by a group rule carries an amber `规则` badge (`data-testid="model-tree-rule-badge"`) next to its name.
- Hovering the badge reads: `分组规则命中，主位置在别处；右键「定位到原位置」`.
- The row keeps its own primary owner; the existing 「定位到原位置」 context action still navigates to the element's real position.

`rule` vs. `secondary`, on the wire:

| Row kind | `secondary` | `via` | `rule` |
|---|---|---|---|
| Main-chain child | key absent | key absent | key absent |
| GPITEM explicit member | `true` | the GPITEM refno | `false` |
| Rule (SCOSEL) member | `true` | `null` | `true` |

So a rule member is not an explicit GPITEM inclusion — it has no `via` at all, which is why it shows `规则` instead of `引用`.

Backend switch: `AIOS_GROUP_SCOSEL=true` (or `group_scosel = true` in `DbOption.toml`). It is **off by default**; while it is off the backend answers byte-identically to before, no `rule` key is emitted and no badge appears.

Tests:

- `npm test` — the baseline carries 2 pre-existing failures unrelated to this feature; the acceptance rule is "same failure count and same case names as the baseline".
- `npm run type-check` — must exit 0.
- The three component cases for the badge live in `src/components/model-tree/ModelTreeRow.dbnum.test.ts`.

### Group context action: load the models a group references

A group row (`GPSET`) has no geometry of its own — its members may be GPITEM slots or an `SCOSEL` rule, and none of them are loaded just because the group row exists. Right-clicking a group row now offers **「显示分组引用的模型」** (`data-testid="model-tree-show-group-models"`).

What the user sees:

- The action appears on group rows only, gated by `v-if="contextNodeIsGroup"`.
- It reuses the already-verified `showModelByRefno(id, { flyTo: true })` chain end to end: member resolution → `generate` → `records` → DTX load → `flyTo`. On success it calls `pdmsTree.setVisible(id, true)` so the tree reflects the newly loaded subtree.

Mutual exclusion with 「重新生成模型」:

| Context row | 「重新生成模型」 | 「显示分组引用的模型」 |
|---|---|---|
| Non-group node | shown (`v-if="!contextNodeIsGroup"`) | hidden |
| Group node (`GPSET`) | hidden | shown |

So a group row offers exactly one of the two actions — never both, never neither.

The group path deliberately does **not** pass `regenerate: true`. A group carrying `force` hits the backend's pre-existing `group_scope` 422 (the G2 semantics for group-scoped generation). Loading the referenced models and regenerating them are therefore two different actions, not one action with a flag.

### Empty-group messages by reason code

An empty group used to be indistinguishable from a rule that matched nothing. Both cases produced a byte-identical `generate` receipt — same `status`, `generation_roots`, `generation_root_count`, `scope_refnos`, `unresolved_count`, `dbnum`, `routes` — so the UI could only show one generic sentence and the user had no way to tell "this group is genuinely empty" from "this rule hit zero elements".

The backend now reports *why* a member failed to resolve, and `src/model-source/genModelV1/modelRecords.ts` maps the reason to a message via `emptyGroupHintFor(unresolved)`:

| Backend `unresolved[].reason` | Message shown |
|---|---|
| `group_empty` | 「分组为空」 (`GROUP_EMPTY_HINT`) |
| `scosel_no_match` | 「规则没有命中任何构件」 (`GROUP_RULE_NO_MATCH_HINT`) |
| `scosel_unsupported`, `scosel_eval_failed` | 「规则无法求值（成员不可解析）」 (`GROUP_RULE_UNEVALUABLE_HINT`) |
| key absent (switch off / older backend) | falls back to the original `EMPTY_GROUP_HINT` verbatim: 「分组为空或成员不可解析」 |

Wire shape — `POST /api/v1/model/generate` and `POST /api/v1/model/records` now carry `unresolved[]` on group receipts:

| Field | Type | Notes |
|---|---|---|
| `via` | `RefnoEnum` | underscore form, e.g. `"2_15"` |
| `target` | `RefnoEnum` | underscore form, e.g. `"2_15"` |
| `reason` | string | one of the seven codes below |

- `via` / `target` use the same underscore form as `/api/v1/tree/children?refno=<GPSET>&resolved=1`'s `unresolved[]`, so the two endpoints agree element by element.
- The key is **omitted entirely** when the array is empty — it is not `[]`.
- When `unresolved` is present, `unresolved_count == unresolved.length`.
- Seven reason codes, in two families:
  - GPREF family (broken reference chain): `gpref_missing`, `db_not_in_mdb`, `target_missing`
  - SCOSEL family (rule evaluation): `scosel_eval_failed`, `scosel_unsupported`, `scosel_no_match`, `group_empty`

Read `reason`, never `via`, when picking the message. For a rule-family broken slot and for the `group_empty` slot there is no GPITEM to route through, so the backend fills `via` with the group's own refno. Rendering anything member-level off that value produces misleading text ("member X failed" when the group itself is the subject).

Acceptance samples (all `GPSET`, checked against a live backend):

| Path | Refno | Expected |
|---|---|---|
| `/ACCEPT-GROUP` | `2013286764_3` | `reason: group_empty` → 「分组为空」 |
| `/AREA01_HVAC` | `2013286748_7` | `reason: scosel_no_match` → 「规则没有命中任何构件」 |
| `/AREA01_PIPE` | `2013286748_2` | normal match, no `unresolved` key at all |

## Recommended IDE Setup

[VSCode](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur) + [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin).

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [TypeScript Vue Plugin (Volar)](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin) to make the TypeScript language service aware of `.vue` types.

If the standalone TypeScript plugin doesn't feel fast enough to you, Volar has also implemented a [Take Over Mode](https://github.com/johnsoncodehk/volar/discussions/471#discussioncomment-1361669) that is more performant. You can enable it by the following steps:

1. Disable the built-in TypeScript Extension
    1) Run `Extensions: Show Built-in Extensions` from VSCode's command palette
    2) Find `TypeScript and JavaScript Language Features`, right click and select `Disable (Workspace)`
2. Reload the VSCode window by running `Developer: Reload Window` from the command palette.

## Customize configuration

See [Vite Configuration Reference](https://vitejs.dev/config/).

## Project Setup

```sh
npm install
```

## Documentation

- Notes index: `docs/notes/README.md`
  - SolveSpace 3D dimensions dataflow: `docs/notes/solvespace-dimension-dataflow.md`
- Implementation plans (working docs): `docs/plans/`

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Test

```sh
npm test
```

Scoped PTSET measurement checks:

```sh
npx vitest run src/utils/three/ptsetTransform.test.ts src/composables/useMeasurementPickSources.test.ts src/composables/useToolStore.measurementSourceInfo.test.ts src/composables/useXeokitMeasurementTools.test.ts src/components/tools/MeasurementPanel.test.ts src/utils/xeokitMeasurementFormat.test.ts
```

Direct browser validation URL pattern:

```txt
http://127.0.0.1:<frontend-port>/?output_project=ptset-bran-2013286704-476&show_dbnum=250160&show_refno=2013286704_476&data_source=parquet&backendPort=<generated-site-port>
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```
