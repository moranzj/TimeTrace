<div align="center">

<img src="assets/timetrace.png" width="96" alt="TimeTrace icon">

# 时迹 TimeTrace

[![CI](https://github.com/moranzj/TimeTrace/actions/workflows/ci.yml/badge.svg)](https://github.com/moranzj/TimeTrace/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/moranzj/TimeTrace?label=release)](https://github.com/moranzj/TimeTrace/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A local-first personal activity tracker** — see where your time actually goes.

Records the foreground app + screenshot every 10s · 10-minute summaries · daily/weekly reports · optional AI insights · local web dashboard

[Features](#features) · [Install](#install) · [Usage](#usage) · [Privacy](#privacy) · [中文文档](README.md)

</div>

---

> 📌 **Owner: [@moranzj](https://github.com/moranzj) only** — a few unrelated projects share the "TimeTrace" name (CLI tools, mobile apps, ...). This repo is the **desktop (Windows / macOS / Linux) local-first activity tracker & screen-time journal**; when searching, make sure the owner is **moranzj**.

## Features

- 🔍 **Automatic tracking** — foreground app, window title, idle time, optional screenshots (deduplicated) every 10 seconds
- 🧠 **10-minute summaries** — active/idle time, app switches, longest focus, optional AI commentary
- 📄 **Daily & weekly Markdown reports**, regenerated live and finalized at day roll-over
- 📊 **Local dashboard** (bound to `127.0.0.1` only)
  - Today: active time, **vs-yesterday delta**, app ranking, hourly chart, 10-minute timeline, screenshot wall
  - Now: current window + idle state + how long you've been on it
  - Week: daily table, weekly ranking, **🔥 12-week activity heatmap**, AI weekly review
  - **💬 Ask**: natural-language questions about your tracked time
- 🤖 **Optional AI** — any OpenAI-compatible endpoint (Ollama / LM Studio / OpenAI / OpenRouter / ...). Everything except AI text summaries works fully offline.
- 🧹 **Auto retention** — screenshots pruned by age and total size; raw logs pruned by age
- 🔒 **Everything local** — screenshots and logs never leave your machine; when AI is enabled only **text statistics** are sent to your own endpoint

## Platform support

| Platform | Status | Notes |
|---|---|---|
| Windows 10/11 | ✅ tested | native capture.exe built with the bundled .NET csc.exe — no runtime to install |
| macOS 12+ | 🧪 usable | uses built-in `screencapture` / `osascript` / `ioreg`; needs Accessibility + Screen Recording permission |
| Linux (X11) | 🧪 usable | needs `xdotool`, a screenshot tool (`scrot`/`import`/...), `xprintidle` |
| Linux (Wayland) | ⚠️ partial | screenshots via `grim`/`gnome-screenshot`; window titles are restricted by the compositor |

Only prerequisite: **Node.js ≥ 18** (no npm dependencies).

## Install

Download the archive for your platform from [Releases](../../releases), or `git clone` this repo.

### Windows

1. Unzip and double-click **`install.cmd`**
2. That's it: compiles the capture helper, registers autostart, creates desktop shortcuts (TimeTrace / Stop), starts tracking and opens the dashboard

### macOS

```bash
tar -xzf timetrace-*-macos.tar.gz && cd timetrace-*
./install.sh
```

- Grant **Accessibility** (window titles) and **Screen Recording** (screenshots) to your terminal/Node in System Settings → Privacy & Security
- Creates `~/Applications/TimeTrace.app` and a login LaunchAgent

### Linux

```bash
tar -xzf timetrace-*-linux.tar.gz && cd timetrace-*
./install.sh
```

Install helper tools (as suggested by `timetrace doctor`):

```bash
sudo apt install xdotool xprintidle scrot imagemagick   # Debian/Ubuntu
sudo dnf install xdotool xprintidle scrot ImageMagick   # Fedora
sudo pacman -S xdotool xprintidle scrot imagemagick     # Arch
sudo apt install grim                                   # Wayland
```

## Usage

```bash
timetrace install          # autostart + desktop integration + start
timetrace web              # open dashboard (starts daemon if needed)
timetrace status           # status & today's overview
timetrace stop / start     # pause / resume tracking
timetrace doctor           # environment check
timetrace summary-now      # preview the current 10-minute summary
timetrace test-ai          # test the AI pipeline
timetrace rebuild-day  2026-10-16
timetrace rebuild-week 2026-W42
timetrace uninstall [--purge]
```

Without a global command you can always run `node bin/timetrace.mjs <command>`, or `npm install -g .` to get `timetrace` on your PATH.

## Privacy

- All data lives in the project folder: `data/logs/raw/` (JSONL ticks), `shots/` (screenshots), `data/summaries/`, `data/reports/`
- Retention is configurable: `retention.screenshotDays` + `retention.maxScreenshotGB` + `retention.rawLogDays`
- AI (optional) receives **text statistics only** — never screenshots
- Dashboard binds to `127.0.0.1` only

### Config layering

- `config.json` — the default template (committed)
- `config.local.json` — your machine-local overrides (git-ignored)

## AI setup (optional)

Any OpenAI-compatible endpoint works. Example with local Ollama (`config.local.json`):

```json
{
  "llm": {
    "enabled": true,
    "baseURL": "http://127.0.0.1:11434/v1",
    "model": "qwen2.5:7b",
    "minuteSummary": true,
    "daySummary": true,
    "weekSummary": true
  }
}
```

`fallbackModels` are tried in order when the primary model fails.

## Development

```bash
npm test        # syntax check + unit tests (node:test, zero dependencies)
npm run doctor
```

## License

[MIT](LICENSE)
