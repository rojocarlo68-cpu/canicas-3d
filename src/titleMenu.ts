/**
 * TAMA Project title screen + gallery / options overlays.
 */
import {
  loadSave,
  writeSave,
  hasSaveProgress,
  setEquippedSkin,
  setSfxMute,
  setQuality,
  type SaveData,
} from './save';
import { buildGameHref, buildMenuHref } from './levelSelect';
import { resolveControlMode } from './controlMode';
import { paintSeedPreview, paramsFromSeed } from './proceduralMarble';
import { setMarbleAudioMuted, unlockMarbleAudio } from './marbleSounds';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
}

function toast(msg: string): void {
  const el = $('menu-toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.classList.add('show');
  window.clearTimeout((toast as unknown as { _t?: number })._t);
  (toast as unknown as { _t?: number })._t = window.setTimeout(() => {
    el.classList.add('hidden');
    el.classList.remove('show');
  }, 2200);
}

function navigateToLevel(level: 1 | 2): void {
  const control = resolveControlMode();
  window.location.href = buildGameHref(control, level);
}

function refreshLoadButton(save: SaveData): void {
  const btn = $('btn-menu-load') as HTMLButtonElement;
  if (hasSaveProgress() || save.unlockedLevels.length > 1 || save.collection.length > 0) {
    btn.disabled = false;
    btn.classList.remove('is-disabled');
    btn.querySelector('.menu-sub')!.textContent = 'Continuar';
  } else {
    btn.disabled = true;
    btn.classList.add('is-disabled');
    btn.querySelector('.menu-sub')!.textContent = 'Próximamente';
  }
}

function renderGallery(save: SaveData): void {
  const grid = $('gallery-grid');
  grid.innerHTML = '';
  if (save.collection.length === 0) {
    grid.innerHTML = '<p class="gallery-empty">Aún no tienes canicas únicas. Gana un nivel para abrir el maletín gacha.</p>';
    return;
  }
  for (const item of save.collection) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'gallery-card' + (save.equippedSkinSeed === item.seed ? ' equipped' : '');
    card.title = 'Equipar como piel de tirador';
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    paintSeedPreview(canvas, item.seed);
    const name = document.createElement('span');
    name.className = 'gallery-name';
    name.textContent = item.name || paramsFromSeed(item.seed).name;
    const badge = document.createElement('span');
    badge.className = 'gallery-badge';
    badge.textContent = save.equippedSkinSeed === item.seed ? 'Equipada' : 'Equipar';
    card.append(canvas, name, badge);
    card.addEventListener('click', () => {
      const next = setEquippedSkin(item.seed);
      toast(`Equipada: ${item.name}`);
      renderGallery(next);
    });
    grid.appendChild(card);
  }
}

function syncOptions(save: SaveData): void {
  const mute = $('opt-mute') as HTMLInputElement;
  const quality = $('opt-quality') as HTMLSelectElement;
  mute.checked = save.sfxMute;
  quality.value = save.quality;
  setMarbleAudioMuted(save.sfxMute);
}

export function initTitleMenu(): void {
  const title = $('title-screen');
  const levelPick = $('level-pick');
  const gallery = $('gallery-overlay');
  const options = $('options-overlay');

  const save = loadSave();
  refreshLoadButton(save);
  syncOptions(save);

  $('btn-menu-new').addEventListener('click', () => {
    unlockMarbleAudio();
    levelPick.classList.remove('hidden');
  });

  $('btn-level-1').addEventListener('click', () => {
    unlockMarbleAudio();
    navigateToLevel(1);
  });
  $('btn-level-2').addEventListener('click', () => {
    unlockMarbleAudio();
    const s = loadSave();
    if (!s.unlockedLevels.includes(2)) {
      toast('Nivel 2 bloqueado — gana el Nivel 1');
      return;
    }
    navigateToLevel(2);
  });
  $('btn-level-pick-close').addEventListener('click', () => levelPick.classList.add('hidden'));

  $('btn-menu-load').addEventListener('click', () => {
    unlockMarbleAudio();
    const s = loadSave();
    if (!hasSaveProgress() && s.unlockedLevels.length <= 1 && s.collection.length === 0) {
      toast('Próximamente');
      return;
    }
    const lvl = s.unlockedLevels.includes(2) ? 2 : 1;
    navigateToLevel(lvl as 1 | 2);
  });

  $('btn-menu-multi').addEventListener('click', () => {
    toast('Multijugador — Próximamente');
  });

  $('btn-menu-gallery').addEventListener('click', () => {
    unlockMarbleAudio();
    renderGallery(loadSave());
    gallery.classList.remove('hidden');
  });
  $('btn-gallery-close').addEventListener('click', () => gallery.classList.add('hidden'));

  $('btn-menu-options').addEventListener('click', () => {
    unlockMarbleAudio();
    syncOptions(loadSave());
    options.classList.remove('hidden');
  });
  $('btn-options-close').addEventListener('click', () => options.classList.add('hidden'));

  ($('opt-mute') as HTMLInputElement).addEventListener('change', (e) => {
    const muted = (e.target as HTMLInputElement).checked;
    setSfxMute(muted);
    setMarbleAudioMuted(muted);
  });
  ($('opt-quality') as HTMLSelectElement).addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value as SaveData['quality'];
    setQuality(v);
    toast(v === 'low' ? 'Calidad baja' : v === 'high' ? 'Calidad alta' : 'Calidad automática');
  });

  // Update L2 lock badge
  const l2 = $('btn-level-2');
  if (!save.unlockedLevels.includes(2)) {
    l2.classList.add('locked');
    const sub = l2.querySelector('.menu-sub');
    if (sub) sub.textContent = 'Bloqueado';
  }

  title.classList.remove('hidden');
}

export function hideTitleMenu(): void {
  const title = document.getElementById('title-screen');
  title?.classList.add('hidden');
  document.getElementById('level-pick')?.classList.add('hidden');
  document.getElementById('gallery-overlay')?.classList.add('hidden');
  document.getElementById('options-overlay')?.classList.add('hidden');
}

/** In-game access to gallery (e.g. from pause). */
export function openGalleryFromGame(): void {
  const gallery = document.getElementById('gallery-overlay');
  if (!gallery) return;
  renderGallery(loadSave());
  gallery.classList.remove('hidden');
}

export function applySaveAudio(): void {
  const s = loadSave();
  setMarbleAudioMuted(s.sfxMute);
}

export { buildMenuHref, writeSave };
