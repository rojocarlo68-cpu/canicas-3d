import './style.css';
import { Game } from './Game';
import { resolveSceneLevel } from './levelSelect';
import { initTitleMenu, hideTitleMenu, applySaveAudio } from './titleMenu';
import { loadSave } from './save';
import { setMarbleAudioMuted } from './marbleSounds';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('No se encontró #game-canvas');
}

document.title = 'TAMA Project';
applySaveAudio();

const level = resolveSceneLevel();
let game: Game | null = null;

if (level === null) {
  // Title / menu entry
  initTitleMenu();
  // Soft-hide in-game HUD until a level is chosen (page navigates away)
  document.getElementById('hud')?.classList.add('hidden');
  document.getElementById('ui-actions')?.classList.add('hidden');
} else {
  hideTitleMenu();
  const save = loadSave();
  setMarbleAudioMuted(save.sfxMute);
  game = new Game(canvas);
  game.start();
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
  });
}
