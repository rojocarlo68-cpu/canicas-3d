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
  setLanguage,
  setAimGuide,
  addToCollection,
  exportCollectionJSON,
  importCollectionJSON,
  DEFAULT_PLAYER_NAME,
  COLLAB_MARBLE_SEED,
  type SaveData,
} from './save';
import { buildGameHref, buildMenuHref, type SceneLevel } from './levelSelect';
import { resolveControlMode } from './controlMode';
import {
  paintSeedPreview,
  paramsFromSeed,
  generateUniqueMarbleSeed,
  styleLabelKey,
  createDesignFromSeed,
} from './proceduralMarble';
import { MarbleShowcase } from './marbleShowcase';
import { setMarbleAudioMuted, unlockMarbleAudio } from './marbleSounds';
import { t, setLang, applyI18n, isLang, type Lang } from './i18n';

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

/** Optional live apply when gallery opened mid-match. */
let onApplySkinLive: ((seed: string) => void) | null = null;
let pendingSelectSeed: string | null = null;
let justApplied = false;

export function setGalleryLiveApplyHandler(
  handler: ((seed: string) => void) | null,
): void {
  onApplySkinLive = handler;
}

function navigateToLevel(level: SceneLevel, opts?: { load?: boolean }): void {
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
      const locale =
        loadSave().language === 'ja'
          ? 'ja-JP'
          : loadSave().language === 'zh'
            ? 'zh-CN'
            : loadSave().language === 'en'
              ? 'en-US'
              : 'es-MX';
      btn.querySelector('.menu-sub')!.textContent =
        `N${snap.sceneLevel} · ${snap.playerName} · ${d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}`;
    } else {
      btn.querySelector('.menu-sub')!.textContent = t('menu.load.sub');
    }
  } else {
    btn.disabled = true;
    btn.classList.add('is-disabled');
    btn.querySelector('.menu-sub')!.textContent = t('menu.load.empty');
  }
}

function syncApplyButtons(): void {
  const hasPending =
    !!pendingSelectSeed &&
    pendingSelectSeed !== loadSave().equippedSkinSeed &&
    !justApplied;
  const label = hasPending ? t('gallery.apply') : t('gallery.close');
  for (const id of ['btn-gallery-apply-top', 'btn-gallery-apply-bottom']) {
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (!btn) continue;
    btn.textContent = label;
    btn.dataset.mode = hasPending ? 'apply' : 'close';
  }
}

function closeGallery(): void {
  const gallery = document.getElementById('gallery-overlay');
  gallery?.classList.add('hidden');
  gallery?.setAttribute('aria-hidden', 'true');
  pendingSelectSeed = null;
  justApplied = false;
  syncApplyButtons();
}

function applyPendingSkin(): boolean {
  const seed = pendingSelectSeed;
  if (!seed) return false;
  const next = setEquippedSkin(seed);
  onApplySkinLive?.(seed);
  const name =
    next.collection.find((c) => c.seed === seed)?.name ||
    paramsFromSeed(seed).name;
  toast(t('gallery.applied', { name }));
  justApplied = true;
  pendingSelectSeed = seed;
  renderGallery(next);
  syncApplyButtons();
  return true;
}

function onApplyOrCloseClick(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
  const btn = e.currentTarget as HTMLButtonElement;
  if (btn.dataset.mode === 'apply') {
    applyPendingSkin();
  } else {
    closeGallery();
  }
}

function downloadCollection(seeds: string[] | null): void {
  const json = exportCollectionJSON(seeds);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tama-collection-${new Date().toISOString().slice(0, 10)}.tama-collection.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(t('gallery.exported'));
}

function selectedSeedsFromUI(): string[] {
  const boxes = document.querySelectorAll<HTMLInputElement>(
    '#gallery-grid input.gallery-check:checked',
  );
  return [...boxes].map((b) => b.value).filter(Boolean);
}

