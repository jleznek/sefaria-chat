# Building Sefaria Chat: An AI-Assisted Development Story

This document chronicles how Sefaria Chat was built through an iterative conversation between a developer and GitHub Copilot (Claude), from initial concept to published release — all in a single session.

---

## Phase 1: Foundation

The project started with an existing Electron app scaffold that had:
- A working chat interface with Google Gemini integration
- Connection to Sefaria's MCP (Model Context Protocol) servers for text lookup
- Basic streaming responses with Markdown rendering
- A single AI provider (Gemini)

The codebase was already functional as a development project (`npm start`), but had never been packaged for distribution.

## Phase 2: Multi-Provider Support

The app was extended to support multiple AI providers beyond Gemini:

- **OpenAI** (GPT-4o, GPT-4o mini, o3-mini) — full tool-calling support
- **Anthropic** (Claude Sonnet, Haiku) — full tool-calling support  
- **Ollama** (local models like Llama, Mistral, Qwen) — runs entirely offline with no API key

Each provider was implemented as a separate module under `src/providers/`, conforming to a common `ChatProvider` interface. The UI was updated with a provider/model picker that dynamically adjusts based on the selected provider (showing/hiding API key fields, updating help links, etc.).

## Phase 3: Packaging & Distribution

**Request**: *"Please make an installer with a standalone executable and all dependencies."*

The developer asked for a distributable installer. Using `electron-builder`, we configured:
- NSIS installer for Windows (one-click install)
- Portable executable (no installation needed)
- Proper app metadata (name, icon, description)

