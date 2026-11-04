import type { Language, LocalizedText } from './types';

const STR = {
  title: { zh: '世界工坊', en: 'World Workshop' },
  subtitle: { zh: 'chasheo 的三维主世界 · 通往不同游戏的工坊', en: "chasheo's 3D home world · a workshop that leads to many games" },
  takeover: { zh: '接管角色', en: 'Take control' },
  backHome: { zh: '返回主页', en: 'Back to homepage' },
  loading: { zh: '载入中', en: 'Loading' },
  paused: { zh: '已暂停', en: 'Paused' },
  resume: { zh: '继续', en: 'Resume' },
  heroine: { zh: '青衫 · 女侠', en: 'Qingshan · Swordswoman' },
  guardian: { zh: '铁面 · 守关者', en: 'Iron Mask · Gatekeeper' },
  guardianSub: { zh: '持斧守门，未曾一退', en: 'Axe in hand, he never yields the gate' },
  parry: { zh: '弹反', en: 'PARRY' },
  counter: { zh: '反击', en: 'COUNTER' },
  broken: { zh: '破势', en: 'BROKEN' },
  stagger: { zh: '失衡', en: 'STAGGER' },
  danger: { zh: '危', en: '!' },
  early: { zh: '过早', en: 'Too early' },
  late: { zh: '过晚', en: 'Too late' },
  dead: { zh: '败', en: 'Defeated' },
  deadSub: { zh: '刀未离手，再来一次。', en: 'The blade is still in hand. Try again.' },
  retry: { zh: '重试 · R', en: 'Retry · R' },
  victory: { zh: '门开', en: 'The Gate Opens' },
  victorySub: { zh: '守关者收斧退下，工坊的光门已经点亮。', en: 'The gatekeeper lowers his axe. The workshop gate is lit.' },
  enterGate: { zh: '走近光门，按 E 查看作品', en: 'Approach the gate and press E to browse games' },
  gateLocked: { zh: '光门未启 · 击败守关者，或直接打开游戏库', en: 'Gate sealed · defeat the gatekeeper, or open the library directly' },
  openLibrary: { zh: '打开游戏库', en: 'Open game library' },
  gateSealed: { zh: '光门未启', en: 'Gate sealed' },
  playGame: { zh: '进入这款游戏', en: 'Play this game' },
  showcaseOnly: { zh: '展示样例 · 尚未接入', en: 'Showcase sample · not connected' },
  queueHint: { zh: '由主页排队并启动云端 UE', en: 'Host page queues and launches cloud UE' },
  offline: { zh: '暂不可用', en: 'Unavailable' },
  close: { zh: '关闭', en: 'Close' },
  prev: { zh: '上一个', en: 'Prev' },
  next: { zh: '下一个', en: 'Next' },
  challenge: { zh: '守关者在院中等候 · 靠近以开战', en: 'The gatekeeper waits in the yard · approach to fight' },
  rematch: { zh: '再战一次', en: 'Fight again' },
  rematchPrompt: { zh: '守关者倒地未起 · 按 E 让他再战（光门保持开启）', en: 'The gatekeeper is down · press E to fight him again (the gate stays open)' },
  sectionArrival: { zh: '山径 · 抵达', en: 'Mountain path · Arrival' },
  sectionCourtyard: { zh: '楼下院落', en: 'Courtyard below the houses' },
  sectionWorlds: { zh: '世界之门', en: 'Gate of Worlds' },
  dragHint: { zh: '拖动观察 · 滚轮缩放', en: 'Drag to look · Scroll to zoom' },
  controlsPC: {
    zh: 'WASD 移动 · 鼠标 转视角 · 左键 五段连击(第五段蓄力跃斩) · 右键 弹反 · Shift 短按闪避/长按冲刺 · 空格 跳跃 · E 交互 · Esc 返回',
    en: 'WASD move · Mouse look · LMB 5-hit combo (5th = charged leap) · RMB parry · Shift tap dodge / hold sprint · Space jump · E interact · Esc back',
  },
  controlsTouch: {
    zh: '左侧摇杆移动(推到底冲刺) · 斩 连击 · 弹 弹反 · 闪 闪避 · 跃 跳跃',
    en: 'Left stick move (push fully to sprint) · Slash combo · Parry · Dodge · Jump',
  },
  btnAttack: { zh: '斩', en: 'Slash' },
  btnParry: { zh: '弹', en: 'Parry' },
  btnDodge: { zh: '闪', en: 'Dodge' },
  btnJump: { zh: '跃', en: 'Jump' },
  btnUse: { zh: '交', en: 'Use' },
  sound: { zh: '声音', en: 'Sound' },
  playable: { zh: '可游玩', en: 'Playable' },
  queue: { zh: '排队中', en: 'Queued' },
} satisfies Record<string, LocalizedText>;

export type StrKey = keyof typeof STR;

export function t(key: StrKey, lang: Language): string {
  return STR[key][lang];
}

export function loc(v: string | LocalizedText | undefined, lang: Language): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : v[lang] ?? v.zh;
}
