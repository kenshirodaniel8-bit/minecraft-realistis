# AI HANDOFF — STEAL A MONSTER

> **To any AI continuing this project:** read this whole file first, then
> `README.md` (features and controls) and `TESTING.md` (what is verified).
> **Keep this file up to date**: when you finish a change, update the
> "Current state" and "Change log" sections below, so the next AI (or the
> previous one, coming back after a usage limit) can continue without
> guessing.
>
> **Untuk pemilik game (Bahasa Indonesia):** berikan file ini (atau seluruh
> folder `steal-a-monster`, atau link GitHub-nya) ke AI lain, lalu tulis
> permintaanmu seperti biasa. Untuk AI yang hanya menerima upload file, unduh
> **satu file HTML berisi seluruh game**:
> https://kenshirodaniel8-bit.github.io/minecraft-realistis/source.html
> (selalu versi terbaru; klik kanan → *Save as*), lalu upload ke AI itu. Bilang ke AI itu: *"Baca AI-HANDOFF.md dulu, dan
> perbarui file itu setelah selesai."*

---

## 1. What this is

A 3D multiplayer browser game: explore islands, fight and recruit cute baby
monsters, put them in your base tower for income, steal other players'
monsters and protect your own.

- **Owner:** GitHub user `kenshirodaniel8-bit`, repository
  `kenshirodaniel8-bit/minecraft-realistis`. The game lives in the
  **`steal-a-monster/`** folder (the repository root is a different,
  older project called "Realistis" — don't touch it).
- **Working branch:** `claude/steal-a-monster-game-mjo51w` (all work so far
  is there; not merged into `main`). Don't open pull requests unless the
  owner asks.
- **Live site (single-player + online rooms):**
  https://kenshirodaniel8-bit.github.io/minecraft-realistis/ — published
  automatically by `.github/workflows/steal-a-monster-pages.yml` on every
  push to the working branch (or `main`) that touches `steal-a-monster/**`.
  CI (`.github/workflows/ci.yml`) runs `npm test`.
- **The owner speaks Indonesian.** Reply in Indonesian, simple words, step by
  step for anything they must click themselves. **In-game text is English.**
  User guides for the owner are in Indonesian (`PANDUAN-FIREBASE.md`).

## 2. Tech and architecture

- **Client:** Three.js (`three@0.186.1`), plain ES modules, no framework,
  everything procedural (no model or texture files). `public/`.
- **Server:** Node.js ≥ 20, Express + Socket.IO, **server-authoritative**
  `Game` class (`server/game.js`) with services in `server/services/`.
  Clients only send intentions (move, attack, buy…); the server decides
  Money, damage, ownership.
- **Shared code:** `shared/` (imported as `#shared/...`), identical on server
  and client: config, world generation, species, swords, costumes, guards,
  names.
- **Three ways to run the same game code:**
  1. `npm start` — Node server (`server.js`), saves in `DATA_DIR` (JSON files).
  2. **Web build** (`node scripts/build-web.mjs` → `dist-web/`) — the whole
     `Game` runs **inside the browser** (`public/client/localNet.js`), saves
     in IndexedDB/localStorage (`browserStore.js`). This is what GitHub Pages
     serves.
  3. **Online rooms** (web build + Firebase): the room creator's browser runs
     the `Game`; guests talk to it through **Firebase Realtime Database**
     (`public/client/rooms.js`). Accounts use **Firebase Authentication**
     (`public/client/accounts.js`, `fb.js`).
- **Message flow:** client `net.request(type, payload)` → `game.handle(sid,
  type, payload)` → `game.handlers[type]` → service method returning
  `{ ok: true, ... }` or `fail('code', 'message')`. Broadcasts go out with
  `game.broadcast` / `broadcastNear` / `send`.

### Key files

| Area | Files |
|---|---|
| Game loop, join/leave, snapshots, handlers | `server/game.js` |
| Profiles, sanitising, ownership ledger | `server/services/playerData.js`, `server/storage.js` |
| Combat, monsters AI | `server/services/combat.js`, `monsterAI.js` |
| Bases, income, guards purchase | `server/services/bases.js` |
| Guards + helicopters AI | `server/services/guards.js`, `shared/guards.js`, client `guardsView.js` |
| Costumes, Legend Master powers | `server/services/costumes.js`, `shared/costumes.js`, client `humanoid.js`, `legendFx.js`, `effects.js` |
| Admin (Player panel, return, ban) | `server/services/admin.js`, client `ui.js` (`playersHtml`), `main.js` actions |
| Accounts | Node: `server/accounts.js`; online: `public/client/accounts.js`; names: `shared/names.js` |
| Online rooms | `public/client/rooms.js`, `firebase-database.rules.json`, `public/firebase-config.js` |
| Client entry, controls, events | `public/client/main.js` |
| HUD and panels | `public/client/ui.js`, `public/index.html`, `public/style.css` |
| World and monsters | `shared/world.js`, `shared/monsters.js`, `shared/speciesGen.js`, `public/client/worldRenderer.js`, `monsterRenderer.js` |

## 3. Commands

```bash
cd steal-a-monster
npm install
npm start                      # http://localhost:3000
npm test                       # 86 unit/integration tests (node --test), must stay green
npm run test:e2e               # 2 real browsers vs the Node server (Playwright + Chromium)
node scripts/build-web.mjs     # web build -> dist-web/ (what GitHub Pages serves, incl. source.html)
node scripts/build-handoff-html.mjs   # ONE html file with these docs + all source -> steal-a-monster-for-ai.html

# Online rooms / accounts against the official Firebase emulators (needs Java):
npx firebase-tools@13 emulators:start --only auth,database --project demo-sam &
node scripts/room-e2e.mjs 127.0.0.1:9000 127.0.0.1:9099
node scripts/rules-check.mjs   # security rules: who may write what
```

`DEV_COMMANDS=1 npm start` enables chat cheats (`/money N`, `/level N`, `/tp X Z`, …).
Browser tests use SwiftShader (software WebGL): frame rates there are
meaningless; to inspect visuals, freeze effects and take screenshots.

## 4. Rules for changing the code

1. **Run `npm test` before every commit.** Add a test in `tests/` for new
   server rules (see existing suites; `tests/helpers.js` has a fake clock,
   `h.join`, `h.place`, `h.advance`, `h.spawnMonster`).
2. **New message type** → add it to `game.handlers` in `server/game.js`. The
   test "every message the game handles is reachable" calls each one with a
   bogus payload, so validate input (`server/validate.js`) and never throw.
   If it spends Money, use `s.recall(reqId)` / `s.remember(reqId, res)` for
   idempotency and add it to `TRANSACTIONAL` in `public/client/rooms.js`.
3. **New profile field** → sanitise it in `sanitizeProfile`
   (`server/services/playerData.js`), give it a default in `newProfile`.
   Saves from old versions must still load.
4. **Admin names live in TWO places** and must match: `ADMIN_NAMES` in
   `shared/names.js` **and** the email list in `firebase-database.rules.json`
   (`<name>@players.steal-a-monster.game`, lowercase, spaces → dots). After
   changing the rules file, the **owner must paste it again** in Firebase
   Console → Realtime Database → Rules → Publish (you cannot do it).
5. Prices and numbers belong in `shared/` (`config.js`, `costumes.js`,
   `guards.js`, `weapons.js`), not hard-coded in services.
6. After changing the web game, the live site updates by itself after the
   push (1–3 minutes). Tell the owner to press **Ctrl + F5**.
7. Commit messages: plain English, describe what changed for players. Push
   with `git push -u origin claude/steal-a-monster-game-mjo51w`.
8. Update `README.md` / `TESTING.md` / this file when features change.
9. If you work from the single HTML file (`source.html`) instead of the
   repository, give the owner back **complete files with their paths**, so
   they (or the next AI with GitHub access) can put them in place.

## 5. Firebase (online rooms and accounts)

- Project **`steal-a-monster`** (region asia-southeast1). Config is in
  `public/firebase-config.js` (public by design; the rules protect the data).
- **Authentication → Email/Password** is enabled (done by the owner).
  Accounts are made **in the game** with *Create account*: the game turns the
  name into an email `name@players.steal-a-monster.game` (lowercase, spaces →
  dots). Users added by hand in the Firebase console with Gmail addresses are
  **not** game accounts.
- Existing game accounts (Oct 2026): `daniel`, `prabu`, `shallom`, `naddd`
  (Nadine's account).
- Database layout: `sam/accounts/<uid>` `{name, profile (JSON string), at,
  online}`, `sam/bans/<uid>` `{name, at}`, `sam/returns/<uid>/<id>` `{j}`,
  `sam/rooms/<CODE>` (`host`, `guests`, `up`, `down`).
- **The rules must be published by the owner** whenever
  `firebase-database.rules.json` changes. Give them the full file content in a
  code block plus: *Realtime Database → Rules → hapus semua → tempel →
  Publish*.
- Unban: delete `sam/bans/<uid>` in the console (Realtime Database → Data).
- Free Spark plan: ~10 GB/month download; one guest ≈ 80 MB/hour.

## 6. Current state (keep this updated)

**Last updated:** 2026-10-15, after adding the one-file HTML for other AIs (`source.html`).

Everything listed in README "How to play" works and is tested. Features, in
the order the owner asked for them:

- World: plaza, regions, 7 monster islands (350+ species, Common → Mythic),
  Island Gate, Lucky Blocks, LUCKY LUCKY event, day/night, moon secret
  platformer + Moon Sky Arena on Cute Monster Island.
- Fighting, recruiting (R), base tower (5 floors, 10 pads per floor, stairs),
  income, lasers (L), H teleport home, stealing, gadgets, Monster Gems,
  decorations, 5 companion monsters (X calls them).
- Costumes (Costume Shop) with own animations and master power on Z; "Upgrade
  your power" shop (+130 per level). **Legend Master** costs **11,000,000**
  (owner lowered it from 200,000,000): choose 1 of 6 powers (fire, ice,
  lightning, shadow, light, cosmic) right after buying; 1,200-damage power;
  10 different sword moves in a row (server counts `moveIdx`).
- **Accounts** (Create account / Log in; unique names, spaces allowed); progress
  follows the account into friends' rooms; on join: "start over or continue?".
- **Admins:** Daniel, Nadine (+ her account name `naddd`), Prabu, Shallom —
  🛡 Player button: who stole what from whom, return the monster, ban.
- **Base guards:** 420,000,000 for 2 guards; upgrades (60,000,000 × level) up
  to level 10 = 24 gold guards + 4 armed helicopters; thief alerts on screen.

**Not verified:** real GPUs/phones/Safari/Firefox, a long session on the live
Firebase project, game balance. See `TESTING.md` section 4.

**Open items / ideas:** none requested right now. Possible follow-ups the
owner may ask: password reset (not implemented; owner can delete the account
in Firebase), more costumes, rebalancing prices.

## 7. Change log (newest first — add yours on top)

- 2026-10-15 — `scripts/build-handoff-html.mjs`: the whole source + docs in one HTML file for AIs that only take uploads; published with the site as `source.html`.
- 2026-10-15 — `naddd` added as admin (Nadine registered with that name). Rules updated; owner must re-publish.
- 2026-10-15 — Login: typing an email or a non-existent name shows a clear hint to use "Create account" with the game name.
- 2026-10-15 — Legend Master price 200,000,000 → 11,000,000.
- 2026-10-15 — Four admins (Daniel, Nadine, Prabu, Shallom); retrying a half-finished Create account works.
- 2026-10-15 — Base guards + helicopters; Legend Master costume with 6 powers and 10 sword moves; docs.
- 2026-10-15 — Accounts, unique names, start over/continue, admin Player panel (return, ban).
- 2026-10-15 — Firebase web config added (online rooms on).
- Earlier — costumes and Z powers, companions, moon secret, 7 islands, tower bases, swords, gems, decorations, Lucky Blocks, stealing, the core game (see `git log`).
