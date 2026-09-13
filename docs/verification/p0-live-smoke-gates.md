# P0 真实后端冒烟门

这些命令不会把“后端没启动”当作跳过。预检、环境变量或任一断言失败都会返回非零退出码。
四条门可单独运行，也可用 `npm run test:smoke:p0` 顺序执行全部门。

## 1. 模型链

```powershell
$env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'
npm run test:smoke:p0:model
```

覆盖 `show_refno` 的 BRAN/EQUI/ZONE、`show_dbnum` 渐进批量 records，以及服务重启后重新
ensure。该门会启用 `GEN_MODEL_P5_LIVE=1`，包含服务重启场景，只能对允许重启的联调实例运行。

## 2. 测量、尺寸与 MBD

```powershell
$env:PLANT3D_API_BASE = 'http://127.0.0.1:3100'
npm run test:smoke:p0:measurement
```

启动前会真实请求模型版本 API 和 MBD V2 API。浏览器门覆盖真实 AMS DB7997 最小交付单元版本、
尺寸系统创建会话、MBD 合同装载、原子拒收诊断和 SVG 导出。

## 3. 校审后端

```powershell
$env:PLANT3D_API_BASE = 'http://127.0.0.1:3910'
npm run test:smoke:p0:review
```

运行真实 HTTP 合同流：获取 token、创建校审任务、保存确认记录、评论隔离、批注状态、
提交前检查及清理测试数据。后端必须是可写的联调实例。

## 4. PowerPMS

```powershell
$env:PMS_E2E_PASSWORD = '<联调密码>'
$env:PMS_EMBEDDED_SITE_SUBSTRING = '<已部署 plant3d-web 地址片段>'
npm run test:smoke:p0:pms
```

强制执行 full + extended 流程并开启 PMS JSON 响应可见性验证：token 身份、`form_id` 隔离、
发起校审、PMS 列表可见、换角色校核及外部流程同步。

密码只放在本机环境变量或 CI Secret，不写入仓库和测试报告。

## CI 接入

四条门依赖不同的真实服务与凭据，建议拆成四个受保护的 CI job。每个 job 只注入本门所需
的地址和 Secret；全部通过后再允许发布。普通单元测试流水线不应运行这些有状态的 live 门。
