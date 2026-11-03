# 动作、骨架与招式时序（当前版本）

## 1. 角色与骨架

| 角色 | 显示模型 | 骨架 | 动作如何套上 |
|---|---|---|---|
| 女侠「青衫」 | `heroine2.glb`：按加载海报造型生成并自动绑骨 | 自动绑骨的 52 骨人形骨架（`bone_0…bone_51`），按层级与关节坐标映射到 Mixamo 骨骼名（`src/chars/retarget.ts::HEROINE2_MAP`） | 静止姿态感知重定向：源为不显示的 Mixamo 骨架 `heroine.glb`。颈部与头部跟随胸腔的对齐，因为自动绑骨把头部关节放在颈部关节后上方，按颈头连线对齐会把头压低四十多度 |
| 守关者「铁面」 | `guardian.glb` | 剥离原骨架后自动绑骨（53 骨），映射 `GUARDIAN_MAP` | 同一套重定向 |

### 重定向方法（`src/chars/retarget.ts`）

每一帧：在 Mixamo 源骨架上播放动作得到世界旋转 `W_src(t)`；求相对源静止姿态的增量 `D = W_src(t)·W_src_rest⁻¹`；目标世界旋转 `W_dst(t) = D·A·W_dst_rest`，其中 `A` 把目标静止姿态对齐到源静止姿态（髋、胸、手用主骨方向加侧向轴双轴对齐，其余用骨骼方向）；再换回局部旋转。髋部位移和根位移按腿长比例换算。所有动作在加载时一次性烘焙到各自骨架上。

### 握持（`src/chars/grips.ts`）

握柄轴为手骨坐标系中小指根到食指根的连线；每帧在动画之后给四指和拇指加握拳旋转（刀 62°/80°/50°、拇指 35°；斧 66°/84°/55°、拇指 40°），任何动作下都闭合在柄上。

### 马尾（`src/chars/ponytail.ts`）

生成模型的马尾整块绑在头骨上。加载时按位置选出马尾顶点（363 个），在头骨下插入 5 节发束骨骼并重新蒙皮（发结处与头骨平滑过渡）。每帧用 120 Hz 质点链模拟：重力、惯性、阻尼、向动画形状回弹（根部硬、末端软），每节偏转角上限（根部 40°、末端 60°），沿脊柱和头骨的胶囊体防穿身，地面防穿地；游戏里瞬间转身时马尾随身体一起转。

## 2. 动作清单

全部为 Mixamo 动作（Seele 资产库 `three_motion` 检索下载，或参考工程「烬雨孤刀」发布资源中的 Mixamo 动作）。**没有使用视频动捕，也没有使用文生动作。** 30 fps，四元数 Int16 量化（`tools/build-anims.mjs`）。

### 女侠（`public/assets/anims/heroine.anim.*`）

| 名称 | 用途 | 源动作 | 资产编号 | 截取 |
|---|---|---|---|---|
| idle | 持刀待机 | Sword And Shield Idle | 1077382 | 全段 |
| look | 浏览时张望 | Looking Around | 1076690 | 全段 |
| practice | 浏览时练刀 / 胜利 | Sword And Shield Power Up | 1068972 | 全段 |
| walk | 行走 | Female Walk | 1072845 | 全段 |
| run | 跑步（方向键） | Running | 1076539 | 全段 |
| sprint | 冲刺（按住 Shift） | Running | 1075764 | 全段 |
| dodge | 闪避 | Standing Dodge Left | 1078952 | 0–30 帧 |
| parry | 弹反架势 | Sword And Shield Block | 1075367 | 全段 |
| light1–light4 | 五段连击前四段 | One Hand Sword Combo | 1070941 | 14–42 / 42–68 / 68–98 / 98–126 帧 |
| heavy | 第五段蓄力跃斩 | Great Sword Jump Attack | 1080464 | 6–62 帧 |
| counter | 弹反后旋斩 | Great Sword High Spin Attack | 1082855 | 全段 |
| hit / death | 受击 / 战败 | Sword And Shield Impact / Death | 1068970 / 1068968 | 全段 |
| jump | 起跳 | Jumping Up | 1074273 | 9–25 帧，髋部高度固定（跳跃弧线由游戏物理给出） |
| land | 落地 | Standing Jump Running Landing | 1077740 | 8–22 帧 |

### 守关者（`public/assets/anims/guardian.anim.*`）

