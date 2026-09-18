# TAMA Project

Canicas 3D rebranded as **TAMA Project**: title screen, spy-briefcase dropper, victory gacha / collection, localStorage save, desktop RMB orbit while aiming.



Juego de canicas en 3D: **Jugador vs IA**, física con cannon-es, cámara táctil y repetición.




## URLs (GitHub Pages)

- Title / menú: https://rojocarlo68-cpu.github.io/canicas-3d/
- Nivel 1: https://rojocarlo68-cpu.github.io/canicas-3d/?level=1
- Nivel 2: https://rojocarlo68-cpu.github.io/canicas-3d/?level=2
- Nivel 3: https://rojocarlo68-cpu.github.io/canicas-3d/?level=3

### Controles (PC)

| Acción | Entrada |
|--------|---------|
| Apuntar / flick | LMB en tu canica + arrastrar; suelta para tirar |
| Órbita mientras apuntas | **RMB arrastra** (mismo rol que el 2º dedo en móvil) |
| Órbita normal | LMB en espacio vacío / RMB |
| Zoom | Rueda / pellizca |
| Soltar canicas | Botón maletín (Drop) |

### Gacha / colección

Al ganar un nivel se abre un maletín con VFX eléctrico; se genera una canica única (seed procedural) que entra en la **Galería**. Desde Galería puedes equiparla como piel del tirador. Progreso en `localStorage` (niveles, colección, skin, mute).


## Escenas / niveles de mapa

- **Nivel 1 (Parque):** `?level=1` — parque día/noche (ciclo 30 min).
- **Nivel 2 (Campamento):** `?level=2` — desierto de noche con fogata, montañas y círculo imperfecto en arena.
- **Nivel 3 (Consultorio):** `?level=3` — dentist office; play vessel = white cuspidor/spit bowl. After drop settle, center opens as a hole. Score = field marbles into the hole. Personal marble into hole or out of bowl = lose that marble / match. AI skill L1 < L2 < L3.

### Canica colaboración
**Lazo Marblus–Carlo** — en la Galería por defecto (equipable). Diseño: doble hélice cian (Marblus) + ámbar (Carlo) fusionadas en vidrio.

Ejemplos:

- https://rojocarlo68-cpu.github.io/canicas-3d/?control=flick&level=1
- https://rojocarlo68-cpu.github.io/canicas-3d/?control=flick&level=2
- https://rojocarlo68-cpu.github.io/canicas-3d/?control=flick&level=3

## HUD / física (2026-09-17)

- Botones de imagen premium: Soltar, Repetición, Reiniciar, Pausa (`public/ui/`).
- Eliminado el badge Flick/Empuje y enlaces Parque/Campamento (usa `?control=` y `?level=`).
- Colliders sólidos en rocas, anillo de piedras y asientos del campamento (L2); llamas no sólidas.
- Sonidos de choque canica–canica (WebAudio procedural, ~3 variantes).


## Fixes (2026-09-17 evening)

1. **AI / field sink under floor:** Root cause — tiny spheres at cañonazo speeds tunneling a thin Cannon plane, worsened on L2 by rock colliders buried deep under the sand (wedge into the ground box). Thick ground box at `PLAY_SURFACE_Y`, per-frame Y clamp + `previousPosition` rewind, mesh floor sync, camp rocks lifted mostly above the pad.
2. **Title neon:** Diamond streak / gold shimmer removed; cyan neon glow letters (`neon-text`).
3. **Marble clacks:** AudioContext unlock on first gesture; resume-then-play (no silent skip); louder ~3 glass variants.
4. **Commentators:** Spanish Memo/Lalo toast banners on drop, strong hits, knockouts, big shots, clutch, end-turn, win/lose.

## Fixes (2026-09-17)

