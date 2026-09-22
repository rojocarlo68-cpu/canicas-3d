/**
 * Battle-quality spinning marble viewer for victory / gacha UI canvases.
 * Uses MeshPhysicalMaterial clones of in-game designs (not flat 2D icons).
 */
import * as THREE from 'three';
import type { MarbleDesign } from './marbles';

const SPIN_RAD_PER_SEC = 0.55; // flattering slow spin

export class MarbleShowcase {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private mesh: THREE.Mesh | null = null;
  private raf = 0;
  private running = false;
  private lastT = 0;
  private readonly canvas: HTMLCanvasElement;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /** Start (or restart) showing a design. Safe to call repeatedly. */
  show(design: MarbleDesign): void {
    if (this.disposed) return;
    this.ensureRenderer();
    if (!this.scene || !this.renderer) return;

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      const mat = this.mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
      this.mesh = null;
    }

    const geo = new THREE.SphereGeometry(1, 48, 40);
    const material = design.material.clone();
    // Ensure map is shared (clone keeps map ref) — fine for UI preview
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.rotation.set(0.35, 0.4, 0.1);
    this.scene.add(this.mesh);
    this.start();
  }

  start(): void {
    if (this.disposed || this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const tick = (t: number) => {
      if (!this.running || this.disposed) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      if (this.mesh) {
        this.mesh.rotation.y += SPIN_RAD_PER_SEC * dt;
        this.mesh.rotation.x += SPIN_RAD_PER_SEC * 0.18 * dt;
      }
      this.render();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    if (this.mesh && this.scene) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      const mat = this.mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
      this.mesh = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }

  private ensureRenderer(): void {
    if (this.renderer) {
      this.resize();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(64, Math.floor(rect.width * (window.devicePixelRatio || 1)));
    const h = Math.max(64, Math.floor(rect.height * (window.devicePixelRatio || 1)));
    this.canvas.width = w;
    this.canvas.height = h;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(rect.width || 180, rect.height || 180, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
    this.camera.position.set(0, 0.15, 3.55);
    this.camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xfff2d6, 0x1a2030, 1.15);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe0a0, 1.35);
    key.position.set(2.2, 3.2, 2.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88bbff, 0.55);
    fill.position.set(-2.5, 0.8, -1.5);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xffcc66, 1.2, 12);
    rim.position.set(-1.2, 1.6, 2.4);
    this.scene.add(rim);

    // Soft env-ish ambient glow behind marble (transparent BG still)
    const back = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0x1a1008,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.35,
      }),
    );
    this.scene.add(back);
  }

  private resize(): void {
    if (!this.renderer || !this.camera) return;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    this.renderer.setSize(cssW, cssH, false);
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();
  }

  private render(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.resize();
    this.renderer.render(this.scene, this.camera);
  }
}
