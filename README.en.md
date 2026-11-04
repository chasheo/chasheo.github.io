<h1 align="center">Game Workshop</h1>

<p align="center"><a href="README.md">简体中文</a> · English</p>

[![Website](https://img.shields.io/badge/Play-chasheo.github.io-007ec6)](https://chasheo.github.io/)
[![Deploy](https://github.com/chasheo/chasheo.github.io/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/chasheo/chasheo.github.io/actions/workflows/pages.yml)
[![Three.js](https://img.shields.io/badge/3D-Three.js-black?logo=threedotjs)](https://threejs.org/)
[![Unreal Engine](https://img.shields.io/badge/Streaming-Unreal_Engine-313131?logo=unrealengine)](https://www.unrealengine.com/)

**Chasheo's playable homepage: explore a 3D workshop or join the queue for Unreal games running on a local GPU.**

[Visit the homepage](https://chasheo.github.io/) · [Browse games](https://chasheo.github.io/#play) · [Local hosting guide (Chinese)](docs/LOCAL_HOST.md)

## Experience

- **3D workshop:** guided viewpoints, free observation, third-person movement and combat, with Chinese, English and touch controls.
- **Two Unreal games:** explore Mystic Forest or fight through the rainy streets of Neon Embers. Preview screenshots, enter fullscreen and control audio.
- **One shared seat:** visitors queue without registering. The host closes the active game after 120 seconds without a heartbeat and offers the seat to the next visitor.
- **Community:** per-game likes, comments, visits and successful play counts persist in local SQLite.

## Local development

Node.js 22+ is required. These commands run the frontend; live streaming also requires a configured Windows host.

```sh
npm ci
npm run dev
npm run build
```

## Project structure

| Directory | Contents |
| --- | --- |
| `src/`, `public/` | Homepage, workshop integration and media |
| `vendor/world-workshop/` | Editable 3D workshop source and asset/motion provenance |
| `server/` | Queue, Windows process management, Pixel Streaming signalling and community API |
| `edge/` | Cloudflare public API and WebSocket gateway |
| `tests/` | Session isolation, process cleanup, community and gateway checks |

GitHub Pages hosts the frontend; a Windows GPU host runs the games and services. Cloudflare provides the public API and signalling entry; video is delivered through WebRTC. Games and community features require the host to be online. Connectivity depends on the visitor's network and ICE/TURN configuration.

Pushes to `main` and the current development branch `codex/local-streaming-demo` deploy to the same GitHub Pages site.

## Assets and licensing

See [ASSETS](vendor/world-workshop/docs/ASSETS.md) and [ANIMATION](vendor/world-workshop/docs/ANIMATION.md) for sources. Assets remain subject to their original licenses; no blanket open-source license is declared for this repository. Game builds, private configuration, databases and credentials are excluded from Git.
