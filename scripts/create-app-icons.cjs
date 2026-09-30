const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crcBuf]);
}

function createPngBuffer(size = 256) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bit per channel
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = [];
  const radius = size * 0.42;
  const center = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const offset = 1 + x * 4;

      if (dist <= radius) {
        // Gradient diagonal Cyan/Blue -> Electric Purple
        const t = (x + y) / ((size - 1) * 2);
        // Highlight in upper-left
        const lightDist = Math.sqrt((x - center * 0.7) ** 2 + (y - center * 0.7) ** 2);
        const lightGlow = Math.max(0, 1 - lightDist / (radius * 1.2));

        let r = Math.round(37 * (1 - t) + 168 * t + lightGlow * 40);
        let g = Math.round(99 * (1 - t) + 85 * t + lightGlow * 30);
        let b = Math.round(235 * (1 - t) + 247 * t + lightGlow * 20);

        r = Math.min(255, Math.max(0, r));
        g = Math.min(255, Math.max(0, g));
        b = Math.min(255, Math.max(0, b));

        // Anti-aliased outer border
        let a = 255;
        if (dist > radius - 1.5) {
          a = Math.max(0, Math.min(255, Math.round((radius - dist + 1.5) * (255 / 1.5))));
        }

        row[offset] = r;
        row[offset + 1] = g;
        row[offset + 2] = b;
        row[offset + 3] = a;
      } else {
        // Outer soft glow aura
        const auraRadius = radius * 1.15;
        if (dist <= auraRadius) {
          const auraFactor = (auraRadius - dist) / (auraRadius - radius);
          const a = Math.round(auraFactor * 45);
          row[offset] = 99;
          row[offset + 1] = 102;
          row[offset + 2] = 241;
          row[offset + 3] = Math.min(255, Math.max(0, a));
        } else {
          row[offset] = 0;
          row[offset + 1] = 0;
          row[offset + 2] = 0;
          row[offset + 3] = 0;
        }
      }
    }
    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createIcoFile(pngBuffers, outputPath) {
  // ICO header: 6 bytes
  // 0-1: Reserved (0)
  // 2-3: Image type (1 for icon)
  // 4-5: Number of images
  const numImages = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(numImages, 4);

  // Each directory entry is 16 bytes
  const dirSize = 16 * numImages;
  let currentOffset = 6 + dirSize;

  const dirEntries = [];
  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // color palette (0 = none)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // size of image in bytes
    entry.writeUInt32LE(currentOffset, 12); // offset of image data
    dirEntries.push(entry);
    currentOffset += buffer.length;
  }

  const finalBuffer = Buffer.concat([
    header,
    ...dirEntries,
    ...pngBuffers.map((p) => p.buffer),
  ]);

  fs.writeFileSync(outputPath, finalBuffer);
  console.log(`Fichier ICO généré : ${outputPath} (${finalBuffer.length} octets, ${numImages} résolutions)`);
}

function main() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  console.log('Génération des icônes d\'application Morix...');

  // 1. Générer icon.png 512x512
  const png512 = createPngBuffer(512);
  fs.writeFileSync(path.join(assetsDir, 'icon.png'), png512);
  console.log('Fichier icon.png (512x512) généré.');

  // 2. Générer icon.ico avec plusieurs tailles (256, 128, 64, 48, 32, 16)
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngList = sizes.map((s) => ({
    size: s,
    buffer: createPngBuffer(s),
  }));

  createIcoFile(pngList, path.join(assetsDir, 'icon.ico'));
}

main();
