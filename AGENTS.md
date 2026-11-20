# 盯盘管家开发指南

盯盘管家是面向 macOS Apple Silicon 和 Windows x64 的桌面应用。前端使用 Vue 3、TypeScript、Vite 和 HQChart，桌面层使用 Tauri 2 和 Rust。

## 代码入口

- `src/App.vue` 负责登录、自选分组、行情刷新和设置。`src/StockChart.vue`、`src/WatchlistSparkline.vue` 负责详情图表和列表缩略图，`src/hqStockChart.ts` 封装 HQChart。
- `src/market.ts` 负责账号、自选、搜索和报价。`src/chartSources.ts` 负责历史行情解析和备用数据源，`src/stockMarkets.ts` 负责市场和证券代码转换。
- `src/desktop.ts` 封装前端 IPC、窗口操作和托盘事件。`src-tauri/src/main.rs` 负责原生窗口、托盘和全局快捷键，`src-tauri/src/session.rs` 负责会话存储，`src-tauri/src/updater.rs` 负责更新。
- `tests/e2e/watchlist.spec.ts` 覆盖离线自选和模拟桌面事件，`tests/e2e/market.spec.ts` 用浏览器拦截模拟登录、报价及历史行情。原生安装升级脚本位于 `tests/release/`。

## 本地开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖。使用与 CI 一致的 Node.js 24 |
| `npm run dev` | 在 `127.0.0.1:1420` 启动浏览器预览 |
| `npm run tauri -- dev` | 启动桌面开发版，需要 Rust stable 和当前平台的 Tauri 构建依赖 |
| `npm run typecheck` | 检查 TypeScript、Vue 模板和 Playwright 用例 |
| `npm run build` | 执行类型检查并构建前端生产产物 |
| `npm run test:e2e` | 运行两套 Playwright 用例，需要本机 Google Chrome 和空闲的 1426、1427 端口 |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | 检查 Rust 桌面层 |

- 前端自有脚本使用 TypeScript，Vue 脚本使用 `lang="ts"`。延续 `tsconfig.json` 的严格检查，优先复用现有行情、会话和图表类型。
- 前端改动先做类型检查，再按影响范围跑对应的 Playwright 用例。涉及构建入口、依赖或打包时，验证生产构建。
- IPC 改动同时核对前端调用、Rust 命令参数与返回值，以及适用的 Tauri 权限。系统托盘、全局快捷键、窗口恢复、系统凭据和安装升级需要在目标平台单独验证。验收步骤见 [验收方案](docs/acceptance-plan.md)。

## 行情、凭据与发布

- Vite 开发默认使用内置离线样本，生产构建默认使用真实服务。配置项见 [.env.example](.env.example)。本地测试优先用样本或拦截响应。连接真实账号、修改真实自选数据或切换生产端点前，先取得授权。
- 登录会话通过 Tauri 存入系统凭据存储，按账号服务地址隔离。账号接口与公开行情请求保持隔离。新增或变更桌面行情端点时，同步核对 `src-tauri/capabilities/main.json` 的具体路径权限。`VITE_*` 用于公开的客户端配置，私钥和服务端密钥由发布环境或服务端管理。
- 行情和图表改动沿用现有备用数据源、超时和请求取消机制。验证受影响市场的代码映射、交易时区和成交量单位。新增或替换打包资源时，核对 `THIRD_PARTY_NOTICES.md`、`licenses/` 和 Tauri 资源清单。
- `.github/workflows/desktop.yml` 构建未签名的 Windows NSIS 和 macOS DMG，`.github/workflows/update-release.yml` 将签名产物上传到草稿 Release，`.github/workflows/verify-release-upgrade.yml` 用于安装升级验证。发布按 [更新与签名流程](docs/updater.md) 执行。上传、发布和生产更新源变更须明确授权。汇报时分别说明构建、签名、安装升级验证和正式发布的结果。
