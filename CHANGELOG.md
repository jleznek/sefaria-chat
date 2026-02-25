# Change Log

All notable changes to Sefaria Chat will be documented in this file.

## [1.1.0]

- **Edit API keys** — Configured providers now show a pencil (✎) button to change API keys without removing and reconfiguring
- **API key validation** — Keys are validated against the provider's API before saving; invalid keys are rejected with a clear error message
- **Better Grok error handling** — xAI billing/credits errors (HTTP 403) now show the correct "add credits" message instead of "invalid key"
- **Ollama model detection** — App validates Ollama models exist locally at startup and in the model picker; missing models no longer cause 404 errors
- **Ollama status display** — Settings panel shows Ollama's actual status: "Ready", "No models" (with pull instructions), or "Not running"
- **Improved 404 error messages** — Ollama model-not-found errors now tell you exactly which model is missing and how to pull it

## [1.0.0]

- **Microsoft Store release** — Sefaria Chat is now available in the Microsoft Store
- **Store-aware updates** — Update check UI is automatically hidden for Store installs (updates come through the Store)
- **Changelog fix** — Changelog and version info now display correctly in all distribution types
- **Ollama 404 fix** — Missing Ollama models now show a helpful "pull" command instead of a generic error

## [0.9.3]

- **Streamlined provider settings** — Merged "Active Providers" and "Add a Provider" into a single unified section with inline configuration
- **Right-click context menu** — Paste, copy, cut, undo, redo, and select all now available via right-click in all text fields

## [0.9.2]

- **DeepSeek balance display** — Account balance (¥) now appears in the rate limit bar for DeepSeek, refreshing after each response and periodically
- **Standalone citation linking** — Major Jewish works (Guide for the Perplexed, Mishneh Torah, Shulchan Arukh, etc.) auto-link to Sefaria even without a chapter:verse reference
- **Better billing error handling** — DeepSeek HTTP 402 "Insufficient Balance" errors are now detected and surfaced with a clear message
- **UI refinement** — "RPM" replaced with "req/min" throughout the rate limit bar and model picker for clarity
- **System prompt enhancement** — AI now hyperlinks major works by name to their Sefaria table of contents page

## [0.9.1]

- **Store certification compliance** — Removed clickable download link for Ollama; replaced with plain-text dependency notice per Microsoft Store policy
- **NPU-gated Ollama option** — Ollama provider is now hidden on devices without a Neural Processing Unit (NPU)
- **Updated Ollama messaging** — All Ollama references now inform users of the dependency requirement without offering install/download links

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