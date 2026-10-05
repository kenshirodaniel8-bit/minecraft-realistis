# Realistis – realistic Minecraft-style game in your browser

A block-building sandbox with **realistic graphics**: real-time sun shadows, god rays through
the trees, animated water that mirrors the world around it, waving grass and leaves, a day/night cycle with sunsets,
stars and moonlight, warm torch lighting in caves, and high-resolution (64×64) textures with
normal maps.

Pick **1. Survival** (gather, craft tools, eat, survive zombies at night) or **2. Creative**
(every block, flying, instant building) right on the title screen. It also has **singleplayer**
(worlds are saved in your browser), **multiplayer** (play together with friends), **custom skins**
(upload any Minecraft-format skin `.png`) and **touch controls** for phones and tablets.

**Play in your browser, no install:** https://claude.ai/artifact/EkrewQJMC27wXaaCMS3WSj
(singleplayer; for multiplayer run the server as described below).

![Jungle with sun rays](docs/screenshots/jungle-sunrays.jpg)

| | |
|---|---|
| ![Jungle floor](docs/screenshots/jungle-floor.jpg) | ![Sunset over water](docs/screenshots/sunset-water.jpg) |
| ![Landscape](docs/screenshots/landscape.jpg) | ![Skin editor](docs/screenshots/skin-editor.jpg) |

## How to play (quick start)

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. Download this project, open a terminal in its folder and run:

   ```bash
   npm install
   npm start
   ```

3. Open **http://localhost:3000** in Chrome, Edge or Firefox.
4. On the title screen click **1 · Survival** or **2 · Creative** (or press the **1** / **2** key).
   The first time, a new world is created for you; after that you get your list of worlds for
   that mode. Click the screen to start playing. **My Worlds** lists every world and lets you
   create one with your own name, seed and mode.

## Controls

