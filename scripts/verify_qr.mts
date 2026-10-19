import QRCode from 'qrcode';
import jsQR from 'jsqr';

async function decode(text: string): Promise<string | null> {
  const png = await QRCode.toDataURL(value_fix(text), {
    width: 512,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  // Decode via canvas-free path: jsQR needs raw pixels; decode the data URL.
  const base64 = png.split(',')[1];
  const bytes = Buffer.from(base64, 'base64');
  // Parse PNG manually is overkill — use a tiny PNG decoder via zlib.
  return decodePng(bytes);
}

function value_fix(s: string) {
  return s;
}

// Minimal PNG decoder for single IDAT, 8-bit RGBA/RGB/grayscale
import { inflateSync } from 'node:zlib';

function decodePng(buf: Buffer): string | null {
  // Signature 8 bytes; then chunks
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  let idat = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat = Buffer.concat([idat, data]);
    }
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (channels === 0 || bitDepth !== 8) return null;
  const raw = inflateSync(idat);
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const si = x * channels;
      const di = (y * width + x) * 4;
      if (channels === 1) {
        out[di] = out[di + 1] = out[di + 2] = cur[si]; out[di + 3] = 255;
      } else {
        out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2];
        out[di + 3] = channels === 4 ? cur[si + 3] : 255;
      }
    }
    prev = cur;
  }
  const res = jsQR(out, width, height);
  return res ? res.data : null;
}

const samples = [
  'https://saffron-smoke.menulist.app/t/eb589f751db72f9f02',
  'https://saffron-smoke.menulist.app/t/f8cb32b903424d50c4',
  '#guest/dd89570de319e6ec1b',
  'https://order.venue.com/t/abc123',
];

let ok = 0;
for (const s of samples) {
  const out = await decode(s);
  const pass = out === s;
  if (pass) ok++;
  console.log(pass ? 'PASS' : 'FAIL', JSON.stringify(s), '->', JSON.stringify(out));
}
console.log(`${ok}/${samples.length} round-trips decoded`);
process.exit(ok === samples.length ? 0 : 1);
