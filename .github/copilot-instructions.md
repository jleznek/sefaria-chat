# Sefaria Desktop – Electron App

## Project Overview
This is a standalone Electron desktop application for exploring the Sefaria digital library of Jewish texts. It connects to Sefaria's MCP (Model Context Protocol) servers and uses Google Gemini for AI-powered chat with tool calling.

## Architecture
- **Runtime**: Electron (Chromium + Node.js)
- **LLM**: Google Gemini 2.5 Flash (user provides free API key from Google AI Studio)
- **MCP Servers** (connected from main process via `@modelcontextprotocol/sdk`):
  - **Sefaria Texts MCP** (`https://mcp.sefaria.org/sse`) – Query the library of Jewish texts
  - **Sefaria Developers MCP** (`https://developers.sefaria.org/mcp`) – API/code assistance
- **Bundler**: esbuild (main + preload bundles)
- **Packaging**: electron-builder → Windows (NSIS/portable), macOS (DMG), Linux (AppImage/deb)

## Key Files
- `src/main.ts` – Electron main process: window creation, IPC handlers, settings persistence
- `src/preload.ts` – Context bridge exposing `window.sefaria` API to the renderer
- `src/chat-engine.ts` – Gemini streaming + tool-calling loop
- `src/mcp-client.ts` – Manages SSE connections to both Sefaria MCP servers
- `src/prompts.ts` – System and command prompts
- `src/renderer/` – Browser-side UI (HTML, CSS, vanilla JS)
- `esbuild.js` – Build script for main + preload bundles
- `package.json` – Scripts, deps, electron-builder config

## Development
- `npm install` – Install dependencies
- `npm start` – Build and launch the app
- `npm run watch` – Watch mode for development
- `npm run dist:win` / `dist:mac` / `dist:linux` – Package distributable
- Press F5 in VS Code to debug the main process
