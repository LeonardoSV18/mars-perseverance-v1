// npm run fotos
// Baja fotos candidatas recientes de cada cámara de Percy desde la API de imágenes crudas de la NASA
// y las guarda en public/photos/candidatos/<pieza>/ con sus datos (cámara, sol, fecha).
// No usa dependencias: solo Node 18 o superior. Se corre en tu computadora (necesita internet).
//
//   npm run fotos                 -> 60 candidatas por cámara
//   npm run fotos -- --por 100    -> otro número
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const POR_CAMARA = Number(process.argv[process.argv.indexOf('--por') + 1]) || 60;
const BASE = 'https://mars.nasa.gov/rss/api/';
const SALIDA = 'public/photos/candidatos';

// pieza del modelo -> nombres de instrumento en la API de la NASA
const CAMARAS = {
  Mastcam_Z_cams: ['MCZ_LEFT', 'MCZ_RIGHT'],
  NavCams: ['NAVCAM_LEFT', 'NAVCAM_RIGHT'],
  hazcams_front: ['FRONT_HAZCAM_LEFT_A', 'FRONT_HAZCAM_RIGHT_A'],
  WATSON: ['SHERLOC_WATSON'],
};

async function pedir(token, pagina) {
  const url = `${BASE}?feed=raw_images&category=mars2020&feedtype=json&ver=1.2&num=100&page=${pagina}&order=sol+desc&search=${encodeURIComponent('|' + token + '|')}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (marte-paisaje)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.json();
}

const esMiniatura = (it) => /thumb/i.test(`${it.sample_type ?? ''} ${it.image_files?.small ?? ''}`) && !it.image_files?.large && !it.image_files?.medium;
const urlFoto = (it) => it.image_files?.large || it.image_files?.medium || it.image_files?.full_res;

const todo = {};
for (const [pieza, tokens] of Object.entries(CAMARAS)) {
  const cand = [];
  for (const token of tokens) {
    for (let pag = 0; pag < 3 && cand.length < POR_CAMARA * 3; pag++) {
      let datos;
      try { datos = await pedir(token, pag); } catch (e) { console.error(`  ${token} página ${pag}: ${e.message}`); break; }
      const imgs = datos.images || [];
      if (pag === 0 && imgs[0]) console.log(`  ${token}: ${datos.total_results ?? '?'} fotos en total. Campos: ${Object.keys(imgs[0]).join(', ')}`);
      if (!imgs.length) break;
      for (const it of imgs) {
        if (esMiniatura(it) || !urlFoto(it)) continue;
        cand.push({
          pieza, camara: it.camera?.instrument || token, id: it.imageid, sol: it.sol,
          fecha: it.date_taken_utc || it.date_received, tipo: it.sample_type, titulo: it.title, url: urlFoto(it),
        });
      }
    }
  }
  // mezcla las cámaras izquierda y derecha y se queda con las más recientes
  cand.sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
  todo[pieza] = cand.slice(0, POR_CAMARA);
  console.log(`${pieza}: ${todo[pieza].length} candidatas`);
}

let bajadas = 0, fallos = 0;
const cola = [];
for (const [pieza, lista] of Object.entries(todo)) {
  mkdirSync(join(SALIDA, pieza), { recursive: true });
  for (const f of lista) {
    f.archivo = `candidatos/${pieza}/${f.id}.jpg`;
    const destino = join('public/photos', f.archivo);
    if (existsSync(destino)) continue;
    cola.push(async () => {
      try {
        const r = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 (marte-paisaje)' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        writeFileSync(destino, Buffer.from(await r.arrayBuffer()));
        bajadas++;
      } catch (e) { fallos++; f.error = e.message; console.error(`  ${f.id}: ${e.message}`); }
    });
  }
}
const trabajadores = Array.from({ length: 6 }, async () => { while (cola.length) await cola.shift()(); });
await Promise.all(trabajadores);

writeFileSync(join(SALIDA, 'candidatos.json'), JSON.stringify(todo, null, 1));
console.log(`\nListo: ${bajadas} fotos nuevas, ${fallos} con error.`);
console.log(`Fotos y datos en ${SALIDA}/. Comprime esa carpeta y envíamela para elegir las más impresionantes.`);
