# 本地游戏宿主

## 运行结构

- GitHub Pages：公开主页 `https://chasheo.github.io/`。
- 本机：`http://127.0.0.1:18790/`；仅监听回环地址。
- Cloudflare：命名 Tunnel 与固定网关连接本机，前端构建变量为 `VITE_API_BASE_URL`、`VITE_API_FALLBACK_URL`。变量只放公开 HTTPS 地址。
- 私有信令：18791；游戏 streamer：18888。不要将开发工具接口直接暴露公网。
- 媒体经 WebRTC 直连或独立 TURN；免费入口在部分国内网络可能不可达。

## 首次配置

在仓库目录运行，准备 Node.js 22+、Python 3.11 和支持 Pixel Streaming 的 Windows 游戏包：

```powershell
npm ci
npm run build
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
Copy-Item .local.example.json .local.json
# 编辑 .local.json，填入实际游戏 exe、工作目录和运行目录
.\start-demo.ps1
```

`start-demo.ps1` 优先使用仓库 `.venv`，兼容共享目录下既有 `seele-dev\temp\chasheo-demo\venv`；也可显式传入 `-PythonPath`。中文配置以 UTF-8 保存。

当前机器游戏位置：

- Mystic Forest：`C:\Users\Admin\Games\MysticForest\MCPUnrealProject\Binaries\Win64\MCPGameProject.exe`。
- 霓虹余烬：`C:\Users\Admin\Games\Cyberpunk-City\SimpleGame.exe`。

私人 `.local.json` 包含实际路径，不提交到 Git。它的 `games` 数组配置 `id`、`title`、`description`、`executable`、`cwd`、`image`、`images`；可选 `video` 与 `download_url`。图像使用 `/media/` 或 HTTPS 地址，下载仅接受 HTTPS 地址。浏览器不会收到本机 exe 路径。配置变化后在席位空闲时重启宿主。

## 静默启动

```powershell
# 安装登录时静默启动，并立即检查一次
.\install-local-autostart.ps1
# 手动启动 / 停止
.\start-demo.ps1
.\stop-demo.ps1
# 移除自启任务（不会停止已运行服务）
.\install-local-autostart.ps1 -Remove
```

任务 `chasheo-worlds-local-host` 使用 `wscript.exe` 运行相对目录的 `start-demo-hidden.vbs`，只在当前用户登录时触发，不创建每分钟任务。Cloudflared 是独立的 Windows 自动启动服务。机器必须开机联网；登录触发不等于用户登录之前即可提供游戏服务。

安装脚本会修改系统计划任务，停止脚本会结束当前游戏与信令。修改、部署源码不需要运行这些脚本。已有任务的触发条件不会随 Git 更新自动改变。

## 数据与日志

- 默认数据库：`%LOCALAPPDATA%\chasheo-worlds\community.sqlite3`；可用 `data_dir` 覆盖。
- 同目录 `visitor-signing.key` 用于匿名访客凭证；与数据库一起妥善备份，不上传。
- `runtime_dir` 包含 `host.log`、`game-<session>.log` 与进程回执。
- 当前机器 Python 环境与日志仍在 `C:\SeeleAI\seele-dev\temp\chasheo-demo`，请勿整体删除。

## 会话与操作

所有游戏共享一个席位，FIFO 排队。轮到后有 30 秒确认窗口，等候者无心跳 90 秒移出队列。玩家每 15 秒发送认证心跳，失联 120 秒后服务关闭其游戏进程树，确认退出再放行下一位；主动退出立即回收。网页刷新在有效租期内可重连。心跳代表连接存活，不是操作检测，没有额外 AFK 时限。

Windows 文件锁阻止第二个宿主；Job Object 管理游戏进程树。游戏自身是否写存档由游戏决定，宿主不提供跨访客存档隔离。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pip install pytest==8.4.2 psutil==7.1.3
.\.venv\Scripts\python.exe -m pytest tests -q
node --test tests/test_service_selection.mjs tests/test_edge_gateway.mjs tests/test_workshop_combat.mjs
npm run build
```

`tests/verify_live_host.py` 会实际启动、等待 120 秒并关闭游戏，仅在无访客时执行。自动测试通过不等同于真实视频、声音或操作已验收。

## 发布

`.github/workflows/pages.yml` 当前由 `codex/local-streaming-demo` 推送触发，构建 `dist/` 并发布 GitHub Pages。源码通过现有 PR 审核合入 `main`。不上传 `.local.json`、环境变量文件、凭证、数据库、游戏 exe 或 `dist/`。

网关源码在 `edge/`，部署使用个人账户的本地 Wrangler 配置；不将账户凭证写入文档或提交。免费临时 Tunnel 会变更地址，现有固定入口不依赖临时 Tunnel。
