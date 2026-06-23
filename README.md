# Mim TTS

Tiny macOS menu-bar dictation app.

Mim records your voice, transcribes locally with Whisper, stores recent history, and pastes the text into the active app. Models are downloaded on demand and kept under Application Support.

## Requirements

- macOS 11+
- Node.js + npm
- Rust
- CMake
- Microphone permission
- Accessibility permission for auto-paste and Fn/Globe hotkey capture

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
