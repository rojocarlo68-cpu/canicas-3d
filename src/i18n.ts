/** Lightweight i18n for TAMA Project UI. */

export type Lang = 'es' | 'en' | 'ja' | 'zh';

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'zh', label: '中文' },
];

type Dict = Record<string, string>;

const es: Dict = {
  'menu.new': 'Nueva partida',
  'menu.new.sub': 'New Game',
  'menu.load': 'Cargar',
  'menu.load.sub': 'Continuar',
  'menu.load.empty': 'Sin partida',
  'menu.multi': 'Multijugador',
  'menu.multi.sub': 'Próximamente',
  'menu.gallery': 'Galería',
  'menu.gallery.sub': 'Colección',
  'menu.factory': 'Fábrica de canicas',
  'menu.factory.sub': 'Crear',
  'menu.options': 'Opciones',
  'menu.options.sub': 'Options',

  'level.pick': 'Elegir nivel',
  'level.1': 'Nivel 1 · Parque',
  'level.1.sub': 'Park',
  'level.2': 'Nivel 2 · Campamento',
  'level.2.sub': 'Desert camp',
  'level.3': 'Nivel 3 · Consultorio',
  'level.3.sub': 'Dentist cuspidor',
  'level.4': 'Nivel 4 · Escritorio',
  'level.4.sub': 'Mahogany desk',
  'level.locked': 'Bloqueado',
  'level.locked.toast': 'Nivel {n} bloqueado — gana el Nivel {prev}',
  'level.label': 'Nivel {n}',

  'gallery.title': 'Galería',
  'gallery.hint':
    'Elige una canica → Aplicar cambia solo la piel del tirador. Casillas + Exportar/Importar (.tama-collection.json). Colab protegida.',
  'gallery.apply': 'Aplicar',
  'gallery.close': 'Cerrar',
  'gallery.selectAll': 'Seleccionar todas',
  'gallery.export': 'Exportar',
  'gallery.import': 'Importar',
  'gallery.empty':
    'Aún no tienes canicas únicas. Gana un nivel para abrir el maletín gacha.',
  'gallery.equipped': 'Equipada',
  'gallery.chosen': 'Elegida',
  'gallery.choose': 'Elegir',
  'gallery.collab': 'Colab',
  'gallery.applied': 'Aplicada: {name}',
  'gallery.deleted': 'Eliminada: {name}',
  'gallery.delete.confirm':
    '¿Eliminar «{name}» de la colección?\nEsta acción no se puede deshacer.',
  'gallery.export.all.confirm':
    'No hay casillas marcadas. ¿Exportar toda la colección?',
  'gallery.exported': 'Exportado · .tama-collection.json',
  'gallery.imported': 'Importadas {added} · omitidas {skipped}',
  'gallery.import.error': 'Error al importar',

  'options.title': 'Opciones',
  'options.mute': 'Silenciar SFX',
  'options.quality': 'Calidad',
  'options.quality.auto': 'Auto',
  'options.quality.high': 'Alta',
  'options.quality.low': 'Baja',
  'options.language': 'Idioma',
  'options.aimGuide': 'Guía de apuntado',
  'options.quality.toast.low': 'Calidad baja',
  'options.quality.toast.high': 'Calidad alta',
  'options.quality.toast.auto': 'Calidad automática',

  'factory.title': 'Fábrica de canicas',
  'factory.generate': 'Generar',
  'factory.save': 'Guardar en colección',
  'factory.equip': 'Equipar',
  'factory.close': 'Cerrar',
  'factory.saved': 'Guardada: {name}',
  'factory.already': 'Ya está en tu colección',
  'factory.equipped': 'Equipada: {name}',
  'factory.style': 'Estilo: {style}',

  'name.title': 'Tu nombre',
  'name.hint': '¿Cómo te llamamos en el marcador?',
  'name.label': 'Nombre',
  'name.cancel': 'Cancelar',
  'name.ok': 'OK',

  'pause.title': 'Pausa',
  'pause.body': 'El juego está en pausa.',
  'pause.save': 'Guardar',
  'pause.load': 'Cargar',
  'pause.gallery': 'Galería',
  'pause.menu': 'Menú título',

  'hud.turn.player': 'Turno: {name}',
  'hud.instructions.aim':
    'Orbitar · Zoom · En tu turno: arrastra sobre tu canica para disparar',
  'hud.power': 'Potencia',
  'hud.personalize': 'Personalizar',
  'hud.playmat': 'Playmat',
  'hud.upload': 'Subir imagen',
  'hud.close': 'Cerrar',
  'hud.here': 'Tu canica está aquí',
  'hud.replay': '▶ Repetición',
  'hud.settle': 'Esperando a que se detengan las canicas…',
  'hud.falling': 'Canicas cayendo…',
  'hud.opp.turn': 'Turno de {name}…',
  'hud.exit': 'Salir',
  'hud.vel': 'Vel',

  'end.victory': '¡Victoria!',
  'end.defeat': 'Derrota',
  'end.draw': 'Empate',
  'end.replay': 'Jugar de nuevo',
  'end.replay.btn': 'Repetición',
  'end.continue.n': 'Continuar · Nivel {n}',
  'end.menu': 'Menú título',

  'victory.title': 'VICTORIA',
  'victory.winner': '¡Ganaste el partido!',
  'victory.menu': 'Menú',
  'victory.continue': 'Continuar',

  'gacha.status.gen': 'Generando canica única…',
  'gacha.status.open': 'Abriendo maletín…',
  'gacha.sub': 'Añadida a tu colección · puedes equiparla en Galería',
  'gacha.continue': 'Continuar',

  'toast.multi': 'Multijugador — Próximamente',
  'toast.no.save': 'No hay partida guardada',

  'l4.close': 'Cerrar',

  'style.swirl': 'Remolino',
  'style.galaxy': 'Galaxia',
  'style.cat': 'Ojo de gato',
  'style.solid': 'Sólido',
  'style.bands': 'Bandas',
  'style.nebula': 'Nebulosa',
  'style.oilslick': 'Mancha de aceite',
  'style.crackle': 'Grieta / foil',
  'style.mist': 'Niebla',
  'style.lattice': 'Celosía',
  'style.pearl': 'Perla',
  'style.lava': 'Lava',
  'style.ice': 'Hielo',
};

