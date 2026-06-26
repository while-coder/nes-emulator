# nes-emulator

## Directory structure

- `packages/web/`: Vue/Vite Web package, deployable on its own.
- `packages/player/`: shared NES player package with display, controls, settings, and runtime wiring.
- `packages/app/`: Tauri app shell for desktop, Android, and iOS. It owns its own Vue entry and can add native cache/log/file-system behavior without changing the Web package.
- `packages/wasm-core/`: Rust/WASM emulator adapter consumed by the player package.
- `scripts/`: repository-level build scripts, such as the WASM build helper.

## Build

- `npm install`: install workspace dependencies.
- `npm run sync:rom-catalog --workspace @nes-emulator/web`: sync the ROM catalog into `packages/web/public/catalog.json`. By default it uses `E:\nes-roms\catalog.json` when present, otherwise it fetches the remote Gitee catalog.
- `bash scripts/build-wasm.sh`: build `packages/wasm-core` into `packages/player/src/wasm`.
- `wasm-pack build packages/wasm-core --target web --out-dir ../player/src/wasm --out-name nes_core`: same WASM build command for Windows/PowerShell.
- `npm run build --workspace @nes-emulator/web`: build the standalone Web app.
- `npm run build:frontend --workspace @nes-emulator/app`: build the App frontend into `packages/app/dist`.
- `npm run build --workspace @nes-emulator/app`: build the Tauri app shell, using `packages/app/dist`.

## ROM catalog

- Web reads `./catalog.json` from the same origin to avoid browser CORS failures on Gitee raw files.
- During local Web development, Gitee ROM downloads are rewritten through the Vite dev proxy at `/__nes_roms__/`.
- For static production hosting, set `NES_ROM_DOWNLOAD_BASE_URL` before building if ROM files are hosted on a CORS-enabled object store.
