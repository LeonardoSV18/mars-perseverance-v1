// npm run check: abre la página en Chrome headless (Chrome del sistema vía Playwright),
// guarda una captura y lista errores de consola. Sale con código 1 si hay errores.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';

const URL = process.env.CHECK_URL || 'http://localhost:5173/';
const OUT = process.env.CHECK_OUT || 'captures/latest.png';

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));

const errors = [];
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// El render por software (SwiftShader) emite avisos de rendimiento "GPU stall" que no son errores reales.
const ruido = /GPU stall|GL Driver Message/i;
const roverLogs = [];
const misionLogs = [];
// CHECK_PHOTOS=carpeta sirve esa carpeta como /photos/ (solo para probar el código; las fotos de prueba no son de Marte).
if (process.env.CHECK_PHOTOS) {
  const { readFileSync, existsSync: hay } = await import('node:fs');
  await page.route('**/photos/**', (r) => {
    const rel = decodeURIComponent(new globalThis.URL(r.request().url()).pathname.replace(/^\/photos\//, ''));
    const f = `${process.env.CHECK_PHOTOS}/${rel}`;
    if (!hay(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: readFileSync(f), contentType: f.endsWith('.json') ? 'application/json' : 'image/jpeg' });
  });
  console.log(`AVISO: usando fotos de prueba de ${process.env.CHECK_PHOTOS}; NO son de Marte.`);
}
// CHECK_FIXTURE=ruta.json sirve ese archivo en lugar de public/data/M20_waypoints.json (solo para probar el código).
if (process.env.CHECK_FIXTURE) {
  await page.route('**/data/M20_waypoints.json', (r) => r.fulfill({ path: process.env.CHECK_FIXTURE, contentType: 'application/json' }));
  console.log(`AVISO: usando archivo de prueba ${process.env.CHECK_FIXTURE}; los números NO son de la NASA.`);
}
page.on('console', (m) => {
  if (m.text().startsWith('[rover]')) roverLogs.push(m.text());
  if (m.text().startsWith('[mision]') && m.type() === 'log') misionLogs.push(m.text());
  if ((m.type() === 'error' || m.type() === 'warning') && !ruido.test(m.text())) errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 }).catch(() => errors.push('[check] la escena no marcó __ready'));
await page.waitForTimeout(1500);
await page.waitForFunction(() => window.__mission?.listo === true, null, { timeout: 20000 }).catch(() => errors.push('[check] el control de misión no terminó de cargar'));

// Control de misión: los 4 datos deben tener un número, y la tecla T debe ocultar y mostrar el panel.
const IDS = ['distancia', 'altura', 'inclinacion', 'luz'];
const datos = await page.evaluate(() => JSON.parse(JSON.stringify(window.__mission?.datos || {})));
for (const id of IDS) {
  const d = datos[id];
  if (d?.ok && Number.isFinite(d.valor)) console.log(`Dato ${id}: ${d.valor.toFixed(3)} ${d.unidad} (${d.proveedor}, ${d.puntos} puntos)`);
  else errors.push(`[check] dato "${id}" sin número${d?.error ? `: ${d.error}` : ''}`);
}
const visible = () => page.evaluate(() => !document.getElementById('mision').hidden);
if (!(await visible())) errors.push('[check] el panel debería estar visible al inicio');
await page.keyboard.press('t');
if (await visible()) errors.push('[check] T no ocultó el panel');
await page.keyboard.press('t');
if (!(await visible())) errors.push('[check] T no volvió a mostrar el panel');
console.log('Tecla T: oculta y muestra el panel.');

// Cámaras: pasar el mouse muestra el nombre; un clic abre una foto real; flechas cambian de foto; Esc vuelve al juego.
const piezas = await page.evaluate(() => window.__camaras?.piezas() || []);
if (piezas.length !== 4) errors.push(`[check] se esperaban 4 cámaras y hay ${piezas.length}`);
for (const pieza of piezas) {
  const pos = await page.evaluate((p) => window.__camaras.pantalla(p), pieza);
  await page.mouse.move(pos.x, pos.y);
  await page.waitForTimeout(150);
  const tip = await page.evaluate(() => { const t = document.getElementById('cam-tip'); return t.hidden ? '' : t.textContent; });
  if (!tip.includes(pieza)) errors.push(`[check] ${pieza}: el mouse encima no muestra su nombre`);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForFunction(() => window.__camaras.estado.revelado === true, null, { timeout: 90000 }).catch(() => errors.push(`[check] ${pieza}: la foto no terminó de revelarse`));
  const info = await page.evaluate(() => ({ foto: window.__camaras.estado.foto, abierto: window.__camaras.estado.abierto, img: !!document.querySelector('#visor .foto canvas, #visor .foto img') }));
  if (!info.abierto || !info.foto || !info.img) errors.push(`[check] ${pieza}: no se abrió una foto real`);
  else {
    console.log(`Cámara ${pieza}: foto ${info.foto.archivo} (${info.foto.camara}, sol ${info.foto.sol})`);
    await page.screenshot({ path: OUT.replace(/\.png$/, `-camara-${pieza}.png`) });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (await page.evaluate(() => window.__visorAbierto)) errors.push(`[check] ${pieza}: Esc no cerró el visor`);
}
await page.mouse.move(5, 5);

mkdirSync(OUT.split('/').slice(0, -1).join('/') || '.', { recursive: true });
const START = OUT.replace(/\.png$/, '-inicio.png');
await page.screenshot({ path: START });

// Conduce un rato con WASD para comprobar movimiento, huellas y cámara.
const antes = await page.evaluate(() => ({ x: window.__rover?.x, z: window.__rover?.z }));
// El render por software va lento, así que se espera a que recorra distancia en vez de un tiempo fijo.
const recorrida = async (min, maxMs) => {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const p = await page.evaluate(() => ({ x: window.__rover.x, z: window.__rover.z }));
    if (Math.hypot(p.x - antes.x, p.z - antes.z) >= min) return;
    await page.waitForTimeout(250);
  }
};
await page.keyboard.down('w');
await recorrida(8, 25000);
await page.keyboard.down('a');
await page.waitForTimeout(1500);
await page.keyboard.up('a');
await recorrida(16, 25000);
await page.keyboard.up('w');
await page.waitForTimeout(1500);
const despues = await page.evaluate(() => ({ x: window.__rover?.x, z: window.__rover?.z }));
const recorrido = Math.hypot(despues.x - antes.x, despues.z - antes.z);
await page.screenshot({ path: OUT });
await browser.close();

roverLogs.forEach((l) => console.log(l));
misionLogs.forEach((l) => console.log(l));
console.log(`Rover recorrió ${recorrido.toFixed(1)} m al pulsar W.`);
if (!(recorrido > 1)) errors.push('[check] el rover no se movió con W');
console.log(`Capturas: ${START} y ${OUT}`);
if (errors.length) {
  console.log(`Errores de consola (${errors.length}):`);
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
}
console.log('Sin errores de consola.');