const en: Dict = {
  'menu.new': 'New Game',
  'menu.new.sub': 'Nueva partida',
  'menu.load': 'Load',
  'menu.load.sub': 'Continue',
  'menu.load.empty': 'No save',
  'menu.multi': 'Multiplayer',
  'menu.multi.sub': 'Coming soon',
  'menu.gallery': 'Gallery',
  'menu.gallery.sub': 'Collection',
  'menu.factory': 'Marble Factory',
  'menu.factory.sub': 'Create',
  'menu.options': 'Options',
  'menu.options.sub': 'Opciones',

  'level.pick': 'Choose level',
  'level.1': 'Level 1 · Park',
  'level.1.sub': 'Parque',
  'level.2': 'Level 2 · Camp',
  'level.2.sub': 'Campamento',
  'level.3': 'Level 3 · Clinic',
  'level.3.sub': 'Consultorio',
  'level.4': 'Level 4 · Desk',
  'level.4.sub': 'Escritorio',
  'level.locked': 'Locked',
  'level.locked.toast': 'Level {n} locked — win Level {prev}',
  'level.label': 'Level {n}',

  'gallery.title': 'Gallery',
  'gallery.hint':
    'Pick a marble → Apply changes only the shooter skin. Checkboxes + Export/Import (.tama-collection.json). Collab protected.',
  'gallery.apply': 'Apply',
  'gallery.close': 'Close',
  'gallery.selectAll': 'Select all',
  'gallery.export': 'Export',
  'gallery.import': 'Import',
  'gallery.empty':
    'No unique marbles yet. Win a level to open the gacha case.',
  'gallery.equipped': 'Equipped',
  'gallery.chosen': 'Selected',
  'gallery.choose': 'Choose',
  'gallery.collab': 'Collab',
  'gallery.applied': 'Applied: {name}',
  'gallery.deleted': 'Removed: {name}',
  'gallery.delete.confirm':
    'Remove “{name}” from the collection?\nThis cannot be undone.',
  'gallery.export.all.confirm':
    'No boxes checked. Export the whole collection?',
  'gallery.exported': 'Exported · .tama-collection.json',
  'gallery.imported': 'Imported {added} · skipped {skipped}',
  'gallery.import.error': 'Import error',

  'options.title': 'Options',
  'options.mute': 'Mute SFX',
  'options.quality': 'Quality',
  'options.quality.auto': 'Auto',
  'options.quality.high': 'High',
  'options.quality.low': 'Low',
  'options.language': 'Language',
  'options.aimGuide': 'Aim guide',
  'options.quality.toast.low': 'Low quality',
  'options.quality.toast.high': 'High quality',
  'options.quality.toast.auto': 'Auto quality',

  'factory.title': 'Marble Factory',
  'factory.generate': 'Generate',
  'factory.save': 'Save to collection',
  'factory.equip': 'Equip',
  'factory.close': 'Close',
  'factory.saved': 'Saved: {name}',
  'factory.already': 'Already in your collection',
  'factory.equipped': 'Equipped: {name}',
  'factory.style': 'Style: {style}',

  'name.title': 'Your name',
  'name.hint': 'What should we call you on the scoreboard?',
  'name.label': 'Name',
  'name.cancel': 'Cancel',
  'name.ok': 'OK',

  'pause.title': 'Paused',
  'pause.body': 'The game is paused.',
  'pause.save': 'Save',
  'pause.load': 'Load',
  'pause.gallery': 'Gallery',
  'pause.menu': 'Title menu',

  'hud.turn.player': 'Turn: {name}',
  'hud.instructions.aim':
    'Orbit · Zoom · On your turn: drag on your marble to shoot',
  'hud.power': 'Power',
  'hud.personalize': 'Customize',
  'hud.playmat': 'Playmat',
  'hud.upload': 'Upload image',
  'hud.close': 'Close',
  'hud.here': 'Your marble is here',
  'hud.replay': '▶ Replay',
  'hud.settle': 'Waiting for marbles to stop…',
  'hud.falling': 'Marbles falling…',
  'hud.opp.turn': "{name}'s turn…",
  'hud.exit': 'Exit',
  'hud.vel': 'Spd',

  'end.victory': 'Victory!',
  'end.defeat': 'Defeat',
  'end.draw': 'Draw',
  'end.replay': 'Play again',
  'end.replay.btn': 'Replay',
  'end.continue.n': 'Continue · Level {n}',
  'end.menu': 'Title menu',

  'victory.title': 'VICTORY',
  'victory.winner': 'You won the match!',
  'victory.menu': 'Menu',
  'victory.continue': 'Continue',

  'gacha.status.gen': 'Generating unique marble…',
  'gacha.status.open': 'Opening case…',
  'gacha.sub': 'Added to your collection · equip it in Gallery',
  'gacha.continue': 'Continue',

  'toast.multi': 'Multiplayer — Coming soon',
  'toast.no.save': 'No saved game',

  'l4.close': 'Close',

  'style.swirl': 'Swirl',
  'style.galaxy': 'Galaxy',
  'style.cat': 'Cat’s eye',
  'style.solid': 'Solid',
  'style.bands': 'Bands',
  'style.nebula': 'Nebula',
  'style.oilslick': 'Oil slick',
  'style.crackle': 'Crackle / foil',
  'style.mist': 'Mist',
  'style.lattice': 'Lattice',
  'style.pearl': 'Pearl',
  'style.lava': 'Lava',
  'style.ice': 'Ice',
};

