# Mim TTS

Tiny macOS menu-bar dictation app.

Mim records your voice, transcribes locally with Whisper, stores recent history, and pastes the text into the active app. Models are downloaded on demand and kept under Application Support.

## Requirements

- macOS 11+
- Node.js + npm
- Rust
- CMake
- Microphone permission
- Keyboard permissions for auto-paste and the macOS Option hotkey. Use the in-app Keyboard access row first so macOS registers Mim TTS before opening Privacy & Security manually.
- First launch uses a required setup checklist: download the default Base model, grant microphone access, and enable keyboard access before the main app appears.
- Default hotkey is Option on macOS and F8 on Windows/Linux.

## Dev

```sh
npm install
npm run dev
```

Use `npm run dev`, not `npm tauri dev`.

## Build

```sh
npm run build -- --no-bundle
```

Runtime data lives in:

```text
~/Library/Application Support/mim-tts/
```
