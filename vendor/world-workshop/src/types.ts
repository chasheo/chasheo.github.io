// Public types for the World Workshop embed module.

export type Language = 'zh' | 'en';
export type Mode = 'browse' | 'inspect' | 'play';
export type Section = 'arrival' | 'courtyard' | 'worlds';
export type Availability = 'playable' | 'queue' | 'showcase' | 'offline';

export interface LocalizedText {
  zh: string;
  en: string;
}

export interface GameEntry {
  /** Stable id passed back to the host through onSelectGame(gameId). */
  id: string;
  title: string | LocalizedText;
  description: string | LocalizedText;
  /** Cover image (relative to assetBase or absolute URL supplied by the host). */
  cover?: string;
  /** Optional muted looping preview video shown inside the world gate. */
  video?: string;
  /** Optional accent color for the gate light, e.g. '#7fd6a4'. */
  accent?: string;
  /** Optional theme hint used to tint the showcase ('forest' | 'scifi' | 'racing' | string). */
  theme?: string;
  /** Optional tags shown under the title. */
  tags?: Array<string | LocalizedText>;
  /**
   * playable: the host can launch it (UE pixel streaming etc.).
   * queue: playable but currently queued by host.
   * showcase: display sample only — the module never fabricates a play link or stats.
   * offline: temporarily unavailable.
   */
  availability: Availability;
}

export interface MountOptions {
  language?: Language;
  games?: GameEntry[];
  /** Base URL for runtime assets (models, textures, audio). Default './'. */
  assetBase?: string;
  /** Initial mode. Default 'browse'. */
  mode?: Mode;
  /** Initial section. Default 'arrival'. */
  section?: Section;
  /** 'auto' picks by device; 'high' | 'low' force a tier. */
  quality?: 'auto' | 'high' | 'low';
  /** Force touch controls on/off (default: detected from pointer: coarse / touch support). */
  touch?: boolean;
  /** Show the built-in "take over" button and section hint in browse/inspect. Default true. */
  builtinBrowseUI?: boolean;
  /**
   * Loading cover shown until the first 3D frame is rendered, then faded out automatically: the text-free key-art
   * poster (assets/intro/heroine_poster_{1440,2560}.jpg) appears at once and the animated version of the same shot
   * (assets/intro/intro_loop_{1080,720}.mp4, muted seamless 10 s loop, picked by covered width) fades in over it when
   * it can play. With reduced motion respected and requested, only the poster is shown. Default true; false keeps
   * the plain loading strip.
   */
  introVideo?: boolean;
  /** Respect prefers-reduced-motion (default true). */
  respectReducedMotion?: boolean;
  /** While in play mode, set documentElement overflow hidden and restore scroll position on exit (default true). */
  lockScrollInPlay?: boolean;
  /** Called when a visitor asks to open the full game library. */
  onOpenLibrary?: () => void;
  /** Called when a visitor selects a game through the world gate. */
  onSelectGame?: (gameId: string) => void;
  /** Called when play mode ends (Esc / "back to homepage"). */
  onExitPlay?: () => void;
  /** Called when the visitor requests play mode from the built-in button. */
  onEnterPlay?: () => void;
  /** Called on internal state changes (mode, section, encounter, ready). */
  onStateChange?: (state: WorkshopState) => void;
}

export type EncounterState = 'dormant' | 'engaged' | 'victory' | 'defeat';

export interface WorkshopState {
  ready: boolean;
  mode: Mode;
  section: Section;
  language: Language;
  paused: boolean;
  encounter: EncounterState;
  portalOpen: boolean;
  quality: 'high' | 'low';
}

export interface WorkshopHandle {
  setMode(mode: Mode): void;
  setSection(section: Section): void;
  setLanguage(lang: Language): void;
  setGames(games: GameEntry[]): void;
  pause(): void;
  resume(): void;
  resize(): void;
  dispose(): void;
  getState(): WorkshopState;
  /** Resolves once assets are loaded and the first frame rendered. */
  ready: Promise<void>;
}
