<script setup lang="ts">
import { ref } from 'vue';

import {
  ChevronDown,
  ChevronRight,
  FileCheck,
  FileWarning,
  FileSpreadsheet,
  Cog,
  ExternalLink,
} from 'lucide-vue-next';

// 关联文件类型定义
export type AssociatedFile = {
  id: string;
  name: string;
  path: string;
  status: 'ok' | 'warning' | 'error' | 'pending';
  updatedAt: string;
  size?: string;
}

export type FileCategory = {
  id: string;
  name: string;
  icon: string;
  description: string;
  files: AssociatedFile[];
  expanded: boolean;
}

// Props
type Props = {
  modelRefNo?: string;
}

const props = defineProps<Props>();

// 模拟的文件分类数据
const fileCategories = ref<FileCategory[]>([
  {
    id: 'mechanics',
    name: '力学分析文件',
    icon: 'mechanics',
    description: '管道应力分析、支吊架计算等力学校验文件',
    expanded: false,
    files: [
      {
        id: 'm1',
        name: '1RCV0244_应力分析报告.pdf',
        path: '/analysis/mechanics/1RCV0244_stress.pdf',
        status: 'ok',
        updatedAt: '2025-12-20 14:30',
        size: '2.4 MB',
      },
      {
        id: 'm2',
        name: '管道支吊架计算书.xlsx',
        path: '/analysis/mechanics/pipe_support_calc.xlsx',
        status: 'ok',
        updatedAt: '2025-12-19 10:15',
        size: '856 KB',
      },
      {
        id: 'm3',
        name: '热膨胀分析.docx',
        path: '/analysis/mechanics/thermal_expansion.docx',
        status: 'warning',
        updatedAt: '2025-12-18 16:45',
        size: '1.2 MB',
      },
    ],
  },
  {
    id: 'collision',
    name: '碰撞检查文件',
    icon: 'collision',
    description: '三维模型碰撞检测结果报告',
    expanded: false,
    files: [
      {
        id: 'c1',
        name: '碰撞检查报告_20251220.xlsx',
        path: '/check/collision/collision_report_20251220.xlsx',
        status: 'warning',
        updatedAt: '2025-12-20 09:00',
        size: '3.1 MB',
      },
      {
        id: 'c2',
        name: '硬碰撞清单.csv',
        path: '/check/collision/hard_clash_list.csv',
        status: 'error',
        updatedAt: '2025-12-20 09:00',
        size: '125 KB',
      },
      {
        id: 'c3',
        name: '软碰撞清单.csv',
        path: '/check/collision/soft_clash_list.csv',
        status: 'ok',
        updatedAt: '2025-12-20 09:00',
        size: '89 KB',
      },
      {
        id: 'c4',
        name: '碰撞处理记录.pdf',
        path: '/check/collision/clash_resolution.pdf',
        status: 'pending',
        updatedAt: '2025-12-19 17:30',
        size: '456 KB',
      },
    ],
  },
  {
    id: 'rules',
    name: '规则校验文件',
    icon: 'rules',
    description: '设计规范合规性检查结果',
    expanded: false,
    files: [
      {
        id: 'r1',
        name: '管道坡度校验.xlsx',
        path: '/check/rules/pipe_slope_check.xlsx',
        status: 'ok',
        updatedAt: '2025-12-20 11:20',
        size: '234 KB',
      },
      {
        id: 'r2',
        name: '阀门间距检查.csv',
        path: '/check/rules/valve_spacing_check.csv',
        status: 'ok',
        updatedAt: '2025-12-20 11:20',
        size: '67 KB',
      },
      {
        id: 'r3',
        name: '支吊架间距校验.xlsx',
        path: '/check/rules/support_spacing_check.xlsx',
        status: 'warning',
        updatedAt: '2025-12-19 15:45',
        size: '189 KB',
      },
    ],
  },
  {
    id: 'comparison',
    name: '二三维比对文件',
    icon: 'comparison',
    description: '二维图纸与三维模型一致性校验',
    expanded: false,
    files: [
      {
        id: 'p1',
        name: '二三维比对报告.pdf',
        path: '/check/comparison/2d3d_comparison.pdf',
        status: 'ok',
        updatedAt: '2025-12-20 16:00',
        size: '5.2 MB',
      },
      {
        id: 'p2',
        name: '差异清单.xlsx',
        path: '/check/comparison/difference_list.xlsx',
        status: 'warning',
        updatedAt: '2025-12-20 16:00',
        size: '312 KB',
      },
    ],
  },
]);

