/**
 * Prépare le dossier de l'application de bureau :
 *  - copie le serveur compilé (../server/dist) et l'interface compilée (../client/dist) ;
 *  - écrit app-config.json (URL du serveur hébergé par défaut, via ENDBUY_SERVER_URL).
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const serverBundle = path.join(root, '..', 'server', 'dist', 'endbuy-server.mjs');
const clientDist = path.join(root, '..', 'client', 'dist');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(serverBundle)) fail('Serveur non compilé. Lance d’abord :  npm run build  (à la racine du projet).');
if (!fs.existsSync(path.join(clientDist, 'index.html'))) fail('Interface non compilée. Lance d’abord :  npm run build  (à la racine du projet).');
if (!fs.existsSync(path.join(root, 'build', 'icon.ico'))) fail('Icônes absentes. Lance :  npm run icons  (dans le dossier desktop).');

fs.rmSync(path.join(root, 'server'), { recursive: true, force: true });
fs.rmSync(path.join(root, 'client'), { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'server'), { recursive: true });
fs.copyFileSync(serverBundle, path.join(root, 'server', 'endbuy-server.mjs'));
fs.cpSync(clientDist, path.join(root, 'client'), { recursive: true });

const cfgPath = path.join(root, 'app-config.json');
const current = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
const url = process.env.ENDBUY_SERVER_URL !== undefined ? process.env.ENDBUY_SERVER_URL.trim().replace(/\/+$/, '') : current.defaultServerUrl || '';
fs.writeFileSync(cfgPath, JSON.stringify({ defaultServerUrl: url }, null, 2) + '\n');

console.log('✔ Application de bureau préparée.');
console.log(url ? `  Serveur hébergé par défaut : ${url}` : '  Aucun serveur hébergé par défaut : l’application démarrera son serveur local intégré.');
