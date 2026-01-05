import { ref, computed } from 'vue';

/**
 * 模型生成设置 Store
 * 管理调试模式和 regen-model 选项
 */

// 全局状态
const debugMode = ref(import.meta.env.DEV); // 开发环境默认开启
const regenModelEnabled = ref(import.meta.env.DEV); // 调试模式下默认开启

export function useModelSettingsStore() {
    /**
     * 是否为调试模式
     */
    const isDebugMode = computed(() => debugMode.value);

    /**
     * 是否开启 regen-model（强制重新生成模型）
     */
    const isRegenModelEnabled = computed(() => regenModelEnabled.value);

    /**
     * 设置调试模式
     */
    function setDebugMode(enabled: boolean) {
        debugMode.value = enabled;
        // 调试模式关闭时，同步关闭 regen-model
        if (!enabled) {
            regenModelEnabled.value = false;
        }
    }

    /**
     * 设置 regen-model 选项
     */
    function setRegenModelEnabled(enabled: boolean) {
        regenModelEnabled.value = enabled;
    }

    /**
     * 切换 regen-model 选项
     */
    function toggleRegenModel() {
        regenModelEnabled.value = !regenModelEnabled.value;
    }

    return {
        isDebugMode,
        isRegenModelEnabled,
        setDebugMode,
        setRegenModelEnabled,
        toggleRegenModel,
    };
}
