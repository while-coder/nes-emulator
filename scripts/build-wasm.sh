#!/usr/bin/env bash
# 构建 Rust 核心为 WASM,输出到前端可直接 import 的目录。
set -euo pipefail
cd "$(dirname "$0")/.."
wasm-pack build core --target web --out-dir ../web/src/wasm --out-name nes_core
echo "WASM 已输出到 web/src/wasm/"
