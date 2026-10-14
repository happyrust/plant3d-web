# Plant3D-Web 离线部署包 - 测试报告

**测试时间**: 2026-10-14
**测试版本**: v0.2.0
**测试环境**: Windows 10 (win32 10.0.26200)
**测试工具**: `scripts/test-offline-deploy.ps1`

---

## 测试结果总览

| 指标 | 结果 |
|------|------|
| 总测试数 | 17 |
| 通过 | 17 |
| 失败 | 0 |
| 跳过 | 0 |
| **通过率** | **100%** |

---

## 详细测试结果

### 1. 前置检查（4 项）

| 测试项 | 结果 | 详情 |
|--------|------|------|
| 检查 nginx.exe 存在 | ✅ PASS | 找到: `deploy/offline/nginx/nginx.exe` |
| 检查 www 目录存在 | ✅ PASS | 找到: `deploy/offline/www` |
| 检查 index.html 存在 | ✅ PASS | 找到: `deploy/offline/www/index.html` |
| 检查 version.json 存在 | ✅ PASS | 版本: 0.2.0, Commit: 95fd4b4 |

### 2. Nginx 配置（1 项）

| 测试项 | 结果 | 详情 |
|--------|------|------|
| nginx 配置语法 | ✅ PASS | `syntax is ok` + `test is successful` |

### 3. Nginx 启动/停止（2 项）

| 测试项 | 结果 | 详情 |
|--------|------|------|
| nginx 进程启动 | ✅ PASS | PID: 34720 |
| nginx 进程停止 | ✅ PASS | 残留进程: 无 |

### 4. 静态文件访问 - 80 端口（4 项）

| 测试项 | 结果 | 详情 |
|--------|------|------|
| GET /version.json | ✅ PASS | 版本: 0.2.0, 状态码: 200 |
| GET / (index.html) | ✅ PASS | 状态码: 200, 包含 #app: True |
| GET /pms-review-simulator.html | ✅ PASS | 状态码: 200 |
| GET 静态资源 (JS bundle) | ✅ PASS | 文件: assets/index-DbwkIi6c.js, 状态码: 200 |

### 5. 兼容端口访问 - 3100 端口（2 项）

| 测试项 | 结果 | 详情 |
|--------|------|------|
| GET :3100/version.json | ✅ PASS | 版本: 0.2.0, 状态码: 200 |
| GET :3100/ (index.html) | ✅ PASS | 状态码: 200 |

### 6. SPA Fallback（1 项）

| 测试项 | 结果 | 详情 |
|--------|------|------|
| SPA fallback 路由 | ✅ PASS | 状态码: 200, 返回 index.html: True |

### 7. API 代理连通性（1 项）

| 测试项 | 结果 | 详情 |
|--------|------|------|
| API 代理 /api/v1/health | ✅ PASS | 状态码: 200, 后端响应: `{"status":"ok","core":{"status":"ready",...}}` |

> **注意**: 此测试通过说明本地 gen-model (aios-database) 后端正在运行，代理功能正常。

### 8. 响应头检查（2 项）

| 测试项 | 结果 | 详情 |
|--------|------|------|
| Cache-Control 头 (version.json) | ✅ PASS | 值: `no-store, no-cache, must-revalidate` |
| Content-Type 头 (index.html) | ✅ PASS | 值: `text/html; charset=utf-8` |

---

## Bat 脚本测试

| 脚本 | 测试结果 | 说明 |
|------|---------|------|
| `start.bat` | ✅ 正常 | 能正确启动 nginx，显示访问地址 |
| `stop.bat` | ✅ 正常 | 能正确停止 nginx 进程 |
| `config.bat` | ✅ 正常 | 交互式配置后端地址和端口 |

> **修复记录**: bat 脚本已从中文注释改为英文注释，避免 cmd 编码解析问题。

---

## 功能验证清单

- [x] nginx 1.30.5 Windows 版正常运行
- [x] 静态文件托管（HTML/JS/CSS/WASM/字体）
- [x] SPA 路由 fallback（前端路由正常工作）
- [x] 双端口监听（80 + 3100，兼容 PowerPMS）
- [x] API 反向代理（/api → gen-model :8022）
- [x] 附件下载代理（/files → gen-model）
- [x] WebSocket 支持（$connection_upgrade map）
- [x] Gzip 压缩
- [x] 缓存控制头（静态资源长期缓存，HTML 不缓存）
- [x] 版本信息接口（/version.json）
- [x] 优雅启动/停止

---

## 发包产物

| 项目 | 内容 |
|------|------|
| 文件名 | `plant3d-web-offline-v0.2.0-20261014.zip` |
| 位置 | `../gen-model/releases/` |
| 大小 | 30.61 MB |
| 文件数 | 328 个 |

---

## 测试结论

**✅ 所有测试通过（17/17，100%）**

离线部署包已验证可以正常工作，满足内网部署需求：
1. 解压即用，无需安装任何依赖
2. 双击 `config.bat` 配置后端地址
3. 双击 `start.bat` 启动服务
4. 浏览器访问 `http://localhost` 或 `http://<本机IP>`

---

## 后续建议

1. **客户现场部署前**：在目标机器上先运行 `config.bat` 确认后端地址
2. **防火墙**：确保 80 和 3100 端口已放行
3. **后端联调**：确保 gen-model (aios-database) 已启动并监听 8022 端口
4. **PowerPMS 集成**：模型中心地址配置为 `http://<前端服务器IP>:3100`

---

*报告生成时间: 2026-10-14*
