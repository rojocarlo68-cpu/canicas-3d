# Canicas 3D

Juego de canicas en 3D: **Jugador vs IA**, física con cannon-es, cámara táctil y repetición.

## Stack

- [Vite](https://vitejs.dev/) + TypeScript
- [Three.js](https://threejs.org/) (render, OrbitControls, Sky)
- [cannon-es](https://github.com/pmndrs/cannon-es) (física)

**Escala:** `1` unidad = `1` metro. Radio de canica ≈ `0.008` m. Altura de soltado = **0.10 m** (10 cm).

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
6. Al inicio de cada turno se marca la canica activa (anillo/flecha + aviso).
7. **Repetición:** reproduce los últimos ~10 s de acción.
8. Manos 3D estilizadas acompañan la carga y el lanzamiento (jugador e IA).

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
- Cámara centrada en vertical y horizontal (compensa HUD y controles).
- Cielo (Sky) + suelo muy amplio (sin “isla” flotante).
- Medidor de potencia grande y claro en móvil.
- Indicador de ubicación de la canica activa.
- Buffer de repetición (~10 s).
- Manos 3D low-poly con animación de carga y tiro.

## Limitaciones

- Arte procedural (sin texturas externas).
- La IA es heurística (cúmulos / borde), no un oponente perfecto.
- La repetición congela la entrada y reproduce transformaciones grabadas; no re-simula física.
- La física es jugable, no un simulador de laboratorio.

## Licencia

Proyecto de demostración.
