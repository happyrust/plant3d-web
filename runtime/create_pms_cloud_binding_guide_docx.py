from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(r'D:\work\plant-code\plant3d-web')
SHOTS = ROOT / 'test-results'
OUTPUT = ROOT / 'docs' / 'guides' / 'PMS三维校审云线元素绑定操作说明-含截图操作.docx'

BLUE = '2E74B5'
DARK_BLUE = '1F4D78'
LIGHT_BLUE = 'E8EEF5'
LIGHT_GRAY = 'F2F4F7'
MUTED = '667085'
GREEN = '16803C'
INK = '172B4D'


def set_run_font(run, size=11, bold=False, color='000000', italic=False):
    run.font.name = 'Calibri'
    run._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = RGBColor.from_string(color)


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd')
        tc_pr.append(shd)
    shd.set(qn('w:fill'), fill)


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in('w:tcMar')
    if tc_mar is None:
        tc_mar = OxmlElement('w:tcMar')
        tc_pr.append(tc_mar)
    for edge, value in (('top', top), ('start', start), ('bottom', bottom), ('end', end)):
        node = tc_mar.find(qn(f'w:{edge}'))
        if node is None:
            node = OxmlElement(f'w:{edge}')
            tc_mar.append(node)
        node.set(qn('w:w'), str(value))
        node.set(qn('w:type'), 'dxa')


def set_table_geometry(table, widths):
    total = sum(widths)
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.first_child_found_in('w:tblW')
    tbl_w.set(qn('w:w'), str(total))
    tbl_w.set(qn('w:type'), 'dxa')
    tbl_ind = tbl_pr.first_child_found_in('w:tblInd')
    if tbl_ind is None:
        tbl_ind = OxmlElement('w:tblInd')
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn('w:w'), '120')
    tbl_ind.set(qn('w:type'), 'dxa')
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        col = OxmlElement('w:gridCol')
        col.set(qn('w:w'), str(width))
        grid.append(col)
    for row in table.rows:
        for index, cell in enumerate(row.cells):
            width = widths[index]
            tc_w = cell._tc.get_or_add_tcPr().first_child_found_in('w:tcW')
            tc_w.set(qn('w:w'), str(width))
            tc_w.set(qn('w:type'), 'dxa')
            cell.width = Inches(width / 1440)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            set_cell_margins(cell)


def add_table(doc, headers, rows, widths):
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = 'Table Grid'
    set_table_geometry(table, widths)
    for index, text in enumerate(headers):
        cell = table.rows[0].cells[index]
        set_cell_shading(cell, LIGHT_BLUE)
        paragraph = cell.paragraphs[0]
        paragraph.paragraph_format.space_after = Pt(0)
        run = paragraph.add_run(text)
        set_run_font(run, 10, True, DARK_BLUE)
    for row in rows:
        cells = table.add_row().cells
        for index, text in enumerate(row):
            paragraph = cells[index].paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(0)
            run = paragraph.add_run(text)
            set_run_font(run, 9.5)
    set_table_geometry(table, widths)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run('第 ')
    set_run_font(run, 9, color=MUTED)
    fld = OxmlElement('w:fldSimple')
    fld.set(qn('w:instr'), 'PAGE')
    paragraph._p.append(fld)
    run = paragraph.add_run(' 页')
    set_run_font(run, 9, color=MUTED)


def add_title(doc, text, size=28, after=8):
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_after = Pt(after)
    run = paragraph.add_run(text)
    set_run_font(run, size, True, INK)
    return paragraph


def add_body(doc, text, bold_prefix=None, color='000000', after=6):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(after)
    paragraph.paragraph_format.line_spacing = 1.25
    if bold_prefix and text.startswith(bold_prefix):
        lead = paragraph.add_run(bold_prefix)
        set_run_font(lead, 11, True, DARK_BLUE)
        rest = paragraph.add_run(text[len(bold_prefix):])
        set_run_font(rest, 11, color=color)
    else:
        run = paragraph.add_run(text)
        set_run_font(run, 11, color=color)
    return paragraph


