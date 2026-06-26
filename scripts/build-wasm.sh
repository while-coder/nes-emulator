#!/usr/bin/env bash
# 构建 Rust/WASM 适配层,输出到 Web 包可直接 import 的目录。
set -euo pipefail
cd "$(dirname "$0")/.."
wasm-pack build packages/wasm-core --target web --out-dir ../player/src/wasm --out-name nes_core
echo "WASM 已输出到 packages/player/src/wasm/"
