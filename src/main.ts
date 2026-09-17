import './style.css';
import { Game } from './Game';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
if (!canvas) {
  throw new Error('No se encontró #game-canvas');
}

const game = new Game(canvas);
game.start();

// HMR safety
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
