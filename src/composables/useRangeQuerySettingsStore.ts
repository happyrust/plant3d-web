import { ref } from 'vue'

import type { SiteSpecValue } from '@/types/spec'

/**
 * 范围查询设置（供 ViewerPanel 右侧快捷设置 + ModelQueryPanel 消费）
 *
 * 说明：先用“全局单例 store”把 UI 状态串起来，后续若要持久化再加 localStorage 即可。
 */
const radiusM = ref<number>(50)
const specValues = ref<SiteSpecValue[]>([])
const nounsText = ref<string>('')
const nameQuery = ref<string>('')

export function useRangeQuerySettingsStore() {
  return {
    radiusM,
    specValues,
    nounsText,
    nameQuery,
    toggleSpecValue: (sv: SiteSpecValue) => {
      const idx = specValues.value.indexOf(sv)
      if (idx >= 0) specValues.value.splice(idx, 1)
      else specValues.value.push(sv)
    },
    clearSpecFilter: () => {
      specValues.value = []
    },
    reset: () => {
      radiusM.value = 50
      specValues.value = []
      nounsText.value = ''
      nameQuery.value = ''
    },
  }
}

