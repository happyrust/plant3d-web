/**
 * Visual harness · 管道间距家族运行时视觉证据（#44 补证）
 *
 * 挂载真实 PipeDistanceDrawer，向 usePipeDistanceStore 注入两根 BRAN 与
 * 两条 mock 距离结果（含激活行，一条 surface / 一条 axis-estimate 走不同 provenance
 * 标签）。无后端、无 3D viewer——标注渲染走 useClearanceDimensionSync 的外部源，
 * 没 viewer 时只是没画面，store 链路照常。
 *
 * 仅供 vite（端口 5195）下 /harness/pipe-distance.html 人工 / 截图访问。
 */
import { createApp } from 'vue';

import { VueQueryPlugin } from '@tanstack/vue-query';

import '@/assets/tailwind.css';

import PipeDistanceDrawer from '@/components/pipe-distance/PipeDistanceDrawer.vue';
import { usePipeDistanceStore, type PipeDistanceResult } from '@/composables/usePipeDistanceStore';

const store = usePipeDistanceStore();

const results: PipeDistanceResult[] = [
  {
    id: 'pd-1',
    distance: 141.2,
    measurementKind: 'surface',
    pipeA: '24381/145218',
    pipeB: '24381/145264',
    start: [0, 0, 0],
    end: [0.14, 0, 0],
    designPoints: { start: [0, 0, 0], end: [141.2, 0, 0] },
  },
  {
    id: 'pd-2',
    distance: 2984,
    measurementKind: 'axis-estimate',
    pipeA: '24381/145364',
    pipeB: '24381/145454',
    start: [2, 1, 0],
    end: [4.98, 1, 0],
    designPoints: { start: [2000, 1000, 0], end: [4984, 1000, 0] },
  },
];

store.setBranRefnos(['24381/145218', '24381/145264', '24381/145364', '24381/145454']);
// #64：注入走 ClearanceStore 同一入口——两条记录进 `clearance` 外部源，与真实检测同一路径。
store.commitPipeDistanceResults(results);
store.showAnnotations.value = true;
store.maxDistance.value = 500;
store.maxAngle.value = 5;

// 组件链路内使用 vue-query 的 useQuery，必须安装 VueQueryPlugin 才能挂载
createApp(PipeDistanceDrawer, { open: true }).use(VueQueryPlugin).mount('#app-drawer');
