# NWGE Studio

NWGE Studio is the desktop editor for the NumWorks Game Engine. It gives you a full game-making workspace for sprites, objects, rooms, scripts, live preview, and export, wrapped in a Tauri desktop app with a React UI.

## What you can do

- Build complete NWGE projects in a desktop editor
- Draw and animate sprites with a pixel-art workflow
- Create objects and bind Lua scripts to game events
- Design rooms with instance layers, tile layers, and backgrounds
- Edit Lua with Monaco-based code editing and built-in runtime docs
- Save and load `.nwgs.json` project files
- Export raw `.pack` bundles for the engine runtime
- Use cloud compilation to turn your current project into a device-ready `.nwa`
- Launch the simulator with the latest matching runtime artifacts
- Flash the latest compiled device runtime together with your current pack to a calculator

## Main features

### Project workspace

The studio keeps game resources in one place:

- Project settings and calculator icon selection
- Rooms, objects, sprites, and scripts in a resource tree
- Dedicated property panels for each resource type
- Recent-project launcher for quickly reopening workspaces

### Sprite editor

The sprite workflow is built for small-screen game assets:

- Multi-frame sprite animation
- Pixel drawing tools including line, rectangle, circle, fill, erase, move, and selection
- Frame previews and animation timing
- Bounding box and origin controls
- Import image files as new sprites or frames

### Object and room editing

You can wire gameplay together visually:

- Assign sprites to objects
- Connect scripts to create, step, draw, destroy, collision, alarm, and button events
- Place object instances inside rooms
- Organize backgrounds, tiles, and instances in separate layer types
- Preview camera position and follow behavior
- Paint tile data and collision masks

### Lua authoring

The script editor is designed around the runtime:

- Monaco-based Lua editor
- Lua language-server integration
- Diagnostics, completion, hover, and go-to-definition support
- Built-in runtime documentation and Lua API reference
- Fast switching between code and gameplay resources

### Preview, export, and deployment

NWGE Studio supports several ways to run and ship your game:

- `Export Pack`: write a raw `.pack` file for the current project
- `Embedded Export`: upload the generated pack to the NWGE backend and download a compiled `.nwa`
- `Run Simulator`: download the latest compatible host runtime and simulator artifacts, then launch them with your current pack
- `Flash To Calculator`: download the latest device `.nwa` and install it with your pack using `nwlink`
- Output pane for build, simulator, and flashing logs
- Preview console for sending Lua commands to a running simulator session

## Cloud compilation

One of the main release workflows in the studio is cloud compilation.

When you choose the embedded export flow, the studio:

1. Builds your current project into an NWGE `.pack`
2. Uploads that pack to the backend
3. Optionally sends a calculator icon generated from the selected project sprite
4. Waits for the server to compile a device-ready `.nwa`
5. Downloads the compiled file back to your machine

This means you can generate a calculator-ready app package without needing a full local embedded toolchain installed.

## Tech stack

- Tauri 2
- React 18
- TypeScript
- Vite
- Monaco Editor
- Rust backend commands for pack building, simulator launch, export, and tooling integration

## Development

### Prerequisites

- `pnpm`
- Rust toolchain
- Tauri prerequisites for your platform

### Install dependencies

```bash
pnpm install
```

### Run the frontend in development

```bash
pnpm dev
```

### Run the desktop app

```bash
pnpm tauri dev
```

### Build the frontend

```bash
pnpm build
```

### Build the desktop app

```bash
pnpm tauri build
```

## Notes

- Project files are saved as `.nwgs.json`
- Exported runtime bundles are saved as `.pack`
- Cloud-compiled calculator apps are downloaded as `.nwa`
- Flashing requires `npx` so the studio can run `nwlink`

## License

MIT

## Trademarks

NumWorks is a registered trademark.