function renderGallery(save: SaveData): void {
  ensureGalleryHandlers();
  const grid = $('gallery-grid');
  grid.innerHTML = '';
  if (save.collection.length === 0) {
    grid.innerHTML =
      `<p class="gallery-empty">${t('gallery.empty')}</p>`;
    syncApplyButtons();
    return;
  }
  for (const item of save.collection) {
    const isCollab = item.seed === COLLAB_MARBLE_SEED;
    const selected = pendingSelectSeed === item.seed;
    const equipped = save.equippedSkinSeed === item.seed;
    const card = document.createElement('div');
    card.className =
      'gallery-card' +
      (equipped ? ' equipped' : '') +
      (selected ? ' selected' : '');
    card.title = item.description
      ? `${item.description} · Seleccionar piel`
      : 'Seleccionar como piel de tirador';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'gallery-check';
    check.value = item.seed;
    check.title = 'Seleccionar para exportar';
    check.addEventListener('click', (e) => e.stopPropagation());

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    paintSeedPreview(canvas, item.seed);
    const name = document.createElement('span');
    name.className = 'gallery-name';
    name.textContent = item.name || paramsFromSeed(item.seed).name;
    const badge = document.createElement('span');
    badge.className = 'gallery-badge';
    badge.textContent = equipped
      ? t('gallery.equipped')
      : selected
        ? t('gallery.chosen')
        : t('gallery.choose');
    const equipBtn = document.createElement('button');
    equipBtn.type = 'button';
    equipBtn.className = 'gallery-equip';
    equipBtn.append(canvas, name, badge);
    equipBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pendingSelectSeed = item.seed;
      justApplied = false;
      renderGallery(loadSave());
      syncApplyButtons();
    });
    card.append(check, equipBtn);
    if (isCollab) {
      const lock = document.createElement('span');
      lock.className = 'gallery-locked';
      lock.textContent = t('gallery.collab');
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
        const ok = window.confirm(
          `¿Eliminar «${item.name}» de la colección?\nEsta acción no se puede deshacer.`,
        );
        if (!ok) return;
        const next = removeFromCollection(item.seed);
        if (pendingSelectSeed === item.seed) pendingSelectSeed = null;
        toast(`Eliminada: ${item.name}`);
        renderGallery(next);
        syncApplyButtons();
      });
      card.appendChild(del);
    }
    grid.appendChild(card);
  }
  syncApplyButtons();
}

function syncOptions(save: SaveData): void {
  const mute = $('opt-mute') as HTMLInputElement;
  const quality = $('opt-quality') as HTMLSelectElement;
  mute.checked = save.sfxMute;
  quality.value = save.quality;
  setMarbleAudioMuted(save.sfxMute);
  const lang = document.getElementById('opt-language') as HTMLSelectElement | null;
  if (lang) lang.value = save.language || 'es';
  const aim = document.getElementById('opt-aim-guide') as HTMLInputElement | null;
  if (aim) aim.checked = save.aimGuide !== false;
}

/* ---------- Marble Factory ---------- */
let factorySeed: string | null = null;
let factoryShowcase: MarbleShowcase | null = null;

function refreshFactoryPreview(): void {
  if (!factorySeed) return;
  const canvas = document.getElementById('factory-preview') as HTMLCanvasElement | null;
  const nameEl = document.getElementById('factory-marble-name');
  const styleEl = document.getElementById('factory-marble-style');
  if (!canvas || !nameEl || !styleEl) return;
  const params = paramsFromSeed(factorySeed);
  nameEl.textContent = params.name;
  styleEl.textContent = t('factory.style', { style: t(styleLabelKey(params.style)) });
  try {
    if (!factoryShowcase) factoryShowcase = new MarbleShowcase(canvas);
    factoryShowcase.show(createDesignFromSeed(factorySeed));
  } catch {
    // Fallback flat preview if WebGL unavailable
    paintSeedPreview(canvas, factorySeed);
  }
}

