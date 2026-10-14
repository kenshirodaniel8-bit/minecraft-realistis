# Testing STEAL A MONSTER

This file separates what was **tested automatically**, what was **checked in a
real browser** (scripted or by looking at it), and what is **not verified**.

Test environment: Node.js 22 (unit tests also on Node 20.20), headless Chromium
via Playwright with **SwiftShader software WebGL** on a 4-core Linux container.
There was no real GPU, phone, Safari or Firefox available.

---

## 1. Automated tests — executed, all passing

```bash
npm test          # 51 tests, ~3 s, also runs in CI (.github/workflows/ci.yml)
```

They run the real server code: the `Game` class with a controllable clock and an
in-memory or temporary-directory store, and for networking a real HTTP +
Socket.IO server with real socket clients.

| Suite | Tests | Covers |
|---|---|---|
| `profile.test.js` | 8 | 1,000 Money exactly once (new profile only); no re-grant on reconnect/refresh/respawn; token hashing; save survives a server restart; corrupt save → backup restore, both broken → login refused (no fresh bonus); save retries; schema migration (1 → 2) and repair of forged data; coming back after a minute pays a minute of offline income (timestamps survive a reload) |
| `combat.test.js` | 6 | all 44 species build a distinct 3D model in Node; sword reach/facing/cooldown, server-side damage only; monsters attack, knock out, respawn at home; dodge immunity; defeat → recruitment offers only to real fighters; AI behaviour (shy flee, territorial, region bounds) |
| `recruitment.test.js` | 9 | not enough Money → nothing changes; extra recruit conditions on rare monsters (sword tier, discoveries); exact price deducted once; no double recruit (retries, double clicks, two players racing); fighter priority + base capacity; decline; one pad per monster; passive income, collect, offline cap; disconnect with an open offer |
| `stealing.test.js` | 11 | lasers block entry and theft; lasers switching on eject intruders and make a thief drop; steal → carry → deliver, ownership moves exactly once; duplicate/invalid steal requests; an aborted grab tells the owner it is safe; gadget hit releases the monster (both drop rules); dropped monsters fly home; disconnects during theft; H teleport rules (own base only, cooldown, not while carrying); gadget range/facing/cooldown/shields; shop prices, proximity, idempotency |
| `world.test.js` | 8 | deterministic world, 12 flat bases, spots inside their regions; region unlocks refused by the server; expansion regions open/close with hysteresis; closed portals; Lucky Blocks open once, only up close, server-rolled rewards; LUCKY LUCKY lifecycle; forged messages can't create Money/ownership/teleports; hidden/night spawns and the ruins vault puzzle |
| `gems.test.js` | 4 | Monster Gems drop by rarity (plus the Volcanic bonus) and can't be forged; Gem Geodes pay out once and only in gem regions; gem-priced swords and upgrades take Money and Gems together or nothing; decorations are bought only at your own base, placed/moved/cleared on valid spots, visible to other players, trophies only from milestones |
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

### Server load test — `npm run test:load`

12 simulated players (real Socket.IO clients, the server's player cap) walk out
of their bases, wander the plains and swing swords for 40 s while the server
ticks are timed. On this 4-core container the 20 Hz tick used about 2.5 ms of
its 50 ms budget at the 95th percentile, and each client received about
19 KB/s (the event-loop lag figures are at the monitor's 10 ms resolution):

```
{
  "players": 12,
  "seconds": 40,
  "monsters": 141,
  "ticks": 799,
  "tickMs": {
    "avg": 1.26,
    "p50": 1.2,
    "p95": 2.56,
    "p99": 4.63,
    "max": 7.35
  },
  "budgetMs": 50,
  "eventLoopLagMs": {
    "p50": 10.2,
    "p99": 12.7
  },
  "downKBps": {
    "avg": 18.6,
    "max": 21.6
  },
  "corrections": 0,
  "rssMB": 111
}

LOAD OK: p95 tick 2.56 ms of a 50 ms budget
```

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
- All 44 monsters in the gallery (`/gallery.html`): every one renders, looks
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
