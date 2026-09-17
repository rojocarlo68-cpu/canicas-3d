# Canicas 3D

Mockup jugable de un juego de canicas en 3D con física realista (gravedad, rebotes, fricción y colisiones).

Playable 3D marble (*canicas*) web mockup with realistic physics (gravity, bounce, friction, and collisions).

## Stack

- [Vite](https://vitejs.dev/)
- [Three.js](https://threejs.org/) (render + OrbitControls)
- [cannon-es](https://github.com/pmndrs/cannon-es) (physics)
- TypeScript

**Escala / Scale:** `1` unidad = `1` metro. Radio de canica ≈ `0.008` m (diámetro 1.6 cm). Altura de soltado ≈ `0.13` m (13 cm).

## Cómo ejecutar / How to run

```bash
cd canicas-3d
npm install
npm run dev
```

Abre la URL que muestre Vite (por defecto `http://localhost:5173`).

Open the URL Vite prints (default `http://localhost:5173`).

Para exponer en la red local:

```bash
npm run dev -- --host 0.0.0.0 --port 5173
```

Build de producción:

```bash
npm run build
npm run preview
```

## Cómo jugar / How to play

### Español

1. Pulsa **Soltar canicas** para soltar 10 canicas con diseños distintos desde el recipiente (~13 cm sobre el suelo).
2. Espera a que se detengan dentro del círculo marcado en el suelo.
3. **Mantén** el botón de **Tu canica** (abajo a la derecha) para cargar potencia; **suelta** para disparar hacia el centro del círculo.
4. Mientras cargas, arrastra un poco horizontalmente para ajustar la mira.
5. Arrastra en el escenario para orbitar la cámara; pellizca o usa la rueda para hacer zoom.
6. Ganas cuando **no queda ninguna canica de campo dentro del círculo**. El marcador muestra cuántas sacaste.

### English

1. Tap **Soltar canicas** to drop 10 distinctly designed marbles from the hopper (~13 cm above the ground).
2. Wait until they settle inside the marked circle.
3. **Hold** the **Tu canica** button (bottom-right) to charge power; **release** to shoot toward the circle center.
4. While charging, drag slightly horizontally to adjust aim.
5. Drag the scene to orbit; pinch or scroll to zoom.
6. You win when **no field marbles remain inside the circle**. The HUD tracks how many you knocked out.

## Controles / Controls

| Acción | Entrada |
|--------|---------|
| Orbitar | Arrastrar (ratón / 1 dedo) |
| Zoom | Rueda / pellizca |
| Soltar canicas | Botón superior |
| Cargar y disparar | Mantener y soltar el botón de la canica (abajo derecha) |
| Apuntar | Arrastre horizontal mientras cargas |

## Limitaciones conocidas / Known limitations

- Solo nivel 1 (plano de tierra + un círculo).
- Arte procedural / placeholder (sin texturas externas).
- Tras cada disparo, la canica del jugador se reposiciona en el borde cuando se detiene (flujo de mockup de turnos).
- La física es una aproximación jugable; no es un simulador de laboratorio.

## Licencia

Proyecto de demostración / demo project.
