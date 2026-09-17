import * as THREE from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';

/** One full day = 30 real minutes. */
export const DAY_CYCLE_SECONDS = 30 * 60;

export type StreetLamp = {
  group: THREE.Group;
  bulbMat: THREE.MeshStandardMaterial;
  light: THREE.PointLight;
};

export type DayNightTargets = {
  sky: Sky;
  sunLight: THREE.DirectionalLight;
  hemiLight: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  renderer: THREE.WebGLRenderer;
  lamps: StreetLamp[];
  /** Soft fill so the play circle stays readable at night */
  playFill: THREE.PointLight;
  sunDir: THREE.Vector3;
};

/**
 * Continuous day→night cycle driven by elapsed seconds.
 * phase 0 = morning sunrise, 0.25 noon, 0.5 sunset, 0.75 night, 1 morning.
 */
export function applyDayNight(elapsedSec: number, t: DayNightTargets): void {
  const phase = ((elapsedSec % DAY_CYCLE_SECONDS) + DAY_CYCLE_SECONDS) % DAY_CYCLE_SECONDS
    / DAY_CYCLE_SECONDS;

  // elev: +1 noon, 0 dawn/dusk, -1 midnight
  const elev = Math.sin(phase * Math.PI * 2);
  // Azimuth sweeps full circle over the day
  const azim = phase * Math.PI * 2 - Math.PI * 0.5;

  // Sky.js phi = polar from +Y (0 zenith, π/2 horizon)
  const maxElevDeg = 72;
  const elevDeg = elev * maxElevDeg;
  const phi = THREE.MathUtils.degToRad(90 - elevDeg);
  const theta = azim;

  t.sunDir.setFromSphericalCoords(1, phi, theta);
  const skyU = t.sky.material.uniforms;
  skyU['sunPosition'].value.copy(t.sunDir);

  // Place directional light along sun direction
  t.sunLight.position.copy(t.sunDir).multiplyScalar(3);

  const dayAmount = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);
  const nightAmount = 1 - dayAmount;
  const sunsetGlow = Math.exp(-Math.pow((elev - 0.05) / 0.22, 2)); // peak near dusk/dawn

  // Sun intensity & color
  const sunWarm = new THREE.Color().setHSL(0.08, 0.65, 0.55);
  const sunNoon = new THREE.Color().setHSL(0.12, 0.25, 0.95);
  const sunCol = sunNoon.clone().lerp(sunWarm, sunsetGlow);
  t.sunLight.color.copy(sunCol);
  t.sunLight.intensity = THREE.MathUtils.lerp(0.05, 1.45, dayAmount)
    + sunsetGlow * 0.35;

  // Hemisphere ambient
  const hemiSkyDay = new THREE.Color(0xb8d8ff);
  const hemiSkyNight = new THREE.Color(0x1a2240);
  const hemiSkySunset = new THREE.Color(0xffb074);
  const hemiGroundDay = new THREE.Color(0x6b5030);
  const hemiGroundNight = new THREE.Color(0x1a1510);
  t.hemiLight.color.copy(hemiSkyDay)
    .lerp(hemiSkySunset, sunsetGlow * dayAmount)
    .lerp(hemiSkyNight, nightAmount);
  t.hemiLight.groundColor.copy(hemiGroundDay).lerp(hemiGroundNight, nightAmount);
  t.hemiLight.intensity = THREE.MathUtils.lerp(0.18, 0.55, dayAmount)
    + sunsetGlow * 0.12;

  // Fog / sky feel — lighter density so sky + horizon mountains/buildings stay visible
  const fogDay = new THREE.Color(0xb8d4ef);
  const fogSunset = new THREE.Color(0xc98b5a);
  const fogNight = new THREE.Color(0x0c1220);
  t.fog.color.copy(fogDay).lerp(fogSunset, sunsetGlow * 0.7).lerp(fogNight, nightAmount);
  t.fog.density = THREE.MathUtils.lerp(0.009, 0.016, nightAmount);

  // Sky atmosphere params
  skyU['turbidity'].value = THREE.MathUtils.lerp(2.5, 8, sunsetGlow) + nightAmount * 1.5;
  skyU['rayleigh'].value = THREE.MathUtils.lerp(0.4, 2.4, dayAmount) + sunsetGlow * 1.2;
  skyU['mieCoefficient'].value = THREE.MathUtils.lerp(0.002, 0.008, sunsetGlow);
  skyU['mieDirectionalG'].value = 0.85;

  // Exposure — slightly lower at night but not pitch black
  t.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.72, 1.05, dayAmount)
    + sunsetGlow * 0.08;

  // Street lamps: on only at night / deep dusk (hide lights when off for mobile)
  const lampOn = THREE.MathUtils.smoothstep(-elev, 0.02, 0.25);
  const lampsLit = lampOn > 0.04;
  for (let i = 0; i < t.lamps.length; i++) {
    const lamp = t.lamps[i]!;
    // Only the nearest 4 faroles cast real point lights (perf); rest are emissive glow
    const usePoint = i < 4;
    lamp.light.visible = lampsLit && usePoint;
    lamp.light.intensity = usePoint ? lampOn * 1.25 : 0;
    lamp.bulbMat.emissiveIntensity = lampOn * 2.4;
    lamp.bulbMat.color.setHex(lampOn > 0.05 ? 0xffe082 : 0x555555);
  }

  // Play-circle fill for night readability (always a little, stronger at night)
  t.playFill.intensity = 0.15 + nightAmount * 0.85;
  t.playFill.color.setHex(nightAmount > 0.5 ? 0xffe6b0 : 0xfff5e0);
}

/** Build a simple park farol (post + lamp head). */
export function makeStreetLamp(
  x: number,
  z: number,
  rotY = 0,
): StreetLamp {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({
    color: '#3a3a3a',
    roughness: 0.7,
    metalness: 0.35,
  });
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 2.2, 6),
    postMat,
  );
  post.position.y = 1.1;
  post.castShadow = true;
  group.add(post);

  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.05, 0.05),
    postMat,
  );
  arm.position.set(0.2, 2.15, 0);
  group.add(arm);

  const bulbMat = new THREE.MeshStandardMaterial({
    color: '#555555',
    emissive: '#ffcc66',
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    bulbMat,
  );
  bulb.position.set(0.42, 2.05, 0);
  group.add(bulb);

  // Shade
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.12, 8, 1, true),
    new THREE.MeshStandardMaterial({ color: '#2a2a2a', side: THREE.DoubleSide }),
  );
  shade.position.set(0.42, 2.18, 0);
  shade.rotation.x = Math.PI;
  group.add(shade);

  const light = new THREE.PointLight(0xffd899, 0, 7, 2);
  light.position.set(0.42, 2.0, 0);
  // Keep mobile-friendly: no lamp shadows
  light.castShadow = false;
  group.add(light);

  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  return { group, bulbMat, light };
}
