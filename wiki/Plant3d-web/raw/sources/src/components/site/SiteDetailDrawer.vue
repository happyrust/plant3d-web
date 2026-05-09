<template>
  <Transition name="site-detail-fade">
    <div v-if="open"
      class="fixed inset-0 z-[80] flex justify-end bg-slate-900/25"
      data-testid="site-detail-drawer"
      @click="$emit('close')">
      <Transition name="site-detail-slide">
        <aside v-if="open"
          class="flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl"
          @click.stop>
          <header class="flex items-start justify-between border-b border-slate-200 px-6 py-5">
            <div class="min-w-0">
              <p class="text-sm font-medium text-slate-500">站点详情</p>
              <h3 class="mt-1 truncate text-2xl font-bold text-slate-900">
                {{ site?.name || '未选择站点' }}
              </h3>
              <p class="mt-2 text-sm text-slate-500">
                {{ site?.site_id || '请选择站点查看详情' }}
              </p>
            </div>
            <button type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              data-testid="site-detail-close"
              @click="$emit('close')">
              <XIcon class="h-5 w-5" />
            </button>
          </header>

          <div class="flex-1 space-y-6 overflow-y-auto px-6 py-6">
            <section class="space-y-3">
              <h4 class="text-sm font-semibold text-slate-900">基础信息</h4>
              <dl class="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-2">
                <div>
                  <dt class="text-slate-500">站点名称</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.name || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">运行状态</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.status || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">地域</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.region || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">最后心跳</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.last_seen_at || '-' }}</dd>
                </div>
              </dl>
            </section>

            <section class="space-y-3">
              <h4 class="text-sm font-semibold text-slate-900">项目与地址</h4>
              <dl class="space-y-3 rounded-2xl border border-slate-200 p-4 text-sm">
                <div>
                  <dt class="text-slate-500">工程</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.project_name || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">项目编码</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.project_code || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">前端地址</dt>
                  <dd class="mt-1 break-all font-medium text-slate-900">{{ site?.frontend_url || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">后端地址</dt>
                  <dd class="mt-1 break-all font-medium text-slate-900">{{ backendAddress }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">项目路径</dt>
                  <dd class="mt-1 break-all font-medium text-slate-900">{{ site?.project_path || '-' }}</dd>
                </div>
              </dl>
            </section>

            <section class="space-y-3">
              <h4 class="text-sm font-semibold text-slate-900">运行配置摘要</h4>
              <dl class="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 p-4 text-sm md:grid-cols-2">
                <div>
                  <dt class="text-slate-500">数据库类型</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.config?.db_type || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">数据库名</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.config?.mdb_name || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">模块</dt>
                  <dd class="mt-1 font-medium text-slate-900">{{ site?.config?.module || '-' }}</dd>
                </div>
                <div>
                  <dt class="text-slate-500">布尔运算</dt>
                  <dd class="mt-1 font-medium text-slate-900">
                    {{ site?.config?.apply_boolean_operation === false ? '关闭' : '开启' }}
                  </dd>
                </div>
              </dl>
            </section>
          </div>

          <footer class="space-y-4 border-t border-slate-200 px-6 py-5">
            <div class="rounded-2xl border px-4 py-3 text-sm"
              :class="isCurrentSite
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'">
              <template v-if="isCurrentSite">
                当前站点快捷入口将基于当前站点配置打开任务创建面板，并复用现有任务监控链路。
              </template>
              <template v-else>
                主站点暂不支持跨站直接发任务，请使用“打开站点”进入目标站点后再执行任务。
              </template>
            </div>

            <div class="space-y-3">
              <h4 class="text-sm font-semibold text-slate-900">快捷动作</h4>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button v-if="isCurrentSite"
                  type="button"
                  class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
                  data-testid="site-create-parsing-task-action"
                  :disabled="busy"
                  @click="$emit('create-parsing-task')">
                  创建解析任务
                </button>
                <button v-if="isCurrentSite"
                  type="button"
                  class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100"
                  data-testid="site-create-model-task-action"
                  :disabled="busy"
                  @click="$emit('create-model-task')">
                  创建建模任务
                </button>
                <button v-if="isCurrentSite"
                  type="button"
                  class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  data-testid="site-open-task-monitor-action"
                  :disabled="busy"
                  @click="$emit('open-task-monitor')">
                  打开任务监控
                </button>
                <button v-if="!isCurrentSite"
                  type="button"
                  class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  data-testid="site-open-frontend-action"
                  :disabled="busy"
                  @click="$emit('open-frontend')">
                  打开站点
                </button>
                <button v-if="!isCurrentSite"
                  type="button"
                  class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  data-testid="site-copy-backend-action"
                  :disabled="busy"
                  @click="$emit('copy-backend')">
                  复制后端地址
                </button>
                <button type="button"
                  class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                  data-testid="site-healthcheck-action"
                  :disabled="busy"
                  @click="$emit('healthcheck')">
                  {{ busy ? '执行中...' : '健康检查' }}
                </button>
                <button type="button"
                  class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  data-testid="site-edit-action"
                  :disabled="busy"
                  @click="$emit('edit')">
                  编辑
                </button>
                <button type="button"
                  class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm font-medium text-rose-700 transition-colors hover:bg-rose-100"
                  data-testid="site-delete-action"
                  :disabled="busy"
                  @click="$emit('delete')">
                  删除
                </button>
              </div>
            </div>
          </footer>
        </aside>
      </Transition>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { XIcon } from 'lucide-vue-next';

import type { DeploymentSite } from '@/types/site';

const props = defineProps<{
  open: boolean;
  site: DeploymentSite | null;
  isCurrentSite: boolean;
  busy?: boolean;
}>();

defineEmits<{
  close: [];
  healthcheck: [];
  'open-frontend': [];
  'copy-backend': [];
  edit: [];
  delete: [];
  'create-parsing-task': [];
  'create-model-task': [];
  'open-task-monitor': [];
}>();

const backendAddress = computed(() => {
  if (props.site?.backend_url) {
    return props.site.backend_url;
  }

  if (props.site?.bind_host) {
    return `${props.site.bind_host}:${props.site.bind_port || ''}`.replace(/:$/, '');
  }

  return '-';
});
</script>

<style scoped>
.site-detail-fade-enter-active,
.site-detail-fade-leave-active {
  transition: opacity 0.2s ease;
}

.site-detail-fade-enter-from,
.site-detail-fade-leave-to {
  opacity: 0;
}

.site-detail-slide-enter-active,
.site-detail-slide-leave-active {
  transition: transform 0.2s ease;
}

.site-detail-slide-enter-from,
.site-detail-slide-leave-to {
  transform: translateX(100%);
}
</style>
