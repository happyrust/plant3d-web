import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: vi.fn(),
}));

import {
  buildRoomIsolateRefnos,
  enterRoomView,
  exitRoomView,
  setRoomTubeTruncation,
  useRoomClip,
} from '@/composables/useRoomClip';

function makeStubViewer() {
  const objects: Record<string, { visible: boolean; selected: boolean; xrayed: boolean }> = {};
  for (const id of ['24381_10', '24381_11', '24381_1200', '24381_1240', '24381_1241', '24381_1242', '24381_9999']) {
    objects[id] = { visible: true, selected: false, xrayed: false };
  }
  const scene = {
    objects,
    get objectIds() {
      return Object.keys(objects);
    },
    ensureRefnos: vi.fn(),
    setObjectsVisible: vi.fn((ids: string[], visible: boolean) => {
      for (const id of ids) {
        if (objects[id]) objects[id]!.visible = visible;
      }
    }),
    setObjectsSelected: vi.fn(),
    setObjectsXRayed: vi.fn((ids: string[], xrayed: boolean) => {
      for (const id of ids) {
        if (objects[id]) objects[id]!.xrayed = xrayed;
      }
    }),
  };
  return {
    scene,
    requestRender: vi.fn(),
    cameraFlight: { flyTo: vi.fn() },
  } as unknown as DtxCompatViewer;
}

describe('useRoomClip', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    exitRoomView({ keepIsolation: true });
    setRoomTubeTruncation(true);
  });

  it('buildRoomIsolateRefnos：开启截断时采用 Exact 口径（排除房外同分支管件与面板），关闭时带上整分支伴随管件', () => {
    const ctx = {
      panelRefnos: ['24381_10', '24381_11'],
      memberRefnos: ['24381_1240', '24381_1241', '24381_10'],
      tubeCarriers: ['24381_1200'],
      companionsOf: () => ['24381_1242'],
    };

    // 截断开启 + 房间体正常（withPanels = false）：面板不进，房外 1242 不进
    expect(buildRoomIsolateRefnos(ctx, true, false)).toEqual([
      '24381_1240',
      '24381_1241',
      '24381_1200',
    ]);

    // 截断关闭 + 房间体正常（withPanels = false）：房外 1242 进，面板不进
    expect(buildRoomIsolateRefnos(ctx, false, false)).toEqual([
      '24381_1240',
      '24381_1241',
      '24381_1200',
      '24381_1242',
    ]);

    // 房间体兜底失败（withPanels = true）：面板也进隔离集
    expect(buildRoomIsolateRefnos(ctx, false, true)).toEqual([
      '24381_10',
      '24381_11',
      '24381_1240',
      '24381_1241',
      '24381_1200',
      '24381_1242',
    ]);
  });

  it('enterRoomView / setRoomTubeTruncation / exitRoomView：切换开关时同步切换隔离口径并持久化状态', async () => {
    const viewer = makeStubViewer();
    const roomClip = useRoomClip();

    await enterRoomView({
      roomRefno: '24381_35580',
      roomNum: 'R432',
      roomName: '/1RX-RM04-R432',
      panelRefnos: ['24381_10'],
      memberRefnos: ['24381_1240', '24381_1241'],
      tubeCarriers: ['24381_1200'],
      viewer,
      companionsOf: () => ['24381_1242'],
    });

    expect(roomClip.active.value).toBe(true);
    expect(roomClip.roomNum.value).toBe('R432');
    expect(roomClip.truncateEnabled.value).toBe(true);
    expect(viewer.scene.setObjectsXRayed).toHaveBeenLastCalledWith(
      ['24381_1240', '24381_1241', '24381_1200'],
      false,
    );
    // 面板在常规层隐藏
    expect(viewer.scene.objects['24381_10']!.visible).toBe(false);

    // 拨关：整根分支的房外管件 24381_1242 一并纳入隔离集
    setRoomTubeTruncation(false);
    expect(roomClip.truncateEnabled.value).toBe(false);
    expect(viewer.scene.setObjectsXRayed).toHaveBeenLastCalledWith(
      ['24381_1240', '24381_1241', '24381_1200', '24381_1242'],
      false,
    );

    // 退出房间视图：面板恢复可见、隔离解除
    exitRoomView();
    expect(roomClip.active.value).toBe(false);
    expect(viewer.scene.objects['24381_10']!.visible).toBe(true);
  });
});