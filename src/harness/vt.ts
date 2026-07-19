// Visual-baseline harness entry: mount the real VersionTimelinePanel with
// Tailwind tokens. APIs are network-mocked by the shot runner scenario
// (harness/vt.shots.mjs, driven by scripts/visual-baseline/shot.mjs).
import { createApp } from 'vue';

import '@/assets/tailwind.css';
import VersionTimelinePanel from '@/components/model-version/VersionTimelinePanel.vue';

createApp(VersionTimelinePanel).mount('#app');
