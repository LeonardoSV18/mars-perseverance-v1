import * as THREE from 'three';
import './mission.js';
import { crearRuedas, actualizarRuedas } from './wheels.js';
import { crearCamaras } from './camaras.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
const CAM_Z = 22;
camera.position.set(0, 9, CAM_Z);
camera.lookAt(0, 4.5, -40);

// ---------- Cielo caramelo ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {},
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y, -0.1, 1.0);
      vec3 horizon = vec3(0.93, 0.62, 0.36); // caramelo
      vec3 mid     = vec3(0.80, 0.47, 0.26);
      vec3 zenith  = vec3(0.45, 0.25, 0.17);
      vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, h));
      col = mix(col, zenith, smoothstep(0.2, 0.9, h));
      // halo de polvo cerca del sol
      vec3 sunDir = normalize(vec3(-0.55, 0.22, -0.8));
      float s = max(dot(normalize(vDir), sunDir), 0.0);
      col += vec3(1.0, 0.62, 0.32) * pow(s, 6.0) * 0.28;
      col += vec3(1.0, 0.78, 0.5) * pow(s, 40.0) * 0.35;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
// Cielo, sol y lunas viajan con la cámara para que siempre queden "en el infinito".
const celestial = new THREE.Group();
scene.add(celestial);
celestial.add(new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat));
scene.fog = new THREE.FogExp2(0xd98f5a, 0.012);

// ---------- Luz de tarde ----------
const sun = new THREE.DirectionalLight(0xffc489, 3.2);
sun.position.set(-55, 22, -80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 6;
sun.shadow.camera.left = -38;
sun.shadow.camera.right = 38;
sun.shadow.camera.top = 38;
sun.shadow.camera.bottom = -38;
sun.shadow.camera.far = 250;
sun.shadow.bias = -0.0004;
const SUN_OFFSET = new THREE.Vector3(-55, 22, -80);
scene.add(sun);
scene.add(sun.target);
scene.add(new THREE.HemisphereLight(0xf2b27c, 0x5a2a18, 0.9));

// ---------- Terreno con dunas ----------
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (
    hash(xi, yi) * (1 - u) * (1 - v) + hash(xi + 1, yi) * u * (1 - v) +
    hash(xi, yi + 1) * (1 - u) * v + hash(xi + 1, yi + 1) * u * v
  );
}
function height(x, z) {
  const dune = Math.sin(x * 0.06 + noise(x * 0.02, z * 0.02) * 4) * 2.4;
  const ridge = Math.abs(Math.sin(z * 0.045 + x * 0.015 + noise(x * 0.03, z * 0.03) * 3)) * 3.2;
  const detail = noise(x * 0.25, z * 0.25) * 0.35;
  return dune + ridge + detail - 2;
}

const SIZE = 300, SEG = 220;
const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position;
const colors = new Float32Array(pos.count * 3);
const cA = new THREE.Color(0xb5532a), cB = new THREE.Color(0xd98a52);
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getZ(i) - 60;
  const y = height(x, z);
  pos.setY(i, y);
  const c = cA.clone().lerp(cB, THREE.MathUtils.clamp((y + 2) / 6, 0, 1));
  colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
}
geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
geo.computeVertexNormals();
const ground = new THREE.Mesh(
  geo,
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
);
ground.position.z = -60;
ground.receiveShadow = true;
scene.add(ground);

// ---------- Rocas ----------
const rockGeo = new THREE.DodecahedronGeometry(1, 1);
const rp = rockGeo.attributes.position;
for (let i = 0; i < rp.count; i++) {
  const n = 0.75 + hash(rp.getX(i) * 9, rp.getZ(i) * 9 + rp.getY(i) * 5) * 0.5;
  rp.setXYZ(i, rp.getX(i) * n, rp.getY(i) * n * 0.8, rp.getZ(i) * n);
}
rockGeo.computeVertexNormals();
const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a5036, roughness: 0.95, flatShading: true });
const SPAWN = { x: 0, z: 6 };
const rocks = []; // {x, z, r} para colisiones con el rover
function addRockCollider(x, z, s) { if (s > 0.55) rocks.push({ x, z, r: s * 0.9 }); }
for (let i = 0; i < 160; i++) {
  const x = (hash(i, 1) - 0.5) * 220;
  const z = 60 - hash(i, 2) * 240;
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 8) continue;
  const s = 0.25 + Math.pow(hash(i, 3), 2.8) * 1.6;
  addRockCollider(x, z, s);
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.scale.set(s * (0.8 + hash(i, 4) * 0.6), s, s * (0.8 + hash(i, 5) * 0.6));
  rock.position.set(x, height(x, z) + s * 0.05, z);
  rock.rotation.set(hash(i, 6) * 3, hash(i, 7) * 6, hash(i, 8) * 3);
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
}