| Key | Action |
|---|---|
| **W A S D** or **↑ ← ↓ →** | Move |
| Mouse | Look around |
| **Space** | Jump / swim up — double-tap to fly (creative) |
| **Shift** | Sneak (you won't fall off edges) / fly down |
| **R** or double-tap **W** | Sprint |
| Left click | Break block (hold it in survival) / attack |
| Right click | Place block / hold to eat food |
| Middle click | Pick the block you are looking at |
| **1–9** / mouse wheel | Choose hotbar slot |
| **E** | Inventory: block picker (creative) or inventory + crafting (survival) |
| **Q** | Drop one of the held item (survival) |
| **T**, **Enter** or **/** | Chat and commands (`/help`) |
| **F5** or **V** | First / third person view |
| **F1** / **F2** / **F3** | Hide HUD / screenshot / debug info |
| **Esc** | Pause menu (settings, save & quit) |

Chat commands: `/time set day|noon|sunset|night|midnight`, `/gamemode creative|survival`,
`/tp x y z`, `/spawn`, `/seed`, `/fly`, `/give <item> [count]` (e.g. `/give iron_pickaxe`),
`/peaceful` (turn monsters off or on), and `/list` on servers.

**Phones and tablets:** move with the joystick on the left, drag anywhere else to look, and use
the buttons on the right to break, place / eat, jump and sneak. The buttons at the top open the
inventory, change the view, go fullscreen and pause. Tap a hotbar slot to select it.

**If the mouse can't be captured** (some embedded pages and browser settings block it), the
game switches to drag-to-look by itself: hold the mouse button and drag to look around, click
to break, right-click to place.

## Game modes

### 1. Survival

You start with nothing. Your health and hunger bars sit above the hotbar.

1. **Wood:** hold left click on a tree trunk to get logs. Open the inventory (**E**) and craft
   planks, then sticks and a **crafting table**. Place the table: recipes marked
   *Crafting Table* only work within a few blocks of it.
2. **Tools:** a wooden pickaxe can mine stone; stone tools mine iron ore; iron tools mine gold
   and diamond ore; only a diamond pickaxe mines obsidian. Mining with the right tool is much
   faster, and some blocks drop nothing without it. Axes are best for wood, shovels for dirt,
   sand and gravel, swords for fighting. Tools wear out (the bar under the slot).
3. **Furnace:** craft one from 8 cobblestone and stand near it to smelt iron and gold ore into
   ingots, cook meat, and make glass, smooth stone and bricks. Coal comes from coal ore, or
   smelt 2 logs into 1 coal.
4. **Food:** running, jumping, swimming and healing make you hungry. Pigs and cows drop raw
   meat; cook it in the furnace for much more food. Leaves sometimes drop apples. Hold right
   click with food in your hand to eat. With a full food bar you slowly heal; with an empty
   one you lose health.
5. **Night:** zombies spawn in the dark and at night, and burn up when the sun rises. Fight
   them with a sword (attacks while falling are critical hits), or build a shelter and light
   it with torches. Choose *Peaceful* when creating a world, or type `/peaceful`, if you just
   want to explore.

Long falls and drowning hurt. When you die you respawn at the world spawn.

### 2. Creative

Every block and item is available in the inventory (**E**) with a search box, blocks break
instantly, you can't take damage, and double-tapping **Space** toggles flying.

## Multiplayer

`npm start` also starts the multiplayer server.

- **Same Wi-Fi / LAN:** the terminal prints an address like `http://192.168.1.20:3000`.
  Friends open that address and click **Multiplayer → Join Server**.
- **Over the internet:** forward port 3000 on your router, or run the server on any Node.js
  host (Render, Railway, Fly.io, a VPS…). Players enter the address in **Multiplayer**.
  If the game page is opened over `https://`, the server must also use `https`/`wss`.

Each player chooses **Survival** or **Creative** on the Multiplayer screen before joining.
Everyone shares the same world: block changes, chat, the time of day and player skins are
synced. Animals and monsters are singleplayer-only for now. The server saves the world to `server/data/world.json` every 30 seconds and when it
stops.

Server options (environment variables):

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | Port to listen on | `3000` |
| `SEED` | Seed for a new world | random |
| `GAMEMODE` | Mode for players whose game doesn't send one | `creative` |
| `MAX_PLAYERS` | Player limit | `20` |
| `RESET=1` | Start a fresh world (the old one is backed up) | |

Example: `PORT=8080 SEED=jungle npm start` (on Windows PowerShell: `$env:PORT=8080; npm start`).

## Skins

Open **Skin & Profile** on the title screen to set your name and upload a skin. Any
Minecraft-format skin works: 64×64, the classic 64×32 layout, or HD skins (128, 256, 512).
Slim (3-pixel arm) skins are detected automatically. Other players see your skin in multiplayer.

## Graphics settings

The first time you play, the game checks your frame rate and lowers the graphics by itself if
your computer struggles. You can always change it: open **Settings** and choose a
**Graphics quality** or **Render distance**:

- **Low** – no shadows or post-processing (fastest; good for laptops)
- **Medium** – sun shadows + bloom
- **High** – shadows, god rays, water reflections, bloom (default)
- **Ultra** – 4K shadow maps, sharper reflections, full resolution

The game needs a browser with WebGL 2 (all current versions of Chrome, Edge, Firefox and Safari).

On phones and tablets the game starts on **Medium** graphics with a shorter render distance.

## Play without installing

Singleplayer works as a static website, without the Node.js server:

- **GitHub Pages:** on GitHub open **Settings → Pages** and set **Source** to
  **GitHub Actions**, then open **Actions → Deploy to GitHub Pages → Run workflow**.
- **Any web host:** run `npm run build:static` and upload the `dist` folder.
- **Hosts that wrap pages in their own HTML** (like the play link above): run
  `node scripts/build-static.js --embedded`. This writes `dist-embedded`, which loads three.js
  from the jsDelivr CDN.

If web workers or pointer lock are blocked on a host, the game falls back to running world
generation on the main thread and to drag-to-look.

## For developers

```
public/            browser game (no build step, plain ES modules + three.js)
  js/engine/       world generation, meshing, lighting, rendering, physics, networking,
                   items.js / survival.js (tools, recipes, hunger, inventory), mobs.js
  js/ui/           HUD, inventory, block and item icons, touch controls
server/server.js   static file server + WebSocket multiplayer server
scripts/           static build
tests/             unit and integration tests (node --test)
```

- `npm test` runs the tests (terrain, lighting, meshing, player physics, survival rules,
  crafting, worker fallback, multiplayer server).
- Terrain generation, lighting and meshing run in Web Workers. Every chunk is a pure function of
  the world seed, so only player edits are saved and sent over the network.
- All textures and sounds are generated in code, so there are no asset files to download.

Realistis is a fan-made project and is not affiliated with Mojang or Microsoft.
