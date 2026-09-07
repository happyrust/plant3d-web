/**
 * Visual harness · 管道间距家族运行时视觉证据（#44 补证）
 *
 * 挂载真实 PipeDistanceDrawer，向 usePipeDistanceStore 注入两根 BRAN 与
 * 两条 mock 距离结果（含激活行）。无后端、无 3D viewer
 * （usePipeDistanceAnnotationThree 对 null viewer 安全）。
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
    pipeA: '24381/145218',
    pipeB: '24381/145264',
    start: [0, 0, 0],
    end: [0.14, 0, 0],
    pipeAStart: [0, 0, 0],
    pipeAEnd: [0, 5, 0],
    pipeBStart: [0.14, 0, 0],
    pipeBEnd: [0.14, 5, 0],
  },
  {
    id: 'pd-2',
    distance: 2984,
    pipeA: '24381/145364',
    pipeB: '24381/145454',
    start: [2, 1, 0],
    end: [4.98, 1, 0],
  },
];

store.setBranRefnos(['24381/145218', '24381/145264', '24381/145364', '24381/145454']);
store.results.value = results;
store.activeResultIndex.value = 0;
store.showAnnotations.value = true;
store.maxDistance.value = 500;
store.maxAngle.value = 5;

// 组件链路内使用 vue-query 的 useQuery，必须安装 VueQueryPlugin 才能挂载
createApp(PipeDistanceDrawer, { open: true }).use(VueQueryPlugin).mount('#app-drawer');
