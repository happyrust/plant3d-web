import { computed, ref } from 'vue';

import { pdmsGetUiAttr, type PdmsUiAttrResponse } from '@/api/genModelPdmsAttrApi';
import { normalizeRoomTreeId, roomTreeGetAncestors } from '@/api/genModelRoomTreeApi';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { showModelByRefnosWithAck } from '@/composables/useViewerContext';

export type RoomInfoRecord = {
  sourceRefno: string;
  roomRefno: string;
  fullName: string | null;
  attrs: Record<string, unknown>;
  refFullNames: Record<string, string> | null;
  ancestorIds: string[];
};

export type RoomInfoResolveOptions = {
  includeAttrs?: boolean;
};

const current = ref<RoomInfoRecord | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const modelLoading = ref(false);
const modelError = ref<string | null>(null);

function isRoomObjectId(id: string): boolean {
  return /^\d+_\d+$/.test(normalizeRoomTreeId(id));
}

function roomIdFromAncestorIds(ids: string[]): string | null {
  const normalized = ids.map(normalizeRoomTreeId).filter(Boolean);
  for (let i = 0; i < normalized.length; i += 1) {
    const id = normalized[i];
    if (isRoomObjectId(id) && normalized[i + 1]?.startsWith('room-group:')) {
      return id;
    }
  }
  return null;
}

function attrString(attrs: Record<string, unknown>, key: string): string | null {
  const v = attrs[key] ?? attrs[key.toUpperCase()] ?? attrs[key.toLowerCase()];
  if (v === null || v === undefined) return null;
  const text = String(v).trim();
  return text || null;
}

export async function resolveContainingRoomInfo(
  refno: string,
  options: RoomInfoResolveOptions = {},
): Promise<RoomInfoRecord | null> {
  const sourceRefno = normalizeRoomTreeId(refno);
  if (!sourceRefno) return null;

  const ancestorResp = await roomTreeGetAncestors(sourceRefno);
  if (!ancestorResp.success) {
    throw new Error(ancestorResp.error_message || `未找到 ${sourceRefno} 的房间归属`);
  }

  const ancestorIds = ancestorResp.ids.map(normalizeRoomTreeId).filter(Boolean);
  const roomRefno = roomIdFromAncestorIds(ancestorIds);
  if (!roomRefno) return null;

  if (options.includeAttrs === false) {
    return {
      sourceRefno,
      roomRefno,
      fullName: null,
      attrs: {},
      refFullNames: null,
      ancestorIds,
    };
  }

  const attrResp: PdmsUiAttrResponse = await pdmsGetUiAttr(roomRefno);
  if (!attrResp.success) {
    throw new Error(attrResp.error_message || `房间属性查询失败: ${roomRefno}`);
  }

  return {
    sourceRefno,
    roomRefno,
    fullName: attrResp.full_name ?? attrString(attrResp.attrs, 'NAME') ?? null,
    attrs: attrResp.attrs ?? {},
    refFullNames: attrResp.ref_full_names ?? null,
    ancestorIds,
  };
}

export function useRoomInfoPanel() {
  const selection = useSelectionStore();

  const displayName = computed(() => {
    const info = current.value;
    if (!info) return '';
    return info.fullName || attrString(info.attrs, 'NAME') || info.roomRefno;
  });

  const roomType = computed(() => {
    const info = current.value;
    if (!info) return '';
    return attrString(info.attrs, 'TYPE') || 'ROOM';
  });

  const description = computed(() => {
    const info = current.value;
    if (!info) return '';
    return attrString(info.attrs, 'DESC') || attrString(info.attrs, 'DESCRIPTION') || '';
  });

  const ownerName = computed(() => {
    const info = current.value;
    if (!info) return '';
    return info.refFullNames?.OWNER || attrString(info.attrs, 'OWNER') || '';
  });

  async function loadForRefno(refno: string): Promise<RoomInfoRecord | null> {
    const sourceRefno = normalizeRoomTreeId(refno);
    if (!sourceRefno) return null;

    loading.value = true;
    error.value = null;
    modelError.value = null;
    try {
      const info = await resolveContainingRoomInfo(sourceRefno);
      current.value = info;
      if (!info) {
        error.value = `未解析到 ${sourceRefno} 的所在房间`;
      }
      return info;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      current.value = null;
      error.value = message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function openForRefno(refno: string): Promise<RoomInfoRecord | null> {
    ensurePanelAndActivate('roomInfo');
    return await loadForRefno(refno);
  }

  async function showRoomModel(refno = current.value?.roomRefno): Promise<boolean> {
    const roomRefno = normalizeRoomTreeId(refno || '');
    if (!roomRefno) return false;

    modelLoading.value = true;
    modelError.value = null;
    try {
      const result = await showModelByRefnosWithAck({
        refnos: [roomRefno],
        flyTo: true,
        timeoutMs: 20_000,
        ensureViewerReady: true,
      });
      if (result.error || result.fail.length > 0) {
        throw new Error(result.error || result.fail[0]?.error || `房间模型加载失败: ${roomRefno}`);
      }
      return result.ok.length > 0;
    } catch (e) {
      modelError.value = e instanceof Error ? e.message : String(e);
      return false;
    } finally {
      modelLoading.value = false;
    }
  }

  function viewRoomProperties() {
    const roomRefno = current.value?.roomRefno;
    if (!roomRefno) return;
    selection.setSelectedRefno(roomRefno);
    ensurePanelAndActivate('properties');
  }

  return {
    current,
    loading,
    error,
    modelLoading,
    modelError,
    displayName,
    roomType,
    description,
    ownerName,
    loadForRefno,
    openForRefno,
    showRoomModel,
    viewRoomProperties,
  };
}