def add_step(doc, number, action, detail):
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.space_after = Pt(5)
    paragraph.paragraph_format.line_spacing = 1.25
    badge = paragraph.add_run(f'步骤 {number}  ')
    set_run_font(badge, 11, True, BLUE)
    title = paragraph.add_run(action)
    set_run_font(title, 11, True, '000000')
    detail_run = paragraph.add_run(f'：{detail}')
    set_run_font(detail_run, 11)


def add_callout(doc, label, text, fill=LIGHT_GRAY, color=INK):
    table = doc.add_table(rows=1, cols=1)
    set_table_geometry(table, [9360])
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    paragraph = cell.paragraphs[0]
    paragraph.paragraph_format.space_after = Pt(0)
    run = paragraph.add_run(f'{label}  ')
    set_run_font(run, 10.5, True, color)
    run = paragraph.add_run(text)
    set_run_font(run, 10.5, color=color)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def set_alt_text(inline_shape, title, description):
    doc_pr = inline_shape._inline.docPr
    doc_pr.set('title', title)
    doc_pr.set('descr', description)


def add_figure(doc, filename, caption, number):
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.space_before = Pt(4)
    paragraph.paragraph_format.space_after = Pt(4)
    paragraph.paragraph_format.keep_with_next = True
    inline_shape = paragraph.add_run().add_picture(str(SHOTS / filename), width=Inches(6.3))
    set_alt_text(inline_shape, f'图 {number}', caption)
    caption_p = doc.add_paragraph()
    caption_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption_p.paragraph_format.space_before = Pt(0)
    caption_p.paragraph_format.space_after = Pt(8)
    caption_p.paragraph_format.keep_with_next = False
    run = caption_p.add_run(f'图 {number}  {caption}')
    set_run_font(run, 9, color=MUTED)


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.75)
section.bottom_margin = Inches(0.72)
section.left_margin = Inches(1)
section.right_margin = Inches(1)
section.header_distance = Inches(0.38)
section.footer_distance = Inches(0.38)

normal = doc.styles['Normal']
normal.font.name = 'Calibri'
normal._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
normal.font.size = Pt(11)
normal.paragraph_format.space_before = Pt(0)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.25

for style_name, size, color, before, after in (
    ('Heading 1', 16, BLUE, 18, 10),
    ('Heading 2', 13, BLUE, 14, 7),
    ('Heading 3', 12, DARK_BLUE, 10, 5),
):
    style = doc.styles[style_name]
    style.font.name = 'Calibri'
    style._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    style.font.size = Pt(size)
    style.font.bold = True
    style.font.color.rgb = RGBColor.from_string(color)
    style.paragraph_format.space_before = Pt(before)
    style.paragraph_format.space_after = Pt(after)
    style.paragraph_format.keep_with_next = True

header = section.header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.LEFT
run = header.add_run('PowerPMS · 三维校审操作指南')
set_run_font(run, 9, True, MUTED)
add_page_number(section.footer.paragraphs[0])

# Cover
spacer = doc.add_paragraph()
spacer.paragraph_format.space_after = Pt(70)
add_title(doc, 'PMS 三维校审', 31, 5)
add_title(doc, '云线与模型元素绑定操作说明', 24, 12)
subtitle = doc.add_paragraph()
subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
subtitle.paragraph_format.space_after = Pt(30)
run = subtitle.add_run('SJ 发起 · PMS 送审 · JH 绘制 · 自动截图 · 双向定位')
set_run_font(run, 13, color=DARK_BLUE)
add_callout(
    doc,
    '实测环境',
    'PowerPMS；Aveva Marine Sample；BRAN 24381_145018；2026-07-30。',
    fill=LIGHT_BLUE,
)
add_body(
    doc,
    '本指南中的截图来自真实 PMS 联调过程。账号密码不写入文档；流程人员及项目权限以实际组织配置为准。',
    color=MUTED,
)

