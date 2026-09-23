import './style.css';
import { Game } from './Game';
import { resolveSceneLevel } from './levelSelect';
import { initTitleMenu, hideTitleMenu, applySaveAudio } from './titleMenu';
import { loadSave } from './save';
import { setMarbleAudioMuted, installMarbleAudioUnlock, unlockMarbleAudio } from './marbleSounds';
import { setLang, applyI18n, isLang } from './i18n';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('No se encontró #game-canvas');
}

document.title = 'TAMA Project';
applySaveAudio();
{
  const s = loadSave();
  if (isLang(s.language)) setLang(s.language);
  applyI18n(document);
}
installMarbleAudioUnlock();

const level = resolveSceneLevel();
let game: Game | null = null;

if (level === null) {
  // Title / menu entry
  initTitleMenu();
  // Soft-hide in-game HUD until a level is chosen (page navigates away)
  document.getElementById('hud')?.classList.add('hidden');
  document.getElementById('ui-actions')?.classList.add('hidden');
  // Any title click unlocks AudioContext for the next page load gesture chain
  document.getElementById('title-screen')?.addEventListener(
    'pointerdown',
    () => unlockMarbleAudio(),
    { once: true, capture: true },
  );
} else {
  hideTitleMenu();
  const save = loadSave();
  setMarbleAudioMuted(save.sfxMute);
  game = new Game(canvas);
  game.start();
  (window as unknown as { __TAMA_GAME__: Game }).__TAMA_GAME__ = game;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
  });
}
