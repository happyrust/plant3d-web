import { computed, effectScope } from 'vue';

import { autoRvmAfterRedeploy, createRedeployRvmFollowUp } from './redeployRvmFollowUp';
import { useModelGenerationAdmin } from './useModelGenerationAdmin';
import { useRvmCheckStore } from './useRvmCheckStore';

let instance: ReturnType<typeof createRedeployRvmFollowUp> | null = null;

/** 重新部署 → 逐库 RVM 核对的共享单例；第一次调用时开始盯部署进度。 */
export function useRedeployRvmFollowUp() {
  if (!instance) {
    // 独立作用域：第一次在组件 setup 里调用时，watch 不能跟着那个组件卸载
    instance = effectScope(true).run(() => {
      const admin = useModelGenerationAdmin();
      const rvm = useRvmCheckStore();
      return createRedeployRvmFollowUp({
        progress: admin.upgradeProgress,
        tasks: computed(() => admin.redeployTasks.value),
        enabled: autoRvmAfterRedeploy,
        collectSites: rvm.collectSites,
        enqueue: rvm.enqueue,
      });
    })!;
  }
  return { ...instance, enabled: autoRvmAfterRedeploy };
}
