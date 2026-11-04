# 资产与来源清单（当前版本）

运行时资源全部在 `public/assets/`（构建后复制到 `dist/assets/`），按相对路径或宿主传入的 `assetBase` 加载，运行时不访问任何外部地址。下表只列当前游戏实际加载的文件；它们的源文件在 `art-src/`。

## 1. 角色（`models/`）

| 文件 | 用途 | 来源 | 处理 |
|---|---|---|---|
| `heroine2.glb`（0.48 MB） | 女侠的可见模型 | 依据加载海报的人物造型，用 Seele 图像生成做全身 A 字姿态设定图（`art-src/heroine2/apose_a.jpg`、`apose_b.jpg`，提示词 `prompt_apose.txt`、`prompt_hairfix.txt`）→ Seele 图生 3D（`gen_raw.glb`，4,651 三角面，单材质 2048 贴图）→ Seele 自动绑骨（人形，52 骨，质量报告 no_flags） | `tools/bpy-heroine-prep.py`：合并网格、朝向 +Z、缩放到 1.68 m、脚底落地（`heroine2_prep.glb`）→ 绑骨结果 `heroine2_rigged.glb` → gltf-transform（Draco + WebP）。运行时：静止姿态重定向（`HEROINE2_MAP`，颈部和头部跟随胸腔对齐）；加载时给马尾接 5 节弹簧骨骼（`src/chars/ponytail.ts`）；剪掉与胸甲粘连的右侧长发，留到下颌（`src/chars/meshtrim.ts`） |
| `heroine.glb` | 不显示；只作为动作重定向的 Mixamo 骨架源 | Seele 资产库 `three_avatar` #1005898（Mixamo 骨架，源 FBX `art-src/characters/heroine_1005898.fbx`） | `tools/fbx-to-glb.mjs` 以 three.js FBXLoader 的骨骼帧导出 GLB |
| `guardian.glb` | 守关者「铁面」 | 参考工程「烬雨孤刀」发布资源 `brute.glb` 的网格（副本 `art-src/characters/guardian_brute_ref.glb`） | `tools/blender/bpy_strip_rig.py` 剥离原骨架（`guardian_static.glb`）→ Seele 自动绑骨（人形，53 骨，no_flags，记录 `guardian_rig_result.json`，结果 `guardian_rigged_skintokens.glb`）→ 运行时重定向（`GUARDIAN_MAP`） |
| 柳叶刀、单手战斧 | 武器 | 程序化（`src/chars/weapons.ts`） | 真实尺寸，带粗糙度噪声贴图和发光着色 |

## 2. 动作（`anims/heroine.anim.*`、`anims/guardian.anim.*`）

全部为 Mixamo 动作：Seele 资产库 `three_motion` 分类检索下载，以及参考工程「烬雨孤刀」发布资源中的 3 段。没有使用视频动捕或文生动作。逐段编号、截取帧和用途见 `docs/ANIMATION.md` 第 2 节；源 FBX 在 `art-src/motions/`（编号记录：`library/motions_manifest.json`、`cand2/manifest.json`、`cand3/manifest.json`、`r11/manifest.json`、`r13/manifest.json`）。打包：`node tools/build-anims.mjs`（配置 `tools/anims.config.json`）。

## 3. 加载封面（`intro/`）

| 文件 | 来源与处理 |
|---|---|
| `heroine_poster_2560.jpg`（570 KB）、`heroine_poster_1440.jpg`（220 KB） | Seele 图像生成（seedream5lite，16:9，无文字），两版候选与提示词在 `art-src/intro2/`，选用 B 版。页面打开即显示，按视口宽度自动选档 |
| `intro_loop_1080.mp4`（4.3 MB）、`intro_loop_720.mp4`（1.9 MB） | Seele 视频生成（Seedance 2.0，1080p，10 s，首帧和尾帧都是上面的海报，无水印输出）：风吹动马尾和红绸、云海流动、薄雾升起、阳光穿云、刀身掠过光芒，结尾回到海报构图。提示词 `art-src/intro_video/prompt.txt`，原始输出 `art-src/intro_video/seedance_raw.mp4`。`tools/make-intro.py` 去掉与首帧重复的末帧、末尾 12 帧渐变回首帧以无缝循环、去掉音轨，输出 1080p / 720p 两档 H.264 |

## 4. 环境模型

### `models/env/`

| 文件 | 来源 | 处理 |
|---|---|---|
| `bamboo.glb` | Seele 资产库 #651232（原件 `art-src/env/bamboo_651232.glb`） | 减面、贴图压缩至 0.43 MB |
| `tree_broad`、`tree_broad_far`、`pine`、`fir`、`fern`、`shrub_hb`、`shrub_box`、`grassclip`、`drygrass`、`mossrock` | 参考工程「烬雨孤刀」`assets/models/`（原件 `art-src/env/ref_props/`） | 减面、风动着色、实例化 |
| `logpile`、`winejar`、`bucket`、`basket`、`lantern`、`stump`、`sacks`、`jar`、`barrel1` | 参考工程「烬雨孤刀」`assets/models/` | `lantern`、`basket`、`stump` 贴图降到 1024 WebP |

