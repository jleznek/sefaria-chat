# Change Log

All notable changes to Sefaria Chat will be documented in this file.

## [0.9.0]

- **First-run setup wizard** — 3-step guided onboarding: Welcome, Choose Provider, Enter API Key
- **Embedded browser during wizard** — Links clicked during setup open in the side-by-side browser pane
- **Improved error reporting** — Chat engine init errors now show descriptive messages instead of generic failure
- **Thinking indicator fix** — "Thinking..." no longer stays visible when an error occurs
- **Auto-update error handling** — Download failures now display in the UI instead of silently failing
- **Artifact naming fix** — Fixed filename mismatch between GitHub release assets and update manifest
- **Dev-mode guard** — Auto-updater no longer runs during development
- **New provider: xAI (Grok)** — Grok 3, Grok 3 Fast, Grok 3 Mini, and Grok 3 Mini Fast
- **New provider: Mistral AI** — Mistral Small, Medium, and Large
- **New provider: DeepSeek** — DeepSeek-V3 and DeepSeek-R1
- **7 AI providers** — Google Gemini, OpenAI, Anthropic, xAI Grok, Mistral, DeepSeek, and Ollama (local)
- **Sefaria MCP integration** — Query the library of Jewish texts and Sefaria developer API via MCP
- **Streaming responses** — Real-time streamed AI responses with tool-call indicators
- **Citation auto-linking** — Sefaria text references are automatically hyperlinked
- **Mermaid diagrams** — Render diagrams from AI responses
- **Chat history** — Save, load, and manage multiple conversations
- **Settings page** — Manage providers, API keys, auto-scroll, and check for updates
- **Auto-updates** — Automatic update detection, download, and install via GitHub Releases
- **Embedded browser** — Side-by-side webview pane for Sefaria links
- **Print conversations** — Generate a printable PDF of your chat
- **Randomized prompts** — Pool of 24 suggested prompts, 6 shown at random
- **Ollama support** — Run local models with automatic model detection and timeout handling