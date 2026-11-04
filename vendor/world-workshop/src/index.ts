import { Workshop } from './workshop';
import type { GameEntry, Language, Mode, MountOptions, Section, WorkshopHandle } from './types';

export type { GameEntry, Language, Mode, MountOptions, Section, WorkshopHandle, WorkshopState, LocalizedText, Availability, EncounterState } from './types';

const instances = new WeakMap<HTMLElement, { ws: Workshop; handle: WorkshopHandle }>();

/**
 * Mount the World Workshop into `container` (the module fills it; give it a size).
 * Calling mount() again on the same container does NOT create a second render loop or listener set:
 * it updates language/games/callbacks on the existing instance and returns the same handle.
 */
export function mount(container: HTMLElement, options: MountOptions = {}): WorkshopHandle {
  const existing = instances.get(container);
  if (existing) {
    const { ws, handle } = existing;
    Object.assign(ws.opts, options);
    if (options.language) ws.setLanguage(options.language);
    if (options.games) ws.setGames(options.games);
    if (options.section) ws.setSection(options.section);
    if (options.mode) ws.setMode(options.mode);
    return handle;
  }
  const ws = new Workshop(container, options);
  const handle: WorkshopHandle = {
    setMode: (m: Mode) => (m === 'play' ? ws.setMode('play') : ws.mode === 'play' ? (ws.setMode(m), ws.opts.onExitPlay?.()) : ws.setMode(m)),
    setSection: (s: Section) => ws.setSection(s),
    setLanguage: (l: Language) => ws.setLanguage(l),
    setGames: (g: GameEntry[]) => ws.setGames(g),
    pause: () => ws.pause(),
    resume: () => ws.resume(),
    resize: () => ws.resize(),
    dispose: () => {
      ws.dispose();
      instances.delete(container);
    },
    getState: () => ws.getState(),
    ready: ws.readyPromise,
  };
  ws.readyPromise.then(() => undefined);
  instances.set(container, { ws, handle });
  // resolve ready on first rendered frame
  const poll = () => {
    if (ws.frameCount > 0) (ws as unknown as { resolveReady: () => void }).resolveReady();
    else if (!(ws as unknown as { disposed: boolean }).disposed) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  return handle;
}

/** Internal access for the standalone trial page / QA automation. */
export function _debug(container: HTMLElement) {
  return instances.get(container)?.ws.debug();
}
