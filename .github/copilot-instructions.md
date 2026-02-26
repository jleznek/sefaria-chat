# Sefaria Desktop – Electron App

## Project Overview
A standalone Electron desktop application for exploring the Sefaria digital library of Jewish texts via AI-powered chat. The app uses MCP (Model Context Protocol) to query Sefaria's servers and supports 7 LLM providers.

## Build & Development

```bash
npm install           # Install dependencies
npm start             # Type-check + build + launch (full pipeline)
npm run watch         # Watch mode: esbuild + tsc in parallel (then run `npx electron .` separately)
npm run check-types   # TypeScript type-check only (no emit)
npm run lint          # ESLint
npm run compile       # Type-check + esbuild bundle + copy renderer files to dist/
npm run dist          # Package Windows appx for Microsoft Store
```

There are no automated tests. `dist:mac` and `dist:linux` are disabled (echo stubs only). The app is distributed exclusively through the Microsoft Store. Press F5 in VS Code to debug the main process.

## Architecture

**Three-process Electron design:**
- `src/main.ts` – Main process: window management, IPC handlers, settings/chat persistence (`userData/settings.json`)
- `src/preload.ts` – Context bridge only; exposes `window.sefaria` API (~30 methods) to the renderer via `contextBridge.exposeInMainWorld`. The renderer has no direct Node.js access.
- `src/renderer/` – Vanilla HTML/CSS/JS. All communication goes through `window.sefaria` IPC calls, never direct Node APIs.

**Chat pipeline:**
1. `ChatEngine` (`chat-engine.ts`) receives a user message and available MCP tools
2. Calls `provider.streamChat()` in a loop (up to 10 rounds)
3. If the LLM returns function calls, executes them via `McpClientManager.callTool()` and feeds results back
4. Rate limiting is enforced before every API call using a sliding-window RPM tracker

**MCP connections** (`mcp-client.ts`):
- Connects on startup to both Sefaria servers in parallel
- Transport fallback: tries Streamable HTTP first, falls back to SSE
- Tools are indexed by name → server for routing

## Provider System (`src/providers/`)

Conversation history uses **Gemini-style parts format** as the canonical representation. Every provider converts from this format internally:
```ts
{ role: 'user' | 'model', parts: [{ text }, { functionCall }, { functionResponse }] }
```
Function responses are always `role: 'user'` (Gemini convention).

**To add a new provider:**
1. Create `src/providers/<name>.ts` — implement `ChatProvider` from `types.ts`; export `<NAME>_INFO: ProviderInfo` and `<Name>Provider` class
2. Add to `providers/index.ts`: export the class + info, add `<NAME>_INFO` to `AVAILABLE_PROVIDERS`, add a `case` in `createProvider()`

Each `ProviderInfo.models` entry can have an optional `rpm` field to override the provider-level rate limit for that model (used by free-tier Gemini models).

## Key Conventions

- **ESM-only packages** (e.g. `@google/genai`) must use dynamic `import()` at runtime — esbuild can't statically bundle them. See `gemini.ts` for the pattern.
- **`// eslint-disable-next-line @typescript-eslint/no-explicit-any`** is the approved suppression style when typing dynamic LLM SDK responses is impractical. Avoid blanket `@ts-ignore`.
- **Renderer files are copied, not bundled** — `src/renderer/*.{html,css,js}` are copied as-is to `dist/renderer/` by the `copy-renderer` script. esbuild only processes `main.ts` and `preload.ts`.
- The `dist/` directory is the compiled output and is excluded from packaging map files (`!dist/**/*.map`).
