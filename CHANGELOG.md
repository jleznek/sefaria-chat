# Change Log

All notable changes to Sefaria Chat will be documented in this file.

## [1.3.2]

- **Changelog fix**: Fixed blank changelog in Settings About by including CHANGELOG.md in packaged app
- **Update progress bar**: Added a visual progress bar in Settings when downloading an update
- **Up-to-date styling**: "You're up to date" message now displays in bold green

## [1.3.1]

- **About section**: Added About page in Settings with changelog, GitHub link, donate link, and copyright
- **Version in title bar**: Window title now shows the app version
- **Copyright update**: Updated copyright year to 2026

## [1.3.0]

- **Ollama timeout handling**: Added first-token timeout (3 min) and idle timeout (60s) to prevent infinite "Thinking..." state when a model is loading or stalls
- **Randomized suggested prompts**: Pool of 24 diverse prompts; 6 are randomly picked each time (initial load, clear, new chat)
- **About section**: Added About page in Settings with changelog, GitHub link, donate link, and copyright
- **Version in title bar**: Window title now shows the app version
- **Copyright update**: Updated copyright year to 2026

## [1.2.5]

- **Update check fix**: Fixed update check when already on the latest version
- **UI cleanup**: Removed overlay icon, updated placeholder text
- **CI fix**: Fixed CI workflow for builds

## [1.2.4]

- **Settings redesign**: Merged "AI Provider & Model" and "API Key" into a single "Add a Provider" section
- **Click to set default**: Click any configured provider in the Active Providers list to make it the default
- **Remove provider**: Added ability to remove a provider's saved API key from the Active Providers list
- **Attribution & disclaimer**: Added notices throughout the app (setup screen, settings, footer, system prompt) clarifying this app is not developed by or affiliated with Sefaria.org
- **Copyright**: Added © Jason Leznek to setup screen, settings, footer, and README

## [1.2.3]

- **Linux build fix**: Added author email for maintainer field in deb packages

## [1.2.2]

- **Auto-update fix**: Fixed install using setImmediate and forceRunAfter

## [1.2.1]

- **Settings redesign**: Added check-for-updates button and activated providers display

## [1.2.0]

- **Auto-update support**: Added electron-updater for automatic updates from GitHub Releases
- Updates download in background and show a banner when ready to install

## [1.1.1]

- **Rate limit fix**: Fixed false rate-limit errors — RESOURCE_EXHAUSTED no longer falsely reported when it's an output token limit
- **Mermaid diagrams**: Added Mermaid.js for rendering diagrams from LLM responses

## [1.1.0]

- **Print preview**: Generate a PDF preview of your conversation from within the app
- **Citation auto-linking**: Sefaria text references are automatically hyperlinked for all providers
- **Icon improvements**: Regenerated icon.ico with 7 sizes (16–256px) for proper taskbar display
- **Code signing**: Configured x64 + arm64 builds with code signing
- **Installer**: Separate NSIS installer and portable artifact names per architecture

## [1.0.0]

- Initial release