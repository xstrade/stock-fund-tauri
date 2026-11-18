# 应用更新

默认安装包无需更新服务。维护者通过构建配置同时提供更新清单地址和公开验签密钥后，客户端才会在启动时检查更新。用户可以在设置里重新检查，有新版本时选择下载并安装。Windows 安装程序接管退出和重启，macOS 安装完成后可点击重新启动。

## 从 GitHub Releases 分发

1. 在项目目录运行 `npm run tauri -- signer generate -w ~/.tauri/stock-fund.key`，备份私钥并保留密码。所有后续版本沿用这套密钥，已安装的客户端用内置公钥验证更新。
2. 在公开 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中，将 `.pub` 的完整内容写入变量 `TAURI_UPDATER_PUBLIC_KEY`，将私钥内容和密码写入 Secrets `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
3. 提升 `src-tauri/tauri.conf.json` 的版本号并手动运行 **Build signed updates**。两个平台构建成功后，在 Release 草稿确认 Windows x64 安装包、macOS Apple Silicon DMG、签名文件和 `latest.json` 均已上传，并确认清单包含 `windows-x86_64` 和 `darwin-aarch64`。
4. 验收通过后手动发布草稿。客户端通过仓库的 `releases/latest/download/latest.json` 检查更新。已有离线安装需先手动安装一次带更新源的构建。

当前工作流使用 Tauri 更新签名。macOS 构建使用临时签名，公开发行所用的 Developer ID 签名和公证，以及 Windows 发布者签名，需分别配置。

## 正式构建配置

将以下内容写入发布环境的 Tauri 配置覆盖文件，再以 `npm run tauri -- build --config <配置文件>` 构建。端点和公钥使用发布环境实际值。公钥是 `.pub` 文件内容。发布流水线用 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供签名材料。

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "endpoints": ["https://releases.example.invalid/latest.json"],
      "pubkey": "<更新公钥>",
      "requireSignedVersion": true
    }
  }
}
```

- Windows x64 使用 NSIS 安装程序，macOS Apple Silicon 使用更新用的 `.app.tar.gz`。DMG 用于手动安装。
- 清单中的 `platforms` 以 `windows-x86_64`、`darwin-aarch64` 等平台名区分。每个平台的 `url` 指向对应的更新产物，`signature` 填该产物的 `.sig` 内容。先上传全部产物，再更新清单。
- 更新器在安装前校验产物签名、清单版本与签名内的版本。只接受高于当前应用版本的更新。构建时由 Tauri CLI 绑定版本，手工签名用 `signer sign --app-version <版本>`。
- 更新验签和操作系统代码签名各自配置。正式 macOS 分发还需要代码签名与公证。
- 旧 Electron 版本使用不同更新格式。用户首次迁移通过安装 Tauri 版本，之后进入 Tauri 更新渠道。

[Tauri 更新插件文档](https://v2.tauri.app/plugin/updater/)

## 本地签名验收

在临时工作目录用本地测试密钥和隔离应用标识操作。Debug 构建允许显式配置回环 HTTP，仅接受 `127.0.0.1` 或 `[::1]` 的清单和产物地址。正式构建要求 HTTPS。

1. 运行 `npm run tauri -- signer generate --ci --write-keys /绝对路径/fixture.key`。将生成的公钥写入 Debug 配置覆盖文件，配置唯一 `identifier`、`plugins.updater.requireSignedVersion: true`、`plugins.updater.dangerousInsecureTransportProtocol: true` 及回环端点。调试密钥仅用于本地样本。
2. 使用同一应用标识和更新配置构建两份 Debug 应用，版本为 `0.1.0` 和 `0.1.1`。在 macOS 选择 `--bundles app` 并将应用复制到临时安装路径。Windows 选择 `--bundles nsis` 并使用隔离的测试安装。
3. 在 macOS 用 `tar -czf fixture.app.tar.gz -C <新版应用目录> <应用名>.app` 生成更新包。Windows 直接使用新版 NSIS 安装程序。运行 `npm run tauri -- signer sign --private-key-path /绝对路径/fixture.key --app-version 0.1.1 <更新包>`。
4. 在临时目录写入清单，提供 `version`、`notes`、`platforms`。以 `python3 -m http.server 18754 --bind 127.0.0.1 --directory <临时更新目录>` 启动更新源。清单和产物都使用 `http://127.0.0.1:18754/`。
5. 首先发布测试用的错误签名、篡改产物或把清单版本填为 `0.1.2`，从 `0.1.0` 检查并尝试安装。确认客户端显示错误，重新启动仍为原版本，设置保留。随后恢复原始文件与匹配的签名和版本，点击重新启动，验证能升级到 `0.1.1`，并保留设置。
6. 用无更新配置的默认构建重新启动，确认设置页显示更新源未配置，启动时不请求清单。
