<h1 align="center">游戏工坊</h1>

<p align="center">简体中文 · <a href="README.en.md">English</a></p>

[![Website](https://img.shields.io/badge/Play-chasheo.github.io-007ec6)](https://chasheo.github.io/)
[![Deploy](https://github.com/chasheo/chasheo.github.io/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/chasheo/chasheo.github.io/actions/workflows/pages.yml)
[![Three.js](https://img.shields.io/badge/3D-Three.js-black?logo=threedotjs)](https://threejs.org/)
[![Unreal Engine](https://img.shields.io/badge/Streaming-Unreal_Engine-313131?logo=unrealengine)](https://www.unrealengine.com/)

**chasheo 的可游玩个人主页：接管女侠探索三维工坊，或排队进入本机 GPU 运行的 Unreal 游戏。**

[打开主页](https://chasheo.github.io/) · [选择游戏](https://chasheo.github.io/#play) · [本地部署说明](docs/LOCAL_HOST.md)

## 可以体验什么

- **三维工坊**：浏览背景、地点引导与自由观察、第三人称移动和战斗，支持中英文与触屏操作。
- **两个 Unreal 游戏**：魔法森林探索、霓虹余烬雨夜城市战斗；支持实机截图预览、全屏和声音切换。
- **共享单席位**：访客免注册排队，轮到后选择游戏；当前玩家连续 120 秒没有心跳，关闭该局并放行下一位。
- **真实社区数据**：游戏点赞、留言、访问量与成功游玩次数，由本机 SQLite 持久保存。

## 本地开发

需要 Node.js 22+。以下命令运行静态前端；真实推流还需配置 Windows 游戏宿主。

```sh
npm ci
npm run dev
# 生产构建
npm run build
```

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `src/`、`public/` | 主页、游戏工坊集成与展示素材 |
| `vendor/world-workshop/` | 可编辑三维工坊源码与素材、动作来源说明 |
| `server/` | 排队、Windows 游戏进程管理、Pixel Streaming 信令与社区接口 |
| `edge/` | Cloudflare 公网 API / WebSocket 网关 |
| `tests/` | 会话隔离、进程回收、社区与网关验证 |

GitHub Pages 托管前端；Windows GPU 主机运行游戏与服务，经 Cloudflare 固定入口提供 API 和信令，游戏画面通过 WebRTC 传输。主机离线时游戏与社区服务不可用，静态主页仍可浏览；公网连通性取决于访客网络与 ICE/TURN 配置。

`main` 为主分支；`main` 和当前开发分支 `codex/local-streaming-demo` 的推送都会发布到同一个 GitHub Pages 网站。

## 素材与授权

素材和动作来源见 [ASSETS](vendor/world-workshop/docs/ASSETS.md) 与 [ANIMATION](vendor/world-workshop/docs/ANIMATION.md)。各素材遵循原授权，本仓库未声明统一开源许可证；可运行游戏包、私人配置、数据库和凭证不纳入 Git。
