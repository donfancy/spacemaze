// 2026-Engine: prozedurale SKYBOX -- einmalig beim Weltaufbau in eine Cubemap
// gebacken (CubeCamera -> WebGLCubeRenderTarget), danach kostet der Himmel
// pro Frame nichts mehr (scene.background sampelt nur die Textur). Die
// Zutaten (Farben, Crescendo-Staerke, Seed) liefert skyTheme.js (pur);
// hier lebt nur der Three.js-/GLSL-Teil. Idee wie space-3d (wwwtyro,
// Unlicense): FBM-Simplex-Nebel + Sternenstaub, deterministisch aus Seed.
//
// Zwei Regeln aus dem Bloom-/8-Bit-Umfeld:
// - Die Nebel-Helligkeit bleibt UNTER der Bloom-Schwelle (0.85 in
//   backend.js) -- der Himmel darf nicht gluehen, nur die Leuchtkanten
//   (NEBULA_MAX deckelt den vollen Crescendo-Gain).
// - Dunkle Verlaeufe in 8 Bit banden sichtbar -- der Shader dithert
//   (1/128-Rauschen), sonst ziehen sich Farbringe durch den Nebel.

import * as THREE from 'three';
import { createRng } from '../util/rng.js';

export const SKY_SIZE = 1024;   // Pixel pro Wuerfelseite
const NEBULA_MAX = 0.5;         // Helligkeits-Deckel (Bloom-Schwelle 0.85)
const RADIUS = 100;             // Bake-Szene: Box-Halbgroesse; Staub sitzt innen
const DUST_TINT_PROB = 0.25;    // Anteil getoenter Staub-Sterne (Schicht-Farben)

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 3D-Simplex-Noise nach Ashima Arts / Stefan Gustavson (webgl-noise, MIT) --
// der Standard-GLSL-Simplex, wie ihn auch space-3d nutzt.
const SNOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uCols[3];
uniform vec3 uOffs[3];
uniform float uScales[3];
uniform float uLayerN;
uniform float uGain;
uniform vec3 uBandCol;
uniform vec3 uBandN;
uniform float uBandStrength;
uniform float uHorizonFade;

${SNOISE}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * snoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 d = normalize(vDir);

  // Nebel-Schichten: FBM sanft geklemmt, hoch drei -> sparsame Wolken.
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    if (float(i) >= uLayerN) break;
    float n = fbm(d * uScales[i] + uOffs[i]);
    n = smoothstep(-0.2, 1.0, n);
    col += uCols[i] * pow(n, 3.0);
  }

  // Blasses Galaxien-Band entlang eines zufaelligen Grosskreises.
  float bd = dot(d, uBandN);
  float band = exp(-bd * bd * 40.0);
  float bn = 0.5 + 0.5 * fbm(d * 3.0 + uOffs[0].yzx);
  col += uBandCol * (band * bn * uBandStrength);

  // Welt: unter dem Horizont ausblenden (Startscreen: volle Kugel).
  col *= mix(1.0, smoothstep(-0.4, 0.1, d.y), uHorizonFade);

  col *= uGain * ${NEBULA_MAX.toFixed(3)};
  col += vec3((hash12(gl_FragCoord.xy) - 0.5) / 128.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

// '#rrggbb' -> Vector3 im linearen Arbeitsfarbraum (wie alle Szenen-Farben).
function colVec(hex) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

// Wie GLSL-smoothstep -- fuer den Horizont-Fade der Staub-Sterne.
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Feiner Hintergrund-Sternenstaub, direkt mit in die Cubemap gebacken --
// statisch und HINTER den funkelnden Punkt-Sternen der Szene (die bleiben
// die Animation obendrauf). Dunkel genug, dass der Bloom ihn ignoriert.
function buildBakeDust(scene, rng, theme) {
  const tints = theme.layers.map((l) => new THREE.Color(l.hex));
  const pts = [];
  const cols = [];
  const r = RADIUS * 0.9;
  for (let i = 0; i < theme.dust; i++) {
    const az = rng() * Math.PI * 2;
    const el = Math.asin(rng() * 2 - 1);
    const y = Math.sin(el);
    pts.push(r * Math.cos(el) * Math.cos(az), r * y, r * Math.cos(el) * Math.sin(az));
    const c = rng() < DUST_TINT_PROB
      ? tints[Math.floor(rng() * tints.length)].clone()
      : new THREE.Color(1, 1, 1);
    const fade = theme.horizonFade ? smoothstep(-0.4, 0.1, y) : 1;
    c.multiplyScalar((0.08 + rng() * 0.3) * fade);
    cols.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.5, sizeAttenuation: false, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(geo, mat));
}

// Backt das Thema in eine Cubemap. Rueckgabe: das RenderTarget -- der
// Aufrufer setzt scene.background = rt.texture und ruft rt.dispose()
// beim Welt-Teardown (disposeWorld traversiert nur die Szene, der
// Hintergrund haengt NICHT im Szenengraph).
export function bakeSkybox(renderer, theme) {
  const rng = createRng(theme.seed);
  const scene = new THREE.Scene();

  const cols = theme.layers.map((l) => colVec(l.hex));
  const offs = theme.layers.map(
    () => new THREE.Vector3(rng() * 100, rng() * 100, rng() * 100));
  const scales = theme.layers.map((l) => l.scale);
  const layerN = theme.layers.length;
  while (cols.length < 3) cols.push(new THREE.Vector3());
  while (offs.length < 3) offs.push(new THREE.Vector3());
  while (scales.length < 3) scales.push(1);

  // Band-Lage: zufaellige Grosskreis-Ebene (Normale gleichverteilt).
  const az = rng() * Math.PI * 2;
  const el = Math.asin(rng() * 2 - 1);
  const bandN = new THREE.Vector3(
    Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));

  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uCols: { value: cols },
      uOffs: { value: offs },
      uScales: { value: scales },
      uLayerN: { value: layerN },
      uGain: { value: theme.gain },
      uBandCol: { value: colVec(theme.band.hex) },
      uBandN: { value: bandN },
      uBandStrength: { value: theme.band.strength },
      uHorizonFade: { value: theme.horizonFade },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(2 * RADIUS, 2 * RADIUS, 2 * RADIUS), mat));
  buildBakeDust(scene, rng, theme);

  const rt = new THREE.WebGLCubeRenderTarget(SKY_SIZE);
  const cam = new THREE.CubeCamera(0.1, 4 * RADIUS, rt);
  cam.update(renderer, scene);

  // Bake-Szene sofort freigeben -- nur die Cubemap lebt weiter.
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return rt;
}