const ja: Dict = {
  'menu.new': '新しいゲーム',
  'menu.new.sub': 'New Game',
  'menu.load': 'ロード',
  'menu.load.sub': '続ける',
  'menu.load.empty': 'セーブなし',
  'menu.multi': 'マルチプレイ',
  'menu.multi.sub': '近日公開',
  'menu.gallery': 'ギャラリー',
  'menu.gallery.sub': 'コレクション',
  'menu.factory': 'ビー玉工房',
  'menu.factory.sub': '作成',
  'menu.options': 'オプション',
  'menu.options.sub': '設定',

  'level.pick': 'レベル選択',
  'level.1': 'レベル1 · 公園',
  'level.1.sub': 'Park',
  'level.2': 'レベル2 · キャンプ',
  'level.2.sub': 'Desert camp',
  'level.3': 'レベル3 · 歯科',
  'level.3.sub': 'Clinic',
  'level.4': 'レベル4 · デスク',
  'level.4.sub': 'Desk',
  'level.locked': 'ロック中',
  'level.locked.toast': 'レベル{n}はロック中 — レベル{prev}に勝利してください',
  'level.label': 'レベル {n}',

  'gallery.title': 'ギャラリー',
  'gallery.hint':
    'ビー玉を選ぶ →「適用」で射手の見た目のみ変更。チェック＋書出/読込（.tama-collection.json）。コラボは削除不可。',
  'gallery.apply': '適用',
  'gallery.close': '閉じる',
  'gallery.selectAll': 'すべて選択',
  'gallery.export': '書き出し',
  'gallery.import': '読み込み',
  'gallery.empty':
    'ユニークなビー玉はまだありません。レベルに勝ってガチャを開けましょう。',
  'gallery.equipped': '装備中',
  'gallery.chosen': '選択中',
  'gallery.choose': '選ぶ',
  'gallery.collab': 'コラボ',
  'gallery.applied': '適用：{name}',
  'gallery.deleted': '削除：{name}',
  'gallery.delete.confirm':
    '「{name}」をコレクションから削除しますか？\n元に戻せません。',
  'gallery.export.all.confirm':
    'チェックがありません。コレクション全体を書き出しますか？',
  'gallery.exported': '書き出し完了 · .tama-collection.json',
  'gallery.imported': '追加 {added} · スキップ {skipped}',
  'gallery.import.error': '読み込みエラー',

  'options.title': 'オプション',
  'options.mute': '効果音を消す',
  'options.quality': '画質',
  'options.quality.auto': '自動',
  'options.quality.high': '高',
  'options.quality.low': '低',
  'options.language': '言語',
  'options.aimGuide': '照準ガイド',
  'options.quality.toast.low': '低画質',
  'options.quality.toast.high': '高画質',
  'options.quality.toast.auto': '自動画質',

  'factory.title': 'ビー玉工房',
  'factory.generate': '生成',
  'factory.save': 'コレクションに保存',
  'factory.equip': '装備',
  'factory.close': '閉じる',
  'factory.saved': '保存：{name}',
  'factory.already': 'すでにコレクションにあります',
  'factory.equipped': '装備：{name}',
  'factory.style': 'スタイル：{style}',

  'name.title': '名前',
  'name.hint': 'スコアボードに表示する名前は？',
  'name.label': '名前',
  'name.cancel': 'キャンセル',
  'name.ok': 'OK',

  'pause.title': '一時停止',
  'pause.body': 'ゲームを一時停止中です。',
  'pause.save': 'セーブ',
  'pause.load': 'ロード',
  'pause.gallery': 'ギャラリー',
  'pause.menu': 'タイトルへ',

  'hud.turn.player': 'ターン：{name}',
  'hud.instructions.aim':
    '軌道・ズーム · 自分の番：ビー玉をドラッグして撃つ',
  'hud.power': 'パワー',
  'hud.personalize': 'カスタム',
  'hud.playmat': 'プレイマット',
  'hud.upload': '画像をアップロード',
  'hud.close': '閉じる',
  'hud.here': 'ビー玉はここ',
  'hud.replay': '▶ リプレイ',
  'hud.settle': 'ビー玉が止まるまで待機…',
  'hud.falling': 'ビー玉落下中…',
  'hud.opp.turn': '{name}の番…',
  'hud.exit': '終了',
  'hud.vel': '速度',

  'end.victory': '勝利！',
  'end.defeat': '敗北',
  'end.draw': '引き分け',
  'end.replay': 'もう一度',
  'end.replay.btn': 'リプレイ',
  'end.continue.n': '続ける · レベル {n}',
  'end.menu': 'タイトルへ',

  'victory.title': '勝利',
  'victory.winner': '試合に勝ちました！',
  'victory.menu': 'メニュー',
  'victory.continue': '続ける',

  'gacha.status.gen': 'ユニークなビー玉を生成中…',
  'gacha.status.open': 'ケースを開いています…',
  'gacha.sub': 'コレクションに追加 · ギャラリーで装備できます',
  'gacha.continue': '続ける',

  'toast.multi': 'マルチプレイ — 近日公開',
  'toast.no.save': 'セーブがありません',

  'l4.close': '閉じる',

  'style.swirl': '渦巻き',
  'style.galaxy': '銀河',
  'style.cat': '猫目',
  'style.solid': 'ソリッド',
  'style.bands': 'バンド',
  'style.nebula': '星雲',
  'style.oilslick': 'オイルスリック',
  'style.crackle': 'ひび／箔',
  'style.mist': '霧',
  'style.lattice': '格子',
  'style.pearl': 'パール',
  'style.lava': '溶岩',
  'style.ice': '氷',
};

