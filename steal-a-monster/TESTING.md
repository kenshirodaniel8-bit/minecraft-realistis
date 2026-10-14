# Testing STEAL A MONSTER

This file separates what was **tested automatically**, what was **checked in a
real browser** (scripted or by looking at it), and what is **not verified**.

Test environment: Node.js 22 (unit tests also on Node 20.20), headless Chromium
via Playwright with **SwiftShader software WebGL** on a 4-core Linux container.
There was no real GPU, phone, Safari or Firefox available.

---

## 1. Automated tests — executed, all passing

```bash
npm test          # 44 tests, ~3 s, also runs in CI (.github/workflows/ci.yml)
```

They run the real server code: the `Game` class with a controllable clock and an
in-memory or temporary-directory store, and for networking a real HTTP +
Socket.IO server with real socket clients.

| Suite | Tests | Covers |
|---|---|---|
| `profile.test.js` | 7 | 1,000 Money exactly once (new profile only); no re-grant on reconnect/refresh/respawn; token hashing; save survives a server restart; corrupt save → backup restore, both broken → login refused (no fresh bonus); save retries; schema migration and repair of forged data |
| `combat.test.js` | 6 | all 44 species build a distinct 3D model in Node; sword reach/facing/cooldown, server-side damage only; monsters attack, knock out, respawn at home; dodge immunity; defeat → recruitment offers only to real fighters; AI behaviour (shy flee, territorial, region bounds) |
| `recruitment.test.js` | 8 | not enough Money → nothing changes; exact price deducted once; no double recruit (retries, double clicks, two players racing); fighter priority + base capacity; decline; one pad per monster; passive income, collect, offline cap; disconnect with an open offer |
| `stealing.test.js` | 11 | lasers block entry and theft; lasers switching on eject intruders and make a thief drop; steal → carry → deliver, ownership moves exactly once; duplicate/invalid steal requests; an aborted grab tells the owner it is safe; gadget hit releases the monster (both drop rules); dropped monsters fly home; disconnects during theft; H teleport rules (own base only, cooldown, not while carrying); gadget range/facing/cooldown/shields; shop prices, proximity, idempotency |
| `world.test.js` | 8 | deterministic world, 12 flat bases, spots inside their regions; region unlocks refused by the server; expansion regions open/close with hysteresis; closed portals; Lucky Blocks open once, only up close, server-rolled rewards; LUCKY LUCKY lifecycle; forged messages can't create Money/ownership/teleports; hidden/night spawns and the ruins vault puzzle |
| `multiplayer.test.js` | 4 | HTTP serves the game, shared modules, three.js and Socket.IO; two clients get different bases and see each other move; LUCKY LUCKY is identical for both; malformed/forged socket messages are rejected |

The README's "Testing" section maps the 24 required checks to these suites.

---

## 2. Scripted browser and load tests — executed

These need Playwright and Chromium (`npm i -D playwright` or a global install).
They are not part of CI because they take minutes and need a browser.

### Two-player end-to-end test — `npm run test:e2e`

Starts its own server and drives **two real browser pages** (Alice and Bob)
with the real controls (keys, camera, pointer). The result of the last run:

```
E2E_RESULT_PLACEHOLDER
```

Because SwiftShader renders at about 1–2 frames per second with two browsers on
one CPU, the bots pause drawing (`__app.skipRender`) while walking long routes so
they move in real time; game logic, input and networking keep running, and
drawing is switched back on before every check that looks at the screen.

### Server load test — `npm run test:load`

12 simulated players (real Socket.IO clients, the server's player cap) walk out
of their bases, wander the plains and swing swords for 40 s while the server
ticks are timed:

```
LOAD_RESULT_PLACEHOLDER
```

### Phone-sized touch check — `node scripts/mobile-check.mjs ./shots`

844×390 landscape viewport with touch emulation:

```
MOBILE_RESULT_PLACEHOLDER
```

### UI tour — `node scripts/ui-tour.mjs ./shots`

Opens every panel (Monsters, Dex, sword shop, gadget shop, Base, Lucky board,
Map, Settings, Help), the monster inspector and the LUCKY LUCKY banner, and
saves screenshots. UI_TOUR_PLACEHOLDER The screenshots were reviewed by eye
(layout, text fitting, 3D previews rendering).

### Rendering cost (software rendering, so frame rate is not meaningful)

Measured with `renderer.info` at four places in the world after the
performance pass (far-plane culling, chunked props with detail culling, merged
monster meshes with a low-poly copy for far-away monsters, instanced base pads
and clouds, distance-culled labels):

| Quality | Draw calls | Triangles |
|---|---|---|
| Low | 270–420 | 160–210 K |
| High (incl. shadow pass) | 470–630 | 230–320 K |

Before the pass: 430–980 draw calls and 430–830 K triangles at Low.
Press **F3** in the game to see these numbers live.

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
- Minimap rotation and world-map labels; offer cards on short screens.

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
