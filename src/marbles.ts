import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  MARBLE_RADIUS,
  MARBLE_MASS,
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

export type MarbleOwner = 'field' | 'player' | 'ai';

function canvasTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 256,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial highlight baked into map for cheap “glass” specular. */
function addGlassSheen(ctx: CanvasRenderingContext2D, s: number): void {
  const hl = ctx.createRadialGradient(s * 0.32, s * 0.28, s * 0.02, s * 0.35, s * 0.32, s * 0.42);
  hl.addColorStop(0, 'rgba(255,255,255,0.55)');
  hl.addColorStop(0.35, 'rgba(255,255,255,0.12)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, s, s);

  // Rim darkening
  const rim = ctx.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.52);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, s, s);
}

function glassMat(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  opts: Partial<THREE.MeshPhysicalMaterialParameters> = {},
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: canvasTexture((ctx, s) => {
      draw(ctx, s);
      addGlassSheen(ctx, s);
    }),
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    reflectivity: 0.55,
    envMapIntensity: 1.0,
    ...opts,
  });
}

function solidGlass(
  color: string,
  opts: Partial<THREE.MeshPhysicalMaterialParameters> = {},
): THREE.MeshPhysicalMaterial {
  return glassMat((ctx, s) => {
    const g = ctx.createRadialGradient(s * 0.35, s * 0.32, s * 0.05, s / 2, s / 2, s * 0.55);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.2, color);
    g.addColorStop(0.75, shadeHex(color, -30));
    g.addColorStop(1, shadeHex(color, -55));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }, opts);
}

function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

/** Organic swirl veins like classic glass marbles. */
function swirlPattern(
  ctx: CanvasRenderingContext2D,
  s: number,
  base: string,
  veins: string[],
): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  for (let v = 0; v < veins.length; v++) {
    ctx.strokeStyle = veins[v]!;
    ctx.lineWidth = 6 + v * 3;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    const cx = s * (0.35 + v * 0.12);
    const cy = s * (0.4 + (v % 2) * 0.1);
    for (let t = 0; t <= 1; t += 0.02) {
      const a = t * Math.PI * 2.6 + v * 1.1;
      const r = s * (0.08 + t * 0.38);
      const x = cx + Math.cos(a) * r + Math.sin(t * 9 + v) * s * 0.03;
      const y = cy + Math.sin(a * 0.9) * r * 0.85 + Math.cos(t * 7) * s * 0.02;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Internal translucent wash
  const wash = ctx.createRadialGradient(s * 0.5, s * 0.5, s * 0.1, s * 0.5, s * 0.5, s * 0.5);
  wash.addColorStop(0, 'rgba(255,255,255,0.2)');
  wash.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, s, s);
}

export function createFieldDesigns(): MarbleDesign[] {
  return [
    {
      id: 'azul-cristal',
      name: 'Azul cristal',
      material: solidGlass('#1e88e5', {
        roughness: 0.1,
        clearcoat: 1,
        // Cheap transmission approx — keep opacity high for mobile
        transparent: true,
        opacity: 0.92,
        transmission: 0.15,
        thickness: 0.4,
        ior: 1.5,
      }),
    },
    {
      id: 'ojo-gato',
      name: 'Ojo de gato',
      material: glassMat((ctx, s) => {
        ctx.fillStyle = '#f5f5f5';
        ctx.fillRect(0, 0, s, s);
        const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.02, s / 2, s / 2, s * 0.28);
        g.addColorStop(0, '#fffde7');
        g.addColorStop(0.35, '#ff8f00');
        g.addColorStop(0.7, '#c62828');
        g.addColorStop(1, '#4a0000');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(s / 2, s / 2, s * 0.16, s * 0.4, 0.15, 0, Math.PI * 2);
        ctx.fill();
        // Cat-eye slit
        ctx.fillStyle = '#1a0500';
        ctx.beginPath();
        ctx.ellipse(s / 2, s / 2, s * 0.035, s * 0.32, 0.15, 0, Math.PI * 2);
        ctx.fill();
      }),
    },
    {
      id: 'verde-bosque',
      name: 'Verde bosque',
      material: glassMat((ctx, s) => {
        swirlPattern(ctx, s, '#1b5e20', ['#a5d6a7', '#66bb6a', '#004d40', '#c8e6c9']);
      }, { roughness: 0.18 }),
    },
    {
      id: 'swirl-morado',
      name: 'Remolino morado',
      material: glassMat((ctx, s) => {
        swirlPattern(ctx, s, '#4a148c', ['#f9a825', '#ce93d8', '#ffd54f', '#7b1fa2']);
      }),
    },
    {
      id: 'ambar',
      name: 'Ámbar',
      material: solidGlass('#ff8f00', {
        transparent: true,
        opacity: 0.9,
        transmission: 0.2,
        thickness: 0.45,
        roughness: 0.14,
      }),
    },
    {
      id: 'naranja-swirl',
      name: 'Naranja swirl',
      material: glassMat((ctx, s) => {
        swirlPattern(ctx, s, '#e65100', ['#fff3e0', '#ffcc80', '#bf360c', '#ffe0b2']);
      }),
    },
    {
      id: 'azul-blanco',
      name: 'Azul y blanco',
      material: glassMat((ctx, s) => {
        ctx.fillStyle = '#0d47a1';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#e3f2fd';
        for (let i = -s; i < s * 2; i += 22) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.bezierCurveTo(i + 30, s * 0.35, i - 10, s * 0.65, i + 20, s);
          ctx.lineTo(i + 14, s);
          ctx.bezierCurveTo(i + 4, s * 0.65, i + 44, s * 0.35, i + 14, 0);
          ctx.closePath();
          ctx.fill();
        }
      }),
    },
    {
      id: 'negra-onyx',
      name: 'Ónix',
      material: glassMat((ctx, s) => {
        swirlPattern(ctx, s, '#121212', ['#616161', '#9e9e9e', '#37474f', '#eceff1']);
      }, { roughness: 0.2, metalness: 0.15 }),
    },
    {
      id: 'amarilla',
      name: 'Amarilla',
      material: glassMat((ctx, s) => {
        swirlPattern(ctx, s, '#f9a825', ['#fffde7', '#ff6f00', '#ffecb3', '#f57f17']);
      }),
    },
    {
      id: 'rosa-cristal',
      name: 'Rosa translúcida',
      material: solidGlass('#ec407a', {
        transparent: true,
        opacity: 0.88,
        transmission: 0.22,
        thickness: 0.4,
        roughness: 0.12,
      }),
    },
  ];
}

