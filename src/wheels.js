// Ruedas de Percy: el modelo trae las 6 ruedas fusionadas en una sola malla ("Wheels_objs").
// Aquí se separa cada rueda, y cada una gira, gira de dirección y sigue el terreno por su cuenta.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const log = (...a) => console.log('[rover]', ...a);

// ---------- Separar las ruedas ----------
function islas(geom) {
  const pos = geom.attributes.position;
  const idx = geom.index ? geom.index.array : null;
  const nTri = (idx ? idx.length : pos.count) / 3;
  const vid = (i) => (idx ? idx[i] : i);
  // soldar vértices con la misma posición para que las aristas duras no corten una pieza en dos
  const clave = new Map(), soldado = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (!clave.has(k)) clave.set(k, clave.size);
    soldado[i] = clave.get(k);
  }
  const padre = Int32Array.from({ length: clave.size }, (_, i) => i);
  const raiz = (a) => { while (padre[a] !== a) { padre[a] = padre[padre[a]]; a = padre[a]; } return a; };
  for (let t = 0; t < nTri; t++) {
    const a = raiz(soldado[vid(t * 3)]), b = raiz(soldado[vid(t * 3 + 1)]), c = raiz(soldado[vid(t * 3 + 2)]);
    padre[b] = a; padre[c] = a;
  }
  const porIsla = new Map();
  for (let t = 0; t < nTri; t++) {
    const r = raiz(soldado[vid(t * 3)]);
    if (!porIsla.has(r)) porIsla.set(r, []);
    porIsla.get(r).push(t);
  }
  return [...porIsla.values()];
}

