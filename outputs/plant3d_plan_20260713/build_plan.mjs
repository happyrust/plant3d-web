import fs from 'node:fs/promises';

import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1').replace(/\/$/, '');
const outputPath = `${outputDir}/plant3d简化开发计划_截至2026-08-10.xlsx`;
const workbook = Workbook.create();
const tasksSheet = workbook.worksheets.add('开发任务');
const weeksSheet = workbook.worksheets.add('周计划');

const c = {
  navy: '#17365D',
  blue: '#2F75B5',
  paleBlue: '#D9EAF7',
  green: '#70AD47',
  paleGreen: '#E2F0D9',
  amber: '#FFC000',
  paleAmber: '#FFF2CC',
  paleRed: '#FCE4D6',
  white: '#FFFFFF',
  text: '#1F2937',
  gray: '#666666',
  line: '#D9E1F2',
};
const d = (month, day) => new Date(2026, month - 1, day, 12, 0, 0);

const tasks = [
  ['D01', '需求确认与任务拆分', '确认图片中的功能范围、验收样例、负责人和交付顺序', '项目负责人', d(7,14), d(7,15), null, 'P0', '-', '确认后的开发任务清单', '所有功能都有负责人、日期和验收要求', '未开始'],
  ['D02', '云线与模型元素绑定', '绘制云线前选择目标模型，云线保存后可定位并高亮关联元素', '校审前端', d(7,16), d(7,17), null, 'P0', 'D01', '云线关联模型功能', '刷新或重新进入后关联关系不丢失', '未开始'],
  ['D03', '云线自动截屏', '完成云线绘制后自动保存当前三维视角截图，并支持查看和重拍', '校审前端', d(7,20), d(7,21), null, 'P0', 'D02', '自动截图功能', '云线创建后自动出现截图，失败时可重试', '未开始'],
  ['D04', '指定距离模型显示与高亮', '选择一个模型后，只显示指定距离内的模型；支持恢复全部模型和高亮目标', '三维前端', d(7,16), d(7,22), null, 'P0', 'D01', '范围显示与高亮功能', '5米/10米范围结果正确，管道越界部分可按要求显示', '未开始'],
  ['D05', '增量更新与版本管理', '记录每次模型更新，形成可选择、可追溯的模型版本', '后端开发', d(7,16), d(7,24), null, 'P0', 'D01', '模型版本列表与更新记录', '每次更新能生成版本，版本来源和时间清楚', '进行中'],
  ['D06', '多版本三维对照', '选择两个版本，在三维中查看新增、删除、修改和位置变化', '三维前端', d(7,23), d(7,29), null, 'P0', 'D05', '双版本三维对照功能', '两个版本模型显示正确，差异类型清晰可见', '进行中'],
  ['D07', 'PDF 和 Word 文件展示', '在校审界面查看与模型构件关联的 PDF、Word 文件', '校审前端', d(7,20), d(7,23), null, 'P0', 'D01', '关联文件预览功能', 'PDF、Word 可正常打开；异常文件可下载', '未开始'],
  ['D08', '元素关键点获取', '在三维模型中显示并选择元素关键点', '三维前端', d(7,20), d(7,22), null, 'P0', 'D01', '关键点显示与选择功能', '关键点位置正确，选择提示清楚', '未开始'],
  ['D09', '关键点测量', '使用关键点完成距离、角度和标高测量，并保存测量结果', '三维前端', d(7,23), d(7,27), null, 'P0', 'D08', '关键点测量功能', '距离、角度、标高结果正确且可查看/删除', '未开始'],
  ['D10', '元素最近距离测量', '选择两个模型元素，自动计算并标注最近距离', '三维前端', d(7,24), d(7,28), null, 'P1', 'D08', '元素最近距离功能', '最近点和距离与验收样例一致', '未开始'],
  ['D11', '管道与梁板柱墙最近距离', '自动测量管道到梁、板、柱、墙的最近距离并生成标注', '三维/后端', d(7,27), d(7,30), null, 'P0', 'D09', '管道与结构净距功能', '四类结构均可测量，结果能定位到对应构件', '未开始'],
  ['D12', '管道与管道最近距离', '自动测量管道之间的最近距离，支持批量生成和隐藏标注', '三维前端', d(7,29), d(7,31), null, 'P0', 'D09', '管道间净距功能', '标注不重复，距离正确，可显示/隐藏', '未开始'],
  ['D13', '管道信息标注', '标注管道标高、直径、长度、材质、包络、结构距离和管间距', '三维前端', d(7,29), d(8,4), null, 'P0', 'D11,D12', '完整管道标注功能', '字段齐全、单位一致、布局清晰，并与 ISO 图核对', '未开始'],
  ['D14', '三维校审流程集成', '把版本对比、批注、截图、附件和测量结果接入现有编校审流程', '校审前端', d(8,3), d(8,5), null, 'P0', 'D03,D06,D07,D13', '完整校审工作台', '发起、校核、审核、批准各角色可正常使用', '未开始'],
  ['D15', '综合联调与用户验收', '使用真实模型和校审单逐项验证功能，集中修复影响使用的问题', '测试/联调', d(8,6), d(8,7), null, 'P0', 'D14', '验收报告与问题清单', '主要功能全部通过，严重问题清零', '未开始'],
  ['D16', '发布交付', '整理使用说明、部署版本和回退方案，完成最终发布', '项目负责人', d(8,10), d(8,10), null, 'P0', 'D15', '正式发布版本', '上线检查通过，交付材料齐全', '未开始'],
];