# Roles and baseline
page_break(doc)
doc.add_heading('1. 使用前提与角色', level=1)
add_body(doc, 'PMS 入口：http://pms.powerpms.net:1801/sysin.html')
add_table(
    doc,
    ['角色', '默认界面', '主要操作'],
    [
        ('SJ 设计人员', '默认不显示“发起编校审”面板', '显式打开发起面板，保存校审单并送审'),
        ('JH 校对人员', '从 PMS 待办进入校对节点', '绑定元素、绘制云线、确认数据'),
        ('审核/批准人员', '按流程节点进入任务', '查看绑定、定位模型并继续审批'),
    ],
    [1500, 3600, 4260],
)
add_callout(
    doc,
    '关键规则',
    'SJ 进入三维校审时只显示已有批注处理区。只有主动选择“校审 → 发起编校审”后，右侧才显示发起表单。',
    fill='FFF4E5',
    color='7A5A00',
)

page_break(doc)
doc.add_heading('2. 登录 PowerPMS', level=1)
add_step(doc, 1, '打开登录页', '输入内部测试账号和密码。')
add_step(doc, 2, '进入业务中心', '登录后选择“业务中心”，进入设计交付相关菜单。')
add_figure(doc, 'pms-cloud-binding-01-login.png', 'PowerPMS 登录入口', 1)

# Review list
page_break(doc)
doc.add_heading('3. 打开三维校审单', level=1)
add_step(doc, 1, '进入设计交付', '依次打开“设计交付 → 三维校审单”。')
add_step(doc, 2, '新建或打开任务', 'SJ 点击“新增”；JH 从待办或列表打开对应校审单。')
add_step(doc, 3, '等待三维窗口加载', '确认模型树、三维视图和校审面板均已出现。')
add_figure(doc, 'pms-cloud-binding-02-review-list.png', 'PMS 三维校审单列表', 2)

# SJ initiation
page_break(doc)
doc.add_heading('4. SJ 发起并保存校审单', level=1)
add_step(doc, 1, '显式打开发起面板', '点击顶部“校审 → 发起编校审”。')
add_step(doc, 2, '添加模型元素', '输入 RefNo 24381_145018 后按 Enter，或先选模型再使用当前选择。')
add_step(doc, 3, '填写校审信息', '填写校审包名称、说明以及校核、审核、批准人员。')
add_step(doc, 4, '保存数据', '点击“保存编校审单数据”，看到绿色成功提示后再送审。')
add_figure(doc, 'pms-cloud-binding-05-task-saved.png', 'SJ 校审单保存成功及默认权限提示', 3)
add_callout(
    doc,
    '送审',
    '回到 PMS 校审单工具栏点击“送审”，选择“三维编校审”，指定校核、审核、批准人员后提交。',
    fill='EAF6EE',
    color=GREEN,
)

# JH target selection
page_break(doc)
doc.add_heading('5. JH 选择云线关联元素', level=1)
add_step(doc, 1, '打开校对待办', '确认当前节点为“校对”、状态为“待处理”。')
add_step(doc, 2, '选择模型目标', '在模型树或三维视图选择 BRAN 24381_145018。')
add_step(doc, 3, '启动云线批注', '点击“云线批注”，再点击“使用当前选择”。')
add_step(doc, 4, '核对目标', '关联元素区域应显示“关联元素 1”和 RefNo 标签。')
add_figure(doc, 'pms-cloud-binding-06-jh-target.png', 'JH 选择 BRAN 并加入云线关联目标', 4)
add_callout(
    doc,
    '其他选择方式',
    '点选目标支持连续选择并按 Enter 确认；框选目标适合批量选择。目标可逐项移除或清空。',
)

# Draw
page_break(doc)
doc.add_heading('6. 设置锚点并绘制云线', level=1)
add_step(doc, 1, '选择锚点', '关联目标非空后，在模型上单击云线锚点。')
add_step(doc, 2, '拖拽轮廓', '出现“锚点已就绪”提示后，在三维视图按住鼠标拖拽。')
add_step(doc, 3, '保存批注', '检查云线位置后点击“保存批注”。')
add_figure(doc, 'pms-cloud-binding-07-jh-drawn.png', '云线轮廓绘制完成，等待保存', 5)
add_callout(
    doc,
    '状态保护',
    '目标为空时不能选择锚点或绘制；修改目标会清除旧锚点；按 Esc 可退出当前拾取步骤。',
    fill='FFF4E5',
    color='7A5A00',
)

