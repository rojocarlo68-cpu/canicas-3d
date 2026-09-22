/**
 * TAMA Project title screen + gallery / options overlays.
 */
import {
  loadSave,
  writeSave,
  hasSaveProgress,
  hasMatchSnapshot,
  setEquippedSkin,
  removeFromCollection,
  setSfxMute,
  setQuality,
  setPlayerName,
  DEFAULT_PLAYER_NAME,
  COLLAB_MARBLE_SEED,
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

function navigateToLevel(level: 1 | 2 | 3, opts?: { load?: boolean }): void {
  const control = resolveControlMode();
  let href = buildGameHref(control, level);
  if (opts?.load) {
    href += href.includes('?') ? '&load=1' : '?load=1';
  }
  window.location.href = href;
}

function refreshLoadButton(save: SaveData): void {
  const btn = $('btn-menu-load') as HTMLButtonElement;
  if (hasMatchSnapshot() || hasSaveProgress()) {
    btn.disabled = false;
    btn.classList.remove('is-disabled');
    const snap = save.matchSnapshot;
    if (snap) {
      const d = new Date(snap.savedAt);
      btn.querySelector('.menu-sub')!.textContent =
        `N${snap.sceneLevel} · ${snap.playerName} · ${d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`;
    } else {
      btn.querySelector('.menu-sub')!.textContent = 'Continuar';
    }
  } else {
    btn.disabled = true;
    btn.classList.add('is-disabled');
    btn.querySelector('.menu-sub')!.textContent = 'Sin partida';
  }
}

function renderGallery(save: SaveData): void {
  ensureGalleryHandlers();
  const grid = $('gallery-grid');
  grid.innerHTML = '';
  if (save.collection.length === 0) {
    grid.innerHTML = '<p class="gallery-empty">Aún no tienes canicas únicas. Gana un nivel para abrir el maletín gacha.</p>';
    return;
  }
  for (const item of save.collection) {
    const isCollab = item.seed === COLLAB_MARBLE_SEED;
    const card = document.createElement('div');
    card.className = 'gallery-card' + (save.equippedSkinSeed === item.seed ? ' equipped' : '');
    card.title = item.description
      ? `${item.description} · Equipar como piel de tirador`
      : 'Equipar como piel de tirador';
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
    const equipBtn = document.createElement('button');
    equipBtn.type = 'button';
    equipBtn.className = 'gallery-equip';
    equipBtn.append(canvas, name, badge);
    equipBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const next = setEquippedSkin(item.seed);
      toast(`Equipada: ${item.name}`);
      renderGallery(next);
    });
    card.appendChild(equipBtn);
    if (isCollab) {
      const lock = document.createElement('span');
      lock.className = 'gallery-locked';
      lock.textContent = 'Colab';
      lock.title = 'Canica colaboración — no se puede eliminar';
      card.appendChild(lock);
    } else {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'gallery-delete';
      del.setAttribute('aria-label', `Eliminar ${item.name}`);
      del.title = 'Eliminar de la colección';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = removeFromCollection(item.seed);
        toast(`Eliminada: ${item.name}`);
        renderGallery(next);
      });
      card.appendChild(del);
    }
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

/** Wire gallery close even when title menu is skipped (in-game / all levels). */
let galleryHandlersBound = false;
function ensureGalleryHandlers(): void {
  if (galleryHandlersBound) return;
  galleryHandlersBound = true;
  const gallery = document.getElementById('gallery-overlay');
  const btn = document.getElementById('btn-gallery-close');
  if (!gallery || !btn) return;
  const close = (e?: Event) => {
    e?.preventDefault();
    e?.stopPropagation();
    gallery.classList.add('hidden');
  };
  btn.addEventListener('click', close);
  // Backdrop click closes (same as pause overlay)
  gallery.addEventListener('click', (e) => {
    if (e.target === gallery) close(e);
  });
}

function openNamePrompt(onDone: (name: string) => void): void {
  const overlay = $('name-prompt');
  const input = $('name-prompt-input') as HTMLInputElement;
  const save = loadSave();
  input.value = save.playerName || DEFAULT_PLAYER_NAME;
  overlay.classList.remove('hidden');

  const finish = (name: string) => {
    overlay.classList.add('hidden');
    const cleaned = name.trim() || DEFAULT_PLAYER_NAME;
    setPlayerName(cleaned);
    btnOk.removeEventListener('click', onOk);
    btnCancel.removeEventListener('click', onCancel);
    input.removeEventListener('keydown', onKey);
    onDone(cleaned);
  };

  const onOk = () => finish(input.value);
  const onCancel = () => finish(DEFAULT_PLAYER_NAME);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onOk();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const btnOk = $('btn-name-ok');
  const btnCancel = $('btn-name-cancel');
  btnOk.addEventListener('click', onOk);
  btnCancel.addEventListener('click', onCancel);
  input.addEventListener('keydown', onKey);
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 30);
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
    openNamePrompt(() => {
      levelPick.classList.remove('hidden');
    });
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
  $('btn-level-3').addEventListener('click', () => {
    unlockMarbleAudio();
    const s = loadSave();
    if (!s.unlockedLevels.includes(3)) {
      toast('Nivel 3 bloqueado — gana el Nivel 2');
      return;
    }
    navigateToLevel(3);
  });
  $('btn-level-pick-close').addEventListener('click', () => levelPick.classList.add('hidden'));

  $('btn-menu-load').addEventListener('click', () => {
    unlockMarbleAudio();
    const s = loadSave();
    if (s.matchSnapshot) {
      navigateToLevel(s.matchSnapshot.sceneLevel as 1 | 2 | 3, { load: true });
      return;
    }
    if (!hasSaveProgress() && s.unlockedLevels.length <= 1 && s.collection.length === 0) {
      toast('No hay partida guardada');
      return;
    }
    const lvl = s.unlockedLevels.includes(3) ? 3 : s.unlockedLevels.includes(2) ? 2 : 1;
    navigateToLevel(lvl as 1 | 2 | 3);
  });

  $('btn-menu-multi').addEventListener('click', () => {
    toast('Multijugador — Próximamente');
  });

  $('btn-menu-gallery').addEventListener('click', () => {
    unlockMarbleAudio();
    renderGallery(loadSave());
    gallery.classList.remove('hidden');
  });
  ensureGalleryHandlers();

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

  // Update lock badges
  const l2 = $('btn-level-2');
  if (!save.unlockedLevels.includes(2)) {
    l2.classList.add('locked');
    const sub = l2.querySelector('.menu-sub');
    if (sub) sub.textContent = 'Bloqueado';
  }
  const l3 = $('btn-level-3');
  if (!save.unlockedLevels.includes(3)) {
    l3.classList.add('locked');
    const sub = l3.querySelector('.menu-sub');
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
  document.getElementById('name-prompt')?.classList.add('hidden');
}

/** In-game access to gallery (e.g. from pause). */
export function openGalleryFromGame(): void {
  const gallery = document.getElementById('gallery-overlay');
  if (!gallery) return;
  ensureGalleryHandlers();
  renderGallery(loadSave());
  gallery.classList.remove('hidden');
  gallery.setAttribute('aria-hidden', 'false');
}

export function applySaveAudio(): void {
  const s = loadSave();
  setMarbleAudioMuted(s.sfxMute);
}

export { buildMenuHref, writeSave };
