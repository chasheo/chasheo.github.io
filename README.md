# chasheo / Playable Worlds

公开主页：<https://chasheo.github.io/>。GitHub Pages 部署前端展示；未设置公网游戏服务时，游玩、留言和统计会明确显示尚未接入，不向 Pages 请求不存在的 API，也不伪造数据。本机 <http://127.0.0.1:18790/> 保留完整的游戏与社区功能。

前端通过 `.github/workflows/pages.yml` 从功能分支 `codex/local-streaming-demo` 构建部署。后续接入公网宿主时，可设置仓库 Actions 变量 `VITE_API_BASE_URL` 为 HTTPS 服务地址并重新部署；宿主还需配置该来源的 CORS、跨站访客身份、HTTPS/WSS 以及公网 WebRTC/TURN。该变量是公开地址，不得放入令牌或秘密。源码变更保留功能分支与 PR 审核流程，不自行合并主分支。

本机 Unreal 游戏主页 demo。使用 `MysticForest_Windows.zip` 的既有 Windows 游戏包，浏览器通过 Epic 官方 UE 5.5 Pixel Streaming 前端与信令库连接。游戏包无需修改，替换游戏只需调整本机配置。

## 本机启动

本机入口：<http://127.0.0.1:18790/>。游戏宿主仅监听本机回环地址，与 GitHub Pages 的静态主页部署独立。

```powershell
cd C:\SeeleAI\chasheo.github.io
.\start-demo.ps1
# 停止本次 demo，包括它拥有的游戏与信令进程
.\stop-demo.ps1
```

主页面领取入场券，再确认进入。另一窗口/独立标签页可以作为第二位访客排队。游戏菜单默认使用自由鼠标；需要持续转动视角时点击「锁定鼠标」，Esc 释放。「开启声音」解除浏览器初始静音；「沉浸游玩」进入全屏。

## 文件与配置