1. **Cámara lenta:** follows the relevant marble for the whole slow-mo window; on exit, meshes snap to bodies and Y is corrected so marbles are not half-buried.
2. **Indicator arrow:** points **down** at the marble.
3. **Park life:** removed fake person silhouettes (birds kept).
4. **Drop freeze:** 5 s after drop, all field marbles fully stop in place.
5. **Scoring:** only knockouts during a player/opponent shot count; marbles that leave during the initial drop do not score. Scoring set = still in circle after the freeze.
6. **Aim:** impulse uses camera forward projected on the ground (orbit aim while charging), so a centered/straight shot goes toward what you see ahead.
7. **Controles flick/push:** el tiro solo empieza al tocar la canica del jugador (radio visual × ~1.4). Arrastrar en vacío = órbita/zoom. Empuje usa velocidad del dedo en el plano del suelo + spin de rodadura.
8. **Multi-touch flick:** dedo en canica = apuntar; segundo dedo fuera = órbita (OrbitControls sigue activo; solo se captura el pointerId de mira).
9. **Calibración de mira:** dirección del impulso = vector suelo canica→dedo (misma que la línea); `applyImpulse` en el COM (antes `body.position` torcía el tiro).
10. **Empuje más ágil:** `PUSH_VELOCITY_GAIN` 1.45, `PUSH_MAX_SPEED` 2.25 m/s; velocidad por muestras recientes en plano suelo (pico + promedio).
11. **Punch-in de cámara al sacar:** al contar un knockout, la cámara acerca a esa canica (ease-in + hold) y **libera el encuadre ahí** — ya no vuelve obligatoriamente a la canica del jugador/shooter.
12. **Cámara director en turno IA:** mientras la IA tira / hay movimiento, la cámara actúa como director de TV deportiva (low chase, high wide, side track, cluster, punch-ins en impactos); el sujeto es el tirador IA activo o la acción más caliente (preparado para varias IAs).
13. **Repetición:** sigue la canica del jugador como *target* de órbita; **arrastra para orbitar** y **pellizca para zoom**; scrub/velocidad siguen disponibles.
14. **Superficie:** física + dirt pad + `MARBLE_REST_Y` alineados (tiny bias) — las canicas reposan al ras del dirt sin flotar.

## Stack

- [Vite](https://vitejs.dev/) + TypeScript
- [Three.js](https://threejs.org/) (render, OrbitControls, Sky)
- [cannon-es](https://github.com/pmndrs/cannon-es) (física)

**Escala:** `1` unidad = `1` metro. Radio de canica ≈ `0.008` m. Círculo de juego = **0.32 m** (2×). Altura de soltado = **0.10 m** (10 cm).

Despliegue GitHub Pages con `base: '/canicas-3d/'`.

## Cómo ejecutar

```bash
cd canicas-3d
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Cómo jugar

1. Pulsa el botón de **soltar canicas** (icono) (caen desde ~10 cm).
2. Turnos alternos **Jugador ↔ IA**. Cada uno tiene su propia canica tiradora que **permanece donde se detiene**.
3. **Jugador:** mantén el botón de tu canica (abajo derecha). Mientras mantienes:
   - Desliza **arriba** → más **Potencia**
   - Desliza **abajo** → menos **Potencia**
   - Desliza **horizontal** → apunta
   - **Suelta** → dispara con la potencia actual  
   Controles de tiro desactivados en turno de la IA.
4. **IA:** apunta a cúmulos o canicas cerca del borde; la dificultad sube con el **Nivel**.
5. Marcador: canicas de campo sacadas del círculo por cada lado. Gana quien tenga más cuando no quede ninguna dentro.
6. Al inicio de cada turno se marca la canica activa (anillo/flecha + aviso) y la cámara encuadra la canica + círculo.
7. **Repetición:** reproduce los últimos ~10 s de acción.

### Controles

| Acción | Entrada |
|--------|---------|
| Orbitar | Arrastrar en el escenario |
| Zoom | Rueda / pellizca |
| Soltar canicas | Botón superior |
| Potencia | Mantener canica + deslizar ↑↓ |
| Apuntar | Mantener canica + deslizar ↔ |
| Disparar | Soltar el botón de la canica |
| Repetición | Botón «Repetición» |

## Novedades de esta versión

- Modo **vs IA** con puntuación Jugador / IA y niveles.
- Potencia por **arrastre vertical** (no por tiempo de pulsación).
- Cámara de turno: canica activa en el **centro geométrico** de la pantalla, cámara detrás mirando al círculo (apunte tipo billar).
- Ciclo **día/noche** continuo (un día completo = **30 minutos** reales) con faroles que se encienden de noche.
- Vida ambiental del parque: pájaros y siluetas lejanas paseando.
- Billetes 2D texturizados al sacar canicas (+$2), polvo sutil, chispas.
- Parque (no estadio), barrera invisible, repetición libre, UI en español.
- Cielo (Sky) + suelo muy amplio (sin “isla” flotante).
- Medidor de potencia grande y claro en móvil.
- Buffer de repetición (~10 s).

## Limitaciones

- Arte procedural (sin texturas externas).
- La IA es heurística (cúmulos / borde), no un oponente perfecto.
- La repetición congela la entrada y reproduce transformaciones grabadas; no re-simula física.
- La física es jugable, no un simulador de laboratorio.

## Licencia

Proyecto de demostración.
