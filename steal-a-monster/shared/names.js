// Player names and accounts, shared by the server and the browser.
//
// Names are unique: "Mira Fox", "mira fox" and "Mira   Fox" are the same name
// (nameKey). Spaces are allowed. The account named "daniel" is the admin of
// every server (see server/game.js, handleAdmin*).
//
// Online (Firebase) accounts sign in with Firebase Authentication using an
// email made from the name, so the name is also unique there and the
// database rules can check who is who (firebase-database.rules.json).

export const ADMIN_NAME = 'daniel';
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
  return nameKey(name) === ADMIN_NAME;
}

// "Mira Fox" -> "mira.fox@players.steal-a-monster.game"
export function accountEmail(name) {
  return `${nameKey(name).replace(/ /g, '.')}@${ACCOUNT_EMAIL_DOMAIN}`;
}
