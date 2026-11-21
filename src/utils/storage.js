import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const defaultRoot = fileURLToPath(new URL('../../uploads', import.meta.url));
const root = () => path.resolve(process.env.UPLOAD_DIR || defaultRoot);
const dirFor = (tripId) => path.join(root(), 'pod', String(tripId));
const NAME = /^[0-9a-f-]{36}\.(jpg|png)$/;

export const mimeOf = (name) => (name.endsWith('.png') ? 'image/png' : 'image/jpeg');
export async function savePodFile(tripId, buf, ext) {
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(dirFor(tripId), { recursive: true });
  await fs.writeFile(path.join(dirFor(tripId), name), buf);
  return name;
}
export async function readPodFile(tripId, name) {
  if (!NAME.test(name || '')) return null;
  try { return await fs.readFile(path.join(dirFor(tripId), name)); } catch { return null; }
}
export const removeTripFiles = (tripId) => fs.rm(dirFor(tripId), { recursive: true, force: true });
export const removePodFile = (tripId, name) => (NAME.test(name || '') ? fs.rm(path.join(dirFor(tripId), name), { force: true }) : Promise.resolve());
