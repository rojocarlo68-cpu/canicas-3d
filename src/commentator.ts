/**
 * Spontaneous Spanish sports-caster banners during play (Memo / Lalo).
 * Not shown on the title screen — Game only mounts when ?level= is set.
 */

export type CasterEvent =
  | 'drop'
  | 'hit'
  | 'knockout'
  | 'bigShot'
  | 'clutch'
  | 'endTurn'
  | 'win'
  | 'lose';

export type CasterSide = 'player' | 'ai';

const DISPLAY_MS = 2800;
const COOLDOWN_MIN_MS = 2800;
const COOLDOWN_MAX_MS = 4500;

const TAGS = ['Memo', 'Lalo'] as const;

const PHRASES: Record<CasterEvent, string[]> = {
  drop: [
    '¡Ahí van las canicas! ¡Lluvia de cristal!',
    '¡Se abre el maletín! ¡Que empiece el show!',
    '¡Suéltenlas! ¡El círculo se pone caliente!',
    '¡Caen como meteoritos! ¡Esto es TAMA!',
    '¡Boom! ¡Las canicas toman el campo!',
    '¡Arranca la fiesta! ¡Nadie parpadee!',
    '¡Desde arriba! ¡Preparados para el caos!',
    '¡El drop está listo! ¡A jugar se ha dicho!',
    '¡Miren esa cascada de mármol!',
    '¡Se llenó el círculo! ¡Qué nervios!',
    '¡Canicas en el aire! ¡Qué entrada!',
    '¡El maletín espía entrega el paquete!',
  ],
  hit: [
    '¡CLACK! ¡Eso sonó a choque de campeonato!',
    '¡Qué impactoooo! ¡Casi saltan chispas!',
    '¡Tremendo choque canica contra canica!',
    '¡Uff, qué campanazo de cristal!',
    '¡Eso fue un cañonazo de proximidad!',
    '¡Se escuchó en toda la tribuna!',
    '¡Choque de alto voltaje! ¡Brutal!',
    '¡Qué duelo! ¡Dos esferas a toda velocidad!',
    '¡Rebote de oro! ¡Qué contacto!',
    '¡Eso dejó temblando el círculo!',
    '¡Impacto de antología! ¡Memo se para!',
    '¡Como billar de lujo! ¡Qué golpe!',
    '¡Chispas, polvo y drama! ¡Me encanta!',
    '¡Ese choque merecía cámara lenta!',
    '¡Canica contra canica… y gana la física!',
  ],
  knockout: [
    '¡FUERA DEL CÍRCULO! ¡Qué despedida!',
    '¡La sacó del mapa! ¡Knockout limpio!',
    '¡Adiós canica! ¡Viaje de ida!',
    '¡Expulsada! ¡El círculo no perdona!',
    '¡Se fue volando! ¡Golazo de mármol!',
    '¡A la grada virtual! ¡Qué precisión!',
    '¡Knockout confirmado! ¡El marcador late!',
    '¡Esa salió con visa de turista!',
    '¡Directo al exilio! ¡Qué tiro!',
    '¡Se abrió la puerta y… ¡afuera!',
    '¡Canica libre… pero fuera del juego!',
    '¡Qué limpieza! ¡Sacada de antología!',
    '¡El círculo dice: ¡NO PASAS!',
    '¡Boom y fuera! ¡Esto es deporte puro!',
    '¡Una menos adentro! ¡La emoción sube!',
    '¡Esa salida merece ovación de pie!',
  ],
  bigShot: [
    '¡CAÑONAZO! ¡Esa potencia asusta!',
    '¡Tiro de campeonato! ¡Full power!',
    '¡La mandó con todo! ¡Sin miedo!',
    '¡Qué disparo! ¡Se oye el viento!',
    '¡Potencia máxima! ¡Esto es guerra!',
    '¡Tiro de elite! ¡Apunten y… ¡fuego!',
    '¡Esa sale con visa express!',
    '¡Misil de canica! ¡Cubran el círculo!',
    '¡Qué descarga! ¡Lalo no puede creer!',
    '¡Full draw! ¡Eso duele si te toca!',
    '¡Tiro de autor! ¡Firma y fecha!',
    '¡La empujó como locomotora!',
    '¡Qué impulso! ¡Física en modo fiesta!',
    '¡Disparo de alto riesgo y alta recompensa!',
  ],
  clutch: [
    '¡Partido ajustadísimo! ¡Cada canica vale oro!',
    '¡Momento clutch! ¡El círculo no perdona!',
    '¡Quedan pocas… ¡nervios de acero!',
    '¡Esto se decide en un tiro! ¡Qué tensión!',
    '¡El marcador aprieta! ¡Nadie respira!',
    '¡Últimas fichas en el tablero! ¡Drama puro!',
    '¡Situación de campeonato! ¡Concentración total!',
    '¡Uno contra uno en el alma del círculo!',
  ],
  endTurn: [
    '¡Se detiene el polvo! ¡Cambio de turno!',
    '¡Respiro… y ahora le toca al rival!',
    '¡Fin de la jugada! ¡Qué secuencia!',
    '¡Todo quieto… ¡pero la tensión sigue!',
    '¡Turno cerrado! ¡El círculo espera!',
    '¡Se acabó la corrida! ¡Siguiente acto!',
    '¡Pausa dramática! ¿Quién responde?',
    '¡Las canicas respiran… el público no!',
    '¡Jugada lista! ¡A recalcular estrategia!',
    '¡Cortina… y entra el siguiente tirador!',
    '¡Qué ronda! ¡Esto no se puede perder!',
  ],
  win: [
    '¡VICTORIA! ¡El jugador se lleva la noche!',
    '¡Campeón del círculo! ¡Qué cierre!',
    '¡Gana el humano! ¡Memo pierde la voz!',
    '¡Triunfo total! ¡Canicas y gloria!',
  ],
  lose: [
    '¡El rival se lleva el botín! ¡Qué pelea!',
    '¡Derrota amarga… pero qué partido!',
    '¡Hoy gana el oponente! ¡Revancha segura!',
    '¡Se escapó la victoria! ¡Qué drama!',
  ],
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randCooldown(): number {
  return COOLDOWN_MIN_MS + Math.random() * (COOLDOWN_MAX_MS - COOLDOWN_MIN_MS);
}

export class SportsCommentator {
  private readonly el: HTMLElement;
  private readonly tagEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private readyAt = 0;
  private tagIndex = Math.random() < 0.5 ? 0 : 1;
  private lastPhrase = '';
  private enabled = true;

  constructor(el: HTMLElement) {
    this.el = el;
    let tag = el.querySelector('.caster-tag') as HTMLElement | null;
    let text = el.querySelector('.caster-text') as HTMLElement | null;
    if (!tag || !text) {
      el.innerHTML =
        '<span class="caster-tag"></span><span class="caster-text"></span>';
      tag = el.querySelector('.caster-tag') as HTMLElement;
      text = el.querySelector('.caster-text') as HTMLElement;
    }
    this.tagEl = tag;
    this.textEl = text;
    this.el.classList.add('hidden');
    this.el.setAttribute('aria-live', 'polite');
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.hide();
  }

  /** Fire a spontaneous line if cooldown allows (or force). */
  say(
    event: CasterEvent,
    opts?: { side?: CasterSide; force?: boolean; preferLower?: boolean },
  ): boolean {
    if (!this.enabled) return false;
    const now = performance.now();
    const force = opts?.force === true;
    // Big moments get a softer gate so they land more often
    const softGate =
      event === 'knockout' ||
      event === 'win' ||
      event === 'lose' ||
      event === 'drop' ||
      event === 'clutch'
        ? this.readyAt - 1600
        : this.readyAt;
    if (!force && now < softGate) return false;

    const pool = PHRASES[event];
    let phrase = pick(pool);
    if (pool.length > 1) {
      let guard = 0;
      while (phrase === this.lastPhrase && guard++ < 6) {
        phrase = pick(pool);
      }
    }
    this.lastPhrase = phrase;

    const tag = TAGS[this.tagIndex % TAGS.length]!;
    this.tagIndex += 1;

    this.tagEl.textContent = `${tag}:`;
    this.textEl.textContent = phrase;

    // Prefer top during aim so lower HUD / finger aim stays clear
    const useLower =
      opts?.preferLower === true
        ? true
        : opts?.preferLower === false
          ? false
          : Math.random() < 0.35;
    this.el.classList.toggle('caster-lower', useLower);
    this.el.classList.toggle('caster-top', !useLower);
    this.el.classList.toggle('caster-player', opts?.side === 'player');
    this.el.classList.toggle('caster-ai', opts?.side === 'ai');
    this.el.classList.remove('hidden', 'caster-out');
    void this.el.offsetWidth;
    this.el.classList.add('caster-in');

    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), DISPLAY_MS);

    this.readyAt = now + randCooldown();
    return true;
  }

  hide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.el.classList.remove('caster-in');
    this.el.classList.add('hidden');
  }

  dispose(): void {
    this.hide();
  }
}