# Confirm and lookup
page_break(doc)
doc.add_heading('7. 确认、截图与双向定位', level=1)
add_step(doc, 1, '确认当前数据', '点击“确认当前数据 → 确认完成”。')
add_step(doc, 2, '检查自动截图', '批注确认完成后，系统自动保存当前三维视角 PNG；详情中应显示“问题截图”和“重拍”。')
add_step(doc, 3, '云线查模型', '点击“定位高亮全部”或单个元素的“定位高亮”。')
add_step(doc, 4, '模型查云线', '选中模型后查看“当前模型关联云线”，点击条目返回对应云线。')
add_callout(
    doc,
    '自动截图规则',
    '点击“确认完成”后无需手动截屏。系统把当前相机视角保存为 PNG，并与本次批注记录绑定；“问题截图”用于查看，“重拍”以当前视角替换原图。刷新页面或重新登录后，截图随批注恢复。',
    fill=LIGHT_BLUE,
    color=DARK_BLUE,
)
add_figure(doc, 'pms-cloud-binding-08-confirmed-detail.png', '确认后的关联元素、锚点及定位入口', 6)
add_callout(
    doc,
    '持久化检查',
    '刷新页面、重新进入任务或重新登录后，绑定元素、锚点和问题截图均应恢复。',
    fill='EAF6EE',
    color=GREEN,
)

# Screenshot operation
page_break(doc)
doc.add_heading('8. 自动截图查看与重拍', level=1)
add_step(doc, 1, '生成截图', '完成批注并点击“确认完成”，系统自动把当前三维视角保存为 PNG。')
add_step(doc, 2, '查看截图', '在右侧批注详情向下滚动到“问题截图”，点击截图区域查看本次确认视角。')
add_step(doc, 3, '准备重拍', '先旋转、缩放或定位模型，把三维视图调整到需要替换的新视角。')
add_step(doc, 4, '执行重拍', '点击“重拍”，系统用当前三维视角替换原问题截图并随批注保存。')
add_figure(
    doc,
    'pms-cloud-binding-09-problem-screenshot-view.png',
    '问题截图卡片与“重拍”按钮（真实 PMS 操作界面）',
    7,
)
add_callout(
    doc,
    '注意',
    '重拍会替换该批注原有问题截图。操作前先确认当前模型、相机视角和需要表达的问题区域均正确。',
    fill='FFF4E5',
    color='7A5A00',
)

# Verification
page_break(doc)
doc.add_heading('9. 验收检查表', level=1)
add_table(
    doc,
    ['检查项', '结果'],
    [
        ('SJ 进入校审时默认不显示发起面板', '通过'),
        ('SJ 显式发起、保存并通过 PMS 送审', '通过'),
        ('JH 从 PMS 待办进入校对任务', '通过'),
        ('BRAN 24381_145018 作为云线关联目标', '通过'),
        ('锚点选择、云线拖拽及保存', '通过'),
        ('批注确认后自动生成 PNG、“问题截图”和“重拍”入口', '通过'),
        ('确认后关联元素及锚点正确显示', '通过'),
        ('云线定位全部/单个关联元素', '通过'),
        ('模型元素反查关联云线', '通过'),
    ],
    [7600, 1760],
)
doc.add_heading('10. 本次真实联调记录', level=1)
add_body(doc, '校审包：E2E-云线元素绑定-20260730-1100', bold_prefix='校审包：')
add_body(
    doc,
    '三维任务：task-a4bb6c48-cbab-485b-b395-9ab448202b66',
    bold_prefix='三维任务：',
)
add_body(doc, 'PMS 表单：FORM-C776C455DD9C', bold_prefix='PMS 表单：')
add_body(doc, '工作流：当前节点 jd，任务状态 submitted', bold_prefix='工作流：')
add_body(doc, '云线目标及锚点：TUBI / 24381_145018', bold_prefix='云线目标及锚点：')

doc.core_properties.title = 'PMS 三维校审云线元素绑定操作说明'
doc.core_properties.subject = '云线绑定、自动截图和双向定位操作指南'
doc.core_properties.author = 'Plant3D Web'
doc.core_properties.keywords = 'PowerPMS, 三维校审, 云线, 模型元素绑定'
doc.core_properties.comments = '基于 2026-07-30 PowerPMS 实际联调结果生成'

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUTPUT)
print(OUTPUT)
