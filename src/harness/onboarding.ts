/**
 * Visual harness · OnboardingOverlay fallback 警示横幅（token 迁移前后对比）
 *
 * 启动一个目标选择器不存在的向导步骤：isFallbackMode 触发居中 tooltip，
 * actionHint 渲染警示横幅（迁移点），无 actionHint 的对照步骤走 slate 提示。
 *
 * 仅供 shot.mjs 通用 runner（端口 5196）访问 /harness/onboarding.html 使用，
 * 不参与生产构建入口。
 */
import '@/assets/tailwind.css';

import { createApp, h } from 'vue';

import type { GuideDefinition } from '@/components/onboarding/types';

import OnboardingOverlay from '@/components/onboarding/OnboardingOverlay.vue';
import { useOnboardingGuide } from '@/composables/useOnboardingGuide';

const harnessGuide: GuideDefinition = {
  role: 'harness',
  title: '视觉基线向导',
  description: '覆盖 fallback 警示横幅样式',
  steps: [
    {
      id: 'fallback-hint',
      targetSelector: '[data-testid="harness-nonexistent-target"]',
      title: '打开三维校审面板',
      description: '本步骤的目标元素故意不存在，用于展示 fallback 模式下的操作提示横幅。',
      placement: 'bottom',
      actionHint: '请先在顶部功能区点击「三维校审」按钮打开面板，再回到本向导继续。',
      canSkip: true,
    },
  ],
};

const HarnessRoot = {
  setup() {
    const guide = useOnboardingGuide();
    void guide.startGuide(harnessGuide);
    return () => h('div', [
      h('div', { style: 'padding:24px;color:#64748b;font-size:13px' },
        'OnboardingOverlay fallback 场景（tooltip 居中，含警示横幅）'),
      h(OnboardingOverlay),
    ]);
  },
};

createApp(HarnessRoot).mount('#app');
