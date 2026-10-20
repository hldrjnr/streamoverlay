const fs = require("fs");
const path = require("path");

function createPNG(width, height, r, g, b, a = 255) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR - color type 6 = RGBA
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type (RGBA)
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = createChunk("IHDR", ihdrData);

  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter byte
    for (let x = 0; x < width; x++) {
      const cx = width / 2;
      const cy = height / 2;
      const size = Math.min(width, height) * 0.35;
      
      const dx = x - cx;
      const dy = y - cy;
      const inTriangle = dx > -size * 0.7 && dx < size * 0.7 &&
        dy > -size * 0.5 && dy < size * 0.5 &&
        dx < (size * 0.7 - Math.abs(dy)) * 1.2;

      if (inTriangle) {
        rawData.push(255, 255, 255, 255);
      } else {
        rawData.push(r, g, b, a);
      }
    }
  }

  const zlib = require("zlib");
  const compressed = zlib.deflateSync(Buffer.from(rawData));
  const idat = createChunk("IDAT", compressed);
  const iend = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const iconsDir = path.join(__dirname, "src-tauri", "icons");

const sizes = [
  { name: "32x32.png", size: 32 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
  { name: "icon.png", size: 512 },
];

for (const { name, size } of sizes) {
  const png = createPNG(size, size, 180, 30, 30, 255);
  fs.writeFileSync(path.join(iconsDir, name), png);
  console.log(`Created ${name} (${size}x${size}) RGBA`);
}

// ICO with RGBA PNG
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);

const icoEntry = Buffer.alloc(16);
icoEntry[0] = 32;
icoEntry[1] = 32;
icoEntry[2] = 0;
icoEntry[3] = 0;
icoEntry.writeUInt16LE(1, 4);
icoEntry.writeUInt16LE(32, 6); // 32-bit depth for RGBA
const icon32 = createPNG(32, 32, 180, 30, 30, 255);
icoEntry.writeUInt32LE(icon32.length, 8);
icoEntry.writeUInt32LE(22, 12);

fs.writeFileSync(path.join(iconsDir, "icon.ico"), Buffer.concat([icoHeader, icoEntry, icon32]));
console.log("Created icon.ico");
console.log("\nAll RGBA icons generated!");