function geometriaDeTriangulos(geom, tris) {
  const idx = geom.index ? geom.index.array : null;
  const vid = (i) => (idx ? idx[i] : i);
  const nombres = Object.keys(geom.attributes);
  const out = new THREE.BufferGeometry();
  for (const n of nombres) {
    const src = geom.attributes[n], size = src.itemSize;
    const arr = new Float32Array(tris.length * 3 * size);
    let o = 0;
    for (const t of tris) for (let v = 0; v < 3; v++) {
      const i = vid(t * 3 + v);
      for (let c = 0; c < size; c++) arr[o++] = src.array[i * size + c];
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

export function crearRuedas(model, rover) {
  model.updateMatrixWorld(true);
  const raiz = model.getObjectByName('Wheels_objs');
  if (!raiz) { console.error('[rover] no encontré la malla Wheels_objs'); return null; }
  const mallas = [];
  raiz.traverse((o) => { if (o.isMesh) mallas.push(o); });
  const k = model.scale.x;
  const aModelo = new THREE.Matrix4();
  const invModelo = model.matrixWorld.clone().invert();

  // 1) islas de cada malla, con su centro en el espacio del modelo
  const trozos = [];
  for (const m of mallas) {
    aModelo.multiplyMatrices(invModelo, m.matrixWorld);
    const g = m.geometry.clone();
    g.applyMatrix4(aModelo);
    for (const tris of islas(g)) {
      const gi = geometriaDeTriangulos(g, tris);
      gi.computeBoundingBox();
      trozos.push({ geom: gi, material: m.material, centro: gi.boundingBox.getCenter(new THREE.Vector3()) });
    }
    m.parent.remove(m);
  }
  if (!trozos.length) return null;

  // 2) agrupar por rueda: lado (según x) y fila (delantera, media, trasera según z)
  const xs = trozos.map((t) => t.centro.x), zs = trozos.map((t) => t.centro.z);
  const xm = (Math.min(...xs) + Math.max(...xs)) / 2, zm = (Math.min(...zs) + Math.max(...zs)) / 2;
  const banda = (Math.max(...zs) - Math.min(...zs)) / 6;
  const grupos = new Map();
  for (const t of trozos) {
    const lado = t.centro.x < xm ? -1 : 1;
    const fila = t.centro.z > zm + banda ? 1 : t.centro.z < zm - banda ? -1 : 0;
    const key = `${lado},${fila}`;
    if (!grupos.has(key)) grupos.set(key, { lado, fila, trozos: [] });
    grupos.get(key).trozos.push(t);
  }

  // 3) una pieza por rueda: pivote (dirección) -> malla (giro sobre su eje X)
  const ruedas = [];
  for (const gr of grupos.values()) {
    const caja = new THREE.Box3();
    gr.trozos.forEach((t) => caja.union(t.geom.boundingBox));
    const c = caja.getCenter(new THREE.Vector3()), tam = caja.getSize(new THREE.Vector3());
    const pivote = new THREE.Group();
    pivote.position.copy(c);
    const giro = new THREE.Group();
    pivote.add(giro);
    // los pedazos sueltos de una rueda con el mismo material se funden en una sola malla (menos llamadas de dibujo)
    const porMaterial = new Map();
    for (const t of gr.trozos) {
      t.geom.translate(-c.x, -c.y, -c.z);
      if (!porMaterial.has(t.material)) porMaterial.set(t.material, []);
      porMaterial.get(t.material).push(t.geom);
    }
    for (const [material, geoms] of porMaterial) {
      const geom = geoms.length > 1 ? mergeGeometries(geoms, false) : geoms[0];
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      giro.add(mesh);
    }
    model.add(pivote);
    ruedas.push({
      pivote, giro, lado: gr.lado, fila: gr.fila,
      reposo: c.clone(),
      lx: c.x * k + model.position.x, lz: c.z * k + model.position.z, // posición respecto al rover, en metros
      radio: (Math.max(tam.y, tam.z) / 2) * k, ancho: tam.x * k,
      angulo: 0, direccion: 0, dy: 0, vy: 0, contacto: true,
    });
  }
  ruedas.sort((a, b) => b.fila - a.fila || a.lado - b.lado);
  log(`ruedas separadas: ${ruedas.length} (a partir de ${trozos.length} pedazos sueltos; mallas por rueda: ${ruedas.map((w) => w.giro.children.length).join(', ')})`);
  ruedas.forEach((w, i) => log(`  rueda ${i + 1} (fila ${w.fila}, lado ${w.lado}): lx=${w.lx.toFixed(2)} lz=${w.lz.toFixed(2)} radio=${w.radio.toFixed(3)} m ancho=${w.ancho.toFixed(3)} m`));
  return { ruedas, model, rover, polvo: crearPolvo(rover.parent) };
}

// ---------- Polvo que levantan las ruedas ----------
function crearPolvo(escena) {
  const N = 420;
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), edad = new Float32Array(N).fill(99), vida = new Float32Array(N).fill(1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(N), 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N), 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uEscala: { value: 600 } },
    vertexShader: `
      attribute float aAlpha; attribute float aSize; varying float vA; uniform float uEscala;
      void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = aSize * uEscala / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d) * vA;
        if (a < 0.01) discard; gl_FragColor = vec4(0.86, 0.58, 0.38, a); }`,
  });
  const puntos = new THREE.Points(geo, mat);
  puntos.frustumCulled = false;
  escena.add(puntos);
  return { N, pos, vel, edad, vida, geo, mat, puntos, sig: 0 };
}
function emitir(p, x, y, z, vx, vz, fuerza) {
  const i = p.sig; p.sig = (p.sig + 1) % p.N;
  p.pos[i * 3] = x; p.pos[i * 3 + 1] = y; p.pos[i * 3 + 2] = z;
  p.vel[i * 3] = vx * 0.25 + (Math.random() - 0.5) * 0.6;
  p.vel[i * 3 + 1] = 0.35 + Math.random() * 0.5 * fuerza;
  p.vel[i * 3 + 2] = vz * 0.25 + (Math.random() - 0.5) * 0.6;
  p.edad[i] = 0; p.vida[i] = 0.8 + Math.random() * 0.9;
}
function moverPolvo(p, dt) {
  const a = p.geo.attributes.aAlpha.array, s = p.geo.attributes.aSize.array;
  for (let i = 0; i < p.N; i++) {
    if (p.edad[i] > p.vida[i]) { a[i] = 0; continue; }
    p.edad[i] += dt;
    const f = p.edad[i] / p.vida[i];
    p.vel[i * 3 + 1] -= 0.4 * dt;
    p.pos[i * 3] += p.vel[i * 3] * dt; p.pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt; p.pos[i * 3 + 2] += p.vel[i * 3 + 2] * dt;
    a[i] = (1 - f) * 0.32; s[i] = 0.25 + f * 0.9;
  }
  p.geo.attributes.position.needsUpdate = true;
  p.geo.attributes.aAlpha.needsUpdate = true;
  p.geo.attributes.aSize.needsUpdate = true;
}

