# Voxel Engine

![Gameplay screenshot](https://github.com/user-attachments/assets/58cbaf03-9ee5-4adb-805d-c17dac685c6a)

A modern voxel sandbox built on Three.js with dynamic world streaming, volumetric clouds, and a fully interactive inventory. The project serves as a rendering/tech playground, so lighting, weather, and graphics settings get most of the attention.

---

## Features

- Procedural chunked world generation with streaming inside the render radius
- Graphics presets (Performance, Balanced, Cinematic) plus custom overrides
- Dynamic day/night cycle and physically inspired volumetric clouds
- Custom block shader with cloud shadows and PCF/Poisson filtering
- FPS-style movement (pointer lock, sprint, jump, crouch, hotbar)
- Drag-and-drop inventory UI, block selection, ambient audio
- HUD plus debug visualizers (lighting, depth, shadow map, wireframe, etc.)

---

## Requirements

- Node.js 18+ or Python 3.x (for a quick local web server)
- Modern WebGL2-capable browser
- GPU with floating texture support and highp fragment precision recommended

---

## Getting Started

[▶️ Live Demo](https://topl1nk.github.io/Voxel-Engine/)

> The project uses native ES modules. Loading via `file://` is not supported; use any HTTP server.

### Option 1. Python

```bash
python -m http.server 8000
```

Open `http://localhost:8000` and navigate to `index.html`.

### Option 2. Node.js

```bash
npx http-server -p 8000
```

### Option 3. VS Code

Install the **Live Server** extension, right-click `index.html`, and choose *Open with Live Server*.

---

## Controls

| Key | Action |
| --- | --- |
| **W / A / S / D** | Move |
| **Space** | Jump |
| **Shift** | Sprint |
| **Ctrl** | Crouch |
| **1–9** | Hotbar slots |
| **LMB** | Remove block |
| **RMB** | Place block |
| **E** | Toggle inventory |
| **P** | Toggle HUD |
| **Esc** | Pause / exit pointer lock |
| **[, ]** | Cycle debug views |

---

## Graphics Settings

Available in the in-game menu:

- Shadow type, map size, distance, blur radius
- Render distance and day/night speed
- Cloud coverage and lighting intensity
- FXAA and cinematic post-processing

All values persist in `localStorage`; presets can be switched at runtime.

---

## Project Structure

```text
├── index.html
├── css/
│   └── style.css            # UI & HUD
├── js/
│   ├── app.js               # Entry point, scene, UI
│   ├── world.js             # Chunk management & materials
│   ├── chunk.js             # Chunk mesh generation
│   ├── player.js            # Player controller & input
│   ├── inventory.js         # Inventory UI & drag-n-drop
│   ├── sky.js               # Sun, moon, volumetric clouds
│   ├── shaders.js           # GLSL for blocks/clouds
│   ├── constants.js         # Block definitions & config
│   ├── noise.js             # Terrain noise helpers
│   ├── settings.js          # Presets & persistence
│   └── …                    # Audio, textures, helpers
└── assets/
    └── atlas.png            # Block texture atlas
```

---

## Useful Commands

| Command | Description |
| --- | --- |
| `python -m http.server 8000` | Quick static server (Python) |
| `npx http-server -p 8000` | Same via Node.js |
| `npm install && npm run dev` | Use your custom dev script (if any) |

---

## Credits

This prototype—including all code, assets, and textures—was produced entirely with the assistance of AI copilots. The human “author” curated prompts and direction but did not hand-code the final result.
