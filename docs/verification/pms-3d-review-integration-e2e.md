# PowerPMS「三维校审单」→ 新增 → 打开三维页：测试计划

## 目标

验证在 [PowerPMS 登录页](http://pms.powerpms.net:1801/sysin.html) 使用角色账号登录后，**设计交付 → 三维校审单 → 新增** 能打开预期的三维布置 / plant3d-web 页面（新标签或当前页跳转，以实现为准）。

## 手工测试步骤（SOP）

1. 打开 `http://pms.powerpms.net:1801/sysin.html`。
2. 使用角色简写账号登录（如 `SJ`、`SH` 等，**大写**），密码由运维提供（勿在文档中写死）。
3. 若出现验证码，完成验证或使用免验证码测试账号。
4. 左侧菜单进入 **设计交付** → **三维校审单**，确认列表与工具栏（含 **新增**）可见。
5. 点击 **新增**，记录：
   - 是否新开浏览器标签；
   - 最终 URL 是否指向预期环境（内网 plant3d 域名或 `127.0.0.1:3101` 等）；
   - URL 查询参数是否包含业务约定项（如 `form_id`、`project_id`、`user_token` 等，以联调文档为准）。
6. **换角色**（如 `SH`）重复步骤 1–5，确认权限与打开地址是否符合预期。

## 自动化（Playwright）

- 规格文件：`e2e/pms-powerpms-review-new.spec.ts`
- 配置：`playwright.pms.config.ts`（**不**启动本地 Vite，避免与默认 `test:e2e` 冲突）

### 环境变量（密码仅通过环境变量注入）

| 变量 | 说明 |
|------|------|
| `PMS_E2E_ENABLED` | 设为 `1` 才执行（防止 CI 误连外网） |
| `PMS_E2E_PASSWORD` | 登录密码 |
| `PMS_E2E_USERNAME` | 单角色，默认 `SJ` |
| `PMS_E2E_ROLES` | 可选，逗号分隔多角色串行测，如 `SJ,SH,JD` |
| `PMS_E2E_BASE` | 可选，默认 `http://pms.powerpms.net:1801` |
| `PMS_E2E_OPEN_URL_SUBSTRING` | 断言「新增」后页面 URL 应包含的子串，默认 `127.0.0.1`（可按部署改为域名） |
| `PMS_E2E_HEADLESS` | 设为 `1` 时本地也使用无头模式 |
| `PMS_E2E_SUBMIT_REVIEW` | 设为 `1` 时，在通过 URL 断言后继续在 plant3d 内执行「创建并提交提资单」直至成功提示（与 CDP 脚本 `PMS_CDP_SUBMIT_REVIEW` 等价；需已部署含自动化钩子的前端） |
| `PMS_E2E_FILL_PMS_DIALOG` | 设为 `1` 时尝试填写 PMS 弹窗内项目代码/名称并提交（与 `PMS_CDP_FILL_PMS_DIALOG` 一致） |

### 命令示例

```bash
cd plant3d-web
export PMS_E2E_ENABLED=1
export PMS_E2E_PASSWORD='********'
export PMS_E2E_OPEN_URL_SUBSTRING='127.0.0.1:3101'   # 按实际嵌入地址调整
npm run test:e2e:pms
```

### Chrome DevTools Protocol（CDP）脚本

与 Cursor 里 **Chrome DevTools MCP** 一样，本质都是通过 **CDP** 控制 Chromium。仓库提供不依赖 MCP 客户端、可直接在终端运行的脚本。

**嵌入页为线上部署的 plant3d-web（非本地）时**，请设置部署域名片段，用于断言「新增」后是否打开正确站点：

```bash
export PMS_E2E_PASSWORD='********'
export PMS_EMBEDDED_SITE_SUBSTRING='你的-plant3d-线上域名'   # 如 web.plant.example.com
npm run test:pms:cdp
# 或 npm run test:pms:browser（同一脚本，默认有头弹出 Chrome）
```

不设 `PMS_EMBEDDED_SITE_SUBSTRING` / `PMS_E2E_OPEN_URL_SUBSTRING` 时，只自动化到**点击「新增」**，不校验外链 URL。

### 一键：新增 → 三维页填表 → 发起提资（CDP 脚本）

1. **部署**：需已发布包含「`plant3d_automation_review` / `automation_review` 自动化钩子」的 plant3d-web（`InitiateReviewPanel` 在显式开启时暴露 `window.__plant3dInitiateReviewE2E.addMockComponent`）。
2. **环境变量**（在密码、域名片段基础上）：
   - `PMS_CDP_SUBMIT_REVIEW=1`：在打开的三维页（主文档或同源 iframe）中自动注入一条模拟构件、填写数据包名称、选择校核/批准人并点击「创建并提交提资单」，直到出现「提资单创建成功」。
   - `PMS_MOCK_PACKAGE_NAME`：可选，自定义提资数据包名称。
   - `PMS_CDP_FILL_PMS_DIALOG=1`：若「新增」后先出现 **PMS 站内**弹窗（项目代码/项目名称等），尝试填写并点「保存/确定/提交/发起提资」。
3. **示例**：

```bash
export PMS_E2E_PASSWORD='********'
export PMS_EMBEDDED_SITE_SUBSTRING='你的-plant3d-域名'
export PMS_CDP_SUBMIT_REVIEW=1
# 可选：export PMS_CDP_FILL_PMS_DIALOG=1
npm run test:pms:cdp
```

说明：若三维页在 **跨域 iframe** 内，Playwright 无法操作内部 DOM，需改为新标签打开同源三维地址或调整嵌入方式。若审核人列表不足两人或后端创建接口失败，自动化会在对应步骤报错退出。

- 脚本路径：`scripts/pms-chrome-devtools-flow.ts`（`npx tsx` 执行；Playwright → Chromium → **CDP**）。
- **附加本机已打开的 Chrome**（便于同时开 DevTools 看 Network）：先启动  
  `Google Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-pms`  
  再执行 `export CHROME_CDP_URL=http://127.0.0.1:9222` 后运行 `npm run test:pms:cdp`（脚本不会 `browser.close()` 断连）。
- 默认 **有头**；无头可加 `PMS_CDP_HEADLESS=1`（仅在不使用 `CHROME_CDP_URL` 时）。

### 限制说明

- PMS 前端结构若升级，需调整 `e2e/pms-powerpms-review-new.spec.ts` 中的选择器（菜单文案、按钮角色等）。
- 若登录强制验证码且无测试账号，自动化会失败，以手工步骤为准。
- **「新增」在 iframe 内**：用例会在**主文档 + 所有子 frame** 中轮询可见的「新增」（`button` / `link` / 工具栏区域文本），并在菜单点击后等待 iframe 挂载；若仍找不到，需用浏览器开发者工具确认是否 shadow DOM 或跨域 iframe（跨域时 Playwright 仍可操作 frame，只要同源或已导航到该 frame）。

## 与编校审接口的关系（便于联调对照）

- **新增** 打开的 URL 通常由平台后端调用模型中心 **embed-url** 类能力再重定向/拼接得到；联调时对照《编校审交互接口设计》中嵌入地址与 query 约定。
- **UCode/UKey** 用于模型中心 **主动请求** 布置平台辅助数据接口，与「新增打开页」不是同一条链路；勿混测。
