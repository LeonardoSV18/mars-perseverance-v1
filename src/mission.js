// Control de misión dentro de la simulación.
// Patrón tomado de Open MCT: cada dato es un objeto con nombre, unidad y proveedor;
// el proveedor sabe entregar sus valores (históricos y el último); la vista los dibuja.
import './mission.css';

// ---------- Proveedores ----------
const NASA = {
  id: 'nasa-mmgis-m20',
  nombre: 'NASA · MMGIS M20 waypoints',
  archivo: '/data/M20_waypoints.json', // https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json
};
const CALCULO = { id: 'calculo-orbital', nombre: 'Cálculo en vivo · órbitas' };

const LANDING_MS = Date.UTC(2021, 1, 18, 20, 55); // aterrizaje de Perseverance en Jezero
const AU_LUZ_S = 499.00478; // segundos que tarda la luz en recorrer 1 UA

const fmt = (v, d = 0) => v.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const log = (...a) => console.log('[mision]', ...a);

// ---------- Tiempo de luz Tierra–Marte (elementos keplerianos medios, JPL, 1800–2050) ----------
const ELEM = {
  tierra: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], I: [-0.00001531, -0.01294668], L: [100.46457166, 35999.37244981], w: [102.93768193, 0.32327364], O: [0, 0] },
  marte: { a: [1.52371034, 0.00001847], e: [0.0933941, 0.00007882], I: [1.84969142, -0.00813131], L: [-4.55343205, 19140.30268499], w: [-23.94362959, 0.44441088], O: [49.55953891, -0.29257343] },
};
const rad = (d) => (d * Math.PI) / 180;
function posicion(el, T) {
  const v = (k) => el[k][0] + el[k][1] * T;
  const a = v('a'), e = v('e'), I = rad(v('I')), w = v('w'), O = rad(v('O'));
  let M = rad(((v('L') - w + 540) % 360) - 180);
  let E = M;
  for (let i = 0; i < 12; i++) E = M + e * Math.sin(E);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const om = rad(w) - O;
  const cO = Math.cos(O), sO = Math.sin(O), co = Math.cos(om), so = Math.sin(om), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}
export function minutosLuz(ms) {
  const T = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
  const a = posicion(ELEM.tierra, T), b = posicion(ELEM.marte, T);
  return (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * AU_LUZ_S) / 60;
}
const solDe = (ms) => (ms - LANDING_MS) / 88775.244 / 1000; // un sol marciano = 88 775,244 s

