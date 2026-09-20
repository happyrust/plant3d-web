// Visual harness for the misc token migration
// (ObjectMeasureDrawer / Button variants; RoomInfoPanel 随 legacy 房间树 2026-09-20 退役).
// Mounted by /harness/misc.html; shots via scripts/visual-baseline/shot.mjs
// (no .shots.mjs scenario: plain render, full-page single shot).
import { createApp, h } from 'vue';

import '@/assets/tailwind.css';
import ObjectMeasureDrawer from '@/components/tools/ObjectMeasureDrawer.vue';
import Button from '@/components/ui/Button.vue';

createApp({
  render: () =>
    h(ObjectMeasureDrawer, {
      statusText: '已选择第一个构件，正在计算最近点距离...',
      sourceRefno: '=17496/106028',
      targetRefno: null,
      busy: true,
      canReset: true,
    }),
}).mount('#measure-a');

createApp({
  render: () =>
    h(ObjectMeasureDrawer, {
      statusText: '点击模型或在模型树中选择第一个构件',
      sourceRefno: null,
      targetRefno: null,
      busy: false,
      canReset: false,
    }),
}).mount('#measure-b');

createApp({
  render: () =>
    h('div', { class: 'flex flex-wrap items-center gap-3 p-4' }, [
      h(Button, { variant: 'primary' }, () => '主操作 Primary'),
      h(Button, { variant: 'secondary' }, () => '次操作 Secondary'),
      h(Button, { variant: 'danger' }, () => '危险 Danger'),
      h(Button, { variant: 'primary', size: 'sm' }, () => 'Small'),
      h(Button, { variant: 'primary', size: 'lg' }, () => 'Large'),
      h(Button, { variant: 'primary', loading: true }, () => '加载中'),
      h(Button, { variant: 'primary', disabled: true }, () => '禁用'),
    ]),
}).mount('#buttons');
