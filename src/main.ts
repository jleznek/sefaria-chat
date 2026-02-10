import { app, BrowserWindow, ipcMain, Menu, shell, screen, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { McpClientManager } from './mcp-client';
import { ChatEngine } from './chat-engine';
import { createProvider, AVAILABLE_PROVIDERS, detectOllamaModels } from './providers';
import type { ChatProvider } from './providers';

// Set app user model ID so Windows taskbar shows our icon, not the default Electron icon
app.setAppUserModelId('org.sefaria.desktop');

let mainWindow: BrowserWindow | null = null;
let mcpManager: McpClientManager | null = null;
let chatEngine: ChatEngine | null = null;
let currentChatId: string | null = null;

// ── Settings persistence ──────────────────────────────────────────────

interface AppSettings {
    provider?: string;    // 'gemini' | 'openai' | 'anthropic'
    model?: string;       // provider-specific model ID
    apiKeys?: Record<string, string>;  // keyed by provider id
    apiKey?: string;      // legacy single Gemini key (migrated on load)
}

interface ChatSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
}

interface SavedChat {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    messages: any[];   // UI-visible messages (user text + assistant text)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    history: any[];    // engine conversation history for resuming
}

function getSettingsPath(): string {
    return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings(): AppSettings {
    try {
        const data = fs.readFileSync(getSettingsPath(), 'utf8');
        const settings: AppSettings = JSON.parse(data);
        // Migrate legacy single apiKey → apiKeys.gemini
        if (settings.apiKey && !settings.apiKeys) {
            settings.apiKeys = { gemini: settings.apiKey };
            settings.provider = settings.provider || 'gemini';
            delete settings.apiKey;
            saveSettings(settings);
        }
        return settings;
    } catch {
        return {};
    }
}

function saveSettings(settings: AppSettings): void {
    const dir = path.dirname(getSettingsPath());
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

// ── Chat history persistence ──────────────────────────────────────────

function getChatsDir(): string {
    return path.join(app.getPath('userData'), 'chats');
}

function ensureChatsDir(): void {
    const dir = getChatsDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function generateChatId(): string {
    return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saveChatToFile(chat: SavedChat): void {
    ensureChatsDir();
    const filePath = path.join(getChatsDir(), `${chat.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(chat, null, 2));
}

function loadChatFromFile(chatId: string): SavedChat | null {
    try {
        const filePath = path.join(getChatsDir(), `${chatId}.json`);
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function deleteChatFile(chatId: string): void {
    try {
        const filePath = path.join(getChatsDir(), `${chatId}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {
        // ignore
    }
}

function listAllChats(): ChatSummary[] {
    ensureChatsDir();
    const dir = getChatsDir();
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const chats: ChatSummary[] = [];
    for (const file of files) {
        try {
            const data = fs.readFileSync(path.join(dir, file), 'utf8');
            const chat = JSON.parse(data) as SavedChat;
            chats.push({
                id: chat.id,
                title: chat.title,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
            });
        } catch {
            // skip corrupt files
        }
    }
    // Most recent first
    chats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return chats;
}

function saveCurrentChat(firstUserMessage?: string): void {
    if (!chatEngine) return;
    const history = chatEngine.getHistory();
    if (history.length === 0) return;

    if (!currentChatId) {
        currentChatId = generateChatId();
    }

    const existing = loadChatFromFile(currentChatId);
    const title = existing?.title || extractTitle(firstUserMessage || '', history);

    const chat: SavedChat = {
        id: currentChatId,
        title,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: extractUIMessages(history),
        history,
    };
    saveChatToFile(chat);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTitle(firstMsg: string, history: any[]): string {
    // Use the first user text message as the title
    for (const entry of history) {
        if (entry.role === 'user' && entry.parts) {
            for (const part of entry.parts) {
                if (part.text) {
                    const text = part.text.trim();
                    return text.length > 60 ? text.slice(0, 57) + '...' : text;
                }
            }
        }
    }
    return firstMsg.length > 60 ? firstMsg.slice(0, 57) + '...' : firstMsg || 'New Chat';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractUIMessages(history: any[]): any[] {
    // Pull out user text + model text for display
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [];
    for (const entry of history) {
        if (entry.role === 'user') {
            for (const part of entry.parts || []) {
                if (part.text) {
                    messages.push({ role: 'user', text: part.text });
                }
            }
        } else if (entry.role === 'model') {
            for (const part of entry.parts || []) {
                if (part.text) {
                    messages.push({ role: 'assistant', text: part.text });
                }
            }
        }
    }
    return messages;
}

// ── Window ────────────────────────────────────────────────────────────

function createWindow(): void {
    Menu.setApplicationMenu(null);

    mainWindow = new BrowserWindow({
        width: 960,
        height: 720,
        minWidth: 600,
        minHeight: 400,
        title: 'Sefaria Chat',
        icon: nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')),
        backgroundColor: '#f8f6f1',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
        },
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Route external links to the embedded webview pane in the renderer
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        mainWindow?.webContents.send('open-url', url);
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        // Allow loading our own renderer HTML; block everything else
        if (!url.startsWith('file://')) {
            event.preventDefault();
            mainWindow?.webContents.send('open-url', url);
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Resize window when webview pane opens/closes
    ipcMain.handle('resize-for-webview', (_event, open: boolean) => {
        if (!mainWindow) return;
        const bounds = mainWindow.getBounds();
        const display = screen.getDisplayMatching(bounds);
        const workArea = display.workArea;

        if (open) {
            // Widen: try to add 600px, but cap to screen
            const newWidth = Math.min(bounds.width + 600, workArea.width);
            // Keep left edge, or shift left if it would go off-screen
            let newX = bounds.x;
            if (newX + newWidth > workArea.x + workArea.width) {
                newX = Math.max(workArea.x, workArea.x + workArea.width - newWidth);
            }
            mainWindow.setBounds({ x: newX, y: bounds.y, width: newWidth, height: bounds.height }, true);
        } else {
            // Shrink back by 600px (but keep minWidth)
            const newWidth = Math.max(bounds.width - 600, 600);
            mainWindow.setBounds({ x: bounds.x, y: bounds.y, width: newWidth, height: bounds.height }, true);
        }
    });
}

// ── MCP Initialization ───────────────────────────────────────────────

async function initMcp(): Promise<void> {
    mcpManager = new McpClientManager();
    try {
        await mcpManager.connect();
        const status = mcpManager.getConnectionStatus();
        mainWindow?.webContents.send('mcp-status', {
            connected: status.connected.length > 0,
            toolCount: mcpManager.listAllTools().length,
            servers: status,
        });
    } catch (err) {
        mainWindow?.webContents.send('mcp-status', {
            connected: false,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

// ── IPC Handlers ─────────────────────────────────────────────────────

function setupIpcHandlers(): void {
    // ── Provider management ─────────────────────────────────────────

    function initChatEngine(providerId: string, apiKey: string, modelId?: string): boolean {
        if (!mcpManager) { return false; }
        const provider = createProvider(providerId, apiKey, modelId);
        if (!provider) { return false; }
        if (chatEngine) {
            chatEngine.updateProvider(provider);
        } else {
            chatEngine = new ChatEngine(provider, mcpManager);
        }
        return true;
    }

    ipcMain.handle('get-providers', () => {
        return AVAILABLE_PROVIDERS;
    });

    ipcMain.handle('get-provider-config', () => {
        const settings = loadSettings();
        const providerId = settings.provider || 'gemini';
        const providerInfo = AVAILABLE_PROVIDERS.find(p => p.id === providerId);
        const keyRequired = providerInfo?.requiresKey !== false;
        return {
            providerId,
            modelId: settings.model || '',
            hasKey: !keyRequired || !!(settings.apiKeys?.[providerId]),
        };
    });

    /** Return all providers annotated with which ones have a saved API key. */
    ipcMain.handle('get-configured-providers', () => {
        const settings = loadSettings();
        return AVAILABLE_PROVIDERS.map(p => ({
            ...p,
            // Keyless providers (Ollama) are always considered "configured"
            hasKey: p.requiresKey === false || !!(settings.apiKeys?.[p.id]),
        }));
    });

    /** Detect locally installed Ollama models. Returns { available, models } */
    ipcMain.handle('detect-ollama', async () => {
        const models = await detectOllamaModels();
        return {
            available: models !== null,
            models: models || [],
        };
    });

    /** Quick-switch provider/model without clearing conversation history. */
    ipcMain.handle('switch-provider', (_event, { providerId, modelId }: { providerId: string; modelId: string }) => {
        const settings = loadSettings();
        const providerInfo = AVAILABLE_PROVIDERS.find(p => p.id === providerId);
        const keyRequired = providerInfo?.requiresKey !== false;
        const key = settings.apiKeys?.[providerId] || '';
        if (keyRequired && !key) {
            return { error: 'No API key configured for this provider. Add one in Settings.' };
        }
        settings.provider = providerId;
        settings.model = modelId;
        saveSettings(settings);
        if (mcpManager) {
            initChatEngine(providerId, key, modelId);
        }
        return { success: true };
    });

    ipcMain.handle('save-provider-config', (_event, config: { providerId: string; modelId: string; apiKey?: string }) => {
        const settings = loadSettings();
        settings.provider = config.providerId;
        settings.model = config.modelId;
        if (config.apiKey) {
            if (!settings.apiKeys) { settings.apiKeys = {}; }
            settings.apiKeys[config.providerId] = config.apiKey;
        }
        saveSettings(settings);
        // Reinitialize chat engine with the new provider
        const providerInfo = AVAILABLE_PROVIDERS.find(p => p.id === config.providerId);
        const keyRequired = providerInfo?.requiresKey !== false;
        const key = settings.apiKeys?.[config.providerId] || '';
        if ((!keyRequired || key) && mcpManager) {
            initChatEngine(config.providerId, key, config.modelId);
            // Clear conversation when switching providers for clean state
            chatEngine?.clearHistory();
        }
        return true;
    });

    // Legacy handler kept for backwards compat
    ipcMain.handle('get-api-key', () => {
        const settings = loadSettings();
        const providerId = settings.provider || 'gemini';
        return settings.apiKeys?.[providerId] || '';
    });

    ipcMain.handle('set-api-key', (_event, apiKey: string) => {
        const settings = loadSettings();
        const providerId = settings.provider || 'gemini';
        if (!settings.apiKeys) { settings.apiKeys = {}; }
        settings.apiKeys[providerId] = apiKey;
        saveSettings(settings);
        if (mcpManager) {
            initChatEngine(providerId, apiKey, settings.model);
        }
        return true;
    });

    ipcMain.handle('get-mcp-status', () => {
        if (!mcpManager) { return { connected: false, toolCount: 0 }; }
        const tools = mcpManager.listAllTools();
        const status = mcpManager.getConnectionStatus();
        return {
            connected: status.connected.length > 0,
            toolCount: tools.length,
            servers: status,
        };
    });

    // Parse API errors from any provider into friendly user messages
    function parseApiError(err: unknown): { error: string; retryable?: boolean } {
        const raw = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number }).status;

        // Rate limit / quota exceeded
        if (status === 429 || raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED') || raw.includes('rate_limit') || raw.includes('quota')) {
            // Distinguish daily quota vs per-minute rate limit
            if (raw.includes('PerDay') || raw.includes('per_day')) {
                return {
                    error: 'You\u2019ve used up your daily free-tier quota for this model. Try switching to a different model using the picker below, or wait until tomorrow for the quota to reset.',
                    retryable: false,
                };
            }
            // Check for a retry delay in the error
            const retryMatch = raw.match(/retry\s*(?:in|Delay['":\s]*)(\d+(?:\.\d+)?)\s*s/i);
            const retrySeconds = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : null;
            const waitMsg = retrySeconds
                ? `Please wait about ${retrySeconds} seconds and try again.`
                : 'Please wait a minute and try again.';
            return {
                error: `You\u2019ve hit the API rate limit. ${waitMsg} You can also switch to a different model.`,
                retryable: true,
            };
        }

        // Billing / insufficient credits (Anthropic returns 400 for this)
        if (raw.includes('credit balance') || raw.includes('billing') || raw.includes('purchase credits') || raw.includes('insufficient_quota') || raw.includes('billing_hard_limit')) {
            return {
                error: 'Your account doesn\u2019t have enough credit for this provider. Please add credits or upgrade your plan on the provider\u2019s billing page, or switch to a different provider.',
                retryable: false,
            };
        }

        // Invalid API key
        if (status === 401 || status === 403 || raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('invalid_api_key') || raw.includes('authentication_error')) {
            return {
                error: 'Your API key appears to be invalid. Please check your key in Settings.',
                retryable: false,
            };
        }

        // Network / connection errors
        if (raw.includes('ENOTFOUND') || raw.includes('ECONNREFUSED') || raw.includes('fetch failed') || raw.includes('network')) {
            // Special message for Ollama connection failures
            if (raw.includes('localhost') || raw.includes('127.0.0.1') || raw.includes('11434')) {
                return {
                    error: 'Could not connect to Ollama. Make sure Ollama is running (open the Ollama app or run "ollama serve" in a terminal).',
                    retryable: true,
                };
            }
            return {
                error: 'Could not connect to the API. Please check your internet connection.',
                retryable: true,
            };
        }

        // Generic fallback
        return {
            error: `Something went wrong: ${raw.length > 200 ? raw.substring(0, 200) + '\u2026' : raw}`,
            retryable: true,
        };
    }

    ipcMain.handle(
        'send-message',
        async (
            _event,
            { message, responseLength }: { message: string; responseLength?: string },
        ) => {
            console.log('[send-message] received:', message?.substring(0, 50));

            // Ensure chat engine is ready
            if (!chatEngine) {
                const settings = loadSettings();
                const providerId = settings.provider || 'gemini';
                const providerMeta = AVAILABLE_PROVIDERS.find(p => p.id === providerId);
                const keyRequired = providerMeta?.requiresKey !== false;
                const apiKey = settings.apiKeys?.[providerId] || '';
                if (keyRequired && !apiKey) {
                    return { error: 'Please set your API key first in Settings.' };
                }
                if (!mcpManager) {
                    return {
                        error: 'MCP servers not connected. Please restart the app.',
                    };
                }
                initChatEngine(providerId, apiKey, settings.model);
            }

            if (!chatEngine) {
                return { error: 'Failed to initialize chat engine. Please check Settings.' };
            }

            try {
                await chatEngine.sendMessage(
                    message,
                    responseLength || 'concise',
                    (chunk: string) => {
                        mainWindow?.webContents.send('chat-stream', { chunk });
                    },
                    (toolName: string, status: string) => {
                        mainWindow?.webContents.send('tool-status', {
                            toolName,
                            status,
                        });
                    },
                );

                console.log('[send-message] complete');

                // Generate follow-ups AFTER main response, and only if
                // we have plenty of rate-limit headroom.
                let followUps: string[] = [];
                if (chatEngine.hasCapacityForFollowUps()) {
                    followUps = await chatEngine.generateFollowUps().catch((e) => {
                        console.error('[send-message] follow-up generation failed:', e);
                        return [] as string[];
                    });
                } else {
                    console.log('[send-message] skipping follow-ups (near rate limit)');
                }
                console.log('[send-message] follow-ups:', followUps);

                // Send usage stats with stream end
                const usage = chatEngine.getUsageStats();
                mainWindow?.webContents.send('chat-stream-end', { followUps });
                mainWindow?.webContents.send('usage-update', usage);

                // Persist the conversation
                saveCurrentChat(message);

                return { success: true, chatId: currentChatId };
            } catch (err: unknown) {
                console.error('[send-message] error:', err);
                const errorInfo = parseApiError(err);
                // Don't send chat-stream-end here — the error return
                // will be handled by the renderer's error path.
                return errorInfo;
            }
        },
    );

    ipcMain.handle('clear-chat', () => {
        chatEngine?.clearHistory();
        currentChatId = null;
        return true;
    });

    ipcMain.handle('get-usage-stats', () => {
        if (chatEngine) {
            return chatEngine.getUsageStats();
        }
        // Fallback: use the selected provider's rate limit
        const settings = loadSettings();
        const providerId = settings.provider || 'gemini';
        const providerInfo = AVAILABLE_PROVIDERS.find(p => p.id === providerId);
        return { used: 0, limit: providerInfo?.rateLimit.rpm || 20, resetsInSeconds: 0 };
    });

    // ── Chat history handlers ────────────────────────────────────────

    ipcMain.handle('list-chats', () => {
        return listAllChats();
    });

    ipcMain.handle('load-chat', (_event, chatId: string) => {
        const chat = loadChatFromFile(chatId);
        if (!chat) return null;

        // Restore engine history
        currentChatId = chatId;
        if (chatEngine) {
            chatEngine.restoreHistory(chat.history);
        }
        return chat;
    });

    ipcMain.handle('delete-chat', (_event, chatId: string) => {
        deleteChatFile(chatId);
        if (currentChatId === chatId) {
            currentChatId = null;
            chatEngine?.clearHistory();
        }
        return true;
    });

    ipcMain.handle('new-chat', () => {
        chatEngine?.clearHistory();
        currentChatId = null;
        return true;
    });

    ipcMain.handle('reconnect-mcp', async () => {
        if (mcpManager) {
            await mcpManager.disconnect();
        }
        await initMcp();
        return true;
    });
}

// ── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(async () => {
    createWindow();
    setupIpcHandlers();
    await initMcp();
});

app.on('window-all-closed', async () => {
    if (mcpManager) {
        await mcpManager.disconnect();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