// ---------- Lectura del historial de manejos de la NASA ----------
async function leerNasa() {
  const res = await fetch(NASA.archivo, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} al pedir ${NASA.archivo}`);
  let json;
  try { json = JSON.parse(await res.text()); } catch { throw new Error(`${NASA.archivo} no es un JSON válido (¿falta el archivo?)`); }
  const feats = Array.isArray(json) ? json : json.features || json.waypoints || [];
  const filas = feats.map((f, i) => ({ p: f.properties || f, z: f.geometry?.coordinates?.[2], i }));
  if (!filas.length) throw new Error('el archivo no trae puntos');
  const claves = new Set();
  filas.slice(0, 200).forEach((r) => Object.keys(r.p).forEach((k) => claves.add(k)));
  log('campos encontrados:', [...claves].join(', '));
  const buscar = (cands) => cands.find((c) => claves.has(c));
  // la NASA marca los valores que faltan con -9999
  const num = (v) => (v === null || v === '' || v === undefined || Number(v) <= -9990 ? NaN : Number(v));

  const kSol = buscar(['sol', 'Sol']);
  const kDist = buscar(['dist_total_m', 'dist_total', 'total_dist_m', 'dist_m', 'dist']);
  const kElev = buscar(['elev_geoid', 'elev_radius', 'elevation', 'elev']);
  const kTilt = buscar(['tilt', 'tilt_deg', 'inclination']);
  const kPitch = buscar(['pitch']), kRoll = buscar(['roll']);
  log(`mapeo: sol=${kSol} distancia=${kDist} altura=${kElev ?? 'coordenada z'} inclinación=${kTilt ?? (kPitch && kRoll ? 'pitch+roll' : 'ninguno')}`);

  filas.sort((a, b) => (num(a.p[kSol]) - num(b.p[kSol])) || a.i - b.i);
  const serie = (fn) => filas.map((r) => ({ sol: num(r.p[kSol]), v: fn(r) })).filter((d) => Number.isFinite(d.v) && Number.isFinite(d.sol));

  let acum = 0, maximo = 0;
  const esTotal = kDist && /total/.test(kDist);
  return {
    // El total recorrido nunca baja. Las filas "Mid-drive localization" de la NASA traen 0 y se ignoran con el máximo acumulado.
    distancia: kDist ? serie((r) => { const m = num(r.p[kDist]); if (esTotal) { if (Number.isFinite(m)) maximo = Math.max(maximo, m); return maximo / 1000; } acum += Number.isFinite(m) ? m : 0; return acum / 1000; }) : [],
    altura: serie((r) => (kElev ? num(r.p[kElev]) : num(r.z))),
    inclinacion: serie((r) => (kTilt ? num(r.p[kTilt]) : kPitch && kRoll ? Math.hypot(num(r.p[kPitch]), num(r.p[kRoll])) : NaN)),
  };
}

// ---------- Datos (nombre, unidad, proveedor) ----------
const DATOS = [
  {
    id: 'distancia', nombre: 'Distancia recorrida', unidad: 'km', proveedor: NASA, eje: 'sol', dec: 2,
    frase: (v) => `Percy ya manejó ${fmt(v, 1)} km desde que aterrizó${v >= 42.195 ? ', más que una maratón entera' : ''}.`,
  },
  {
    id: 'altura', nombre: 'Altura del terreno', unidad: 'm', proveedor: NASA, eje: 'sol', dec: 1,
    frase: (v) => (v < 0
      ? `El suelo está ${fmt(-v, 0)} m por debajo del nivel de referencia de Marte: Percy anda dentro de un cráter.`
      : `El suelo está ${fmt(v, 0)} m por encima del nivel de referencia de Marte.`),
  },
  {
    id: 'inclinacion', nombre: 'Inclinación', unidad: '°', proveedor: NASA, eje: 'sol', dec: 1,
    frase: (v) => `El rover está inclinado ${fmt(v, 1)}° respecto a la horizontal; 0° sería un suelo perfectamente plano.`,
  },
  {
    id: 'luz', nombre: 'Luz Tierra–Marte', unidad: 'min', proveedor: CALCULO, eje: 'fecha', dec: 2,
    frase: (v) => `Una orden desde la Tierra tarda ${fmt(v, 1)} min en llegar a Percy, y la respuesta otros ${fmt(v, 1)}. Por eso no se maneja en directo.`,
  },
];

const estado = { listo: false, datos: {} };
window.__mission = estado;

// ---------- Vista ----------
const panel = document.createElement('aside');
panel.id = 'mision';
panel.innerHTML = '<header><b>CONTROL DE MISIÓN · PERSEVERANCE</b><span id="mision-sol">cargando…</span></header><div class="rejilla"></div>';
document.body.appendChild(panel);
const rejilla = panel.querySelector('.rejilla');
const elSol = panel.querySelector('#mision-sol');

for (const d of DATOS) {
  const el = document.createElement('section');
  el.className = 'dato';
  el.innerHTML = `
    <div class="nombre"><span>${d.nombre}</span></div>
    <div class="valor vacio">cargando…</div>
    <canvas></canvas>
    <div class="eje"><span></span><span></span></div>
    <div class="frase"></div>
    <div class="prov">Proveedor: <i>${d.proveedor.nombre}</i></div>`;
  rejilla.appendChild(el);
  d.el = el;
  estado.datos[d.id] = { ok: false, valor: null, unidad: d.unidad, proveedor: d.proveedor.id };
}

function dibujar(d) {
  const c = d.el.querySelector('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const s = d.serie;
  const xs = s.map((p) => p.x), ys = s.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const X = (x) => 2 + ((x - x0) / (x1 - x0 || 1)) * (w - 4);
  const Y = (y) => h - 3 - ((y - y0) / (y1 - y0)) * (h - 6);
  g.strokeStyle = 'rgba(255,178,90,0.14)'; g.lineWidth = 1;
  for (let i = 0; i <= 2; i++) { const yy = 3 + (i * (h - 6)) / 2; g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke(); }
  const paso = Math.max(1, Math.floor(s.length / 300));
  g.beginPath();
  s.forEach((p, i) => { if (i % paso && i !== s.length - 1) return; i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y)); });
  g.strokeStyle = '#ff9a5c'; g.lineWidth = 1.6; g.stroke();
  g.lineTo(X(x1), h); g.lineTo(X(x0), h); g.closePath(); g.fillStyle = 'rgba(255,154,92,0.14)'; g.fill();
  const u = s[s.length - 1];
  g.beginPath(); g.arc(X(u.x), Y(u.y), 3, 0, 7); g.fillStyle = '#fff3df'; g.fill();
}

function mostrar(d, valor, serie, etiquetas) {
  d.serie = serie;
  d.valor = valor;
  const el = d.el;
  const v = el.querySelector('.valor');
  v.classList.remove('vacio');
  v.innerHTML = `${fmt(valor, d.dec)}<small>${d.unidad}</small>`;
  el.querySelector('.frase').textContent = d.frase(valor);
  const ej = el.querySelectorAll('.eje span');
  ej[0].textContent = etiquetas[0]; ej[1].textContent = etiquetas[1];
  dibujar(d);
  estado.datos[d.id] = { ok: true, valor, unidad: d.unidad, proveedor: d.proveedor.id, puntos: serie.length };
}
function fallo(d, msg) {
  const v = d.el.querySelector('.valor');
  v.classList.add('vacio');
  v.textContent = 'Sin datos';
  d.el.querySelector('.frase').textContent = msg;
  estado.datos[d.id] = { ok: false, valor: null, unidad: d.unidad, proveedor: d.proveedor.id, error: msg };
  console.error(`[mision] ${d.nombre}: ${msg}`);
}

// Tiempo de luz: toda la misión, un punto por semana, más el valor de ahora.
function luzMision() {
  const ahora = Date.now(), pts = [];
  for (let t = LANDING_MS; t < ahora; t += 7 * 86400000) pts.push({ x: t, y: minutosLuz(t) });
  pts.push({ x: ahora, y: minutosLuz(ahora) });
  return pts;
}
const dLuz = DATOS.find((d) => d.id === 'luz');
function actualizarLuz() {
  const serie = luzMision();
  const f = (ms) => new Date(ms).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
  mostrar(dLuz, serie[serie.length - 1].y, serie, [`${f(LANDING_MS)} · aterrizaje`, 'ahora']);
}
actualizarLuz();
setInterval(actualizarLuz, 1000);

(async () => {
  try {
    const nasa = await leerNasa();
    for (const d of DATOS.filter((x) => x.proveedor === NASA)) {
      const crudo = nasa[d.id];
      if (!crudo.length) { fallo(d, 'El archivo de la NASA no trae este campo.'); continue; }
      const serie = crudo.map((p) => ({ x: p.sol, y: p.v }));
      const ult = crudo[crudo.length - 1];
      mostrar(d, ult.v, serie, [`sol ${fmt(serie[0].x)}`, `sol ${fmt(ult.sol)}`]);
    }
    const solUlt = nasa.distancia.at(-1)?.sol ?? nasa.altura.at(-1)?.sol;
    elSol.textContent = Number.isFinite(solUlt) ? `último manejo: sol ${fmt(solUlt)} · hoy ≈ sol ${fmt(solDe(Date.now()))}` : '';
  } catch (err) {
    for (const d of DATOS.filter((x) => x.proveedor === NASA)) fallo(d, `No se pudo leer el historial de la NASA. ${err.message}`);
    elSol.textContent = `hoy ≈ sol ${fmt(solDe(Date.now()))}`;
  }
  estado.listo = true;
})();

// ---------- Tecla T ----------
addEventListener('keydown', (e) => {
  if (e.code === 'KeyT' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) DATOS.forEach((d) => d.serie && dibujar(d));
  }
});
addEventListener('resize', () => DATOS.forEach((d) => d.serie && !panel.hidden && dibujar(d)));