const zh: Dict = {
  'menu.new': '新游戏',
  'menu.new.sub': 'New Game',
  'menu.load': '读取',
  'menu.load.sub': '继续',
  'menu.load.empty': '无存档',
  'menu.multi': '多人游戏',
  'menu.multi.sub': '即将推出',
  'menu.gallery': '图鉴',
  'menu.gallery.sub': '收藏',
  'menu.factory': '弹珠工坊',
  'menu.factory.sub': '创造',
  'menu.options': '选项',
  'menu.options.sub': '设置',

  'level.pick': '选择关卡',
  'level.1': '第1关 · 公园',
  'level.1.sub': 'Park',
  'level.2': '第2关 · 营地',
  'level.2.sub': 'Desert camp',
  'level.3': '第3关 · 诊室',
  'level.3.sub': 'Clinic',
  'level.4': '第4关 · 书桌',
  'level.4.sub': 'Desk',
  'level.locked': '未解锁',
  'level.locked.toast': '第{n}关未解锁 — 请先通关第{prev}关',
  'level.label': '第 {n} 关',

  'gallery.title': '图鉴',
  'gallery.hint':
    '选择弹珠 →「应用」只更换射手外观。勾选＋导出/导入（.tama-collection.json）。合作款受保护。',
  'gallery.apply': '应用',
  'gallery.close': '关闭',
  'gallery.selectAll': '全选',
  'gallery.export': '导出',
  'gallery.import': '导入',
  'gallery.empty': '还没有独特弹珠。通关后可打开扭蛋箱。',
  'gallery.equipped': '已装备',
  'gallery.chosen': '已选',
  'gallery.choose': '选择',
  'gallery.collab': '合作',
  'gallery.applied': '已应用：{name}',
  'gallery.deleted': '已删除：{name}',
  'gallery.delete.confirm': '要从收藏中删除「{name}」吗？\n此操作无法撤销。',
  'gallery.export.all.confirm': '未勾选任何项。要导出全部收藏吗？',
  'gallery.exported': '已导出 · .tama-collection.json',
  'gallery.imported': '已导入 {added} · 跳过 {skipped}',
  'gallery.import.error': '导入错误',

  'options.title': '选项',
  'options.mute': '静音音效',
  'options.quality': '画质',
  'options.quality.auto': '自动',
  'options.quality.high': '高',
  'options.quality.low': '低',
  'options.language': '语言',
  'options.aimGuide': '瞄准辅助线',
  'options.quality.toast.low': '低画质',
  'options.quality.toast.high': '高画质',
  'options.quality.toast.auto': '自动画质',

  'factory.title': '弹珠工坊',
  'factory.generate': '生成',
  'factory.save': '保存到收藏',
  'factory.equip': '装备',
  'factory.close': '关闭',
  'factory.saved': '已保存：{name}',
  'factory.already': '已在收藏中',
  'factory.equipped': '已装备：{name}',
  'factory.style': '风格：{style}',

  'name.title': '你的名字',
  'name.hint': '记分板上怎么称呼你？',
  'name.label': '名字',
  'name.cancel': '取消',
  'name.ok': '确定',

  'pause.title': '暂停',
  'pause.body': '游戏已暂停。',
  'pause.save': '保存',
  'pause.load': '读取',
  'pause.gallery': '图鉴',
  'pause.menu': '标题菜单',

  'hud.turn.player': '回合：{name}',
  'hud.instructions.aim': '旋转 · 缩放 · 轮到你时：拖拽弹珠射击',
  'hud.power': '力度',
  'hud.personalize': '自定义',
  'hud.playmat': '垫布',
  'hud.upload': '上传图片',
  'hud.close': '关闭',
  'hud.here': '你的弹珠在这里',
  'hud.replay': '▶ 回放',
  'hud.settle': '等待弹珠停下…',
  'hud.falling': '弹珠下落中…',
  'hud.opp.turn': '{name}的回合…',
  'hud.exit': '退出',
  'hud.vel': '速度',

  'end.victory': '胜利！',
  'end.defeat': '失败',
  'end.draw': '平局',
  'end.replay': '再玩一次',
  'end.replay.btn': '回放',
  'end.continue.n': '继续 · 第 {n} 关',
  'end.menu': '标题菜单',

  'victory.title': '胜利',
  'victory.winner': '你赢了这场比赛！',
  'victory.menu': '菜单',
  'victory.continue': '继续',

  'gacha.status.gen': '正在生成独特弹珠…',
  'gacha.status.open': '正在打开箱子…',
  'gacha.sub': '已加入收藏 · 可在图鉴中装备',
  'gacha.continue': '继续',

  'toast.multi': '多人游戏 — 即将推出',
  'toast.no.save': '没有存档',

  'l4.close': '关闭',

  'style.swirl': '漩涡',
  'style.galaxy': '星系',
  'style.cat': '猫眼',
  'style.solid': '纯色',
  'style.bands': '条纹',
  'style.nebula': '星云',
  'style.oilslick': '油膜',
  'style.crackle': '裂纹/箔',
  'style.mist': '薄雾',
  'style.lattice': '网格',
  'style.pearl': '珍珠',
  'style.lava': '熔岩',
  'style.ice': '冰晶',
};

const TABLES: Record<Lang, Dict> = { es, en, ja, zh };

let current: Lang = 'es';

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (TABLES[lang]) current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang =
      lang === 'zh' ? 'zh-Hans' : lang === 'ja' ? 'ja' : lang;
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const table = TABLES[current] || es;
  let s = table[key] ?? es[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/** Apply data-i18n / data-i18n-html / data-i18n-title / data-i18n-aria / data-i18n-sub to DOM. */
export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    el.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (!key) return;
    el.innerHTML = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (!key) return;
    el.title = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    if (!key) return;
    el.setAttribute('aria-label', t(key));
  });
  // menu-sub siblings: button has data-i18n on .menu-label and data-i18n-sub on .menu-sub
  root.querySelectorAll<HTMLElement>('[data-i18n-sub]').forEach((el) => {
    const key = el.getAttribute('data-i18n-sub');
    if (!key) return;
    el.textContent = t(key);
  });
  // <option data-i18n>
  root.querySelectorAll<HTMLOptionElement>('option[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    el.textContent = t(key);
  });
}

export function isLang(v: unknown): v is Lang {
  return v === 'es' || v === 'en' || v === 'ja' || v === 'zh';
}
