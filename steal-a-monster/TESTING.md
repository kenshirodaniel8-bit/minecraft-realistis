# Testing STEAL A MONSTER

This file separates what was **tested automatically**, what was **checked in a
real browser** (scripted or by looking at it), and what is **not verified**.

Test environment: Node.js 22 (unit tests also on Node 20.20), headless Chromium
via Playwright with **SwiftShader software WebGL** on a 4-core Linux container.
There was no real GPU, phone, Safari or Firefox available.

---

## 1. Automated tests — executed, all passing

```bash
npm test          # 85 tests, ~6 s, also runs in CI (.github/workflows/ci.yml)
```

They run the real server code: the `Game` class with a controllable clock and an
in-memory or temporary-directory store, and for networking a real HTTP +
Socket.IO server with real socket clients.

| Suite | Tests | Covers |
|---|---|---|
| `profile.test.js` | 8 | 1,000 Money exactly once (new profile only); no re-grant on reconnect/refresh/respawn; token hashing; save survives a server restart; corrupt save → backup restore, both broken → login refused (no fresh bonus); save retries; schema migration (1 → 2) and repair of forged data; coming back after a minute pays a minute of offline income (timestamps survive a reload) |
| `combat.test.js` | 6 | all 408 species build a distinct 3D model in Node; sword reach/facing/cooldown, server-side damage only; monsters attack, knock out, respawn at home; dodge immunity; defeat → recruitment offers only to real fighters; AI behaviour (shy flee, territorial, region bounds) |
| `recruitment.test.js` | 9 | not enough Money → nothing changes; extra recruit conditions on rare monsters (sword tier, discoveries); exact price deducted once; no double recruit (retries, double clicks, two players racing); fighter priority + base capacity; decline; one pad per monster; passive income, collect, offline cap; disconnect with an open offer |
| `stealing.test.js` | 11 | lasers block entry and theft; lasers switching on eject intruders and make a thief drop; steal → carry → deliver, ownership moves exactly once; duplicate/invalid steal requests; an aborted grab tells the owner it is safe; gadget hit releases the monster (both drop rules); dropped monsters fly home; disconnects during theft; H teleport rules (own base only, cooldown, not while carrying); gadget range/facing/cooldown/shields; shop prices, proximity, idempotency |
| `world.test.js` | 8 | deterministic world, 12 flat bases, spots inside their regions; region unlocks refused by the server; expansion regions open/close with hysteresis; closed portals; Lucky Blocks open once, only up close, server-rolled rewards; LUCKY LUCKY lifecycle; forged messages can't create Money/ownership/teleports; hidden/night spawns and the ruins vault puzzle |
| `gems.test.js` | 4 | Monster Gems drop by rarity (plus the Volcanic bonus) and can't be forged; Gem Geodes pay out once and only in gem regions; gem-priced swords and upgrades take Money and Gems together or nothing; decorations are bought only at your own base, placed/moved/cleared on valid spots, visible to other players, trophies only from milestones |
| `tower.test.js` | 4 | base capacity 15 → 25 → 35 → 45 (10 pads per floor); the inside stairs connect every floor with steps a player can climb, and every pad has a floor under it; a player walks up the stairs with ordinary server-checked moves, and a thief standing under a floor-2 pad can't steal it; the server refuses moves through a tower wall (also at a faked upper-floor height), while the door works |
| `population.test.js` | 1 | a region fills to 50 wild monsters while a player is on it, spread over the whole region (not only around the player); nearby regions get a smaller group; the region empties after the player leaves |
| `swords.test.js` | 4 | the sword list is in tier order and the new swords have prices, unlocks and specials; Bubble slows; Frost freezes only on the server's roll and never a boss; Lucky Clover's jackpot does about triple damage; Rainbow cycles burn, slow and a bonus hit; Galaxy's third hit sets off a nova that hits monsters around the target but not far away |
| `islands.test.js` | 3 | seven islands with 50 species each (16/13/10/6/3/2 from Common to Mythic, no name shared), stronger and pricier further along the chain; the Island Gate only works next to it and respects level locks; the island portals bring you back; Legendary monsters appear at the island lair and Mythic ones at the shrine |
| `moon.test.js` | 3 | the five moon buttons count once each (1/5 … 5/5), are saved and repaired on load; the portal only opens at 5/5; the arena is not a travel destination; falling sends you back to the last platform; rounds 1–4 call an Uncommon, Rare, Epic and Legendary cute monster that only its challenger can hit or be hit by, that never leaves its platform and is never recruitable; winning gives the Secret Lunamochi once (later wins pay Money); a full base blocks the portal; going home ends the run |
| `companions.test.js` | 3 | up to five companions (the sixth is refused), visible to everyone; they pop back when more than 9 feet away; a monster that bites you is attacked and defeated by the team, with the damage credited to you; X calls them (with a cooldown); your team stays with you at home while a fresh recruit moves into the base |
| `costumes.test.js` | 4 | the Black Spy costs exactly 150,000 (a retried request is not charged twice), gives and equips the Spy Sword (which the sword shop does not sell), is visible to others and saved; Z deals exactly 583 to monsters in front only, then cools down; Upgrade your power adds +130 per level (583 → 843 at level 2); the other costumes' fire ring, freezing blizzard, chain lightning and healing hug; the Legend Master costs exactly 200,000,000, Z is refused until a power is chosen, an unknown power is refused, everyone sees the chosen power, Z deals exactly 1,200 to every monster the lightning chain reaches, changing to Ice freezes them, the power is saved (a forged one is dropped), and the sword moves go 1, 2 … 10 and start again, the same for the attacker and the people watching |
| `accounts.test.js` | 8 | creating an account, logging in with the password or the remember key, wrong passwords; names are unique ignoring case and extra spaces, spaces allowed; an account name can't be used without logging in, nor twice at once; the same profile on another device; "start over" wipes the account's progress and its monsters leave the ownership ledger; an online (Firebase) profile is adopted as the truth and saved back through the account saver; "daniel" is the admin: the Player list shows who stole what from whom, returning a stolen monster (owner online or offline, delivered on the next join), banning (kicked, can't come back, saved), the admin can't ban himself and normal players can't use any of it |
| `guards.test.js` | 4 | guards cost 420,000,000 and only at your own base (a retried request is not charged twice), upgrades up to level 10 = 24 guards and 4 helicopters with much stronger swords, visible to everyone; the guards leave the owner alone and a passer-by outside, attack a thief who walks in, tag him (THIEF) and tell the owner (and the thief); a thief can knock out every guard, the owner is told, and they get back on duty later; guards stay on their floor; a helicopter shoots a hostile thief near the tower and stops once every guard is down |
| `multiplayer.test.js` | 5 | HTTP serves the game, shared modules, three.js and Socket.IO; two clients get different bases and see each other move; LUCKY LUCKY is identical for both; malformed/forged socket messages are rejected; every message the game handles is reachable over the socket |

The README's "Testing" section maps the 24 required checks to these suites.

---

## 2. Scripted browser and load tests — executed

These need Playwright and Chromium (`npm i -D playwright` or a global install).
They are not part of CI because they take minutes and need a browser.

### Two-player end-to-end test — `npm run test:e2e`

Starts its own server and drives **two real browser pages** (Alice and Bob)
with the real controls (keys, camera, pointer). The result of the last run:

```
Alice joins
  ✔ new player starts with 1,000 Money (got 1000)
Alice walks out and fights
  ✔ a Chompkin is visible on the client
  ✔ Alice defeated it with her sword (state 7)
  ✔ a recruitment card appeared
  ✔ defeat alone does not give ownership
Alice pays to recruit (R)
  ✔ Alice now owns the Chompkin
  ✔ the fee was paid (1011 -> 891)
Alice presses H and her monster moves in
  ✔ teleported home
  ✔ monster placed on pad 0
Bob joins and steals it
  ✔ Bob has his own base (#2) and 1,000 Money
  ✔ Bob is carrying the stolen monster
  ✔ Alice sees the theft alert
  ✔ still owned by Alice while it is being carried
  ✔ Bob delivered it: ownership transferred
  ✔ Alice lost it (exactly one owner)
Bob locks his base; Alice cannot get in
  ✔ Alice's client shows Bob's lasers switched on
  ✔ the laser gate stopped Alice at the door
  ✔ the server agrees: Alice is not inside
LUCKY LUCKY: Alice opens a Lucky Block
  ✔ the event started and Lucky Blocks appeared on the client
  ✔ Alice opened a Lucky Block (1)
  ✔ Alice: no browser errors 
  ✔ Bob: no browser errors 
client (software rendering, 2 browsers on one CPU): fps 3, game logic 2.1 ms/frame, render 10.7 ms/frame, 411 draw calls, 238580 triangles

E2E PASSED
```

Because SwiftShader renders at about 1–2 frames per second with two browsers on
one CPU, the bots pause drawing (`__app.skipRender`) while they walk and fight so
they move in real time; game logic, input and networking keep running, and
drawing is switched back on before every check that looks at the screen.

### Single-player web build (GitHub Pages)

`node scripts/build-web.mjs` builds a static site in `dist-web/`. It was served
from a sub-folder by a plain static file server (like GitHub Pages) and played
in headless Chromium: the title says single-player, a new player gets 1,000
Money, a Chompkin was fought, defeated and recruited with R, H took the player
home, and after a page reload the monster and Money were still there (no second
starting bonus, no income jackpot). No browser errors, no failed requests.
Not verified: the live github.io site itself (this workspace cannot reach it).

### Online rooms through Firebase — `node scripts/room-e2e.mjs`

Run against the **official Firebase Realtime Database emulator** (Google's
local copy of the database, v4.11.2) with the real Firebase JS SDK and the
security rules from `firebase-database.rules.json` loaded. Two browsers use
the single-player web build: one creates a room, the other opens the invite
link. Result of the last run:

```
Host opens a room
  ✔ the title screen offers "Create room"
  ✔ room code 6JVXU
  ✔ invite link http://127.0.0.1:45285/minecraft-realistis/?room=6JVXU
  ✔ the HUD shows the room (🌐 Room 6JVXU · 1 player · 🔗 Copy link)
A friend opens the link and joins
  ✔ the room code from the link is filled in
  ✔ the friend plays as a guest (no game server in their page)
  ✔ the guest starts with 1,000 Money (got 1000)
  ✔ the guest has their own base (#1, host #0)
  ✔ they see each other (host sees 1, guest sees 1)
  ✔ the host's room button counts 2 players (🌐 Room 6JVXU · 2 players · 🔗 Copy link)
The guest walks out of their tower and into the meadow
  ✔ the guest reached the meadow (1.7 m left)
  ✔ the host's server agrees where the guest is (1.9 m apart)
  ✔ no movement corrections on the way (none)
The guest fights a monster and pays to recruit it
  ✔ the guest defeated it (state 7)
  ✔ a recruitment card appeared for the guest
  ✔ the guest owns the Chompkin (chompkin)
  ✔ the fee was paid (1011 -> 891)
  ✔ the host's game records the guest as the owner
The guest presses H; the monster moves into their base
  ✔ placed on pad 0
  (round trip guest -> Firebase -> host -> Firebase -> guest: about 22 ms on localhost; the guest downloads about 21.8 KB/s)
The host closes the game
  ✔ the guest is told (The room was closed)
  ✔ host: no browser errors
  ✔ guest: no browser errors

ROOM E2E PASSED
```

Since accounts were added the test runs against the **Firebase Local Emulator
Suite** (`firebase-tools` 13: Authentication + Realtime Database, started with
`firebase.json` and the rules file in this folder). It also logs in as the
admin "daniel", makes an account for the friend, checks unique names, the
"start over or continue?" question, that the friend's monster is in their own
account afterwards, and the admin returning a stolen monster and banning the
thief. Result of the last run (after the room part shown above):

```
The admin "daniel" logs in and opens a room
  ✔ the title screen offers "Create room"
  ✔ logged in as daniel (logged in), shown as the admin
  ✔ the admin has the "Player" button
  ✔ room code WDBEG
  ✔ invite link http://127.0.0.1:45269/minecraft-realistis/?room=WDBEG
  ✔ the HUD shows the room (🌐 Room WDBEG · 1 player · 🔗 Copy link)
A friend opens the link, makes an account and joins
  ✔ the room code from the link is filled in
  ✔ joining needs an account (⚠ Log in to your account (or create one) to play online with friends.)
  ✔ account "Guestyotth" created
  ✔ nobody else can take the same name (other letters too)
  ✔ a normal player has no "Player" button
...
The guest's progress is in their own account and comes along everywhere
  ✔ saved in the guest's account (chompkin)
  ✔ still logged in after reopening the game
  ✔ asked: start over or continue?
  ✔ the Chompkin from the friend's room is in the guest's own game (chompkin)
Back in the room: the admin returns a stolen monster and bans the thief
  ✔ the Player panel shows who stole what from whom
  ✔ the stolen monster was taken from the thief
  ✔ it waits in the owner's returns (read denied (as it should be: only the owner reads))
  ✔ the thief is kicked (You were banned by the admin.)
  ✔ the ban is saved online
  ✔ a banned player can't come back (⚠ This account is banned from online rooms.)
  ✔ guest pages: no browser errors 
The host closes the game
  ✔ host: no browser errors 
  ✔ guest: no browser errors 

ROOM E2E PASSED
```

The security rules are checked directly against the emulators by
`node scripts/rules-check.mjs` (all PASS): a player writes only their own
account and only under the name they logged in with (nobody else can take
"daniel"), no extra fields; only "daniel" can ban or send returns; a banned
player can't open or join a room; nobody can join, send or be written to as
someone else; only the host closes the room; the list of rooms can't be read.

**Not verified:** a live Firebase project on the internet (the project's
config is in `public/firebase-config.js`, but this workspace cannot reach
firebasedatabase.app). Email/Password sign-in must be switched on and the new
rules published in that project (PANDUAN-FIREBASE.md). Real-world delay through Firebase servers is expected to be
around 100–300 ms but was not measured. Keeping the game running while the
host's tab is in the background (worker timers) was not tested in a hidden tab.

### Server load test — `npm run test:load`

12 simulated players (real Socket.IO clients, the server's player cap) walk out
of their tower bases through the door, round the towers into the plains and
swing swords for 60 s while the server ticks are timed. The bots slide around
trees and walls like the real client, and the server refused none of their
moves (0 corrections). On this 4-core container the 20 Hz tick used about
1.5 ms of its 50 ms budget at the 95th percentile, and each client received
about 20 KB/s (the event-loop lag figures are at the monitor's 10 ms resolution):

```
{
  "players": 12,
  "seconds": 60,
  "monsters": 135,
  "ticks": 1198,
  "tickMs": { "avg": 0.77, "p50": 0.84, "p95": 1.53, "p99": 2.26, "max": 9.4 },
  "budgetMs": 50,
  "eventLoopLagMs": { "p50": 10.2, "p99": 11.6 },
  "downKBps": { "avg": 20.3, "max": 22.6 },
  "corrections": 0,
  "rssMB": 111
}

LOAD OK: p95 tick 1.53 ms of a 50 ms budget
```

All 12 bots stay in the plains here (new players can't enter the other regions
yet), so the plains has its 50 monsters and the regions next to it 20 each.

### Worst-case monster population — `npm run bench:population`

12 players, each on a different region/island, so 12 regions fill to 50
monsters at once (605 wild monsters). The real `Game` runs in-process with a
simulated clock; every tick (AI, attacks, snapshots for all 12 players) is
timed after the regions have filled:

```
monsters: 605 (50 or 51 in each of the 12 regions; the extra one is a hidden-spot monster)
tickMs:   avg 0.47, p50 0.51, p95 0.88, p99 1.39, max 4.78  (budget 50)
download: about 26 KB/s per player (max 33.5)
```

The players in this benchmark walk slowly and don't fight, so it measures the
cost of the population itself; a client only receives the monsters within
135 m of it.

### Phone-sized touch check — `node scripts/mobile-check.mjs ./shots`

844×390 landscape viewport with touch emulation. It checks that the touch
controls appear, that every HUD/touch button is on screen and is the topmost
element at its center (so a tap reaches it), and that the joystick moves the
player:

```
✔ touch controls shown
✔ all 21 touch/HUD controls are on screen and tappable
✔ joystick moved the player 6.5 units
✔ no browser errors
```

### UI tour — `node scripts/ui-tour.mjs ./shots`

Opens every panel (Monsters, Dex, sword shop, gadget shop, Base, Lucky board,
Map, Settings, Help), the monster inspector and the LUCKY LUCKY banner, and
saves screenshots. Last run: every panel opened, **no browser errors**. The screenshots were reviewed by eye
(layout, text fitting, 3D previews rendering).

### Rendering cost (software rendering, so frame rate is not meaningful)

Measured with `renderer.info` at four places in the world after the
performance pass (far-plane culling, chunked props with detail culling, merged
monster meshes with a low-poly copy for far-away monsters, instanced base pads
and clouds, distance-culled labels):

| Quality | Draw calls | Triangles |
|---|---|---|
| Low | 250–420 | 160–215 K |
| High (incl. shadow pass) | 470–630 | 230–320 K |

Before the pass: 430–980 draw calls and 430–830 K triangles at Low.

With **50 wild monsters on every island** the client receives 45–60 monsters
at a time. Far-away monsters are not drawn (Low: beyond 80 m, Medium: 110 m,
High: 150 m; one that is chasing you is always drawn). Measured in the
single-player build after the islands filled up, in the plains meadow and the
jungle: Low 160–260 draw calls, 170–205 K triangles; High 690–750 draw calls,
330 K triangles. Without the distance limit Low was 470–540 draw calls.
Press **F3** in the game to see these numbers live.

Lucky Blocks, Gem Geodes and glowing swords used to carry their own point
light. In three.js every extra light makes all lit materials more expensive
and recompiles their shaders whenever the light count changes, so the LUCKY
LUCKY event (two dozen blocks) was very slow. They now use an additive glow
sprite instead; in the two-browser e2e run the CPU time spent submitting a
frame during the event dropped from about 300 ms to about 11 ms.

---

## 3. Checked by hand in a browser (screenshots reviewed)

- Title screen, name/color picker, joining, HUD, tutorial steps.
- The original 57 monsters in the gallery (`/gallery.html`): every one renders, looks
  distinct, has eyes/face in the right place, and plays idle/quirk animations.
- World: plaza, shops, bases, every region's look, water, lava, fog per region,
  day/night, LUCKY LUCKY sky and banner, region barriers and portals.
- Combat: swings, damage numbers, attack telegraphs (lunge/breath/slam
  orientation), monster hurt/stunned/defeated poses.
- Recruitment card with the live 3D preview; R to recruit; auto-placement on
  H teleport; placed monsters animating on their pads.
- Theft: carried monster above the thief's head; the owner's alert; lasers
  visible and blocking.
- Minimap rotation; world-map labels at 1280×720 and 1920×1080 (no overlaps).
- Several recruit offers at once (newest card expanded, older ones collapsed);
  name labels and health bars staying a sensible size up close; the base sign
  hiding up close so it doesn't cover your monsters.
- Landscape-phone title screen and HUD (844×390).
- Monster Gems: the HUD counter, a Gem Geode in the Volcanic Kingdom (cracked
  with E), gem prices in the sword shop and base upgrades; a Celestail recruit
  card showing its sword condition with the Recruit button disabled.
- Decorations bought through the real client actions, rendered on the wall
  spots of the base, and the Base panel's decoration list.
- The capture animation after pressing R (scripted in the single-player build,
  stepped frame by frame because software rendering is slow): the ring and
  light beam around the monster, the monster spinning and shrinking, the orb
  flying in an arc to the player, the sparkles and cheer when it lands, and
  the new follower appearing next to the player; the Money and the monster
  were in the profile afterwards.
- The new swords in the sword shop (icons, stats, special labels, gem prices).
- The 13 new monsters in the gallery.
- Tower bases (scripted in the single-player build): walked up the inside
  stairs to floor 2 and floor 3 with the normal controls, the in-page server
  agreed on the height, monsters on floor-2 pads; screenshots from inside each
  floor and from outside (dark block walls, white window frames, name board,
  laser door).
- The seven monster islands: the Island Gate travel panel and its level locks,
  travelling to Cute Monster Island, the world map with the island insets,
  the Monsterdex island tabs and each island's gallery page.
- The moon secret (scripted with a real server and browser): a moon button
  before and after stepping on it (it turns blue, the "🌙 1/5" banner and
  the 🌙 counter under the minimap), the Moon Portal appearing with the
  on-screen arrow, the Moon Sky Arena (night sky, giant moon, stones,
  coloured round platforms and their signs) and the round 1 monster on its
  platform.
- Companions: a team of five walking behind the player with their 💖 names,
  and the team fighting and defeating a monster that bit the player.
- Costumes: all five worn in the open (Black Spy by day and at night with the
  glowing stickman lines and LEDs, Flame Ninja, Frost Knight, Thunder Hero
  with its cape, Bunny Hoodie with ears) and their idle stances; Z hitting a
  monster for exactly 583; the slash, ring and lightning effects; the Costume
  Shop (day and night pictures) and the Upgrade your power panel; the two new
  stalls in the plaza.
- Accounts: the title screen with **Log in / Create account**, name and
  password (Node server and web build).
- Legend Master (scripted with a real server and browser): buying it at the
  Costume Shop for 200,000,000 opens **Choose your power** with the six
  powers and their pictures; choosing Ice closes it and the Z button says
  *Absolute Zero*; the costume worn in all six powers (colours, crown, cape,
  glowing lines, orbs); all 10 sword moves frozen at the moment of the hit
  (each pose and its slash: flat, backhand, chop, rising, full spin, stab,
  X, ground slam, double spin, the big finisher); Z for all six powers with
  five monsters around (fire pillars, ice spikes, sky lightning, the
  shadow wave, light pillars, the cosmic sphere).
- Guards at level 10 (with a second player walking in as the thief): gold
  guards with capes around the thief at the door and on every floor, the
  "🚨 THIEF! Bob is trying to steal your monsters — your guards are
  fighting!" banner, the four gold helicopters circling the tower, and
  "💥 The thief Bob has defeated your guards!" after every guard was knocked
  out.

---

## 4. Not verified

- **Real-GPU frame rate.** No hardware GPU was available. Draw-call and
  triangle counts are reasonable for WebGL, but the actual FPS on desktop,
  laptop or phone hardware was never measured.
- **Real phones and tablets.** Touch controls were tested only with Chromium's
  mobile emulation (joystick, buttons, layout), not on an actual device.
- **Safari and Firefox.** Only Chromium was tested.
- **Internet conditions.** All multiplayer tests ran on localhost; latency,
  jitter and packet loss over a real network were not tested (the client
  interpolates with a 120 ms buffer and the server tolerates jitter in its
  movement checks, but that is untested in the wild).
- **Long sessions.** No multi-hour server run or memory-growth test.
- **Audio.** Sounds are synthesized with Web Audio and play without errors,
  but were not listened to by a person.
- **Game balance.** Prices, income, spawn rates and difficulty were set by
  reasoning, not by playtesting over hours.
- **Multiple server processes.** The game is designed for one Node process
  per world; horizontal scaling is not supported or tested.
