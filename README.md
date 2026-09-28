# plant3d-web

Plant3D-Web is a Vue 3, Vuetify, TypeScript, and Three.js application for Plant 3D visualization, measurement, annotation, and review.

## PTSET Measurement Consistency

PTSET measurement uses parquet package data as the source of truth for BRAN `2013286704/476` from `aps250160_0001`. PTSET display, snap, and capture share transform semantics; measurement endpoints preserve source metadata for PTSET and mesh picks; measurement UI labels and threshold controls are aligned for validation.

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
- LLM documentation index (if you use it): `llmdoc/index.md`

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
