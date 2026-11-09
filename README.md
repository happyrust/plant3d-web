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