// ---------- Cada cuadro ----------
// ctx: { dt, speed, yawRate, heading, wheelWorld(lx,lz)->[x,z], height(x,z), pixelRatioScale }
const _v = new THREE.Vector3(), _dir = new THREE.Vector3();
let tVib = 0;
export function actualizarRuedas(W, ctx) {
  if (!W) return { bob: 0, slip: 0 };
  const { dt, speed, yawRate } = ctx;
  W.rover.updateMatrixWorld(true);
  const k = W.model.scale.x;
  tVib += dt;
  let rodando = 0;
  for (const w of W.ruedas) {
    // velocidad del punto donde está la rueda, en el sistema del rover (x derecha, z adelante)
    const vx = yawRate * w.lz, vz = speed - yawRate * w.lx;
    const esquina = w.fila !== 0;
    let ang = 0, signo = 1;
    if (esquina && Math.hypot(vx, vz) > 0.03) {
      ang = Math.atan2(vx, vz);
      if (Math.abs(ang) > Math.PI / 2) { ang -= Math.sign(ang) * Math.PI; signo = -1; }
    } else if (esquina) ang = w.direccion; // quieta: conserva la dirección
    w.direccion += (ang - w.direccion) * (1 - Math.exp(-9 * dt));
    w.pivote.rotation.y = w.direccion;
    const vRueda = esquina ? signo * Math.hypot(vx, vz) : vz;
    w.angulo += (vRueda / w.radio) * dt;
    w.giro.rotation.x = w.angulo;
    rodando += Math.abs(vRueda);

    // suspensión: la rueda sube o baja para tocar el suelo y rebota con resorte
    _v.copy(w.reposo).applyMatrix4(W.model.matrixWorld);          // centro de la rueda en reposo, mundo
    const [wx, wz] = ctx.wheelWorld(w.lx, w.lz);
    const suelo = ctx.height(wx, wz);
    const objetivo = THREE.MathUtils.clamp(suelo + w.radio - _v.y, -0.22, 0.22);
    w.vy += ((objetivo - w.dy) * 240 - w.vy * 24) * dt;
    w.dy += w.vy * dt;
    w.dy = THREE.MathUtils.clamp(w.dy, -0.24, 0.24);
    w.pivote.position.y = w.reposo.y + w.dy / k;

    // polvo bajo cada rueda al rodar
    const v = Math.abs(vRueda);
    if (v > 0.6 && Math.random() < Math.min(1, v * dt * 9)) {
      _dir.set(Math.sin(ctx.heading), 0, Math.cos(ctx.heading)).multiplyScalar(-Math.sign(speed || 1));
      emitir(W.polvo, wx, suelo + 0.05, wz, _dir.x * v, _dir.z * v, Math.min(1.5, v / 3));
    }
  }
  moverPolvo(W.polvo, dt);
  // vibración fina del cuerpo cuando va rápido
  const bob = Math.sin(tVib * 47) * 0.003 * Math.min(1, Math.abs(speed) / 3) + Math.sin(tVib * 19) * 0.002 * Math.min(1, Math.abs(speed) / 3);
  return { bob, rodando: rodando / W.ruedas.length };
}