const weeks = [
  ['第1阶段', d(7,14), d(7,19), '确认需求并启动开发', '需求清单；云线绑定；范围显示；版本管理启动', 'D01-D05'],
  ['第2阶段', d(7,20), d(7,26), '完成基础校审与测量能力', '自动截图；文件预览；关键点；版本数据准备', 'D03-D09'],
  ['第3阶段', d(7,27), d(8,2), '完成版本对比和最近距离功能', '多版本对照；元素/管道最近距离；管道标注主体', 'D06,D10-D13'],
  ['第4阶段', d(8,3), d(8,7), '集成校审流程并完成验收', '完整校审工作台；综合联调；用户验收', 'D13-D15'],
  ['发布日', d(8,10), d(8,10), '正式交付', '发布版本、使用说明、回退方案', 'D16'],
];

function title(sheet, range, text, subtitle) {
  sheet.getRange(range).merge();
  sheet.getRange(range).values = [[text]];
  sheet.getRange(range).format = {
    fill: c.navy,
    font: { bold: true, color: c.white, size: 18, name: 'Microsoft YaHei' },
    verticalAlignment: 'center',
  };
  sheet.getRange(range).format.rowHeight = 34;
  const endCol = range.split(':')[1].match(/[A-Z]+/)[0];
  sheet.getRange(`A2:${endCol}2`).merge();
  sheet.getRange(`A2:${endCol}2`).values = [[subtitle]];
  sheet.getRange(`A2:${endCol}2`).format = {
    fill: c.paleBlue,
    font: { color: c.gray, size: 10, name: 'Microsoft YaHei' },
    wrapText: true,
    verticalAlignment: 'center',
  };
  sheet.getRange(`A2:${endCol}2`).format.rowHeight = 26;
}

