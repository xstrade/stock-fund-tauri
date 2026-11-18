# 盯盘管家

面向 Windows 和 macOS 的桌面盯盘工具。Tauri 2 管理窗口、系统托盘和全局快捷键，Vue 3 展示自选和行情。K 线由安装包内的 Lightweight Charts 绘制，图表依赖的 OHLCV 由数据源提供。

当前是迁移预览版。默认加载内置合成样本，可以离线体验分组、搜索、添加、删除、置顶、窗口设置和分时和日 K / 周 K / 月 K。样本价格仅用于演示。

## 下载与首次安装

| 系统 | 安装包 |
| --- | --- |
| Windows x64 | [下载 v0.1.1 安装程序（.exe）](https://github.com/xstrade/stock-fund-tauri/releases/download/v0.1.1/_0.1.1_x64-setup.exe) |
| macOS Apple Silicon（M 系列） | [下载 v0.1.1 磁盘映像（.dmg）](https://github.com/xstrade/stock-fund-tauri/releases/download/v0.1.1/_0.1.1_aarch64.dmg) |

其他版本和后续安装包见 [GitHub Releases](https://github.com/xstrade/stock-fund-tauri/releases/latest)。

- **Windows**：双击下载的 `.exe`，按提示完成安装，再从开始菜单打开「盯盘管家」。如果系统缺少 WebView2，安装程序会联网补装。首次运行可能出现 SmartScreen 提示，请先确认安装包来自上方的 GitHub Releases。
- **macOS**：打开 `.dmg`，将「盯盘管家」拖入「应用程序」，再从「应用程序」打开。当前安装包未经过 Apple 公证。如果 Gatekeeper 拦截，确认安装包来自上方的 GitHub Releases 后，可在「系统设置 → 隐私与安全性」选择「仍要打开」。[Apple 安装说明](https://support.apple.com/zh-cn/102445)
- **从旧版 Electron 迁移**：首次使用 Tauri 版时安装上方的安装包。两个版本可并行安装。若要迁移布局、透明度、置顶和快捷键，在新版设置页选择「导入旧版设置」，选中原来的 electron-store JSON，再点击「保存设置」。

## 应用内更新

从 GitHub Releases 安装的正式版本会在启动时检查更新。也可以点击右上角的「设置」，选择「检查更新」。发现新版本后，点击「下载并安装」，应用会下载更新包并验证签名。

- **Windows**：安装程序会关闭当前应用，并在安装完成后重新启动。
- **macOS**：看到「更新安装完成」后，点击「重新启动」。

## 本地运行

准备 Node.js 24、Rust stable 和对应系统的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run tauri -- dev
```

也可运行 `npm run dev` 在浏览器预览自选和图表。桌面窗口、托盘和快捷键需要通过 Tauri 运行。

## 端到端回归

安装依赖后运行 `npm run test:e2e`。测试使用本机 Google Chrome 的无界面模式，启动独立的本地 Vite 服务，覆盖自选管理、设置导入、图表周期以及模拟登录和行情降级。真实模式的请求由测试拦截，账号和数据均为固定样本。

窗口由 macOS 和 Windows 绘制原生标题栏。系统最小化按钮使用系统行为。点击系统关闭按钮会隐藏主窗口并保留托盘，彻底退出可用托盘菜单「退出管家」。浏览器测试覆盖应用内容，原生窗口和托盘验收见[验收方案](docs/acceptance-plan.md)。

## 打包

- Windows 运行 `npm run tauri -- build --bundles nsis`。安装时复用系统 WebView2，缺失时联网补装。
- macOS 运行 `npm run tauri -- build --bundles dmg`。默认构建当前架构，使用系统 WKWebView。
- 产物位于 `src-tauri/target/release/bundle`。macOS 的透明 WebView 使用 Tauri 的 macOS 私有 API 配置，当前面向 DMG 分发。

## 接入行情

将 `.env.example` 复制为 `.env.local`，只有在具备数据服务访问和使用权限时才配置真实行情。浏览器预览受浏览器跨域限制。桌面端通过 Tauri HTTP 插件发送请求，新增端点需要在 `src-tauri/capabilities/main.json` 按域名及路径授权。

- `VITE_DEMO_MODE=false` 启用旧版账号、自选和实时行情接口适配。登录会话存入 macOS 钥匙串或 Windows 凭据管理器，按服务地址区分。切换账号时清除会话，旧版设置导入只读取显示和快捷键配置。
- 自选行情每 15 秒向东方财富批量查询，主站失败后依次尝试备用节点，东方财富节点均不可用时使用腾讯报价。报价查询无需配置客户端标识。Vite 会把 `VITE_*` 值嵌入前端构建产物。
- 股票搜索、分时和 K 线默认直连扩展项目使用的东方财富接口。可用 `VITE_STOCK_SEARCH_KEY` 和 `VITE_HISTORY_CLIENT_ID` 覆盖默认的公开客户端标识。行情请求不携带盯盘管家的账号凭据。
- 分时与 K 线按东方财富历史行情主站、东方财富备用站、腾讯行情、东方财富延迟行情的顺序切换，每个来源最多等待 2.5 秒。腾讯备用源仅用于支持的沪深标的，图表在该来源下只展示价格。
- 自定义历史服务通过 `VITE_HISTORY_URL` 接收 `symbol=<market>.<code>` 和 `period=intraday|1d|1w|1m`，返回按时间严格升序的 `[{time, open, high, low, close, volume}]`。时间是 Unix 秒，价格和成交量使用数值。真实模式在图表打开时每 30 秒刷新数据。

[验收方案](docs/acceptance-plan.md) · [迁移说明](docs/migration.md) · [许可证](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)