- 源码：本仓库。`src/` 为网页，`server/` 为 Python 会话与 Windows 进程管理，以及官方信令库的薄封装。
- `.local.json`：不跟踪的本机配置，以 `.local.example.json` 为模板。
- 解包游戏、Python 环境、日志、PID 回执和验证证据统一放在 `C:\SeeleAI\seele-dev\temp\chasheo-demo\`。原始 ZIP 保持原样。
- 游戏可执行路径指向包内 `MCPUnrealProject/Binaries/Win64/MCPGameProject.exe`，直接运行真正的游戏进程，避免根目录 bootstrap exe 带来歧义。
- `runtime/host.log` 记录会话编号、启动 PID、推流就绪和回收结果；`runtime/game-<session>.log` 是对应 UE 日志。访问日志关闭，令牌不写日志。

首次重建依赖：安装 Node.js 与 uv，在本仓库执行 `npm ci`、`npm run build`；使用 Python 3.11 创建上述临时目录下的 `venv`，安装 `server/requirements.txt`。把给定 ZIP 安全解压到 `temp/chasheo-demo/package/` 后，核对 `.local.json` 中的实际 exe 路径。不要覆盖 SimpleGame 或源工程。

## 会话约定

1. FIFO 队列。轮到队首后提供 30 秒确认窗口，未确认则跳过；等候者无心跳 90 秒移出队列。
2. 当前玩家领取席位后按需启动一个游戏进程，等待对应 streamer 注册；初始化最多等待 120 秒。
3. 当前玩家每 15 秒发送认证心跳。服务端连续 **180 秒** 未收到有效心跳，关闭本服务拥有的整个游戏进程树，确认退出后向下一位提供入场机会。下一位仍需确认，避免为已离开的访客启动游戏。
4. 网页刷新和断线重连复用当前席位；180 秒内游戏保留在内存中。无磁盘存档，超时后重新开始。
5. 等候者、过期玩家的心跳不能续期当前玩家，也不能退出下一局。主动退出立即回收。
6. 推流使用 30 秒有效、单次使用的入场凭证；仅当前玩家可获取。Python 网关验证后才转发到本机私有信令服务。重连会替换同一席位的旧连接。
7. Windows 文件锁拒绝第二个宿主；Windows Job Object 在游戏开始运行前绑定其进程树，宿主意外退出时也会回收子进程。回收失败保留占用并暂停接待，不会另启游戏。

心跳反映连接存活，不代表玩家有操作；本 demo 没有额外的 AFK 踢出或最长游玩限制。刷新页面不会主动发送退出请求，避免误结束游戏。单个标签页的令牌保存在 sessionStorage。

## 验证

`tests/test_sessions.py` 覆盖并发领取、FIFO、180 秒边界、排队心跳隔离、旧令牌、入场凭证、启动失败与清理失败。`tests/test_process.py` 用真实 Windows 父子进程验证统一回收与单宿主锁。

```powershell
$python = 'C:\SeeleAI\seele-dev\temp\chasheo-demo\venv\Scripts\python.exe'
uv pip install --python $python pytest==8.4.2 psutil==7.1.3
& $python -m pytest tests -q --basetemp C:\SeeleAI\seele-dev\temp\chasheo-demo\test-results
# 宿主空闲且没有等候访客时执行；真实等待 180 秒并启动、关闭游戏
& $python tests\verify_live_host.py
```

真实运行回执保存于 `runtime/evidence/lifecycle.json`，浏览器截图在同目录。构建通过或 streamer 注册不等同于观察到视频、声音或游戏输入；验证结果分别记录。

2026-10-30 本机验证：8 项自动检查通过；两位独立浏览器访客排队、退出交接、刷新重连和 1920×1080 实时画面通过，浏览器输入进入 classic 玩法并有游戏日志佐证。最终真实失联回收测试通过，测得约 180.94 秒，包含旧推流连接撤销、下一局启动、旧令牌隔离与主动退出。启动、重复启动、停止和重启脚本已实测。声音按钮已通过官方 API 接线，未对可听音质做人工验收。

## 公网接入边界

当前交付仅供本机访问。后续保留 GitHub Pages 作为静态入口时，需要为会话网关提供 HTTPS/WSS、公网可达的媒体连接及必要的 TURN 中继，并给跨域入口添加明确的允许来源和 CORS 配置。本 demo 没有调用旧脚本中的 TURN 凭据，也没有暴露 UE 编辑器或开发命令接口。

## 视觉与社区功能（v2）

新版是沉浸式的世界实验室：全幅森林概念视觉、GSAP 入场与滚动编排、镜头视差、雾气与粒子、真实统计、实机游玩区和访客留言。概念视觉明确标识，不当作游戏实机截图。原始游戏和单席位、180 秒回收约定不变。

- 动效使用 [GSAP / ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)。比较过 Motion 和 Lenis 后保留原生滚动，避免平滑滚动接管游戏输入。降低动态效果的系统偏好会关闭入场/环境动画；实机画面播放时暂停环境粒子和循环装饰动效。
- 视觉资产在 `public/media/forest-portal.png`，由内置 image_gen 生成；完整生成提示词和用途见 `public/media/SOURCES.json`。不使用无来源的远程背景素材。
- 设计基准：背景 `#0b1112`、文字 `#eeeae0`、交互强调 `#e3f59b`、边线 `#2c3737`；间距主要用 8/12/20/32/48/80/110，正文、辅助文字与装饰微标签分级。主体方角，圆形仅用于少量图标和导航符号。加载、空白、失败、禁用、键盘焦点与提交反馈均有状态。
- 当前字体组合为 Arial/微软雅黑，Georgia 只作局部强调；另外可选 Space Grotesk + Noto Sans SC、Sora + Noto Sans SC。当前没有依赖外部字体网络请求。
- 游戏窗口提供原生全屏/退出全屏按钮及右上退出入口。原生请求被浏览器拒绝时，改用明确命名的「网页沉浸模式」，支持 Esc、退出按钮和 Tab 焦点约束。网页沉浸模式覆盖网页视口，不冒充浏览器原生全屏。退出游戏或断线时返回正常页面。留言输入时关闭游戏键盘捕获。

评论与统计数据库默认位于 `%LOCALAPPDATA%\chasheo-worlds\community.sqlite3`，也可用 `.local.json` 的 `data_dir` 指定。它是持久业务数据，不在临时运行目录中。匿名访客身份使用 HttpOnly 同站 Cookie；昵称可选，留言只按纯文本显示，每个浏览器 30 秒可发表一条，可收回自己发表的留言（数据库软删除）。没有预填虚构留言。

统计口径：访问量 PV 为一次文档打开，页面内锚点跳转不计，网络重试依靠事件 UUID 去重；游玩次数为当前有权连接的游戏会话首次开始播放视频，同一局刷新或重连不重复计数；评论数为未收回的留言。数据从功能启用时开始记录，不补造历史数字。

v2 验证：17 项自动检查通过（原有会话/进程检查及新增数据持久化、请求去重、留言纯文本、频率限制、分页和作者隔离）。浏览器已观察到新首屏，留言提交成功，脚本样式内容作为普通文字显示，实机视频播放后游玩计数从 0 增至 1；服务重启后数据和验证留言仍在。浏览器原生全屏尝试被拒绝，随后自动工具因不能确认 Windows 当前浏览器网址而停止；原生全屏、网页沉浸回退和窄屏布局尚待前台浏览器实测，不能视为已验收。机器回执在 `runtime/evidence/ui-v2-verification.json`。
