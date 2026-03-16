import { ref } from 'vue';

export type QuickViewRequest =
  | { kind: 'show_selected_room_models'; timestamp: number }

/**
 * 轻量“请求-消费”触发器：用于跨面板触发一次性动作（避免面板未挂载导致事件丢失）。
 */
const request = ref<QuickViewRequest | null>(null);

export function useQuickViewRequestStore() {
  return {
    request,
    requestShowSelectedRoomModels: () => {
      request.value = { kind: 'show_selected_room_models', timestamp: Date.now() };
    },
    clear: () => {
      request.value = null;
    },
  };
}
