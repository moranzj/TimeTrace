#!/usr/bin/env bash
# 时迹 TimeTrace · macOS / Linux 一键安装（在项目目录内运行）
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 需要 Node.js ≥ 18：https://nodejs.org/ （macOS 可用 brew install node；Debian/Ubuntu 可用 apt install nodejs npm）"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✗ Node.js 版本过低（v$NODE_MAJOR），需要 ≥ 18"
  exit 1
fi

node bin/timetrace.mjs install "$@"
