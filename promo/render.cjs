/**
 * Exporte la pub endBuy en vidéo MP4 (1920×1080, 30 i/s, son stéréo).
 * La page est pilotée image par image (window.__ad.seek) dans une fenêtre Electron hors écran,
 * chaque image est envoyée à ffmpeg ; la musique est générée hors ligne par la page (Web Audio).
 *
 * Usage (depuis le dossier desktop, qui contient Electron) :
 *   npx electron ../promo/render.cjs --ffmpeg <chemin\ffmpeg.exe> [--out ../promo/endbuy-pub.mp4]
 *   npx electron ../promo/render.cjs --frames 1.8,9.8,23.5 [--dir ./captures]   (images clés en PNG)
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const W = 1920;
const H = 1080;
const src = path.join(__dirname, 'endbuy-pub.html');
const out = path.resolve(arg('--out', path.join(__dirname, 'endbuy-pub.mp4')));
const frames = arg('--frames', null);
const ffmpeg = arg('--ffmpeg', 'ffmpeg');
const dir = path.resolve(arg('--dir', path.join(os.tmpdir(), 'endbuy-frames')));

function wrapHtml() {
  // La page est écrite sans squelette (format Artifact) : on l'enveloppe pour le rendu local.
  const body = fs.readFileSync(src, 'utf8');
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0}</style></head><body>${body}</body></html>`;
  const file = path.join(os.tmpdir(), 'endbuy-pub-render.html');
  fs.writeFileSync(file, html);
  return file;
}

async function main() {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    frame: false,
    useContentSize: true,
    backgroundColor: '#05070a',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  const wc = win.webContents;
  wc.setFrameRate(60);
  await win.loadURL(pathToFileURL(wrapHtml()).href + '?render=1');
  await wc.executeJavaScript('window.__ad.ready');
  await new Promise((r) => setTimeout(r, 800));

  // Capture via le protocole DevTools : chaque capture force une image neuve (l'événement « paint »
  // hors écran livre parfois l'image précédente).
  // La fenêtre peut être plus petite que l'écran disponible : on impose une zone d'affichage 1920×1080 exacte.
  wc.debugger.attach('1.3');
  await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 300));
  const grab = async (t) => {
    await wc.executeJavaScript(`window.__ad.seek(${t}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
    });
    const img = nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
    const size = img.getSize();
    if (size.width !== W || size.height !== H) throw new Error(`capture ${size.width}×${size.height} au lieu de ${W}×${H}`);
    return img;
  };

  if (frames) {
    fs.mkdirSync(dir, { recursive: true });
    for (const t of frames.split(',').map(Number)) {
      const img = await grab(t);
      const file = path.join(dir, `frame-${t.toFixed(2)}.png`);
      fs.writeFileSync(file, img.toPNG());
      console.log('image', file);
    }
    return;
  }

  const { duration, fps } = await wc.executeJavaScript('({ duration: window.__ad.duration, fps: window.__ad.fps })');
  console.log('musique : génération…');
  const wav = path.join(os.tmpdir(), 'endbuy-pub-audio.wav');
  fs.writeFileSync(wav, Buffer.from(await wc.executeJavaScript('window.__ad.renderAudio()'), 'base64'));

  const total = Math.round(duration * fps);
  console.log(`vidéo : ${total} images…`);
  // ffmpeg tourne dans son propre groupe de processus (detached) : un Ctrl+C envoyé à la console
  // parente ne l'interrompt plus au milieu de l'export.
  const tmpOut = out.replace(/\.mp4$/i, '') + '.partial.mp4';
  const ff = spawn(
    ffmpeg,
    [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-',
      '-i', wav,
      '-map', '0:v', '-map', '1:a', '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', tmpOut,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'], detached: true, windowsHide: true },
  );
  let failed = null;
  const done = new Promise((res) =>
    ff.on('close', (code) => {
      if (code !== 0) failed = new Error(`ffmpeg s'est arrêté (code ${code})`);
      res();
    }),
  );
  ff.on('error', (e) => (failed = e));
  ff.stdin.on('error', (e) => (failed = failed || e));
  for (let i = 0; i < total; i++) {
    if (failed) throw failed;
    const img = await grab(i / fps);
    const ok = ff.stdin.write(img.toBitmap());
    if (!ok) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), done]);
    if (i % 60 === 0) console.log(`  ${i}/${total}`);
  }
  ff.stdin.end();
  await done;
  if (failed) throw failed;
  fs.renameSync(tmpOut, out);
  console.log('vidéo prête :', out);
}

app.whenReady().then(() =>
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => app.quit()),
);
