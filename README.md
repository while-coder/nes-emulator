# nes-emulator

## Directory structure

- `packages/web/`: thin Vue/Vite Web host, deployable on its own.
- `packages/player/`: shared NES player package with the app shell, display, controls, settings, runtime wiring, and the libretro core assets.
- `packages/app/`: thin Tauri app host for desktop, Android, and iOS. Native exit/back handling stays here; shared player UI stays in `packages/player`.
- `scripts/`: repository-level helper scripts.

## Build

- `pnpm install`: install workspace dependencies.
- `pnpm --filter @nes-emulator/web run build`: build the standalone Web app.
- `pnpm --filter @nes-emulator/app run build:frontend`: build the App frontend into `packages/app/dist`.
- `pnpm --filter @nes-emulator/app run build`: build the Tauri app shell, using `packages/app/dist`.

## ROM catalog

- Web and App load the ROM catalog from the remote GitHub raw URL at runtime, so the large catalog is not bundled into the frontend output.
- ROM download URLs are used exactly as written in the remote catalog.
- To switch ROM hosting, update the catalog URL in `packages/player/src/store/romCatalog.ts`, and provide a catalog whose `download_url` values point at the new CORS-enabled source.