export function createPlayerDesign(): MarbleDesign {
  return {
    id: 'jugador',
    name: 'Tu canica',
    material: glassMat(
      (ctx, s) => {
        swirlPattern(ctx, s, '#e65100', ['#fff8e1', '#ffd54f', '#ff6f00', '#bf360c', '#5d4037']);
        // Signature ring
        ctx.strokeStyle = 'rgba(93,64,55,0.65)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(s / 2, s / 2, s * 0.26, 0.2, Math.PI * 1.6);
        ctx.stroke();
      },
      { roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 },
    ),
  };
}

export function createAIDesign(): MarbleDesign {
  return {
    id: 'rival',
    name: 'Canica rival',
    material: glassMat(
      (ctx, s) => {
        swirlPattern(ctx, s, '#0d47a1', ['#e3f2fd', '#42a5f5', '#1565c0', '#82b1ff']);
        // Star mark
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        const cx = s / 2;
        const cy = s / 2;
        const spikes = 5;
        const outer = s * 0.18;
        const inner = s * 0.08;
        for (let i = 0; i < spikes * 2; i++) {
          const r = i % 2 === 0 ? outer : inner;
          const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      },
      { roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 },
    ),
  };
}

export type MarbleEntity = {
  mesh: THREE.Mesh;
  body: CANNON.Body;
  design: MarbleDesign;
  owner: MarbleOwner;
  active: boolean;
};

const marbleMaterial = new CANNON.Material('marble');

export function getMarbleCannonMaterial(): CANNON.Material {
  return marbleMaterial;
}

export function createMarbleEntity(
  design: MarbleDesign,
  position: CANNON.Vec3,
  owner: MarbleOwner,
): MarbleEntity {
  // Slightly higher tessellation for nicer specular on glass
  const geo = new THREE.SphereGeometry(MARBLE_RADIUS, 36, 28);
  const mesh = new THREE.Mesh(geo, design.material.clone());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(position.x, position.y, position.z);

  const shape = new CANNON.Sphere(MARBLE_RADIUS);
  const body = new CANNON.Body({
    mass: MARBLE_MASS,
    shape,
    position: position.clone(),
    material: marbleMaterial,
    linearDamping: MARBLE_LINEAR_DAMPING,
    angularDamping: MARBLE_ANGULAR_DAMPING,
  });
  body.material!.friction = MARBLE_FRICTION;
  body.material!.restitution = MARBLE_RESTITUTION;

  return { mesh, body, design, owner, active: true };
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
    g.addColorStop(1, shadeHex(color, -40));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  const hl = ctx.createRadialGradient(w * 0.35, h * 0.3, 1, w * 0.35, h * 0.3, w * 0.2);
  hl.addColorStop(0, 'rgba(255,255,255,0.8)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.arc(w * 0.35, h * 0.3, w * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,224,138,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
  ctx.stroke();
}
