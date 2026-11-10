// Cámaras de Percy: puntos que brillan sobre sus piezas. Un clic dispara la cámara y revela una foto real.
import * as THREE from 'three';
import './camaras.css';

const CAMARAS = [
  { pieza: 'Mastcam_Z_cams', nombre: 'Mastcam-Z', detalle: 'cámaras del mástil, con zoom', desv: 0.11 },
  { pieza: 'NavCams', nombre: 'NavCams', detalle: 'cámaras de navegación', desv: -0.08 }, // desv: separa en pantalla puntos casi encimados (m)
  { pieza: 'hazcams_front', nombre: 'Hazcams delanteras', detalle: 'cámaras de peligros' },
  { pieza: 'WATSON', nombre: 'WATSON', detalle: 'cámara del brazo, de cerca' },
];
const log = (...a) => console.log('[camaras]', ...a);

const resplandor = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,236,200,1)');
  r.addColorStop(0.16, 'rgba(255,160,60,0.95)');
  r.addColorStop(0.45, 'rgba(255,110,30,0.3)');
  r.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

const dias = (iso) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? 'hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`;
};

export function crearCamaras({ scene, camera, canvas, model }) {
  model.updateMatrixWorld(true);

  // ---------- Puntos brillantes sobre cada pieza ----------
  const puntos = [];
  for (const c of CAMARAS) {
    const nodo = model.getObjectByName(c.pieza);
    if (!nodo) { console.error(`[camaras] no encontré la pieza ${c.pieza} en el modelo`); continue; }
    const centro = new THREE.Box3().setFromObject(nodo).getCenter(new THREE.Vector3());
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: resplandor, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false,
    }));
    const base = model.worldToLocal(centro.clone());
    sprite.position.copy(base);
    sprite.scale.setScalar(0.024);
    sprite.renderOrder = 999;
    model.add(sprite);
    puntos.push({ ...c, sprite, base, fase: Math.random() * 6.28, pantalla: new THREE.Vector2() });
  }

  // ---------- Etiqueta al pasar el mouse ----------
  const tip = document.createElement('div');
  tip.id = 'cam-tip'; tip.hidden = true;
  document.body.appendChild(tip);

  const _w = new THREE.Vector3(), _b = new THREE.Vector3(), arriba = new THREE.Vector3();
  function proyectar(p) {
    p.sprite.getWorldPosition(_w).project(camera);
    p.pantalla.set((_w.x * 0.5 + 0.5) * window.innerWidth, (-_w.y * 0.5 + 0.5) * window.innerHeight);
    p.detras = _w.z > 1;
  }
  let bajo = null;
  function buscar(x, y) {
    let mejor = null, d2 = 22 * 22;
    for (const p of puntos) {
      if (p.detras) continue;
      const d = (p.pantalla.x - x) ** 2 + (p.pantalla.y - y) ** 2;
      if (d < d2) { d2 = d; mejor = p; }
    }
    return mejor;
  }
  canvas.addEventListener('pointermove', (e) => {
    if (window.__visorAbierto) return;
    bajo = buscar(e.clientX, e.clientY);
    canvas.style.cursor = bajo ? 'pointer' : '';
    if (bajo) {
      tip.hidden = false;
      tip.innerHTML = `<b>${bajo.nombre.toUpperCase()}</b>${bajo.pieza}<br><small>${bajo.detalle} · clic para tomar una foto</small>`;
      tip.style.left = `${bajo.pantalla.x}px`; tip.style.top = `${bajo.pantalla.y}px`;
    } else tip.hidden = true;
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; bajo = null; });
  canvas.addEventListener('pointerdown', (e) => {
    if (window.__visorAbierto) return;
    const p = buscar(e.clientX, e.clientY);
    if (p) tomarFoto(p);
  });

  // ---------- Fotos (public/photos/seleccion.json) ----------
  let catalogo; // { pieza: [{archivo, sol, fecha, camara, id}] }
  async function cargarCatalogo() {
    if (catalogo !== undefined) return catalogo;
    try {
      const r = await fetch('/photos/seleccion.json', { cache: 'no-store' });
      catalogo = JSON.parse(await r.text());
    } catch {
      catalogo = null;
      console.error('[camaras] no hay public/photos/seleccion.json: corre "npm run fotos" y elige las mejores fotos');
    }
    return catalogo;
  }

  // ---------- Visor ----------
  const visor = document.createElement('div');
  visor.id = 'visor'; visor.hidden = true;
  document.body.appendChild(visor);
  const flash = document.createElement('div');
  flash.id = 'cam-flash';
  document.body.appendChild(flash);

  const est = { abierto: false, grande: false, pieza: null, i: 0, revelado: false, foto: null };
  window.__camaras = {
    estado: est,
    pantalla: (pieza) => { const p = puntos.find((x) => x.pieza === pieza); if (!p) return null; proyectar(p); return { x: p.pantalla.x, y: p.pantalla.y }; },
    piezas: () => puntos.map((p) => p.pieza),
  };

  let audio;
  function obturador() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audio.currentTime;
      [0, 0.09].forEach((off, n) => {
        const len = Math.floor(audio.sampleRate * 0.045);
        const buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
        const src = audio.createBufferSource(), g = audio.createGain(), f = audio.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = n ? 1800 : 2600; f.Q.value = 0.9;
        g.gain.value = 0.5;
        src.buffer = buf; src.connect(f); f.connect(g); g.connect(audio.destination);
        src.start(t0 + off);
      });
    } catch { /* el navegador puede bloquear el audio */ }
  }
  function destello() {
    flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
  }

  // Revela la foto poco a poco: pasa de bloques grandes a la imagen nítida.
  let anim = 0;
  function revelar(lienzo, img, ms) {
    const g = lienzo.getContext('2d');
    const W = lienzo.width = Math.min(1280, img.naturalWidth), H = lienzo.height = Math.round(W * img.naturalHeight / img.naturalWidth);
    const pasos = [6, 10, 16, 26, 42, 68, 110, 180, 300, 520, W];
    const mini = document.createElement('canvas');
    const t0 = performance.now(); est.revelado = false;
    cancelAnimationFrame(anim);
    const cuadro = (ahora) => {
      const f = Math.max(0, Math.min(1, (ahora - t0) / ms)); // el reloj del cuadro puede ir un instante antes que t0
      const e = 1 - Math.pow(1 - f, 2);
      const n = pasos[Math.min(pasos.length - 1, Math.floor(e * pasos.length))];
      const w = Math.max(2, Math.min(n, W)), h = Math.max(2, Math.round(w * H / W));
      mini.width = w; mini.height = h;
      mini.getContext('2d').drawImage(img, 0, 0, w, h);
      g.imageSmoothingEnabled = f >= 1;
      g.filter = `brightness(${0.35 + 0.65 * e}) saturate(${0.5 + 0.5 * e})`;
      g.clearRect(0, 0, W, H); g.drawImage(mini, 0, 0, W, H);
      g.filter = 'none';
      if (f < 1) anim = requestAnimationFrame(cuadro);
      else { est.revelado = true; }
    };
    anim = requestAnimationFrame(cuadro);
  }

  function pintar(rapido) {
    const lista = catalogo?.[est.pieza] || [];
    const cam = CAMARAS.find((c) => c.pieza === est.pieza);
    visor.classList.toggle('grande', est.grande);
    if (!lista.length) {
      visor.innerHTML = `<div class="tarjeta"><div class="nota"><b>${cam.nombre}</b><br>Todavía no hay fotos reales para esta cámara.<br>Corre <code>npm run fotos</code>, elige las mejores y vuelve a intentarlo.<br><br><span class="ayuda">Esc: volver al juego</span></div></div>`;
      est.revelado = true;
      console.error(`[camaras] ${cam.nombre}: sin fotos en public/photos/seleccion.json`);
      return;
    }
    est.i = (est.i + lista.length) % lista.length;
    const f = lista[est.i]; est.foto = f;
    visor.innerHTML = `
      <div class="tarjeta">
        <div class="foto"></div>
        <div class="pie">
          <span><b>${cam.nombre.toUpperCase()}</b> · ${f.camara || cam.pieza} · sol ${f.sol} · ${dias(f.fecha)}</span>
          <span class="ayuda">${lista.length > 1 ? `← → ${est.i + 1}/${lista.length} · ` : ''}clic: ${est.grande ? 'reducir' : 'ampliar'} · Esc: volver al juego</span>
        </div>
      </div>`;
    const marco = visor.querySelector('.foto');
    const img = new Image();
    img.onload = () => {
      if (est.foto !== f) return;
      if (est.grande || rapido) {
        cancelAnimationFrame(anim);
        marco.replaceChildren(img); est.revelado = true;
      } else {
        const lienzo = document.createElement('canvas');
        marco.appendChild(lienzo);
        revelar(lienzo, img, 2800);
      }
    };
    img.onerror = () => { marco.innerHTML = `<div class="nota">No se pudo abrir ${f.archivo}</div>`; console.error(`[camaras] no se pudo abrir la foto ${f.archivo}`); };
    img.src = `/photos/${f.archivo}`;
  }

  async function tomarFoto(p) {
    est.revelado = false;
    obturador(); destello();
    tip.hidden = true;
    await cargarCatalogo();
    est.abierto = true; est.grande = false; est.pieza = p.pieza; est.i = 0;
    window.__visorAbierto = true;
    visor.hidden = false;
    setTimeout(() => pintar(false), 180); // la foto se revela justo después del destello
  }
  function cerrar() {
    cancelAnimationFrame(anim);
    est.abierto = false; est.grande = false; est.revelado = false;
    window.__visorAbierto = false;
    visor.hidden = true; visor.innerHTML = '';
  }
  visor.addEventListener('click', (e) => {
    if (e.target.closest('.nota')) return;
    est.grande = !est.grande; pintar(est.grande);
  });
  addEventListener('keydown', (e) => {
    if (!est.abierto) return;
    if (e.code === 'Escape') { cerrar(); e.preventDefault(); }
    else if (e.code === 'ArrowRight') { est.i++; pintar(est.grande); e.preventDefault(); }
    else if (e.code === 'ArrowLeft') { est.i--; pintar(est.grande); e.preventDefault(); }
  });

  log(`${puntos.length} cámaras listas: ${puntos.map((p) => p.pieza).join(', ')}`);
  return {
    actualizar(t) {
      arriba.set(0, 1, 0).applyQuaternion(camera.quaternion);
      for (const p of puntos) {
        if (p.desv) { // separa Mastcam-Z y NavCams, que están a pocos centímetros, para poder señalar cada una
          _b.copy(p.base); model.localToWorld(_b); _b.addScaledVector(arriba, p.desv);
          p.sprite.position.copy(model.worldToLocal(_b));
        }
        proyectar(p);
        const pulso = 0.5 + 0.5 * Math.sin(t * 3 + p.fase);
        p.sprite.scale.setScalar(0.02 + 0.009 * pulso + (p === bajo ? 0.014 : 0));
        p.sprite.material.opacity = window.__visorAbierto ? 0 : 0.7 + 0.3 * pulso;
      }
      if (bajo && !tip.hidden) { tip.style.left = `${bajo.pantalla.x}px`; tip.style.top = `${bajo.pantalla.y}px`; }
    },
  };
}
