// 任务创建状态管理
// 用于在不同组件间共享任务创建预设类型

import { ref } from 'vue';

import type { DatabaseConfig } from '@/api/genModelTaskApi';
import type { TaskType } from '@/types/task';

const presetType = ref<TaskType | null>(null);
const presetInitialConfig = ref<DatabaseConfig | null>(null);
const presetSiteContext = ref<TaskCreationSiteContext | null>(null);

export type TaskCreationSiteContext = {
  siteId: string;
  siteName: string;
  isCurrentSite: boolean;
};

export type TaskCreationPresetContext = {
  initialConfig?: DatabaseConfig | null;
  siteContext?: TaskCreationSiteContext | null;
};

/**
 * 任务创建状态存储
 */
export function useTaskCreationStore() {
  /**
     * 设置预设任务类型
     * 当从 Ribbon 菜单点击特定任务类型按钮时调用
     */
  function setPresetType(type: TaskType | null) {
    presetType.value = type;
  }

  /**
     * 获取并清除预设类型
     * 任务创建面板打开时调用，获取后清除以避免影响后续操作
     */
  function consumePresetType(): TaskType | null {
    const type = presetType.value;
    presetType.value = null;
    return type;
  }

  function setPresetContext(payload: TaskCreationPresetContext | null) {
    presetInitialConfig.value = payload?.initialConfig ?? null;
    presetSiteContext.value = payload?.siteContext ?? null;
  }

  function consumePresetContext(): TaskCreationPresetContext {
    const payload: TaskCreationPresetContext = {
      initialConfig: presetInitialConfig.value,
      siteContext: presetSiteContext.value,
    };
    presetInitialConfig.value = null;
    presetSiteContext.value = null;
    return payload;
  }

  function getPresetContext(): TaskCreationPresetContext {
    return {
      initialConfig: presetInitialConfig.value,
      siteContext: presetSiteContext.value,
    };
  }

  /**
     * 获取当前预设类型（不清除）
     */
  function getPresetType(): TaskType | null {
    return presetType.value;
  }

  return {
    presetType,
    setPresetType,
    consumePresetType,
    getPresetType,
    setPresetContext,
    consumePresetContext,
    getPresetContext,
  };
}