| 名称 | 用途 | 源动作 | 资产编号 | 截取 |
|---|---|---|---|---|
| idle / taunt | 持斧待机 / 挑衅 | 参考工程 `idle.fbx` / `taunt.fbx` | 烬雨孤刀 | 全段 |
| look | 守位张望 | Looking Around | 1076690 | 全段 |
| walk / run | 逼近 | Standing Walk Forward / 参考工程 `run.fbx` | 1077564 / 烬雨孤刀 | 全段 |
| chop | 双手过顶劈砸 | Heavy Weapon Swing | 1073684 | 34–96 帧 |
| back | 劈砸后回身追击 | Great Sword Attack | 1076255 | 0–36 帧 |
| sweep | 侧身横扫 | Standing Melee Attack Horizontal | 1068934 | 全段 |
| axe1–axe3 | 三连砍 | One Hand Club Combo | 1076105 | 4–30 / 30–54 / 54–84 帧 |
| slam1–slam3 | 三连重砸 | Two Hand Club Combo | 1076791 | 20–60 / 60–100 / 100–140 帧 |
| recoil | 被弹反震退 | Standing React Large Gut | 1076155 | 全段 |
| stagger | 被重击打断 | Standing React Large From Front | 1076562 | 全段 |
| knockdown / getup | 架势崩溃倒地 / 起身 | Knocked Down / Getting Up | 1068842 / 1070656 | 全段 / 120 帧起 |
| defeated | 败退跪地 | Defeated | 1072840 | 全段 |

斧法用的是单手棍、双手棍连招：Mixamo 没有斧类连招，棍法的挥击轨迹和发力最接近单手斧。

## 3. 移动与防滑步

| 状态 | 速度 | 播放 |
|---|---|---|
| 浏览时女侠散步 | 1.25 m/s | walk（动作原速 1.11 m/s） |
| 方向键跑 | 3.4 m/s | run（原速 3.28 m/s，约 1.04 倍） |
| 按住 Shift ≥0.2 s 冲刺 | 5.8 m/s | sprint（原速 5.15 m/s，约 1.13 倍） |
| Shift 短按闪避 | 前 0.32 s 内滑出 3.4 m（先快后慢，分步碰撞） | dodge ×1.55，无敌 0.03–0.60 片段时间 |
| 空格跳跃 | 起跳 6 m/s，重力 18 m/s²（约 1 m 高、0.67 s 滞空），保留起跳速度、可空中转向，不能二段跳 | jump → land；落地 0.12 s 后可接动作 |

播放速率 = 实际速度 / 动作自然速度（限制 0.55–1.6 倍），自然速度由动作根位移计算（`Fighter.calibrate`）。攻击动作的根位移按招式系数施加。

## 4. 招式时序（`src/game/moves.ts`，片段时间，秒）

有效攻击窗口取刃尖速度大于峰值 45% 的连续区间（`tools/cut-windows.mjs` 测量）；命中判定是刃线与目标身体胶囊的真实接触（`Fighter.testContact`），特效只在伤口处生成。

### 女侠（五段连击 light1 → light2 → light3 → light4 → heavy）

| 招式 | 播放速度 | 有效攻击 | 可接下一段 | 伤害 / 架势 |
|---|---|---|---|---|
| light1 过顶横斩 | ×1.3 | 0.42–0.70 | ≥0.60 | 8 / 7 |
| light2 回身撩斩 | ×1.3 | 0.46–0.68 | ≥0.62 | 8 / 7 |
| light3 踏步斜斩 | ×1.3 | 0.58–0.84 | ≥0.78 | 9 / 8 |
| light4 转身回斩 | ×1.3 | 0.38–0.64 | ≥0.58 | 10 / 9 |
| heavy 蓄力跃斩 | ×1.05（0.05–0.20 段按住可蓄力，最多 0.9 s） | 0.86–1.04，落地 1.02 | — | 22 / 32，可打断 |
| counter 弹反后旋斩 | ×1.15 | 0.34–0.52、0.92–1.20（第二段可打断） | — | 12 + 18 / 20 + 28 |

实测连续按键时五段的开始时刻：0 / 0.48 / 0.95 / 1.56 / 2.01 s，共 57 伤害（`docs/combat_qa_result.json::five_hit_chain`）。

### 守关者连招（`GUARD_COMBOS`，每一击都有独立预警和弹反窗口）

| 连招 | 组成 | 接续概率 | 每段有效攻击 |
|---|---|---|---|
| 重劈 | chop → back | 45% | 1.16–1.56 / 0.32–0.56 |
| 横扫 | sweep | — | 0.82–1.04 |
| 三连砍 | axe1 → axe2 → axe3 | 85% | 0.30–0.52 / 0.36–0.56 / 0.24–0.50 |
| 三连重砸 | slam1 → slam2 → slam3 | 80% | 0.64–0.92 / 0.66–0.96 / 0.66–0.96 |

实测接触时刻：重劈 1.592 s，横扫 0.85 s。

### 弹反（`PARRY`）

| 参数 | 值 | 含义 |
|---|---|---|
| pre | 0.18 s | 接触前多早按下仍算成功 |
| post | 0.06 s | 接触后的容错 |
| lockout | 0.42 s | 一次按下后的冷却 |
| spamPenalty | 0.30 s | 冷却内再按不生效，并把冷却后推 |
| earlyFeedback / lateFeedback | 0.55 / 0.30 s | 「过早」「过晚」提示范围 |
| counterWindow | 1.15 s | 弹反后反击窗口 |

轻击不打断守关者的出招；重击（第五段、反击第二段）可打断并击退；架势满后倒地再起身。