function openFactory(): void {
  const overlay = document.getElementById('factory-overlay');
  if (!overlay) return;
  const save = loadSave();
  factorySeed = generateUniqueMarbleSeed(
    save.collection.map((c) => c.seed),
    'factory',
  );
  refreshFactoryPreview();
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeFactory(): void {
  const overlay = document.getElementById('factory-overlay');
  overlay?.classList.add('hidden');
  overlay?.setAttribute('aria-hidden', 'true');
  factoryShowcase?.stop();
}

function wireFactory(): void {
  const overlay = document.getElementById('factory-overlay');
  if (!overlay || overlay.dataset.wired === '1') return;
  overlay.dataset.wired = '1';

  document.getElementById('btn-menu-factory')?.addEventListener('click', () => {
    unlockMarbleAudio();
    openFactory();
  });
  document.getElementById('btn-factory-close')?.addEventListener('click', () => closeFactory());
  document.getElementById('btn-factory-close-x')?.addEventListener('click', () => closeFactory());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeFactory();
  });

  document.getElementById('btn-factory-generate')?.addEventListener('click', () => {
    const save = loadSave();
    const avoid = [
      ...save.collection.map((c) => c.seed),
      ...(factorySeed ? [factorySeed] : []),
    ];
    factorySeed = generateUniqueMarbleSeed(avoid, 'factory');
    refreshFactoryPreview();
  });

  document.getElementById('btn-factory-save')?.addEventListener('click', () => {
    if (!factorySeed) return;
    const save = loadSave();
    if (save.collection.some((c) => c.seed === factorySeed)) {
      toast(t('factory.already'));
      return;
    }
    const params = paramsFromSeed(factorySeed);
    addToCollection({
      seed: factorySeed,
      name: params.name,
      createdAt: Date.now(),
    });
    toast(t('factory.saved', { name: params.name }));
  });

  document.getElementById('btn-factory-equip')?.addEventListener('click', () => {
    if (!factorySeed) return;
    const params = paramsFromSeed(factorySeed);
    const save = loadSave();
    if (!save.collection.some((c) => c.seed === factorySeed)) {
      addToCollection({
        seed: factorySeed,
        name: params.name,
        createdAt: Date.now(),
      });
    }
    setEquippedSkin(factorySeed);
    onApplySkinLive?.(factorySeed);
    toast(t('factory.equipped', { name: params.name }));
  });
}

function applyLanguageFromSave(save: SaveData): void {
  const lang: Lang = isLang(save.language) ? save.language : 'es';
  setLang(lang);
  applyI18n(document);
  refreshLoadButton(loadSave());
  // Re-sync gallery apply labels if open
  syncApplyButtons();
  // Level lock sublabels
  const lockLevel = (id: string, unlocked: boolean) => {
    const el = document.getElementById(id);
    if (!el || unlocked) return;
    const sub = el.querySelector('.menu-sub');
    if (sub) sub.textContent = t('level.locked');
  };
  const s = loadSave();
  lockLevel('btn-level-2', s.unlockedLevels.includes(2));
  lockLevel('btn-level-3', s.unlockedLevels.includes(3));
  lockLevel('btn-level-4', s.unlockedLevels.includes(4));
  if (factorySeed) refreshFactoryPreview();
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
    closeGallery();
  };
  btn.addEventListener('click', close);
  gallery.addEventListener('click', (e) => {
    if (e.target === gallery) close(e);
  });

  for (const id of ['btn-gallery-apply-top', 'btn-gallery-apply-bottom']) {
    document.getElementById(id)?.addEventListener('click', onApplyOrCloseClick);
  }

  document.getElementById('btn-gallery-select-all')?.addEventListener('click', (e) => {
    e.preventDefault();
    const boxes = document.querySelectorAll<HTMLInputElement>(
      '#gallery-grid input.gallery-check',
    );
    const allOn = [...boxes].every((b) => b.checked);
    boxes.forEach((b) => {
      b.checked = !allOn;
    });
  });

  document.getElementById('btn-gallery-export')?.addEventListener('click', (e) => {
    e.preventDefault();
    const selected = selectedSeedsFromUI();
    if (selected.length === 0) {
      const all = loadSave().collection.map((c) => c.seed);
      if (!window.confirm(t('gallery.export.all.confirm'))) {
        return;
      }
      downloadCollection(all);
    } else {
      downloadCollection(selected);
    }
  });

  const importInput = document.getElementById(
    'gallery-import-file',
  ) as HTMLInputElement | null;
  document.getElementById('btn-gallery-import')?.addEventListener('click', (e) => {
    e.preventDefault();
    importInput?.click();
  });
  importInput?.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const { added, skipped, save } = importCollectionJSON(text);
      toast(t('gallery.imported', { added, skipped }));
      renderGallery(save);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('gallery.import.error'));
    }
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

