# nes-emulator

## Directory structure

- `packages/web/`: Vue/Vite Web package, deployable on its own.
- `packages/player/`: shared NES player package with display, controls, settings, and runtime wiring.
- `packages/app/`: Tauri app shell for desktop, Android, and iOS. It owns its own Vue entry and can add native cache/log/file-system behavior without changing the Web package.
- `scripts/`: repository-level helper scripts.

## Build

- `pnpm install`: install workspace dependencies.
- `pnpm --filter @nes-emulator/web run sync:rom-catalog`: sync the ROM catalog into `packages/web/public/catalog.json`. By default it uses `E:\nes-roms\catalog.json` when present, otherwise it fetches the remote GitHub raw catalog.
- `pnpm --filter @nes-emulator/web run build`: build the standalone Web app.
- `pnpm --filter @nes-emulator/app run build:frontend`: build the App frontend into `packages/app/dist`.
- `pnpm --filter @nes-emulator/app run build`: build the Tauri app shell, using `packages/app/dist`.

## ROM catalog

- Web reads `./catalog.json` from the same origin to avoid browser CORS failures on remote raw files.
- ROM download URLs are used exactly as written in the synced catalog.
- To switch ROM hosting, provide a catalog whose `download_url` values point at the new CORS-enabled source.
