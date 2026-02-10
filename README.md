# Sefaria Desktop

A cross-platform desktop app for exploring the [Sefaria](https://www.sefaria.org/) library of Jewish texts, powered by AI (Google Gemini) and [Sefaria's MCP servers](https://developers.sefaria.org/docs/the-sefaria-mcp).

## Features

- **Chat interface** — Ask questions about Jewish texts in natural language
- **Text lookup** — Look up specific references (e.g., "Genesis 1:1", "Talmud Berakhot 2a")
- **Library search** — Search across the entire Sefaria library
- **API help** — Get guidance for building with the Sefaria API
- **Streaming responses** with live Markdown rendering
- **Tool calling** — The AI automatically calls Sefaria MCP tools to retrieve accurate text and citations
- **Free** — Uses Google Gemini's free API tier (no credit card required)

## MCP Servers

The app connects to two Sefaria MCP (Model Context Protocol) servers:

| Server | URL | Purpose |
|--------|-----|---------|
| Sefaria Texts MCP | `https://mcp.sefaria.org/sse` | Query the Sefaria library of Jewish texts |
| Sefaria Developers MCP | `https://developers.sefaria.org/mcp` | Query the Sefaria API for code/dev assistance |

## Getting Started

1. Get a free [Gemini API key](https://aistudio.google.com/apikey) from Google AI Studio
2. Install & run:

```bash
npm install
npm start
```

3. Enter your API key when prompted — it's stored locally and never shared.

## Building Distributable Packages

```bash
# Windows installer + portable
npm run dist:win

# macOS .dmg
npm run dist:mac

# Linux AppImage + .deb
npm run dist:linux
```

Output goes to the `release/` directory.

## Development

```bash
npm install

# Build once + launch
npm start

# Watch mode (auto-rebuild on changes)
npm run watch
# Then in another terminal:
npx electron .

# Debug in VS Code: press F5 (uses launch.json)
```

## Requirements

- Node.js 20+
- A Google Gemini API key (free from [Google AI Studio](https://aistudio.google.com/apikey))