/** Title sparkles + translucent ghost marbles over the art. */
function startTitleFX(): void {
  const wrap = document.getElementById('title-art-wrap');
  if (!wrap || wrap.dataset.fxReady === '1') return;
  wrap.dataset.fxReady = '1';

  const fx = document.createElement('div');
  fx.id = 'title-fx';
  fx.setAttribute('aria-hidden', 'true');
  wrap.appendChild(fx);

  // Sparkles
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span');
    s.className = 'title-sparkle';
    s.style.left = `${8 + Math.random() * 84}%`;
    s.style.top = `${5 + Math.random() * 55}%`;
    s.style.animationDelay = `${Math.random() * 3}s`;
    s.style.animationDuration = `${1.8 + Math.random() * 2.4}s`;
    fx.appendChild(s);
  }

  // Ghost marbles
  const colors = ['#4fc3f7', '#ce93d8', '#ef5350', '#66bb6a', '#ffd54f', '#eceff1', '#212121'];
  for (let i = 0; i < 7; i++) {
    const g = document.createElement('span');
    g.className = 'title-ghost-marble';
    g.style.setProperty('--gm-color', colors[i]!);
    g.style.left = `${10 + i * 12}%`;
    g.style.top = `${48 + (i % 3) * 8}%`;
    g.style.animationDelay = `${i * 0.55}s`;
    g.style.animationDuration = `${7 + (i % 4)}s`;
    fx.appendChild(g);
  }
}

/** Golden glitter confetti on victory overlay. */
export function startVictoryConfetti(): void {
  const overlay = document.getElementById('victory-overlay');
  if (!overlay) return;
  let layer = document.getElementById('victory-confetti');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'victory-confetti';
    layer.setAttribute('aria-hidden', 'true');
    overlay.appendChild(layer);
  }
  layer.innerHTML = '';
  const colors = ['#ffd700', '#ffe082', '#fff8e1', '#ffb300', '#ffecb3', '#ff8f00'];
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('span');
    p.className = 'victory-glitter';
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length]!;
    p.style.animationDelay = `${Math.random() * 2.5}s`;
    p.style.animationDuration = `${2.8 + Math.random() * 2.5}s`;
    p.style.width = `${4 + Math.random() * 6}px`;
    p.style.height = `${4 + Math.random() * 8}px`;
    layer.appendChild(p);
  }
}

export function stopVictoryConfetti(): void {
  const layer = document.getElementById('victory-confetti');
  if (layer) layer.innerHTML = '';
}

