/**
 * Visual harness · dashboard 家族运行时视觉证据（#44 补证）
 *
 * 挂载真实 DashboardOverview（快捷操作 token 色块 / 指标卡 / 任务列表状态徽章 /
 * 团队动态）。数据全部走真实 fetch 路径，由 shot runner 场景在网络层 mock：
 * /api/projects、/api/users/me、/api/review/tasks、/api/status、
 * /api/dashboard/activities（见 harness/dashboard.shots.mjs）。
 *
 * 仅供 vite（端口 5195）下 /harness/dashboard.html 人工 / 截图访问。
 */
import { createApp } from 'vue';

import '@/assets/tailwind.css';

import DashboardOverview from '@/components/dashboard/DashboardOverview.vue';

createApp(DashboardOverview).mount('#app-overview');
