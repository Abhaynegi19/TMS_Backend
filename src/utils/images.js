import { AppError } from './errors.js';

const SIG = { png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], jpg: [0xff, 0xd8, 0xff] };

// Accepts only real JPEG/PNG data URLs. The bytes are checked, not just the declared type.
export function parseImage(dataUrl, field, { maxBytes = 2 * 1024 * 1024 } = {}) {
  const bad = (msg) => new AppError(422, 'VALIDATION_ERROR', 'Please fix the highlighted fields', { [field]: msg });
  if (typeof dataUrl !== 'string') throw bad('Image data is missing');
  const comma = dataUrl.indexOf(',');
  const head = comma < 0 ? null : /^data:image\/(jpeg|png);base64$/.exec(dataUrl.slice(0, comma));
  if (!head) throw bad('Only JPEG or PNG images are accepted');
  const payload = dataUrl.slice(comma + 1);
  const limit = `${Math.round((maxBytes / 1048576) * 10) / 10} MB`;
  if (payload.length > Math.ceil((maxBytes * 4) / 3) + 8) throw bad(`Each image must be under ${limit}`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw bad('Image data is corrupt');
  const buf = Buffer.from(payload, 'base64');
  if (buf.length > maxBytes) throw bad(`Each image must be under ${limit}`);
  const actual = Object.keys(SIG).find((k) => SIG[k].every((b, i) => buf[i] === b));
  if (actual !== (head[1] === 'jpeg' ? 'jpg' : 'png')) throw bad('That file is not a valid JPEG or PNG image');
  return { buf, ext: actual };
}
