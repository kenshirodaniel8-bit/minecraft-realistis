// Player names and accounts, shared by the server and the browser.
//
// Names are unique: "Mira Fox", "mira fox" and "Mira   Fox" are the same name
// (nameKey). Spaces are allowed. The accounts named "daniel", "nadine",
// "prabu" and "shallom" are the admins of every server (server/services/admin.js).
// The same list is in firebase-database.rules.json (keep them in step).
//
// Online (Firebase) accounts sign in with Firebase Authentication using an
// email made from the name, so the name is also unique there and the
// database rules can check who is who (firebase-database.rules.json).

export const ADMIN_NAMES = ['daniel', 'nadine', 'prabu', 'shallom'];
export const ACCOUNT_EMAIL_DOMAIN = 'players.steal-a-monster.game';
export const PASSWORD_MIN = 6;

// The displayed name: 2-16 letters, numbers, spaces, _ or -.
export function cleanName(v) {
  const s = String(v ?? '').replace(/[^A-Za-z0-9_ -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
  return s.length >= 2 ? s : null;
}

// What makes two names "the same".
export function nameKey(name) {
  return String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isAdminName(name) {
  return ADMIN_NAMES.includes(nameKey(name));
}

// "Mira Fox" -> "mira.fox@players.steal-a-monster.game"
export function accountEmail(name) {
  return `${nameKey(name).replace(/ /g, '.')}@${ACCOUNT_EMAIL_DOMAIN}`;
}
