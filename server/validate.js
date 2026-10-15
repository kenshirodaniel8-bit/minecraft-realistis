// Input validation helpers. Every client payload goes through these; anything
// that does not match is rejected before it reaches gameplay code.

export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function finite(v, min = -1e7, max = 1e7) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

export function str(v, maxLen = 64) {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

export function id(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,48}$/.test(v);
}

export function int(v, min = 0, max = 1e9) {
  return Number.isInteger(v) && v >= min && v <= max;
}

export function sanitizeName(v) {
  const s = String(v ?? '').replace(/[^A-Za-z0-9_ -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length >= 2 ? s : null;
}

export function sanitizeText(v, max = 160) {
  // eslint-disable-next-line no-control-regex
  return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
}

export function color(v) {
  return Number.isInteger(v) && v >= 0 && v <= 0xffffff;
}

export const fail = (error, message) => ({ ok: false, error, message: message || error });