function header(range) {
  range.format = {
    fill: c.blue,
    font: { bold: true, color: c.white, name: 'Microsoft YaHei' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
    borders: { preset: 'all', style: 'thin', color: c.line },
  };
  range.format.rowHeight = 30;
}

function body(range) {
  range.format = {
    font: { color: c.text, size: 10, name: 'Microsoft YaHei' },
    verticalAlignment: 'top',
    wrapText: true,
    borders: { insideHorizontal: { style: 'thin', color: '#E7EAF0' }, bottom: { style: 'thin', color: '#E7EAF0' } },
  };
}

// 开发任务
tasksSheet.showGridLines = false;
title(tasksSheet, 'A1:L1', 'Plant3D 三维校审简化开发计划', '以开发任务为主，不展开代码、接口和技术实现细节；计划截止 2026-08-10。');
tasksSheet.getRange('A4:L4').values = [['编号', '开发任务', '主要内容', '责任人', '开始日期', '结束日期', '工期', '优先级', '前置任务', '交付结果', '验收标准', '状态']];
header(tasksSheet.getRange('A4:L4'));
tasksSheet.getRange('A5:L20').values = tasks;
tasksSheet.getRange('G5:G20').formulas = tasks.map((_, i) => [`=NETWORKDAYS(E${i + 5},F${i + 5})`]);
body(tasksSheet.getRange('A5:L20'));
tasksSheet.getRange('E5:F20').format.numberFormat = 'yyyy-mm-dd';
tasksSheet.getRange('G5:G20').format.numberFormat = '0';
tasksSheet.getRange('H5:H20').dataValidation = { rule: { type: 'list', values: ['P0', 'P1', 'P2'] } };
tasksSheet.getRange('L5:L20').dataValidation = { rule: { type: 'list', values: ['未开始', '进行中', '已完成', '阻塞'] } };
tasksSheet.getRange('H5:H20').conditionalFormats.add('containsText', { text: 'P0', format: { fill: c.paleRed, font: { color: '#C00000', bold: true } } });
tasksSheet.getRange('H5:H20').conditionalFormats.add('containsText', { text: 'P1', format: { fill: c.paleAmber, font: { color: '#7F6000', bold: true } } });
tasksSheet.getRange('L5:L20').conditionalFormats.add('containsText', { text: '进行中', format: { fill: c.paleBlue, font: { color: c.navy, bold: true } } });
tasksSheet.getRange('L5:L20').conditionalFormats.add('containsText', { text: '已完成', format: { fill: c.paleGreen, font: { color: '#375623', bold: true } } });
tasksSheet.tables.add('A4:L20', true, 'SimpleDevelopmentTasks').style = 'TableStyleMedium2';
tasksSheet.getRange('A22:L22').merge();
tasksSheet.getRange('A22:L22').values = [['总体目标：7月完成主要功能开发，8月3日进入流程集成，8月6日至7日完成用户验收，8月10日发布。']];
tasksSheet.getRange('A22:L22').format = { fill: c.paleAmber, font: { bold: true, color: '#7F6000', name: 'Microsoft YaHei' }, wrapText: true, borders: { preset: 'outside', style: 'medium', color: c.amber } };
tasksSheet.freezePanes.freezeRows(4);
tasksSheet.freezePanes.freezeColumns(2);
const widths = [8, 24, 46, 14, 12, 12, 8, 9, 16, 30, 38, 11];
widths.forEach((width, index) => tasksSheet.getRangeByIndexes(0, index, 22, 1).format.columnWidth = width);
tasksSheet.getRange('A5:L20').format.rowHeight = 54;

// 周计划 + 简单甘特图
weeksSheet.showGridLines = false;
title(weeksSheet, 'A1:Z1', '阶段计划与工作日排期', '先看阶段目标，再看各开发任务的工作日安排。');
weeksSheet.getRange('A4:F4').values = [['阶段', '开始', '结束', '阶段目标', '主要交付', '对应任务']];
header(weeksSheet.getRange('A4:F4'));
weeksSheet.getRange('A5:F9').values = weeks;
body(weeksSheet.getRange('A5:F9'));
weeksSheet.getRange('B5:C9').format.numberFormat = 'yyyy-mm-dd';
weeksSheet.getRange('A12:F12').values = [['编号', '开发任务', '责任人', '开始', '结束', '状态']];
const workdays = [];
for (let day = d(7,14); day <= d(8,10); day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 12)) {
  if (day.getDay() !== 0 && day.getDay() !== 6) workdays.push(new Date(day));
}
weeksSheet.getRangeByIndexes(11, 6, 1, workdays.length).values = [workdays];
header(weeksSheet.getRange('A12:Z12'));
weeksSheet.getRange('G12:Z12').format.numberFormat = 'm/d';
weeksSheet.getRange('A13:F28').values = tasks.map((row) => [row[0], row[1], row[3], row[4], row[5], row[11]]);
body(weeksSheet.getRange('A13:F28'));
weeksSheet.getRange('D13:E28').format.numberFormat = 'yyyy-mm-dd';
for (let i = 0; i < workdays.length; i++) {
  const col = String.fromCharCode(71 + i);
  weeksSheet.getRange(`${col}13:${col}28`).formulas = tasks.map((_, rowIndex) => [`=IF(AND(${col}$12>=$D${rowIndex + 13},${col}$12<=$E${rowIndex + 13}),\"■\",\"\")`]);
  weeksSheet.getRange(`${col}13:${col}28`).format = { fill: i < 8 ? c.paleBlue : i < 14 ? c.paleGreen : c.paleAmber, font: { bold: true, color: c.navy }, horizontalAlignment: 'center', verticalAlignment: 'center' };
  weeksSheet.getRangeByIndexes(0, 6 + i, 28, 1).format.columnWidth = 5;
}
weeksSheet.getRange('F13:F28').dataValidation = { rule: { type: 'list', values: ['未开始', '进行中', '已完成', '阻塞'] } };
weeksSheet.freezePanes.freezeRows(12);
weeksSheet.freezePanes.freezeColumns(2);
weeksSheet.getRange('A:A').format.columnWidth = 10;
weeksSheet.getRange('B:B').format.columnWidth = 34;
weeksSheet.getRange('C:C').format.columnWidth = 16;
weeksSheet.getRange('D:E').format.columnWidth = 12;
weeksSheet.getRange('F:F').format.columnWidth = 13;
weeksSheet.getRange('A5:F9').format.rowHeight = 42;
weeksSheet.getRange('A13:Z28').format.rowHeight = 32;
weeksSheet.getRange('A1:Z28').format.font.name = 'Microsoft YaHei';

await fs.mkdir(outputDir, { recursive: true });
const taskPreview = await workbook.render({ sheetName: '开发任务', range: 'A1:L22', scale: 0.9, format: 'png' });
await fs.writeFile(`${outputDir}/preview_simple_tasks.png`, new Uint8Array(await taskPreview.arrayBuffer()));
const weekPreview = await workbook.render({ sheetName: '周计划', range: 'A1:Z28', scale: 0.8, format: 'png' });
await fs.writeFile(`${outputDir}/preview_simple_weeks.png`, new Uint8Array(await weekPreview.arrayBuffer()));

const check = await workbook.inspect({ kind: 'table', range: '开发任务!A1:L20', include: 'values,formulas', tableMaxRows: 20, tableMaxCols: 12 });
await fs.writeFile(`${outputDir}/inspect_simple_tasks.ndjson`, check.ndjson, 'utf8');
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'formula error scan' });
await fs.writeFile(`${outputDir}/simple_formula_errors.ndjson`, errors.ndjson, 'utf8');

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
