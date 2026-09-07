// Visual harness for the misc token migration
// (RoomInfoPanel / ObjectMeasureDrawer / Button variants).
// Mounted by /harness/misc.html; shots via scripts/visual-baseline/shot.mjs
// (no .shots.mjs scenario: plain render, full-page single shot).
import { createApp, h } from 'vue';

import { VueQueryPlugin } from '@tanstack/vue-query';

import '@/assets/tailwind.css';
import ObjectMeasureDrawer from '@/components/tools/ObjectMeasureDrawer.vue';
import RoomInfoPanel from '@/components/tools/RoomInfoPanel.vue';
import Button from '@/components/ui/Button.vue';
import { useRoomInfoPanel } from '@/composables/useRoomInfoPanel';

const RoomInfoHarness = {
  setup() {
    const roomInfo = useRoomInfoPanel();
    roomInfo.current.value = {
      sourceRefno: '24381_145018',
      roomRefno: '24381_9001',
      fullName: '=24381/RM-A-102',
      attrs: {
        TYPE: 'ROOM',
        DESC: '电气设备间',
        OWNER: '=24381/ZONE-A',
        ELEV: '+3.500',
        AREA: '42.5 m2',
        FIRE: 'F1',
        DEPT: 'E',
      },
      refFullNames: { OWNER: '=24381/ZONE-A' },
      ancestorIds: [],
    };
    roomInfo.error.value = '示例错误：未解析到 24381_999 的所在房间';
    roomInfo.modelError.value = '房间模型加载失败: 24381_9001（示例警告条）';
    return () => h(RoomInfoPanel);
  },
};

const roomApp = createApp(RoomInfoHarness);
roomApp.use(VueQueryPlugin);
roomApp.mount('#room-info');

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