// ---------- Rocas cercanas (primer plano) ----------
for (let i = 0; i < 14; i++) {
  const x = (hash(i, 21) - 0.5) * 36;
  const z = 12 - hash(i, 22) * 14;
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 8) continue;
  const s = 0.18 + Math.pow(hash(i, 23), 2) * 0.55;
  const rock = new THREE.Mesh(rockGeo, rockMat);
  rock.scale.set(s * 1.2, s * 0.8, s);
  rock.position.set(x, height(x, z) + s * 0.05, z);
  rock.rotation.set(hash(i, 24) * 3, hash(i, 25) * 6, hash(i, 26) * 3);
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
}

// ---------- Polvo en suspensión ----------
const dustN = 900;
const dustPos = new Float32Array(dustN * 3);
for (let i = 0; i < dustN; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 100;
  dustPos[i * 3 + 1] = 1 + Math.random() * 16;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 100;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const dust = new THREE.Points(
  dustGeo,
  new THREE.PointsMaterial({ color: 0xf0b27a, size: 0.35, map: dustTex, transparent: true, opacity: 0.3, depthWrite: false })
);
scene.add(dust);

// ---------- Sol y lunas (Fobos y Deimos) ----------
const sunDisc = new THREE.Mesh(
  new THREE.CircleGeometry(15, 48),
  new THREE.MeshBasicMaterial({ color: 0xfff0d0, fog: false, toneMapped: false })
);
sunDisc.position.copy(sun.position).normalize().multiplyScalar(900);
sunDisc.lookAt(camera.position);
celestial.add(sunDisc);

function moon(radius, color, dir) {
  const m = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, 2),
    new THREE.MeshStandardMaterial({ color, roughness: 1, fog: false, flatShading: true, emissive: 0x7a5a45, emissiveIntensity: 0.8 })
  );
  m.position.copy(dir).normalize().multiplyScalar(800);
  celestial.add(m);
  return m;
}
function roughen(m, amp) {
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (hash(p.getX(i) * 0.3, p.getY(i) * 0.3 + p.getZ(i) * 0.2) - 0.5) * amp;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  m.geometry.computeVertexNormals();
}
const fobos = moon(34, 0xc4a48c, new THREE.Vector3(0.32, 0.34, -1));  // Fobos
fobos.scale.set(1.25, 0.95, 1);
roughen(fobos, 0.35);
roughen(moon(15, 0xd2bba5, new THREE.Vector3(0.78, 0.42, -1)), 0.3);  // Deimos

// ---------- Rover Perseverance ----------
// Unidades de la escena = metros. El frente del modelo apunta a +Z.
const ROVER_WIDTH = 2.7;                 // ancho real con ruedas (m)
const WHEEL_X = 1.12;                    // ruedas laterales, medido en el modelo (±1,06 a ±1,18 m)
const WHEEL_Z = [1.28, 0.09, -0.98];     // delanteras, medias y traseras, medido en el modelo
const WB = WHEEL_Z[0] - WHEEL_Z[2];      // distancia entre ruedas delanteras y traseras
const MAX_X = 125, MIN_Z = -190, MAX_Z = 70;

const rover = new THREE.Group();
rover.rotation.order = 'YXZ'; // giro, cabeceo, alabeo
scene.add(rover);
const state = { x: SPAWN.x, z: SPAWN.z, heading: Math.PI, speed: 0, pitch: 0, roll: 0, y: 0, yawRate: 0 };
let wheels = null;
let camaras = null;
const MARS_G = 3.71; // gravedad de Marte (m/s²)

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath('/draco/');
loader.setDRACOLoader(draco);

const pmrem = new THREE.PMREMGenerator(renderer);
const roverEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

loader.load(
  '/models/perseverance.glb',
  (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const k = ROVER_WIDTH / size.x; // escala a tamaño real
    model.scale.setScalar(k);
    model.position.set(-center.x * k, -box.min.y * k, -center.z * k);
    console.log(
      `[rover] modelo original ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} -> ` +
      `escala ${k.toFixed(3)} -> ${(size.x * k).toFixed(2)} m ancho, ${(size.z * k).toFixed(2)} m largo, ${(size.y * k).toFixed(2)} m alto`
    );

    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if ('envMap' in m) { m.envMap = roverEnv; m.envMapIntensity = 0.55; m.needsUpdate = true; }
      });
    });
    rover.add(model);
    wheels = crearRuedas(model, rover);
    camaras = crearCamaras({ scene, camera, canvas: renderer.domElement, model });

    // Piezas que son cámaras (por nombre del nodo en el modelo)
    const cams = [];
    model.traverse((o) => {
      if (o.name && /cam(era)?|watson/i.test(o.name) && !/cover|wiring|bracket/i.test(o.name)) cams.push(o.name);
    });
    window.__roverCameras = cams;
    console.log(`[rover] Piezas que son cámaras (${cams.length}):`);
    cams.forEach((n) => console.log(`[rover]   - ${n}`));
    window.__ready = true;
  },
  undefined,
  (err) => {
    console.error('[rover] no se pudo cargar el modelo:', err?.message || err);
    window.__ready = true;
  }
);