// 切换分类展开状态
function toggleCategory(categoryId: string) {
  const category = fileCategories.value.find((c) => c.id === categoryId);
  if (category) {
    category.expanded = !category.expanded;
  }
}

// 获取分类图标组件
function getCategoryIcon(iconType: string) {
  switch (iconType) {
    case 'mechanics':
      return Cog;
    case 'collision':
      return FileWarning;
    case 'rules':
      return FileCheck;
    case 'comparison':
      return FileSpreadsheet;
    default:
      return FileCheck;
  }
}

// 获取状态样式
function getStatusStyle(status: AssociatedFile['status']): { bg: string; text: string; label: string } {
  switch (status) {
    case 'ok':
      return { bg: 'bg-green-100', text: 'text-green-700', label: '通过' };
    case 'warning':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '警告' };
    case 'error':
      return { bg: 'bg-red-100', text: 'text-red-700', label: '错误' };
    case 'pending':
      return { bg: 'bg-gray-100', text: 'text-gray-600', label: '待处理' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600', label: '未知' };
  }
}

// 计算分类状态汇总
function getCategorySummary(files: AssociatedFile[]): { ok: number; warning: number; error: number } {
  return {
    ok: files.filter((f) => f.status === 'ok').length,
    warning: files.filter((f) => f.status === 'warning').length,
    error: files.filter((f) => f.status === 'error').length,
  };
}

// 打开文件（模拟）
function openFile(file: AssociatedFile) {
  console.log('Opening file:', file.path);
  // 实际实现时可以打开文件预览或下载
}
</script>

<template>
  <div class="associated-files-list">
    <div class="text-sm text-gray-500 mb-3">
      以下文件根据当前选择的模型构件自动关联
    </div>

    <!-- 文件分类列表 -->
    <div class="space-y-2">
      <div v-for="category in fileCategories"
        :key="category.id"
        class="border rounded-lg overflow-hidden">
        <!-- 分类头部 -->
        <button class="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
          @click="toggleCategory(category.id)">
          <!-- 展开/折叠图标 -->
          <component :is="category.expanded ? ChevronDown : ChevronRight"
            class="h-4 w-4 text-gray-400 flex-shrink-0" />

          <!-- 分类图标 -->
          <component :is="getCategoryIcon(category.icon)"
            class="h-5 w-5 text-blue-600 flex-shrink-0" />

          <!-- 分类名称 -->
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm">{{ category.name }}</div>
            <div class="text-xs text-gray-500 truncate">{{ category.description }}</div>
          </div>

          <!-- 状态汇总徽章 -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <span v-if="getCategorySummary(category.files).error > 0"
              class="px-1.5 py-0.5 text-xs rounded bg-red-100 text-red-700">
              {{ getCategorySummary(category.files).error }}
            </span>
            <span v-if="getCategorySummary(category.files).warning > 0"
              class="px-1.5 py-0.5 text-xs rounded bg-yellow-100 text-yellow-700">
              {{ getCategorySummary(category.files).warning }}
            </span>
            <span class="text-xs text-gray-500">
              {{ category.files.length }} 个文件
            </span>
          </div>
        </button>

        <!-- 文件列表（展开时显示） -->
        <div v-if="category.expanded"
          class="border-t bg-gray-50">
          <div v-for="file in category.files"
            :key="file.id"
            class="flex items-center gap-3 px-4 py-2 hover:bg-gray-100 cursor-pointer border-b last:border-b-0"
            @click="openFile(file)">
            <!-- 文件图标 -->
            <FileSpreadsheet class="h-4 w-4 text-gray-400 flex-shrink-0" />

            <!-- 文件信息 -->
            <div class="flex-1 min-w-0">
              <div class="text-sm truncate">{{ file.name }}</div>
              <div class="text-xs text-gray-400">
                {{ file.updatedAt }} · {{ file.size }}
              </div>
            </div>

            <!-- 状态标签 -->
            <span :class="[
              'px-2 py-0.5 text-xs rounded flex-shrink-0',
              getStatusStyle(file.status).bg,
              getStatusStyle(file.status).text,
            ]">
              {{ getStatusStyle(file.status).label }}
            </span>

            <!-- 打开链接 -->
            <ExternalLink class="h-4 w-4 text-gray-400 flex-shrink-0" />
          </div>
        </div>
      </div>
    </div>

    <!-- 无文件提示 -->
    <div v-if="fileCategories.length === 0"
      class="text-center py-6 text-gray-400 text-sm">
      暂无关联的校验文件
    </div>
  </div>
</template>

<style scoped>
.associated-files-list {
  width: 100%;
}
</style>