export function initTitleMenu(): void {
  const title = $('title-screen');
  const levelPick = $('level-pick');
  const gallery = $('gallery-overlay');
  const options = $('options-overlay');

  const save = loadSave();
  applyLanguageFromSave(save);
  refreshLoadButton(save);
  syncOptions(save);
  startTitleFX();
  wireFactory();

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
      toast(t('level.locked.toast', { n: 2, prev: 1 }));
      return;
    }
    navigateToLevel(2);
  });
  $('btn-level-3').addEventListener('click', () => {
    unlockMarbleAudio();
    const s = loadSave();
    if (!s.unlockedLevels.includes(3)) {
      toast(t('level.locked.toast', { n: 3, prev: 2 }));
      return;
    }
    navigateToLevel(3);
  });
  $('btn-level-4').addEventListener('click', () => {
    unlockMarbleAudio();
    const s = loadSave();
    if (!s.unlockedLevels.includes(4)) {
      toast(t('level.locked.toast', { n: 4, prev: 3 }));
      return;
    }
    navigateToLevel(4);
  });
  $('btn-level-pick-close').addEventListener('click', () => levelPick.classList.add('hidden'));

  $('btn-menu-load').addEventListener('click', () => {
    unlockMarbleAudio();
    const s = loadSave();
    if (s.matchSnapshot) {
      navigateToLevel(s.matchSnapshot.sceneLevel as SceneLevel, { load: true });
      return;
    }
    if (!hasSaveProgress() && s.unlockedLevels.length <= 1 && s.collection.length === 0) {
      toast(t('toast.no.save'));
      return;
    }
    const lvl = s.unlockedLevels.includes(4)
      ? 4
      : s.unlockedLevels.includes(3)
        ? 3
        : s.unlockedLevels.includes(2)
          ? 2
          : 1;
    navigateToLevel(lvl as SceneLevel);
  });

  $('btn-menu-multi').addEventListener('click', () => {
    toast(t('toast.multi'));
  });

  $('btn-menu-gallery').addEventListener('click', () => {
    unlockMarbleAudio();
    pendingSelectSeed = loadSave().equippedSkinSeed;
    justApplied = true; // already equipped → Cerrar
    renderGallery(loadSave());
    gallery.classList.remove('hidden');
    syncApplyButtons();
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
    toast(
      v === 'low'
        ? t('options.quality.toast.low')
        : v === 'high'
          ? t('options.quality.toast.high')
          : t('options.quality.toast.auto'),
    );
  });

  const langSel = document.getElementById('opt-language') as HTMLSelectElement | null;
  langSel?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (!isLang(v)) return;
    setLanguage(v);
    applyLanguageFromSave(loadSave());
  });

  const aimSel = document.getElementById('opt-aim-guide') as HTMLInputElement | null;
  aimSel?.addEventListener('change', (e) => {
    setAimGuide((e.target as HTMLInputElement).checked);
  });

  // Update lock badges
  const lockLevel = (id: string, unlocked: boolean) => {
    const el = $(id);
    if (!unlocked) {
      el.classList.add('locked');
      const sub = el.querySelector('.menu-sub');
      if (sub) sub.textContent = t('level.locked');
    }
  };
  lockLevel('btn-level-2', save.unlockedLevels.includes(2));
  lockLevel('btn-level-3', save.unlockedLevels.includes(3));
  lockLevel('btn-level-4', save.unlockedLevels.includes(4));

  title.classList.remove('hidden');
}

export function hideTitleMenu(): void {
  const title = document.getElementById('title-screen');
  title?.classList.add('hidden');
  document.getElementById('level-pick')?.classList.add('hidden');
  document.getElementById('gallery-overlay')?.classList.add('hidden');
  document.getElementById('options-overlay')?.classList.add('hidden');
  document.getElementById('factory-overlay')?.classList.add('hidden');
  document.getElementById('name-prompt')?.classList.add('hidden');
  factoryShowcase?.stop();
}

/** In-game access to gallery (e.g. from pause). */
export function openGalleryFromGame(): void {
  const gallery = document.getElementById('gallery-overlay');
  if (!gallery) return;
  ensureGalleryHandlers();
  pendingSelectSeed = loadSave().equippedSkinSeed;
  justApplied = true;
  renderGallery(loadSave());
  gallery.classList.remove('hidden');
  gallery.setAttribute('aria-hidden', 'false');
  syncApplyButtons();
}

export function applySaveAudio(): void {
  const s = loadSave();
  setMarbleAudioMuted(s.sfxMute);
  if (isLang(s.language)) setLang(s.language);
}

export { buildMenuHref, writeSave };
