import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  MARBLE_RADIUS,
  MARBLE_FRICTION,
  MARBLE_RESTITUTION,
  MARBLE_LINEAR_DAMPING,
  MARBLE_ANGULAR_DAMPING,
} from './constants';

export type MarbleDesign = {
  id: string;
  name: string;
  material: THREE.MeshPhysicalMaterial;
};

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 128,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function solidMat(color: string, opts: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.15,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    ...opts,
  });
}

function patternedMat(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  opts: Partial<THREE.MeshPhysicalMaterialParameters> = {},
) {
  return new THREE.MeshPhysicalMaterial({
    map: canvasTexture(draw),
    roughness: 0.2,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    ...opts,
  });
}

export function createFieldDesigns(): MarbleDesign[] {
  return [
    {
      id: 'azul',
      name: 'Azul cristal',
      material: solidMat('#2a6fd6', { transmission: 0.35, thickness: 0.5, ior: 1.5, transparent: true, opacity: 0.92 }),
    },
    {
      id: 'ojo-gato',
      name: 'Ojo de gato',
      material: patternedMat((ctx, s) => {
        ctx.fillStyle = '#e8e8e8';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#c62828';
        ctx.beginPath();
        ctx.ellipse(s / 2, s / 2, s * 0.18, s * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff8';
        ctx.beginPath();
        ctx.ellipse(s * 0.38, s * 0.35, s * 0.08, s * 0.12, -0.4, 0, Math.PI * 2);
        ctx.fill();
      }),
    },
    {
      id: 'verde',
      name: 'Verde opaco',
      material: solidMat('#2e7d32', { roughness: 0.35 }),
    },
    {
      id: 'swirl-morado',
      name: 'Remolino morado',
      material: patternedMat((ctx, s) => {
        const g = ctx.createLinearGradient(0, 0, s, s);
        g.addColorStop(0, '#4a148c');
        g.addColorStop(0.35, '#f9a825');
        g.addColorStop(0.65, '#7b1fa2');
        g.addColorStop(1, '#ffd54f');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = '#fff6';
        ctx.lineWidth = 6;
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(s * 0.5, s * 0.5, 10 + i * 12, i * 0.6, i * 0.6 + 2.2);
          ctx.stroke();
        }
      }),
    },
    {
      id: 'ambar',
      name: 'Ámbar',
      material: solidMat('#ff8f00', { transmission: 0.25, thickness: 0.4, transparent: true, opacity: 0.9 }),
    },
    {
      id: 'naranja',
      name: 'Naranja sólido',
      material: solidMat('#ef6c00', { roughness: 0.28 }),
    },
    {
      id: 'azul-blanco',
      name: 'Azul y blanco',
      material: patternedMat((ctx, s) => {
        ctx.fillStyle = '#1565c0';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#e3f2fd';
        for (let i = -s; i < s * 2; i += 18) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.quadraticCurveTo(i + 40, s / 2, i, s);
          ctx.lineTo(i + 10, s);
          ctx.quadraticCurveTo(i + 50, s / 2, i + 10, 0);
          ctx.closePath();
          ctx.fill();
        }
      }),
    },
    {
      id: 'negra',
      name: 'Negra',
      material: solidMat('#1a1a1a', { roughness: 0.25, metalness: 0.2 }),
    },
    {
      id: 'amarilla',
      name: 'Amarilla',
      material: solidMat('#fdd835', { roughness: 0.3 }),
    },
    {
      id: 'rosa',
      name: 'Rosa translúcida',
      material: solidMat('#ec407a', { transmission: 0.4, thickness: 0.45, transparent: true, opacity: 0.88 }),
    },
  ];
}

export function createPlayerDesign(): MarbleDesign {
  return {
    id: 'jugador',
    name: 'Tu canica',
    material: patternedMat(
      (ctx, s) => {
        const g = ctx.createRadialGradient(s * 0.35, s * 0.35, 4, s / 2, s / 2, s * 0.55);
        g.addColorStop(0, '#fffde7');
        g.addColorStop(0.35, '#ffd54f');
        g.addColorStop(0.7, '#ff6f00');
        g.addColorStop(1, '#bf360c');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = '#5d4037';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s * 0.28, 0.2, Math.PI * 1.6);
        ctx.stroke();
      },
      { roughness: 0.18, clearcoat: 1 },
    ),
  };
}

export type MarbleEntity = {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  design: MarbleDesign;
  isPlayer: boolean;
  active: boolean;
};

const marbleMaterial = new CANNON.Material('marble');

export function getMarbleCannonMaterial(): CANNON.Material {
  return marbleMaterial;
}

export function createMarbleEntity(
  design: MarbleDesign,
  position: CANNON.Vec3,
  isPlayer: boolean,
): MarbleEntity {
  const geo = new THREE.SphereGeometry(MARBLE_RADIUS, 32, 24);
  const mesh = new THREE.Mesh(geo, design.material.clone());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(position.x, position.y, position.z);

  const shape = new CANNON.Sphere(MARBLE_RADIUS);
  const body = new CANNON.Body({
    mass: 0.0055, // ~5.5 g typical glass marble
    shape,
    position: position.clone(),
    material: marbleMaterial,
    linearDamping: MARBLE_LINEAR_DAMPING,
    angularDamping: MARBLE_ANGULAR_DAMPING,
  });
  body.material!.friction = MARBLE_FRICTION;
  body.material!.restitution = MARBLE_RESTITUTION;

  return { mesh, body, design, isPlayer, active: true };
}

export function drawPreviewMarble(
  canvas: HTMLCanvasElement,
  design: MarbleDesign,
): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const map = design.material.map;
  if (map && map instanceof THREE.CanvasTexture) {
    const src = map.image as HTMLCanvasElement;
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
  } else {
    const color = `#${design.material.color.getHexString()}`;
    const g = ctx.createRadialGradient(w * 0.35, h * 0.32, 4, w / 2, h / 2, w * 0.45);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, color);
    g.addColorStop(1, shade(color, -40));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  // Gloss highlight
  const hl = ctx.createRadialGradient(w * 0.35, h * 0.3, 1, w * 0.35, h * 0.3, w * 0.2);
  hl.addColorStop(0, 'rgba(255,255,255,0.75)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.arc(w * 0.35, h * 0.3, w * 0.18, 0, Math.PI * 2);
  ctx.fill();

  // Rim
  ctx.strokeStyle = 'rgba(255,224,138,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
  ctx.stroke();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}
