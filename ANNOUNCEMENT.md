# Introducing Sefaria Chat — A Free Desktop App for Exploring Jewish Texts with AI

I'm excited to share **Sefaria Chat**, a free, open-source desktop application that lets you explore the [Sefaria](https://www.sefaria.org/) digital library of Jewish texts through natural conversation with AI.

## What is it?

Sefaria Chat is a standalone Windows app that connects AI language models directly to Sefaria's vast library of Torah, Talmud, Midrash, Halakha, and thousands of other Jewish texts. You ask questions in plain language, and the AI retrieves and cites actual sources from Sefaria — not hallucinated references, but real texts you can click to read in full.

## Key Features

- **Ask anything about Jewish texts** — "What does Rashi say about the first verse of Genesis?", "Compare the views on justice in Pirkei Avot", "Find sources about hospitality in the Talmud"
- **Real citations, not hallucinations** — The AI calls Sefaria's MCP (Model Context Protocol) servers to look up actual texts, so every citation links to the real source
- **Click any reference to read it** — Citations open right inside the app in a side pane, so you can read the full source text without leaving your conversation
- **Multiple AI providers** — Choose the model that works best for you:
  - **Google Gemini** (free tier available — no credit card needed)
  - **OpenAI** (GPT-4o, etc.)
  - **Anthropic** (Claude)
  - **Ollama** (completely local and offline — no API key, no internet needed for the AI)
- **Works offline** — With Ollama, you can run the AI entirely on your own machine. The app still connects to Sefaria for text lookups, but the AI itself needs no cloud connection
- **Print your conversations** — Generate a PDF preview of any conversation for study or sharing
- **Free and open source** — The app is MIT-licensed and the code is available on GitHub

## Download

**Windows installers and portable executables** are available on GitHub:

👉 **[Download Sefaria Chat v1.1.0](https://github.com/jleznek/sefaria-chat/releases/tag/v1.1.0)**

Available for both x64 (Intel/AMD) and ARM64 (Snapdragon) architectures, as both an installer and a portable exe.

## Getting Started

1. Download and run the installer (or portable exe)
2. Choose your AI provider — Gemini is the easiest free option
3. Enter your API key (get a free one from [Google AI Studio](https://aistudio.google.com/apikey) in 30 seconds)
4. Start asking questions!

If you prefer to run everything locally, install [Ollama](https://ollama.com/), pull a model (e.g., `ollama pull llama3`), and select Ollama as your provider — no API key needed.

## How It Works

Under the hood, Sefaria Chat uses the **Model Context Protocol (MCP)** to connect AI models to Sefaria's text servers. When you ask a question, the AI can call tools to search the library, look up specific references, find related texts, and more — then it weaves the results into a natural response with proper citations.

This is powered by [Sefaria's MCP servers](https://developers.sefaria.org/docs/the-sefaria-mcp), which provide structured access to the full Sefaria library.

## Built with AI

In the spirit of transparency: this app was itself built collaboratively with AI assistance (GitHub Copilot). The entire development process — from initial scaffolding to packaging, debugging, and publishing — was done through an iterative conversation between a developer and an AI coding assistant. A document describing that process is included in the repository for anyone curious about AI-assisted development.

## Links

- **GitHub**: [github.com/jleznek/sefaria-chat](https://github.com/jleznek/sefaria-chat)
- **Download**: [v1.1.0 Release](https://github.com/jleznek/sefaria-chat/releases/tag/v1.1.0)
- **Sefaria**: [sefaria.org](https://www.sefaria.org/)
- **Support Sefaria**: [sefaria.org/ways-to-give](https://www.sefaria.org/ways-to-give)

Feedback and contributions are welcome! Feel free to open issues or pull requests on GitHub.
