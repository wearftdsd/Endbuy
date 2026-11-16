/**
 * Génère les icônes de l'application (PNG, ICO multi-tailles, icône de zone de notification, pastille)
 * à partir du logo vectoriel endBuy. À lancer avec Electron :  npx electron scripts/make-icons.cjs
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'build');

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00D9B5"/><stop offset="1" stop-color="#0B8BF5"/></linearGradient></defs>
  <path d="M14 4h36c5.5 0 10 4.5 10 10v28c0 5.5-4.5 10-10 10H27l-11 9v-9h-2C8.5 52 4 47.5 4 42V14C4 8.5 8.5 4 14 4z" fill="url(#g)"/>
  <path d="M18.5 28.5h27M45.5 28.5a13.5 13.5 0 1 0-4 9.6" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
</svg>`;

/** Pastille rouge (notifications) dessinée pixel par pixel, avec anticrénelage. */
function badgeImage(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2 - 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const alpha = Math.max(0, Math.min(1, r - d + 0.5));
      const ring = d > r - 2.2;
      const [R, G, B] = ring ? [255, 255, 255] : [0xf0, 0x4f, 0x5a];
      const i = (y * size + x) * 4;
      buf[i] = Math.round(B * alpha);
      buf[i + 1] = Math.round(G * alpha);
      buf[i + 2] = Math.round(R * alpha);
      buf[i + 3] = Math.round(255 * alpha);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

async function render(svg) {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  win.destroy();
  const size = img.getSize();
  return size.width === 1024 ? img : img.resize({ width: 1024, height: 1024, quality: 'best' });
}

/** Entrée ICO au format DIB 32 bits (BGRA, de bas en haut + masque AND). */
function dibEntry(img, size) {
  const bmp = img.resize({ width: size, height: size, quality: 'best' }).toBitmap(); // BGRA
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(size * size * 4, 20);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    bmp.copy(pixels, (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4);
  }
  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size, 0);
  return Buffer.concat([header, pixels, mask]);
}

function buildIco(img) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((s) => (s === 256 ? img.resize({ width: 256, height: 256, quality: 'best' }).toPNG() : dibEntry(img, s)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const dir = Buffer.alloc(16 * sizes.length);
  let offset = 6 + dir.length;
  sizes.forEach((s, i) => {
    const o = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, o);
    dir.writeUInt8(s >= 256 ? 0 : s, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(images[i].length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, dir, ...images]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const logo = await render(LOGO);
    fs.writeFileSync(path.join(OUT, 'icon.png'), logo.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
    fs.writeFileSync(path.join(OUT, 'icon.ico'), buildIco(logo));
    fs.writeFileSync(path.join(OUT, 'tray.png'), logo.resize({ width: 32, height: 32, quality: 'best' }).toPNG());
    fs.writeFileSync(path.join(OUT, 'badge.png'), badgeImage(32).toPNG());
    console.log('Icônes générées dans', OUT);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});
