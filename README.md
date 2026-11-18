# 盯盘管家

面向 Windows 和 macOS 的桌面盯盘工具，支持自选列表、分时与 K 线、系统托盘和全局快捷键。

应用默认加载内置样本，可离线体验。样本价格仅用于演示。

## 下载与首次安装

| 系统 | 安装包 |
| --- | --- |
| Windows x64 | [下载 Windows 最新版（.exe）](https://github.com/xstrade/stock-fund-tauri/releases/latest/download/stock-fund-windows-x64.exe) |
| macOS Apple Silicon（M 系列） | [下载 macOS 最新版（.dmg）](https://github.com/xstrade/stock-fund-tauri/releases/latest/download/stock-fund-macos-arm64.dmg) |

历史版本见 [GitHub Releases](https://github.com/xstrade/stock-fund-tauri/releases)。

- **Windows**：双击下载的 `.exe`，按提示完成安装，再从开始菜单打开「盯盘管家」。如果系统缺少 WebView2，安装程序会联网补装。首次运行可能出现 SmartScreen 提示，请先确认安装包来自上方的 GitHub Releases。
- **macOS**：打开 `.dmg`，将「盯盘管家」拖入「应用程序」，再从「应用程序」打开。当前安装包未经过 Apple 公证。如果 Gatekeeper 拦截，确认安装包来自上方的 GitHub Releases 后，可在「系统设置 → 隐私与安全性」选择「仍要打开」。[Apple 安装说明](https://support.apple.com/zh-cn/102445)

## 应用内更新

从 GitHub Releases 安装的正式版本会在启动时检查更新。也可以点击右上角的「设置」，选择「检查更新」。发现新版本后，点击「下载并安装」，应用会下载更新包并验证签名。

- **Windows**：安装程序会关闭当前应用，并在安装完成后重新启动。
- **macOS**：看到「更新安装完成」后，点击「重新启动」。
