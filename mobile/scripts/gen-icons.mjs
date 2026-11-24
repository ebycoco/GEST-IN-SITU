// Generation des icones PWA sans dependance (zlib de Node uniquement).
// Usage : node scripts/gen-icons.mjs  (depuis mobile/) -> public/icons/*.png et icon.svg
// Dessin : fond nuit #0a0e27, carre jaune Plein Soleil #FFE600, lettres « GIS » noires.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(out, { recursive: true });

const NUIT = [0x0a, 0x0e, 0x27];
const SOLEIL = [0xff, 0xe6, 0x00];
const NOIR = [0x00, 0x00, 0x00];

// Police 5x7 (G, I, S)
const GLYPHES = {
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
};
const TEXTE = ['G', 'I', 'S'];
const COLS = TEXTE.length * 5 + (TEXTE.length - 1); // 17
const ROWS = 7;

function crc32(buf) {
  let c = ~0 >>> 0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filtre « None »
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 bits RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function lettre(gx, gy) {
  const idx = Math.floor(gx / 6);
  const col = gx % 6;
  if (col === 5 || idx >= TEXTE.length) return false;
  return GLYPHES[TEXTE[idx]][gy][col] === '#';
}
// marge = part de la taille reservee au fond nuit ; texteLargeur = part de la largeur pour le texte
function dessin(size, marge, texteLargeur) {
  const m = Math.round(size * marge);
  const cell = Math.floor((size * texteLargeur) / COLS);
  const tx = Math.floor((size - cell * COLS) / 2);
  const ty = Math.floor((size - cell * ROWS) / 2);
  return (x, y) => {
    if (x < m || y < m || x >= size - m || y >= size - m) return NUIT;
    const gx = Math.floor((x - tx) / cell);
    const gy = Math.floor((y - ty) / cell);
    if (x >= tx && y >= ty && gx < COLS && gy < ROWS && lettre(gx, gy)) return NOIR;
    return SOLEIL;
  };
}

writeFileSync(out + 'icon-192.png', png(192, dessin(192, 0.08, 0.7)));
writeFileSync(out + 'icon-512.png', png(512, dessin(512, 0.08, 0.7)));
// Maskable : zone sure = cercle de 80 % ; fond jaune plein, texte dans 56 % de la largeur.
writeFileSync(out + 'icon-512-maskable.png', png(512, dessin(512, 0, 0.56)));

// SVG equivalent (texte vectoriel en rectangles, aucune police necessaire)
let rects = '';
const cell = 6;
const tx = (128 - cell * COLS) / 2;
const ty = (128 - cell * ROWS) / 2;
for (let gy = 0; gy < ROWS; gy++) {
  for (let gx = 0; gx < COLS; gx++) {
    if (lettre(gx, gy)) rects += `<rect x="${tx + gx * cell}" y="${ty + gy * cell}" width="${cell}" height="${cell}"/>`;
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" fill="#0a0e27"/><rect x="10" y="10" width="108" height="108" rx="14" fill="#FFE600"/><g fill="#000">${rects}</g></svg>\n`;
writeFileSync(out + 'icon.svg', svg);
console.log('icones ecrites dans', out);
