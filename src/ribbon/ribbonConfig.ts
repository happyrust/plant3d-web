import type { RibbonTabConfig } from '@/ribbon/ribbonTypes';

export const RIBBON_TABS: RibbonTabConfig[] = [
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
        id: 'view.panels',
        label: '面板',
        items: [
          {
            kind: 'stack',
            id: 'view.panels.stack',
            items: [
              { kind: 'button', id: 'panel.tree', label: '模型树', icon: 'tree', commandId: 'panel.tree' },
              { kind: 'button', id: 'panel.query', label: '模型查询', icon: 'search', commandId: 'panel.query' },
              { kind: 'button', id: 'panel.measurement', label: '测量', icon: 'ruler', commandId: 'panel.measurement' },
              { kind: 'button', id: 'panel.annotation', label: '批注', icon: 'note', commandId: 'panel.annotation' },
              { kind: 'button', id: 'panel.manager', label: '管理', icon: 'settings', commandId: 'panel.manager' },
              { kind: 'button', id: 'panel.properties', label: '属性', icon: 'info', commandId: 'panel.properties' },
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
          { kind: 'button', id: 'space_calc.range_query', label: '范围查询', icon: 'search', commandId: 'panel.query' },
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
          { kind: 'button', id: 'panel.review', label: '校审面板', icon: 'clipboard_list', commandId: 'panel.review' },
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
        id: 'mbd.basic',
        label: '标注',
        items: [
          { kind: 'button', id: 'mbd.placeholder', label: '未实现', icon: 'pencil', commandId: 'mbd.placeholder' },
        ],
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
          { kind: 'button', id: 'debug.placeholder', label: '未实现', icon: 'bug', commandId: 'debug.placeholder' },
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
          { kind: 'button', id: 'help.about', label: '关于', icon: 'help', commandId: 'help.about' },
          { kind: 'button', id: 'help.docs', label: '文档', icon: 'question', commandId: 'help.docs' },
        ],
      },
    ],
  },
];
