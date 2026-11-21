import { invalid } from './errors.js';

const num = (v) => (v === undefined || v === null || v === '' ? NaN : Number(v));

// Validates one GPS reading. speed is km/h, heading is degrees, accuracy is metres.
export function parseLocation(b = {}) {
  const f = {};
  const lat = num(b.lat);
  const lng = num(b.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) f.lat = 'Latitude must be a number between -90 and 90';
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) f.lng = 'Longitude must be a number between -180 and 180';
  const opt = (k, min, max, label) => {
    if (b[k] === undefined || b[k] === null || b[k] === '') return undefined;
    const n = num(b[k]);
    if (!Number.isFinite(n) || n < min || n > max) { f[k] = `${label} is out of range`; return undefined; }
    return n;
  };
  const speed = opt('speed', 0, 400, 'Speed');
  const heading = opt('heading', 0, 360, 'Heading');
  const accuracy = opt('accuracy', 0, 100000, 'Accuracy');
  if (Object.keys(f).length) throw invalid(f, 'That location reading is not valid');
  return { lat, lng, speed, heading, accuracy };
}
