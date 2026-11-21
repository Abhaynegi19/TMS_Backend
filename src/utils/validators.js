import { invalid } from './errors.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const emailError = (e) => (EMAIL.test(String(e || '').trim()) ? null : 'Enter a valid email address');
export const passwordError = (p) => {
  if (!p || p.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Password must include at least one letter and one number';
  return null;
};
export const missing = (obj, labels) =>
  Object.fromEntries(Object.entries(labels).filter(([k]) => !String(obj[k] ?? '').trim()).map(([k, l]) => [k, `${l} is required`]));
export const failIf = (fields) => { if (Object.keys(fields).length) throw invalid(fields); };
