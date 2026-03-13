# 三维校审 M1 发起侧闭环会议 Checklist

> 用途：开会快速对齐 + 会后直接派单  
> 主设计源：`ui/三维校审/review-designer.pen`  
> 跨角色总览基线：`ui/三维校审/review-flow.pen`（仅用于补充总流程上下文）  
> 对应文档：`开发文档/三维校审/三维校审M1发起侧闭环任务单.md`

## 一、会议目标

- [ ] 对齐 M1 只做“发起侧闭环”，不扩到 M2 / M3
- [ ] 明确本轮验收口径：创建成功、附件归档、关联文件占位、embed 参数透传
- [ ] 会上拍板接口口径、主键口径、联调顺序
- [ ] 会后可以直接按 owner 派单开工

## 二、会前必读

- [ ] 阅读 `开发文档/三维校审/三维校审M1发起侧闭环任务单.md`
- [ ] 阅读 `开发文档/三维校审/三维校审重构执行方案.md`
- [ ] 阅读 `开发文档/三维校审/三维校审M0页面接口字段映射表.md`
- [ ] 会前过一遍 `ui/三维校审/review-designer.pen`，明确发起页、附件区、关联文件区的主设计基线
- [ ] 前端确认范围页面：`InitiateReviewPanel` / `FileUploadSection` / `AssociatedFilesList`
- [ ] 后端准备任务创建、附件上传、embed、关联文件接口现状

## 三、必须拍板项

- [ ] `POST /api/review/tasks` 是否稳定返回 `id` + `formId`
- [ ] `taskId` / `formId` 的使用边界是否明确
- [ ] `POST /api/review/attachments` 在仅 `taskId` / 仅 `formId` / 二者同时存在时的归档规则
- [ ] 任务详情与任务更新中的 `attachments` 字段结构是否统一
- [ ] `AssociatedFilesList` 在 M1 是否必须接真实接口；如果不接，降级范围是什么
- [ ] embed 最小参数集是否定为：`form_id`、`project_id`、`user_id`、`user_token`
- [ ] `reviewerId` 是否继续兼容，计划何时下线

## 四、前端 Owner 清单

- [ ] FE1：收口发起页数据模型，禁止页面内临时推导业务主键
- [ ] FE2：打通“创建任务 -> 回写 taskId/formId -> 页面进入已创建态”
- [ ] FE3：拆分附件状态机：`pending / uploading / success / error`
- [ ] FE4：统一附件上传成功后的任务附件回写时机
- [ ] FE5：把关联文件区改成真实业务占位，支持 `loading / empty / error / data`
- [ ] FE6：统一构件选择、属性拉取、`ReviewComponent` 结构
- [ ] FE7：统一校验、按钮禁用、成功/失败提示文案

## 五、后端 Owner 清单

- [ ] BE1：确认创建任务正式入参/回参样例
- [ ] BE2：补齐附件上传归档规则与标准元数据回参
- [ ] BE3：统一任务 `attachments` 字段结构与更新语义
- [ ] BE4：确认关联文件查询维度与返回字段
- [ ] BE5：确认 embed 参数来源、透传方式、回包样例
- [ ] BE6：确认下载/预览 URL 与权限策略

## 六、联调 / 测试清单

- [ ] INT1：验证创建后稳定回写 `taskId`、`formId`
- [ ] INT2：验证“先创建 -> 再上传 -> 再回写附件”完整时序
- [ ] INT3：梳理各接口只认 `taskId`、只认 `formId`、还是兼容二者
- [ ] INT4：验证关联文件真实数据接入或明确阻塞
- [ ] INT5：验证 embed 参数读取、透传、落点一致
- [ ] QA1：覆盖正常创建、缺人、人员冲突、附件部分失败
- [ ] QA2：覆盖主键一致性、关联文件展示、embed 场景回归

## 七、风险提醒

- [ ] 风险：`formId` 缺失会阻断附件归档与后续闭环
- [ ] 风险：附件上传与任务回写时机不统一，容易重复写入
- [ ] 风险：`AssociatedFilesList` 若继续 mock，会影响 M1 验收可信度
- [ ] 风险：`reviewerId` 不拍板，M2 仍会返工
- [ ] 风险：embed 参数来源不清，线上联调容易出问题

## 八、设计验收提醒

- [ ] 发起侧视觉与交互验收统一对照 `ui/三维校审/review-designer.pen`
- [ ] 若需要讨论跨角色流转衔接，可补充参考 `ui/三维校审/review-flow.pen`，但不替代发起侧主设计稿
- [ ] 会议结论中的页面验收口径，明确写成“发起侧页面以 `review-designer.pen` 为准”

## 九、会议结论模板

- [ ] M1 范围确认：
- [ ] 接口拍板结论：
- [ ] 主键口径结论：
- [ ] 关联文件方案：
- [ ] embed 参数方案：
- [ ] `reviewerId` 兼容方案：
- [ ] 前端 owner / 截止时间：
- [ ] 后端 owner / 截止时间：
- [ ] 联调时间：
- [ ] 验收标准：
