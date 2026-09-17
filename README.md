# Canicas 3D

Juego de canicas en 3D: **Jugador vs IA**, física con cannon-es, cámara táctil y repetición.


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
11. **Punch-in de cámara al sacar:** al contar un knockout, la cámara acerca más fuerte a esa canica (~2s, hold +1s) y luego vuelve al shooter del turno; varias salidas casi juntas retargetean la más reciente.
12. **Repetición:** la cámara sigue la canica del jugador todo el tiempo (encuadre suave, canica cerca del centro); scrub/velocidad siguen disponibles.
13. **Superficie:** física + dirt pad + `MARBLE_REST_Y` alineados (tiny bias) — las canicas reposan al ras del dirt sin flotar.

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

1. Pulsa **Soltar canicas** (caen desde ~10 cm).
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
