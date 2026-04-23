import type { RibbonTabConfig } from '@/ribbon/ribbonTypes';

import { isReviewDebugUiEnabled } from '@/components/review/debugUiGate';
import { isMyTasksAvailableInWorkflowMode } from '@/components/review/workflowMode';
import { UserRole } from '@/types/auth';

const showDebugUi = isReviewDebugUiEnabled();
const showMyTasksEntry = isMyTasksAvailableInWorkflowMode();

const ALL_RIBBON_TABS: RibbonTabConfig[] = [
  {
    id: 'file',
    label: '文件',
    groups: [
      {
        id: 'file.project',
        label: '项目',
        items: [
          { kind: 'button', id: 'file.open', label: '打开', icon: 'folder_open', commandId: 'file.open' },
          { kind: 'button', id: 'file.save', label: '保存', icon: 'file', commandId: 'file.save' },
        ],
      },
      {
        id: 'file.navigation',
        label: '导航',
        items: [
          { kind: 'button', id: 'file.backToDashboard', label: '返回概览', icon: 'layout_dashboard', commandId: 'file.backToDashboard' },
        ],
      },
    ],
  },
  {
    id: 'edit',
    label: '编辑',
    groups: [
      {
        id: 'edit.basic',
        label: '基础',
        items: [
          { kind: 'button', id: 'edit.undo', label: '撤销', icon: 'undo', commandId: 'edit.undo' },
          { kind: 'button', id: 'edit.redo', label: '重做', icon: 'redo', commandId: 'edit.redo' },
        ],
      },
    ],
  },
  {
    id: 'view',
    label: '视图',
    groups: [
      {
        id: 'view.panel.tree',
        label: '模型树',
        items: [
          { kind: 'button', id: 'panel.tree', label: '模型树', icon: 'tree', commandId: 'panel.tree' },
        ],
      },
      {
        id: 'view.panel.query',
        label: '空间查询',
        items: [
          { kind: 'button', id: 'panel.spatialQuery', label: '空间查询', icon: 'search', commandId: 'panel.spatialQuery' },
        ],
      },
      {
        id: 'view.panel.measurement',
        label: '测量',
        items: [
          { kind: 'button', id: 'panel.measurement', label: '测量', icon: 'ruler', commandId: 'panel.measurement' },
        ],
      },
      {
        id: 'view.panel.dimension',
        label: '尺寸标注',
        items: [
          { kind: 'button', id: 'panel.dimension', label: '尺寸标注', icon: 'ruler', commandId: 'panel.dimension' },
        ],
      },
      {
        id: 'view.panel.annotation',
        label: '批注',
        items: [
          { kind: 'button', id: 'panel.annotation', label: '批注', icon: 'note', commandId: 'panel.annotation' },
        ],
      },
      {
        id: 'view.panel.manager',
        label: '管理',
        items: [
          { kind: 'button', id: 'panel.manager', label: '管理', icon: 'settings', commandId: 'panel.manager' },
        ],
      },
      {
        id: 'view.panel.properties',
        label: '属性',
        items: [
          { kind: 'button', id: 'panel.properties', label: '属性', icon: 'info', commandId: 'panel.properties' },
        ],
      },
      {
        id: 'view.panel.console',
        label: '控制台',
        items: [
          { kind: 'button', id: 'panel.console', label: '控制台', icon: 'console', commandId: 'panel.console' },
        ],
      },
      {
        id: 'view.panel.material',
        label: '颜色配置',
        items: [
          { kind: 'button', id: 'panel.materialConfig', label: '颜色配置', icon: 'tag', commandId: 'panel.materialConfig' },
        ],
      },
      {
        id: 'view.attributes',
        label: '属性显示',
        items: [
          {
            kind: 'stack',
            id: 'view.attributes.display',
            items: [
              { kind: 'button', id: 'view.attr.all', label: '全部属性', icon: 'list', commandId: 'view.attr.all' },
              { kind: 'button', id: 'view.attr.general', label: '通用属性', icon: 'file_text', commandId: 'view.attr.general' },
              { kind: 'button', id: 'view.attr.component', label: '元件属性', icon: 'component', commandId: 'view.attr.component' },
              { kind: 'button', id: 'view.attr.uda', label: 'UDA属性', icon: 'tag', commandId: 'view.attr.uda' },
            ],
          },
          {
            kind: 'stack',
            id: 'view.attributes.compare',
            items: [
              { kind: 'button', id: 'view.attr.normal', label: '完整显示', icon: 'eye', commandId: 'view.attr.normal' },
              { kind: 'button', id: 'view.attr.diff', label: '差异对比', icon: 'compare', commandId: 'view.attr.diff' },
            ],
          },
        ],
      },
      {
        id: 'view.layout',
        label: '布局',
        items: [
          { kind: 'button', id: 'layout.popout', label: '弹出', icon: 'layout_left', commandId: 'layout.popout' },
          { kind: 'button', id: 'layout.save', label: '保存布局', icon: 'file', commandId: 'layout.save' },
          { kind: 'button', id: 'layout.reset', label: '重置布局', icon: 'undo', commandId: 'layout.reset' },
        ],
      },
    ],
  },
  {
    id: 'tools',
    label: '工具',
    groups: [
      {
        id: 'tools.core',
        label: '核心',
        items: [
          { kind: 'button', id: 'tools.clear_all', label: '清空全部', icon: 'trash', commandId: 'tools.clear_all' },
          { kind: 'button', id: 'panel.hydraulic', label: '水力计算', icon: 'calculator', commandId: 'panel.hydraulic' },
        ],
      },
    ],
  },
  {
    id: 'measurement',
    label: '测量',
    groups: [
      {
        id: 'measurement.create',
        label: '创建',
        items: [
          { kind: 'button', id: 'measurement.distance', label: '距离', icon: 'ruler', commandId: 'measurement.distance' },
          { kind: 'button', id: 'measurement.point_to_mesh', label: '点到面', icon: 'ruler_combined', commandId: 'measurement.point_to_mesh' },
          { kind: 'button', id: 'measurement.object_to_object', label: '构件最近点', icon: 'ruler_combined', commandId: 'measurement.object_to_object' },
          { kind: 'button', id: 'measurement.pipe_to_structure', label: '管-墙/柱', icon: 'ruler_combined', commandId: 'measurement.pipe_to_structure' },
          { kind: 'button', id: 'measurement.pipe_to_pipe', label: '管-管', icon: 'ruler_combined', commandId: 'measurement.pipe_to_pipe' },
          { kind: 'button', id: 'measurement.angle', label: '角度', icon: 'ruler', commandId: 'measurement.angle' },
        ],
      },
      {
        id: 'measurement.manage',
        label: '管理',
        items: [
          { kind: 'button', id: 'measurement.clear', label: '清空', icon: 'trash', commandId: 'measurement.clear' },
        ],
      },
    ],
  },
  {
    id: 'dimension',
    label: '尺寸标注',
    groups: [
      {
        id: 'dimension.create',
        label: '创建',
        items: [
          { kind: 'button', id: 'dimension.linear', label: '距离', icon: 'ruler', commandId: 'dimension.linear' },
          { kind: 'button', id: 'dimension.angle', label: '角度', icon: 'ruler', commandId: 'dimension.angle' },
        ],
      },
      {
        id: 'dimension.manage',
        label: '管理',
        items: [
          { kind: 'button', id: 'dimension.clear', label: '清空', icon: 'trash', commandId: 'dimension.clear' },
        ],
      },
      {
        id: 'dimension.config',
        label: '配置',
        items: [
          { kind: 'button', id: 'dimension.settings', label: '样式设置', icon: 'settings', commandId: 'dimension.settings' },
        ],
      },
    ],
  },
  {
    id: 'annotation',
    label: '批注',
    groups: [
      {
        id: 'annotation.create',
        label: '创建',
        items: [
          { kind: 'button', id: 'annotation.create.note', label: '创建', icon: 'square_pen', commandId: 'annotation.create' },
        ],
      },
      {
        id: 'annotation.manage',
        label: '管理',
        items: [
          { kind: 'button', id: 'annotation.style.settings', label: '样式设置', icon: 'settings', commandId: 'annotation.settings' },
          { kind: 'button', id: 'annotation.clear', label: '清空', icon: 'trash', commandId: 'annotation.clear' },
        ],
      },
    ],
  },
  {
    id: 'space_calc',
    label: '空间计算',
    groups: [
      {
        id: 'space_calc.query',
        label: '查询',
        items: [
          { kind: 'button', id: 'space_calc.range_query', label: '空间查询', icon: 'search', commandId: 'panel.spatialQuery' },
          { kind: 'button', id: 'space_calc.suppo_compute', label: '支架空间计算', icon: 'calculator', commandId: 'panel.spatialCompute' },
        ],
      },
      {
        id: 'space_calc.room',
        label: '房间计算',
        items: [
          { kind: 'button', id: 'space_calc.room_compute', label: '构建房间关系', icon: 'home', commandId: 'room.compute' },
          { kind: 'button', id: 'space_calc.room_status', label: '计算状态', icon: 'activity', commandId: 'panel.roomStatus' },
        ],
      },
    ],
  },
  {
    id: 'review',
    label: '校审',
    groups: [
      {
        id: 'review.mode',
        label: '模式',
        items: [
          { kind: 'button', id: 'review.start', label: '开始校审', icon: 'clipboard_check', commandId: 'review.start' },
          { kind: 'button', id: 'review.confirm', label: '确认数据', icon: 'check_circle', commandId: 'review.confirm' },
        ],
      },
      {
        id: 'review.panel',
        label: '面板',
        items: [
          { kind: 'button', id: 'panel.initiateReview', label: '发起编校审', icon: 'plus', commandId: 'panel.initiateReview' },
          { kind: 'button', id: 'panel.review', label: '校审面板', icon: 'clipboard_list', commandId: 'panel.review' },
          { kind: 'button', id: 'panel.reviewerTasks', label: '待审核', icon: 'clipboard_check', commandId: 'panel.reviewerTasks' },
          { kind: 'button', id: 'panel.resubmissionTasks', label: '批注处理', icon: 'redo', commandId: 'panel.resubmissionTasks' },
          {
            kind: 'button',
            id: 'panel.annotationTable',
            label: '批注表格',
            icon: 'table',
            commandId: 'panel.annotationTable',
            roles: [
              UserRole.DESIGNER,
              UserRole.PROOFREADER,
              UserRole.REVIEWER,
              UserRole.MANAGER,
              UserRole.ADMIN,
            ],
          },
          { kind: 'button', id: 'panel.myTasks', label: '我的编校审', icon: 'file_text', commandId: 'panel.myTasks' },
        ],
      },
      {
        id: 'review.data',
        label: '数据',
        items: [
          { kind: 'button', id: 'review.export', label: '导出', icon: 'download', commandId: 'review.export' },
          { kind: 'button', id: 'review.clear', label: '清空', icon: 'trash', commandId: 'review.clear' },
        ],
      },
    ],
  },
  {
    id: 'mbd',
    label: 'MBD',
    groups: [
      {
        id: 'mbd.pipe',
        label: '管道标注',
        items: [
          { kind: 'button', id: 'panel.mbdPipe', label: '管道标注', icon: 'ruler', commandId: 'panel.mbdPipe' },
          { kind: 'button', id: 'mbd.generate', label: '生成标注', icon: 'plus', commandId: 'mbd.generate' },
          { kind: 'button', id: 'panel.pipeDistance', label: '管道距离', icon: 'activity', commandId: 'panel.pipeDistance' },
        ],
      },
      {
        id: 'mbd.dims',
        label: '尺寸类型',
        items: [
          {
            kind: 'stack',
            id: 'mbd.dims.left',
            items: [
              { kind: 'button', id: 'mbd.dim.segment', label: '段长', icon: 'ruler', commandId: 'mbd.dim.segment' },
              { kind: 'button', id: 'mbd.dim.chain', label: '链式', icon: 'link', commandId: 'mbd.dim.chain' },
            ],
          },
          {
            kind: 'stack',
            id: 'mbd.dims.right',
            items: [
              { kind: 'button', id: 'mbd.dim.overall', label: '总长', icon: 'move_horizontal', commandId: 'mbd.dim.overall' },
              { kind: 'button', id: 'mbd.dim.port', label: '端口', icon: 'circle_dot', commandId: 'mbd.dim.port' },
            ],
          },
        ],
      },
      {
        id: 'mbd.annotation',
        label: '其他标注',
        items: [
          {
            kind: 'stack',
            id: 'mbd.annotation.stack',
            items: [
              { kind: 'button', id: 'mbd.weld', label: '焊缝', icon: 'zap', commandId: 'mbd.weld' },
              { kind: 'button', id: 'mbd.slope', label: '坡度', icon: 'trending_up', commandId: 'mbd.slope' },
            ],
          },
        ],
      },
      {
        id: 'mbd.display',
        label: '显示控制',
        items: [
          {
            kind: 'stack',
            id: 'mbd.display.left',
            items: [
              { kind: 'button', id: 'mbd.segments', label: '管段线', icon: 'spline', commandId: 'mbd.segments' },
              { kind: 'button', id: 'mbd.labels', label: '文字标签', icon: 'file_text', commandId: 'mbd.labels' },
            ],
          },
          {
            kind: 'stack',
            id: 'mbd.display.right',
            items: [{ kind: 'button', id: 'mbd.toggle_all', label: '全部显隐', icon: 'eye', commandId: 'mbd.toggle_all' }],
          },
        ],
      },
      {
        id: 'mbd.actions',
        label: '操作',
        items: [
          { kind: 'button', id: 'mbd.flyTo', label: '飞行定位', icon: 'locate', commandId: 'mbd.flyTo' },
          { kind: 'button', id: 'mbd.clear', label: '清除', icon: 'trash', commandId: 'mbd.clear' },
        ],
      },
      {
        id: 'mbd.config',
        label: '配置',
        items: [{ kind: 'button', id: 'mbd.settings', label: '标注设置', icon: 'settings', commandId: 'mbd.settings' }],
      },
    ],
  },
  {
    id: 'debug',
    label: '调试',
    groups: [
      {
        id: 'debug.basic',
        label: '调试',
        items: [
          { kind: 'button', id: 'debug.parquetSql', label: 'Parquet SQL', icon: 'database', commandId: 'panel.parquetDebug' },
        ],
      },
    ],
  },
  {
    id: 'task',
    label: '任务',
    groups: [
      {
        id: 'task.create',
        label: '新建任务',
        items: [
          { kind: 'button', id: 'task.dataParsing', label: '数据解析', icon: 'database', commandId: 'task.createDataParsing' },
          { kind: 'button', id: 'task.modelGen', label: '模型生成', icon: 'cube', commandId: 'task.createModelGeneration' },
          { kind: 'button', id: 'task.modelExport', label: '导出模型', icon: 'download', commandId: 'task.createModelExport' },
        ],
      },
      {
        id: 'task.monitor',
        label: '监控',
        items: [
          { kind: 'button', id: 'task.monitor', label: '任务监控', icon: 'monitor', commandId: 'panel.taskMonitor' },
        ],
      },
    ],
  },
  {
    id: 'help',
    label: '帮助',
    groups: [
      {
        id: 'help.basic',
        label: '帮助',
        items: [
          { kind: 'button', id: 'help.reviewGuide', label: '校审导航', icon: 'help', commandId: 'help.reviewGuide' },
          { kind: 'button', id: 'help.about', label: '关于', icon: 'help', commandId: 'help.about' },
          { kind: 'button', id: 'help.releaseNotes', label: '更新说明', icon: 'help', commandId: 'help.releaseNotes' },
          { kind: 'button', id: 'help.docs', label: '文档', icon: 'question', commandId: 'help.docs' },
        ],
      },
    ],
  },
];

const BASE_RIBBON_TABS: RibbonTabConfig[] = showDebugUi
  ? ALL_RIBBON_TABS
  : ALL_RIBBON_TABS.filter((tab) => tab.id !== 'debug');

function filterPassiveWorkflowEntries(tabs: RibbonTabConfig[]): RibbonTabConfig[] {
  if (showMyTasksEntry) return tabs;

  return tabs.map((tab) => ({
    ...tab,
    groups: tab.groups.map((group) => ({
      ...group,
      items: group.items.flatMap((item) => {
        if (item.kind === 'button') {
          return item.commandId === 'panel.myTasks' ? [] : [item];
        }
        if (item.kind === 'stack') {
          const nextItems = item.items.filter((subItem) => subItem.commandId !== 'panel.myTasks');
          return nextItems.length > 0 ? [{ ...item, items: nextItems }] : [];
        }
        return [item];
      }),
    })).filter((group) => group.items.length > 0),
  }));
}

export const RIBBON_TABS: RibbonTabConfig[] = filterPassiveWorkflowEntries(BASE_RIBBON_TABS);
