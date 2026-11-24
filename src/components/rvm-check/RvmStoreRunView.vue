<script setup lang="ts">
/** 一次运行（一个整根，或一个单元）：结论横幅，加它的全部差异与原因汇总。 */
import { computed } from 'vue';

import { runStatusKey } from './rvmStoreFormat';
import RvmStoreMismatchExplorer from './RvmStoreMismatchExplorer.vue';
import RvmStoreNotice from './RvmStoreNotice.vue';
import RvmStoreRunHeader from './RvmStoreRunHeader.vue';
import { useRvmStoreRun } from './useRvmStoreQueries';

const props = withDefaults(defineProps<{
  batchId: string;
  /** 根 / 单元自己的 refno */
  refno: string;
  runId: string | null;
  locatable?: boolean;
}>(), { locatable: false });

const query = useRvmStoreRun(() => ({ batchId: props.batchId, refno: props.refno, runId: props.runId }));
const run = computed(() => query.data.value ?? null);
const status = computed(() => (run.value ? runStatusKey(run.value) : null));
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-2" data-testid="rvm-store-run-view">
    <RvmStoreNotice v-if="query.error.value" kind="error" title="读不到这次运行" :error="query.error.value" @retry="query.refetch()" />
    <RvmStoreNotice v-else-if="query.isPending.value" kind="loading" title="正在读这次运行…" :rows="3" />
    <RvmStoreNotice v-else-if="!run"
      kind="empty"
      title="库里没有这次运行"
      :detail="`rvm_check_run 里没有找到 ${refno} 在这个范围下的行；可能是这一批重跑时换了范围，回上一层再找。`" />
    <template v-else>
      <RvmStoreRunHeader :run="run" />
      <RvmStoreMismatchExplorer :key="run.run_id"
        :scope="{ run_id: run.run_id }"
        :empty-text="status === 'empty' ? '两侧都没有可比的几何，也就没有差异行。' : '这次运行没有差异行：两侧逐件对上了。'"
        :locatable="locatable"
        :run-status="status" />
    </template>
  </section>
</template>
