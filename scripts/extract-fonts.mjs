// Извлечение self-hosted шрифтов IBM Plex из офлайн-бандла прототипа.
// Источник: "Реестр документов (offline).html" — в нём:
//   <script type="__bundler/manifest"> — JSON {uuid: {mime, compressed, data(base64)}}
//   <script type="__bundler/template"> — JSON-строка HTML с @font-face, где src:url("<uuid>")
// Результат: src/vendor/fonts/*.woff2 + src/vendor/fonts/ibm-plex.css (@font-face с локальными url).
// Запуск: node scripts/extract-fonts.mjs  (одноразово на dev-машине; рантайм офлайн)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, 'Реестр документов (offline).html');
const outDir = join(root, 'src', 'vendor', 'fonts');

const html = readFileSync(bundlePath, 'utf8');

function scriptContent(type) {
  const open = `<script type="${type}">`;
  const start = html.indexOf(open);
  if (start === -1) throw new Error(`Не найден <script type="${type}">`);
  const end = html.indexOf('</script>', start);
  return html.slice(start + open.length, end).trim();
}

const manifest = JSON.parse(scriptContent('__bundler/manifest'));
const template = JSON.parse(scriptContent('__bundler/template'));

// Разбор @font-face блоков из template: комментарий-сабсет перед каждым блоком.
const faceRe = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
const WANT_SUBSETS = new Set(['cyrillic-ext', 'cyrillic', 'latin-ext', 'latin']);
const faces = [];
let m;
while ((m = faceRe.exec(template)) !== null) {
  const [, subset, body] = m;
  const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
  const style = /font-style:\s*(\w+)/.exec(body)?.[1] ?? 'normal';
  const weight = /font-weight:\s*([\d ]+)/.exec(body)?.[1]?.trim();
  const uuid = /url\("?([0-9a-f-]{36})"?\)/.exec(body)?.[1];
  const unicodeRange = /unicode-range:\s*([^;]+);?/.exec(body)?.[1]?.trim();
  if (!family || !weight || !uuid || !unicodeRange) continue;
  if (!family.startsWith('IBM Plex')) continue;
  if (!WANT_SUBSETS.has(subset)) continue;
  faces.push({ subset, family, style, weight, uuid, unicodeRange });
}
if (faces.length === 0) throw new Error('Не найдено ни одного @font-face IBM Plex в template');

// Запись woff2 (дедуп по uuid — Sans variable: один файл покрывает веса 400/500/600).
mkdirSync(outDir, { recursive: true });
const fileByUuid = new Map();
for (const f of faces) {
  if (fileByUuid.has(f.uuid)) continue;
  const asset = manifest[f.uuid];
  if (!asset) throw new Error(`В манифесте нет ассета ${f.uuid} (${f.family} ${f.weight} ${f.subset})`);
  if (asset.mime !== 'font/woff2') throw new Error(`Ассет ${f.uuid}: mime ${asset.mime}, ожидался font/woff2`);
  if (asset.compressed) throw new Error(`Ассет ${f.uuid} сжат — не поддерживается этим скриптом`);
  const buf = Buffer.from(asset.data, 'base64');
  if (buf.subarray(0, 4).toString('latin1') !== 'wOF2') {
    throw new Error(`Ассет ${f.uuid}: нет magic wOF2`);
  }
  const famSlug = f.family === 'IBM Plex Mono' ? 'ibm-plex-mono' : 'ibm-plex-sans';
  const weightPart = f.family === 'IBM Plex Mono' ? `-${f.weight}` : '';
  const name = `${famSlug}${weightPart}-${f.subset}.woff2`;
  writeFileSync(join(outDir, name), buf);
  fileByUuid.set(f.uuid, name);
  console.log(`${name}  ${buf.length} bytes`);
}

// Генерация ibm-plex.css: те же @font-face, url — локальные.
let css = '/* IBM Plex Sans/Mono — извлечено из офлайн-бандла прототипа (extract-fonts.mjs). Принцип 1: офлайн. */\n';
for (const f of faces) {
  css += `\n/* ${f.subset} */\n@font-face {\n  font-family: '${f.family}';\n  font-style: ${f.style};\n  font-weight: ${f.weight};\n  font-display: swap;\n  src: url('./${fileByUuid.get(f.uuid)}') format('woff2');\n  unicode-range: ${f.unicodeRange};\n}\n`;
}
writeFileSync(join(outDir, 'ibm-plex.css'), css);
console.log(`\nibm-plex.css: ${faces.length} @font-face, ${fileByUuid.size} woff2 файлов`);