// ---------- Huellas ----------
const MAX_MARKS = 9000;
const STAMP_STEP = 0.44;
const treadTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.lineCap = 'round';
  for (let y = 6; y < 64; y += 16) {
    g.beginPath();
    g.moveTo(4, y + 10);
    g.lineTo(32, y);
    g.lineTo(60, y + 10);
    g.stroke();
  }
  g.globalAlpha = 0.45;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 4, 64);
  g.fillRect(60, 0, 4, 64);
  return new THREE.CanvasTexture(c);
})();
const markGeo = new THREE.PlaneGeometry(0.5, STAMP_STEP);
markGeo.rotateX(-Math.PI / 2);
const markMat = new THREE.MeshStandardMaterial({
  color: 0x3a1608, roughness: 1, alphaMap: treadTex, transparent: true, opacity: 0.8,
  depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
const marks = new THREE.InstancedMesh(markGeo, markMat, MAX_MARKS);
marks.count = 0;
marks.frustumCulled = false;
marks.receiveShadow = true;
scene.add(marks);
let markIndex = 0, markFilled = 0;
const lastStamp = { x: state.x, z: state.z, h: state.heading };
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

function terrainNormal(x, z) {
  const e = 0.3;
  return new THREE.Vector3(
    -(height(x + e, z) - height(x - e, z)),
    2 * e,
    -(height(x, z + e) - height(x, z - e))
  ).normalize();
}
function wheelWorld(lx, lz) {
  const s = Math.sin(state.heading), c = Math.cos(state.heading);
  return [state.x + lx * c + lz * s, state.z - lx * s + lz * c];
}
function stampTracks() {
  _qy.setFromAxisAngle(UP, state.heading);
  for (const lz of WHEEL_Z) {
    for (const lx of [-WHEEL_X, WHEEL_X]) {
      const [wx, wz] = wheelWorld(lx, lz);
      _p.set(wx, height(wx, wz) + 0.05, wz);
      _q.setFromUnitVectors(UP, terrainNormal(wx, wz)).multiply(_qy);
      _m.compose(_p, _q, _s);
      marks.setMatrixAt(markIndex, _m);
      markIndex = (markIndex + 1) % MAX_MARKS;
      markFilled = Math.min(markFilled + 1, MAX_MARKS);
    }
  }
  marks.count = markFilled;
  marks.instanceMatrix.needsUpdate = true;
  lastStamp.x = state.x; lastStamp.z = state.z; lastStamp.h = state.heading;
}

// ---------- Control WASD ----------
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const MAX_SPEED = 5;   // m/s
const TURN_RATE = 1.3; // rad/s

function updateRover(dt) {
  const visor = window.__visorAbierto === true; // con una foto abierta el rover no responde a las teclas
  const throttle = visor ? 0 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const steer = visor ? 0 : (keys.KeyA ? 1 : 0) - (keys.KeyD ? 1 : 0);
  // la pendiente frena al subir y empuja al bajar (pitch positivo = nariz abajo en este modelo)
  const pendiente = Math.tan(-state.pitch); // >0: el frente está más alto que atrás
  const enContra = pendiente * (state.speed >= 0 ? 1 : -1);
  const factor = THREE.MathUtils.clamp(1 - 2.2 * enContra, 0.35, 1.3);
  const target = throttle * MAX_SPEED * (throttle < 0 ? 0.6 : 1) * (throttle ? factor : 1);
  state.speed += (target - state.speed) * (1 - Math.exp(-3 * dt));
  if (!throttle) {
    state.speed -= MARS_G * pendiente * 0.5 * dt;            // sin acelerar, la gravedad lo mueve cuesta abajo
    state.speed *= Math.exp(-(0.6 + 5 * Math.max(0, 0.12 - Math.abs(pendiente))) * dt); // fricción: en plano frena rápido
    if (Math.abs(state.speed) < 0.02) state.speed = 0;
  }
  state.yawRate = steer * TURN_RATE * (1 - Math.min(0.5, Math.abs(state.speed) / MAX_SPEED * 0.3));
  state.heading += state.yawRate * dt;
  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z += Math.cos(state.heading) * state.speed * dt;

  // choque suave con rocas grandes
  for (const r of rocks) {
    const dx = state.x - r.x, dz = state.z - r.z;
    const d = Math.hypot(dx, dz), min = r.r + 1.4;
    if (d < min && d > 0.001) {
      state.x = r.x + (dx / d) * min;
      state.z = r.z + (dz / d) * min;
      state.speed *= 0.5;
    }
  }
  // límites del terreno
  const cx = THREE.MathUtils.clamp(state.x, -MAX_X, MAX_X);
  const cz = THREE.MathUtils.clamp(state.z, MIN_Z, MAX_Z);
  if (cx !== state.x || cz !== state.z) state.speed = 0;
  state.x = cx; state.z = cz;

  // se apoya en el terreno: altura, cabeceo y alabeo según las ruedas
  const h = (lx, lz) => { const [wx, wz] = wheelWorld(lx, lz); return height(wx, wz); };
  const hF = (h(-WHEEL_X, WHEEL_Z[0]) + h(WHEEL_X, WHEEL_Z[0])) / 2;
  const hR = (h(-WHEEL_X, WHEEL_Z[2]) + h(WHEEL_X, WHEEL_Z[2])) / 2;
  const hPX = (h(WHEEL_X, WHEEL_Z[0]) + h(WHEEL_X, WHEEL_Z[1]) + h(WHEEL_X, WHEEL_Z[2])) / 3;
  const hMX = (h(-WHEEL_X, WHEEL_Z[0]) + h(-WHEEL_X, WHEEL_Z[1]) + h(-WHEEL_X, WHEEL_Z[2])) / 3;
  const targetPitch = -Math.atan2(hF - hR, WB);
  const targetRoll = Math.atan2(hPX - hMX, 2 * WHEEL_X);
  const ks = 1 - Math.exp(-8 * dt);
  state.pitch += (targetPitch - state.pitch) * ks;
  state.roll += (targetRoll - state.roll) * ks;
  state.y = (hF + hR + hPX + hMX) / 4 + 0.03;
  rover.position.set(state.x, state.y, state.z);
  rover.rotation.set(state.pitch, state.heading, state.roll);
  const fis = actualizarRuedas(wheels, { dt, speed: state.speed, yawRate: state.yawRate, heading: state.heading, wheelWorld, height });
  rover.position.y += fis.bob;

  // huellas
  if (Math.hypot(state.x - lastStamp.x, state.z - lastStamp.z) > STAMP_STEP ||
      Math.abs(state.heading - lastStamp.h) > 0.25) stampTracks();
}

// ---------- Cámara que sigue al rover ----------
const camLook = new THREE.Vector3();
const camWant = new THREE.Vector3();
function updateCamera(dt, snap = false) {
  const fx = Math.sin(state.heading), fz = Math.cos(state.heading);
  camWant.set(state.x - fx * 9.5, 0, state.z - fz * 9.5);
  camWant.y = Math.max(height(camWant.x, camWant.z) + 2.2, state.y + 4.6);
  const k = snap ? 1 : 1 - Math.exp(-3.2 * dt);
  camera.position.lerp(camWant, k);
  const look = new THREE.Vector3(state.x + fx * 3, state.y + 1.3, state.z + fz * 3);
  camLook.lerp(look, snap ? 1 : 1 - Math.exp(-5 * dt));
  camera.lookAt(camLook);
}

// Con el panel de misión abierto, la vista se corre a la izquierda para que no tape al rover.
let corrimiento = 0;
function corrimientoVista(dt) {
  const panel = document.getElementById('mision');
  const objetivo = panel && !panel.hidden && window.innerWidth > 900 ? Math.min(0.2 * window.innerWidth, 280) : 0;
  corrimiento += (objetivo - corrimiento) * (1 - Math.exp(-6 * dt));
  if (corrimiento > 0.5) camera.setViewOffset(window.innerWidth, window.innerHeight, corrimiento, 0, window.innerWidth, window.innerHeight);
  else camera.clearViewOffset();
}

// ---------- Bucle ----------
const clock = new THREE.Clock();
updateRover(0.016);
updateCamera(0, true);
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  updateRover(dt);
  updateCamera(dt);
  corrimientoVista(dt);
  camaras?.actualizar(clock.elapsedTime);

  sun.target.position.copy(rover.position);
  sun.position.copy(rover.position).add(SUN_OFFSET);
  celestial.position.copy(camera.position);
  dust.position.set(state.x, 0, state.z);
  renderer.render(scene, camera);
}
animate();
window.__rover = state;
window.__dbg = { scene, renderer, camera };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
