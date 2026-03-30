import { computed, ref } from 'vue';

import type { DeploymentSite, DeploymentSiteIdentity } from '@/types/site';

import { getCurrentSiteIdentity } from '@/api/siteRegistryApi';

const identity = ref<DeploymentSiteIdentity | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const initialized = ref(false);

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return `加载当前站点身份失败: ${err.message}`;
  }
  return '加载当前站点身份失败';
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    identity.value = await getCurrentSiteIdentity();
  } catch (err) {
    identity.value = null;
    error.value = normalizeErrorMessage(err);
  } finally {
    loading.value = false;
    initialized.value = true;
  }
}

function isCurrentSite(site: Pick<DeploymentSite, 'site_id'> | null | undefined): boolean {
  if (!site?.site_id || !identity.value?.site_id) {
    return false;
  }
  return site.site_id === identity.value.site_id;
}

export function useCurrentSiteIdentity() {
  if (!initialized.value) {
    void refresh();
  }

  return {
    identity: computed(() => identity.value),
    loading: computed(() => loading.value),
    error: computed(() => error.value),
    refresh,
    isCurrentSite,
  };
}