### `models/env2/`（高精度植被，处理工具 `tools/bpy-process.py`，来源记录 `art-src/veg2/sources.json`）

| 文件 | Seele 资产库编号 | 用途 |
|---|---|---|
| `tree_broad_a.glb` / `tree_broad_b.glb` | #922849 / #1014258 | 院落周边与正厅后方大树（high 档） |
| `tree_maple.glb` | #973472 | 红枫（high） |
| `pine_a.glb` / `pine_b.glb` | #691821 / #690652 | 北坡松林、东脊近景松（high） |
| `bamboo_a.glb` | #651232 | 西厢旁近景竹（high） |
| `bush_b.glb` | #1026543 | 院落近处灌木（high） |
| `fern_a.glb` / `grass_b.glb` | #949636 / #921988 | 林下蕨类、院缘细草（high 与 low） |

### `models/props2/`（道具与家具，来源记录 `art-src/props2/sources.json`）

石狮 #559805、石灯 #370070 / #764309、水缸 #241972、陶罐 #652296、兵器架 #929460、晾架 #762128、手推车 #284039、香鼎 #406178、陶罐架 #916667、供桌 #669128、明式椅 #405266、书案 #264997、茶具 #1044878、书柜 #921235、瓷瓶 #766686、山水画 #970982、格栅屏风 #689122、架子床 #688646、矮柜 #1015354、铁砧 #1023213、木工台 #918757。部分家具把木材标成金属，运行时由 `fixPropMaterial()`（`src/world/world.ts`）把非金属材质的金属度归零。

### 程序化

三栋可进入的房屋（`src/world/buildings.ts`）、院落铺装、路缘、挡土墙、石阶、木人桩（`yard.ts`）、中式石井（`well.ts`）、世界之门与工坊装置（`gate.ts`、`world.ts`）、天空、远山、雾和光柱均由代码生成。

## 5. 贴图（`tex/`，2K 颜色 / 法线 + 1K 粗糙度）

| 前缀 | 来源 |
|---|---|
| `timber_*` 木材 #939384、`plaster_*` 灰泥 #938458、`wetrock_*` 湿岩 #938551、`cliff_*` 崖石 #938546、`paving_*` 石铺 #939311、`gravel_*` 碎石 #939048、`pleaf_*` 落叶地 #939055、`mud_*` 泥地 #939071、`floorwood_*` 木地板 #938689、`rooftile_*` 瓦面 #939611、`brick_*` 青砖 #938221 | Seele 资产库 material（下载脚本 `tools/fetch-tex.py`，记录 `art-src/tex2/sources.json`） |
| `moss_*`、`lime_*`、`leaf_atlas.png`、`overcast.hdr`；`fx/cut_flash.png` | 参考工程「烬雨孤刀」`assets/textures/`、`assets/fx/` |

## 6. 音频（`audio/`）

| 文件 | 来源 |
|---|---|
| `clash.mp3`、`clash_hit.mp3`、`swing_light.mp3`、`swing_heavy.mp3`（同素材降速 0.72） | Seele 音效生成（AudioGen）：钢刀相击、挥刀破风 |
| `parry.mp3` / `dodge.mp3` / `flesh.mp3` | Seele 资产库音效 #173022「Weapon (sword)」/ #157302「Whip whoosh」/ #156761「hit, impact, short smack」 |
| `guardbreak.mp3`、`thud`、`gong`、`wind`、`rain`、`bgm_explore`、`bgm_battle`、`sting_victory`、`sting_death` | 参考工程「烬雨孤刀」`assets/audio/`（`guardbreak` 去掉了开头 1.3 s 静音） |

战斗音效由 `tools/make-sfx.py` 截取单次事件、去掉开头静音、淡出并统一峰值。

## 7. 界面材质（`ui/`，13 件 1.2 MB）

Seele 图像生成（seedream5lite）的宣纸、旧木、朱砂漆、青玉漆、铜钱、墨迹、朱印素材，经 `tools/ui-prep.py` 去色边、按墨色浓度换算透明度，再切成独立 PNG：`panels_paper`、`panels_wood_band`、`hud_bar_frame`、`buttons_cinnabar` / `buttons_paper` / `buttons_jade`、`controls_bronze_disc`、`hud_cell_empty` / `hud_cell_filled`、`decor_brush_wide` / `decor_brush_thin`、`decor_ink_splat`、`decor_seal`。提示词、总图、切图区域与校验结果在 `art-src/ui10/`（`ui-pack/manifest.json`、`validation.json`）。

## 8. 示例游戏封面（`games/`）

`forest_cover.jpg`、`scifi_cover.jpg`：Seele 图像生成，提示词和原图在 `art-src/covers/`。只用于两套示例配置；正式接入时由宿主在 `games` 配置里提供真实封面。

## 9. 其它

`draco/`：three.js 自带的 Draco 解码器（three 0.170.0）。

## 授权说明

- 参考工程资源来自公司已有项目「烬雨孤刀」的发布资产，在公司内部项目中复用；其原始授权记录在源画布中，本环境无法读取。
- Seele 资产库资源和 Seele 生成的图片、视频、模型、音效按平台条款使用；Mixamo 动作与角色遵循 Adobe Mixamo 使用条款。
- 程序化资产由本项目代码生成。