The initial build targeted ARM64 (matching the developer's machine). This was later expanded to include x64 builds as well, with distinct artifact names to avoid conflicts: `Sefaria Chat-Setup-1.1.0-x64.exe`, `Sefaria Chat-Setup-1.1.0-arm64.exe`, etc.

## Phase 4: Citation Auto-Linking

**Request**: *"For some reason the citations are not hyperlinked, at least when using Ollama."*

**The problem**: Cloud providers (Gemini, OpenAI, Anthropic) use tool-calling to fetch texts from Sefaria, and the system prompt instructs them to format citations as hyperlinks. But Ollama's local models don't support tool-calling, so they output bare text references like "Genesis 1:1" or "Rashi on Berakhot 2a" without links.

**The solution**: We added a `linkifyCitations()` function in the renderer that runs on all AI output before Markdown parsing. It uses regex patterns to detect:
- Talmud tractates (Berakhot, Shabbat, etc.)
- Tanakh books (Genesis, Exodus, Psalms, etc.)
- Classical commentators (Rashi, Ramban, Rambam, etc.)
- Other works (Shulchan Arukh, Mishneh Torah, Zohar, etc.)

The function carefully avoids double-linking text that's already inside a Markdown link or code block. Detected references are wrapped in Sefaria URLs following the standard format (spaces → underscores, chapter:verse → periods).

## Phase 5: Print Fix — The Freeze

**Request**: *"If I go to print the chat pane, and cancel the print, the app freezes for about thirty seconds."*

**The problem**: The print button called `window.print()`, which is synchronous in Electron's renderer process. When the user cancelled the OS print dialog, Electron blocked the entire UI thread for ~30 seconds before returning.

**Iteration 1**: Moved printing to the main process via IPC, using `webContents.print()`. This solved the freeze but showed a basic OS print dialog with no preview.

**Request**: *"The print dialog says 'this app doesn't support print preview.'"*

**Iteration 2**: Switched to `printToPDF()` + `shell.openPath()` to open the PDF in the system's default viewer (Edge). This gave full print preview, but...

**Request**: *"I don't like having to have another app (Edge) to view and print the PDF."*

**Iteration 3 (final)**: Generate a PDF via a hidden `BrowserWindow`, write it to a temp file, then display it in the app's own `<webview>` pane. Chromium's built-in PDF viewer provides a toolbar with print, download, and zoom — all within the app. No external application needed.

The renderer builds a complete standalone HTML document from the chat messages (with inline CSS for print-friendly styling) and sends it to the main process via IPC. The main process creates a hidden window, loads the HTML, calls `printToPDF()`, saves the result, and sends the file path back to the renderer to open in the webview pane.

## Phase 6: Taskbar Icon

**Request**: *"Still no icon on the taskbar."*

**The problem**: The app's window showed the correct icon in the title bar, but the Windows taskbar showed the generic Electron icon.

**Investigation**: The icon was a simple single-size ICO file. Windows needs multiple icon sizes embedded in the ICO for proper taskbar display (16px for small icons, 32px for taskbar, 48px for Alt+Tab, 256px for high-DPI).

**The fix**: 
1. Regenerated `assets/icon.ico` with 7 sizes (16, 24, 32, 48, 64, 128, 256px) using the `sharp` image library, manually constructing the ICO binary format
2. Updated `getAppIcon()` to try multiple paths (dev vs. packaged) and prefer ICO on Windows
3. Added `setOverlayIcon()` for dev mode — since Windows associates the taskbar icon with the executable (`electron.exe` in dev), an overlay badge provides visual identity during development

In packaged builds, electron-builder embeds the icon directly into the `.exe`, so the taskbar icon works natively.

## Phase 7: Code Signing

**Request**: *"Can I sign the files?"*

We created a self-signed code signing certificate using PowerShell:
```
New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Sefaria Chat, O=Sefaria"
```

Configured `electron-builder` to use it via the `win.signtoolOptions` config in `package.json`. 

**Challenge**: electron-builder's cached `signtool.exe` didn't include an ARM64 binary, causing the build to fail with `ENOENT`. Fix: copied the x64 `signtool.exe` to the ARM64 cache directory (ARM64 Windows runs x64 binaries via emulation).

All executables are now signed. The signature verifies the files haven't been tampered with, though Windows SmartScreen still shows a warning since it's not from a recognized Certificate Authority.

## Phase 8: Multi-Architecture Builds

**Request**: *"I would like to create an x64 version as well, and then package and publish them on GitHub."*

Updated the `package.json` build targets to produce both x64 and arm64 variants:
- `Sefaria Chat-Setup-1.1.0-x64.exe` / `-arm64.exe` (NSIS installers)
- `Sefaria Chat-Portable-1.1.0-x64.exe` / `-arm64.exe` (portable executables)

Custom `artifactName` patterns in the NSIS and portable configs ensure each architecture gets a distinct filename.

## Phase 9: GitHub Publishing

**Request**: *"Publish them on GitHub."*

The app was published to two GitHub accounts:
1. `jleznek-MSFT/sefaria-chat` (original)
2. `jleznek/sefaria-chat` (personal account for community sharing)

Using the GitHub CLI (`gh`), we:
- Created the repository
- Pushed all code
- Tagged the release as `v1.1.0`
- Created a GitHub Release with release notes and all 4 architecture-specific executables attached

## Phase 10: Final Polish

A few final touches:
- **Donate link**: Added a "Support Sefaria — Donate" link at the bottom of the app, styled in blue, linking to sefaria.org/ways-to-give
- **README update**: Rewrote the README to highlight all four AI providers with a comparison table, document the online/offline flexibility, and describe newer features (in-app viewer, print preview, citation auto-linking)

---

## Reflections

### What worked well
- **Iterative development**: Each feature was requested, implemented, tested, and refined in quick cycles. The developer could test immediately and provide feedback.
- **AI as a debugging partner**: Issues like the print freeze, missing taskbar icon, and signtool ENOENT were diagnosed and fixed through systematic investigation — checking logs, reading source code, and trying targeted fixes.
- **Full-stack capability**: The AI assistant handled everything from TypeScript/Electron code to CSS styling, ICO binary format construction, PowerShell certificate management, esbuild configuration, and GitHub CLI operations.

### What required iteration
- **Print preview** took 3 iterations to get right (sync → async → PDF → in-app PDF viewer), driven by the developer's UX preferences that only became clear through testing
- **Taskbar icon** required multiple approaches before landing on the multi-size ICO + overlay combination
- **Code signing** hit an unexpected platform gap (missing ARM64 signtool) that needed a creative workaround

### The development model
This entire app — from initial scaffold to published, signed, multi-architecture release with multiple AI providers — was built through conversation. The developer provided direction, tested results, and gave feedback. The AI wrote code, debugged issues, managed builds, and handled DevOps. Neither could have done it as efficiently alone.

---

*Built with [Sefaria](https://www.sefaria.org/), [Electron](https://www.electronjs.org/), and [GitHub Copilot](https://github.com/features/copilot).*
