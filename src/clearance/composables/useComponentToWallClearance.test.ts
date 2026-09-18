import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import {
  CLEARANCE_WALL_PICK_NOUNS,
  formatClearanceToast,
  useComponentToWallClearance,
  type ComponentToWallToolStore,
} from './useComponentToWallClearance';

import type { ToastPayload } from '@/ribbon/toastBus';

import { createClearanceService, surfaceClearanceToRecord } from '@/clearance/services/clearanceService';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import {
  beyondMaxDistanceResponse,
  boxToStraightWallResponse,
  elboToCurvedWallResponse,
  intersectingResponse,
  pipeInWallOpeningResponse,
} from '@/clearance/testing/surfaceClearanceFixtures';

const AT = new Date('2026-09-17T12:00:00.000Z');

function fakeToolStore() {
  const toolMode = ref('none');
  let confirm: ((refnos: string[]) => void) | undefined;
  let cancelCb: (() => void) | undefined;
  const store: ComponentToWallToolStore = {
    toolMode,
    startPickRefno: vi.fn((_nouns, onConfirm, onCancel) => {
      confirm = onConfirm;
      cancelCb = onCancel;
      toolMode.value = 'pick_refno';
    }),
    cancelPickRefno: vi.fn(() => {
      toolMode.value = 'none';
      cancelCb?.();
    }),
  };
  return {
    store,
    toolMode,
    /** 模拟用户点墙 + Enter：与 useToolStore.confirmPickRefno 同序——先回 none，再回调。 */
    confirm(refnos: string[]) {
      toolMode.value = 'none';
      confirm?.(refnos);
    },
  };
}

function setup(responses: unknown[]) {
  const queue = [...responses];
  const service = createClearanceService({
    fetchSurfaceClearance: vi.fn(async () => {
      const next = queue.shift();
      if (!next) throw new Error('404 not_found: no_model_mesh');
      return next as never;
    }),
    now: () => AT,
  });
  const toasts: ToastPayload[] = [];
  const records: string[] = [];
  const tool = fakeToolStore();
  const selectedRefno = ref<string | null>('24384/22582');
  const clearanceStore = useClearanceStore();
  const flow = useComponentToWallClearance({
    toolStore: tool.store,
    selectionStore: { selectedRefno },
    clearanceStore,
    service,
    toast: payload => toasts.push(payload),
    onRecord: record => records.push(record.id),
  });
  return { flow, tool, toasts, records, selectedRefno, clearanceStore };
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('useComponentToWallClearance', () => {
  beforeEach(() => {
    useClearanceStore().clearRecords();
  });

  it('refuses to start without a selected component', () => {
    const { flow, tool, toasts, selectedRefno } = setup([]);
    selectedRefno.value = null;
    expect(flow.start()).toBe(false);
    expect(tool.store.startPickRefno).not.toHaveBeenCalled();
    expect(toasts[0]?.level).toBe('warning');
    expect(flow.picking.value).toBe(false);
  });

  it('enters pick_refno restricted to the wall nouns, computes on confirm and reports the record', async () => {
    const { flow, tool, toasts, records, clearanceStore } = setup([elboToCurvedWallResponse()]);
    expect(flow.start()).toBe(true);
    expect(tool.store.startPickRefno).toHaveBeenCalledWith([...CLEARANCE_WALL_PICK_NOUNS], expect.any(Function), expect.any(Function));
    expect(flow.picking.value).toBe(true);
    expect(flow.sourceRefno.value).toBe('24384_22582');

    tool.confirm(['17496/105912']);
    await flush();
    expect(flow.picking.value).toBe(false);
    expect(flow.sourceRefno.value).toBeNull();
    expect(clearanceStore.records.value.map(record => record.id)).toEqual(['clearance:24384_22582:17496_105912']);
    expect(clearanceStore.activeId.value).toBe('clearance:24384_22582:17496_105912');
    expect(records).toEqual(['clearance:24384_22582:17496_105912']);
    expect(toasts.at(-1)).toEqual({ message: '外表面净距 64.4 mm（墙面外侧），垂直于墙面', level: 'success' });
  });

  it('ignores the source itself among picked refnos, warns when several walls were picked and uses the first other one', async () => {
    const { flow, tool, toasts, clearanceStore } = setup([boxToStraightWallResponse()]);
    flow.start();
    tool.confirm(['24384_22582', '17496_105812', '17496_105912']);
    await flush();
    expect(clearanceStore.records.value).toHaveLength(1);
    expect(clearanceStore.records.value[0]?.inputs.targetRefno).toBe('17496_105812');
    expect(toasts.some(toast => toast.message.includes('只算第一堵 17496_105812'))).toBe(true);
    expect(toasts.at(-1)?.message).toBe('外表面净距 885.3 mm（墙面）');
  });

  it('cancel leaves the pick mode and no record; an empty confirm just warns', async () => {
    const { flow, tool, toasts, clearanceStore } = setup([]);
    flow.start();
    flow.cancel();
    expect(tool.store.cancelPickRefno).toHaveBeenCalledTimes(1);
    expect(flow.picking.value).toBe(false);

    flow.start();
    tool.confirm([]);
    await flush();
    expect(clearanceStore.records.value).toHaveLength(0);
    expect(toasts.at(-1)?.message).toContain('没有点到墙');
  });

  it('surfaces service failures as an error toast and returns null', async () => {
    const { flow, toasts, clearanceStore } = setup([]);
    const record = await flow.computeForPair('24384_22582', '17496_105912');
    expect(record).toBeNull();
    expect(clearanceStore.lastError.value).toMatch(/no_model_mesh/);
    expect(toasts.at(-1)?.level).toBe('error');
    expect(await flow.computeForPair('1_2', '1/2')).toBeNull();
    expect(toasts.at(-1)?.message).toContain('同一个构件');
  });

  it('formatClearanceToast covers intersecting, empty and sub-10mm results', () => {
    const input = { sourceRefno: '24384_22582', targetRefno: '17496_105912' };
    expect(formatClearanceToast(surfaceClearanceToRecord(intersectingResponse(), input, AT))).toBe('24384_22582 与 17496_105912 相交（净距 0）');
    expect(formatClearanceToast(surfaceClearanceToRecord(beyondMaxDistanceResponse(), input, AT))).toContain('没有靠近到一起');
    const tiny = elboToCurvedWallResponse({ result: { ...elboToCurvedWallResponse().result!, distance_mm: 6.437, perpendicular: null, target_face: null } });
    expect(formatClearanceToast(surfaceClearanceToRecord(tiny, input, AT))).toBe('外表面净距 6.44 mm');
  });

  it('formatClearanceToast says 洞口 / 垂直于洞壁 when the hit face is a wall opening', () => {
    const input = { sourceRefno: '24384_30001', targetRefno: '17496_105812' };
    expect(formatClearanceToast(surfaceClearanceToRecord(pipeInWallOpeningResponse(), input, AT))).toBe('外表面净距 50.0 mm（洞口），垂直于洞壁');
  });
});
