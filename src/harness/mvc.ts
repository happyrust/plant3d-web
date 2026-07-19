// Visual-baseline harness entry: mount the real ModelVersionComparePanel with
// Tailwind tokens. APIs are network-mocked by the shot runner scenario
// (harness/mvc.shots.mjs, driven by scripts/visual-baseline/shot.mjs).
import { createApp } from 'vue';

import '@/assets/tailwind.css';
import ModelVersionComparePanel from '@/components/model-version/ModelVersionComparePanel.vue';

createApp(ModelVersionComparePanel, { disableFrameNavigation: true }).mount('#app');
