import { app, BrowserWindow, ipcMain, Menu, shell, screen, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { autoUpdater } from 'electron-updater';
import { McpClientManager } from './mcp-client';
import { ChatEngine } from './chat-engine';
import { createProvider, AVAILABLE_PROVIDERS, detectOllamaModels } from './providers';
import type { ChatProvider } from './providers';

// Set app user model ID so Windows taskbar shows our icon, not the default Electron icon
app.setAppUserModelId('org.sefaria.desktop');

// Suppress EPIPE errors from broken stdout/stderr pipes (e.g. when
// electron-updater writes to console after the parent process closes).
process.stdout?.on?.('error', () => {});
process.stderr?.on?.('error', () => {});

let mainWindow: BrowserWindow | null = null;
let mcpManager: McpClientManager | null = null;
let chatEngine: ChatEngine | null = null;
let currentChatId: string | null = null;

// ── NPU detection (cached) ────────────────────────────────────────────

let _npuDetected: boolean | null = null;

/** Check whether this device has a Neural Processing Unit (NPU). */
function hasNpu(): boolean {
    if (_npuDetected !== null) return _npuDetected;
    if (process.platform !== 'win32') {
        _npuDetected = false;
        return false;
    }
    try {
        const out = execSync(
            'powershell -NoProfile -Command "Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -match \'NPU|Neural Processing\' } | Select-Object -First 1 -ExpandProperty FriendlyName"',
            { timeout: 5000, encoding: 'utf8', windowsHide: true },
        );
        _npuDetected = out.trim().length > 0;
    } catch {
        _npuDetected = false;
    }
    return _npuDetected;
}

/** Return the provider list, hiding Ollama when no NPU is present. */
function getVisibleProviders() {
    if (hasNpu()) return AVAILABLE_PROVIDERS;
    return AVAILABLE_PROVIDERS.filter(p => p.id !== 'ollama');
}

// ── Settings persistence ──────────────────────────────────────────────

interface AppSettings {
    provider?: string;    // 'gemini' | 'openai' | 'anthropic'
    model?: string;       // provider-specific model ID
    apiKeys?: Record<string, string>;  // keyed by provider id
    apiKey?: string;      // legacy single Gemini key (migrated on load)
    windowBounds?: { x: number; y: number; width: number; height: number };
    windowMaximized?: boolean;
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
    if (!isValidChatId(chatId)) return null;
    try {
        const filePath = path.join(getChatsDir(), `${chatId}.json`);
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function deleteChatFile(chatId: string): void {
    if (!isValidChatId(chatId)) return;
    try {
        const filePath = path.join(getChatsDir(), `${chatId}.json`);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {
        // ignore
    }
}

/** Validate chat ID to prevent path traversal. */
function isValidChatId(chatId: string): boolean {
    return /^chat_\d+_[a-z0-9]+$/.test(chatId);
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

function getAppIcon(): Electron.NativeImage {
    // Try multiple paths and formats
    const assetDirs = [
        path.join(__dirname, '..', 'assets'),
        path.join(app.getAppPath(), 'assets'),
    ];
    const files = process.platform === 'win32'
        ? ['icon.ico', 'icon.png']
        : ['icon.png'];

    for (const dir of assetDirs) {
        for (const file of files) {
            const p = path.join(dir, file);
            try {
                if (!fs.existsSync(p)) continue;
                const img = nativeImage.createFromPath(p);
                if (!img.isEmpty()) {
                    console.log('[icon] loaded from:', p, 'size:', img.getSize());
                    return img;
                }
            } catch { /* try next */ }
        }
    }
    console.warn('[icon] could not load icon from any path');
    return nativeImage.createEmpty();
}

function createWindow(): void {
    Menu.setApplicationMenu(null);

    const appIcon = getAppIcon();

    // Restore saved window bounds, falling back to defaults
    const settings = loadSettings();
    const saved = settings.windowBounds;
    const defaultBounds = { width: 960, height: 720 };
    // Validate saved bounds are on a visible display
    let bounds = defaultBounds;
    if (saved) {
        const displays = screen.getAllDisplays();
        const visible = displays.some(d =>
            saved.x < d.bounds.x + d.bounds.width &&
            saved.x + saved.width > d.bounds.x &&
            saved.y < d.bounds.y + d.bounds.height &&
            saved.y + saved.height > d.bounds.y,
        );
        if (visible) { bounds = saved; }
    }

    mainWindow = new BrowserWindow({
        ...bounds,
        minWidth: 600,
        minHeight: 400,
        title: `Sefaria Chat v${app.getVersion()}`,
        icon: appIcon,
        backgroundColor: '#f8f6f1',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: true,
        },
    });

    if (settings.windowMaximized) {
        mainWindow.maximize();
    }

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

    // Right-click context menu for text inputs (paste, copy, cut, etc.)
    mainWindow.webContents.on('context-menu', (_event, params) => {
        const menu = Menu.buildFromTemplate([
            { role: 'undo', enabled: params.editFlags.canUndo },
            { role: 'redo', enabled: params.editFlags.canRedo },
            { type: 'separator' },
            { role: 'cut', enabled: params.editFlags.canCut },
            { role: 'copy', enabled: params.editFlags.canCopy },
            { role: 'paste', enabled: params.editFlags.canPaste },
            { role: 'selectAll', enabled: params.editFlags.canSelectAll },
        ]);
        menu.popup();
    });

    // Persist window bounds on move/resize
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const persistBounds = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const s = loadSettings();
            s.windowMaximized = mainWindow.isMaximized();
            if (!mainWindow.isMaximized()) {
                s.windowBounds = mainWindow.getBounds();
            }
            saveSettings(s);
        }, 500);
    };
    mainWindow.on('resize', persistBounds);
    mainWindow.on('move', persistBounds);

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

    function initChatEngine(providerId: string, apiKey: string, modelId?: string): string | true {
        if (!mcpManager) {
            console.error('[initChatEngine] mcpManager is null');
            return 'MCP servers not connected. Please restart the app.';
        }
        const provider = createProvider(providerId, apiKey, modelId);
        if (!provider) {
            console.error(`[initChatEngine] createProvider returned null for "${providerId}"`);
            return `Unknown provider "${providerId}". Please check Settings.`;
        }
        if (chatEngine) {
            chatEngine.updateProvider(provider, modelId);
        } else {
            chatEngine = new ChatEngine(provider, mcpManager, modelId);
        }
        console.log(`[initChatEngine] success: provider=${providerId}, model=${modelId || 'default'}`);
        return true;
    }

    ipcMain.handle('get-providers', () => {
        return getVisibleProviders();
    });

    ipcMain.handle('has-npu', () => hasNpu());

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
        return getVisibleProviders().map(p => ({
            ...p,
            // Keyless providers (Ollama) are always considered "configured"
            hasKey: p.requiresKey === false || !!(settings.apiKeys?.[p.id]),
        }));
    });

    /** Validate an API key by making a lightweight request to the provider. */
    ipcMain.handle('validate-api-key', async (_event, { providerId, apiKey }: { providerId: string; apiKey: string }) => {
        try {
            const validationEndpoints: Record<string, { url: string; init: RequestInit }> = {
                gemini: {
                    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1`,
                    init: { method: 'GET', signal: AbortSignal.timeout(10_000) },
                },
                openai: {
                    url: 'https://api.openai.com/v1/models?limit=1',
                    init: { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) },
                },
                anthropic: {
                    url: 'https://api.anthropic.com/v1/models?limit=1',
                    init: { method: 'GET', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(10_000) },
                },
                grok: {
                    url: 'https://api.x.ai/v1/models',
                    init: { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) },
                },
                mistral: {
                    url: 'https://api.mistral.ai/v1/models',
                    init: { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) },
                },
                deepseek: {
                    url: 'https://api.deepseek.com/models',
                    init: { method: 'GET', headers: { 'Authorization': `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) },
                },
            };
            const endpoint = validationEndpoints[providerId];
            if (!endpoint) {
                return { valid: true }; // No validation available for this provider
            }
            const resp = await fetch(endpoint.url, endpoint.init);
            if (resp.ok) {
                return { valid: true };
            }
            const body = await resp.text().catch(() => '');
            const bodyLower = body.toLowerCase();
            // Check for invalid key indicators across different status codes
            // (Gemini/xAI return 400, OpenAI/Anthropic/Mistral return 401, some return 403)
            const isAuthError = resp.status === 401 || resp.status === 403
                || (resp.status === 400 && (bodyLower.includes('invalid') || bodyLower.includes('api key') || bodyLower.includes('incorrect') || bodyLower.includes('authentication')));
            if (isAuthError) {
                // Distinguish billing issues from truly invalid keys
                if (bodyLower.includes('credits') || bodyLower.includes('billing') || bodyLower.includes('purchase') || bodyLower.includes('balance') || bodyLower.includes('licenses')) {
                    return { valid: true, warning: 'Key accepted, but your account may need credits. Check your provider\'s billing page.' };
                }
                return { valid: false, error: 'Invalid API key. Please double-check and try again.' };
            }
            if (resp.status === 429) {
                return { valid: true }; // Rate limited means the key is valid
            }
            return { valid: true, warning: `Unexpected status ${resp.status}. The key may still work.` };
        } catch {
            return { valid: true, warning: 'Could not reach the provider to validate. The key has been saved.' };
        }
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
    ipcMain.handle('switch-provider', async (_event, { providerId, modelId }: { providerId: string; modelId: string }) => {
        const settings = loadSettings();
        const providerInfo = AVAILABLE_PROVIDERS.find(p => p.id === providerId);
        const keyRequired = providerInfo?.requiresKey !== false;
        const key = settings.apiKeys?.[providerId] || '';
        if (keyRequired && !key) {
            return { error: 'No API key configured for this provider. Add one in Settings.' };
        }
        // For Ollama, verify the model exists locally before switching
        if (providerId === 'ollama') {
            const detected = await detectOllamaModels();
            if (detected !== null && detected.length === 0) {
                return { error: 'Ollama is running but has no models installed. Pull a model first — for example, run "ollama pull llama3.2" in a terminal.' };
            }
            if (detected && detected.length > 0 && !detected.some(m => m.id === modelId)) {
                return { error: `Model "${modelId}" is not installed in Ollama. Run "ollama pull ${modelId}" to download it, or choose an installed model.` };
            }
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

    /** Remove a provider's saved API key. */
    ipcMain.handle('remove-provider-key', (_event, providerId: string) => {
        const settings = loadSettings();
        if (settings.apiKeys?.[providerId]) {
            delete settings.apiKeys[providerId];
            saveSettings(settings);
        }
        // If the removed provider was the active one, switch to the first available
        if (settings.provider === providerId) {
            const fallback = AVAILABLE_PROVIDERS.find(p =>
                p.id !== providerId && (p.requiresKey === false || !!(settings.apiKeys?.[p.id]))
            );
            if (fallback) {
                settings.provider = fallback.id;
                settings.model = fallback.defaultModel;
                saveSettings(settings);
                const key = settings.apiKeys?.[fallback.id] || '';
                if (mcpManager) {
                    initChatEngine(fallback.id, key, fallback.defaultModel);
                    chatEngine?.clearHistory();
                }
                return { switchedTo: fallback.id, modelId: fallback.defaultModel };
            }
        }
        return { success: true };
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
        // Be precise: only match genuine rate-limit or quota errors, not generic resource issues
        const isRateLimit = status === 429
            || raw.includes('rate_limit')
            || raw.includes('Too Many Requests')
            || (raw.includes('RESOURCE_EXHAUSTED') && (raw.includes('rate') || raw.includes('quota') || raw.includes('RPM') || raw.includes('QPM') || raw.includes('requests per') || raw.includes('PerMinute') || raw.includes('PerDay')))
            || raw.includes('insufficient_quota');

        if (isRateLimit) {
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

        // Generic resource exhaustion (e.g. output token limit, content too long)
        if (raw.includes('RESOURCE_EXHAUSTED')) {
            return {
                error: 'The response was too large for this model\u2019s limits. Try a shorter question or switch to a different model.',
                retryable: true,
            };
        }

        // Billing / insufficient credits (Anthropic returns 400, DeepSeek returns 402, xAI returns 403 with credits message)
        if (status === 402 || raw.includes('Insufficient Balance') || raw.includes('credit balance') || raw.includes('billing') || raw.includes('purchase credits') || raw.includes('insufficient_quota') || raw.includes('billing_hard_limit') || raw.includes('credits or licenses')) {
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

        // Ollama model not found (404)
        if (status === 404 && (raw.includes('localhost') || raw.includes('127.0.0.1') || raw.includes('11434') || raw.includes('ollama'))) {
            const modelMatch = raw.match(/model\s+['"]?([\w.:-]+)['"]?/i);
            const modelName = modelMatch?.[1] || 'the selected model';
            return {
                error: `Ollama model "${modelName}" was not found. Pull it first by running: ollama pull ${modelName}`,
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
                const initResult = initChatEngine(providerId, apiKey, settings.model);
                if (initResult !== true) {
                    return { error: initResult };
                }
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

    ipcMain.handle('get-balance', async () => {
        if (chatEngine) {
            return chatEngine.getBalance();
        }
        return null;
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

    ipcMain.handle('print-chat', async (_event, { html }: { html: string }) => {
        if (!mainWindow) return;
        // Generate a PDF from the chat content, save to temp, and open
        // it in the app's embedded webview pane for preview + printing.
        const printWin = new BrowserWindow({
            show: false,
            width: 800,
            height: 600,
            webPreferences: { contextIsolation: true, nodeIntegration: false },
        });

        try {
            await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
            const pdfData = await printWin.webContents.printToPDF({
                printBackground: true,
                margins: { marginType: 'default' },
            });
            printWin.close();

            const tmpPath = path.join(app.getPath('temp'), `sefaria-chat-${Date.now()}.pdf`);
            fs.writeFileSync(tmpPath, pdfData);

            // Open the PDF in the app's embedded webview pane
            const fileUrl = `file://${tmpPath.replace(/\\/g, '/')}`;
            mainWindow.webContents.send('open-url', fileUrl);
        } catch (err) {
            console.error('[print] failed:', err);
            printWin.close();
        }
    });
}

// ── Auto-updater ─────────────────────────────────────────────────────

function setupAutoUpdater(): void {
    // Windows Store apps update through the Store itself
    if (process.windowsStore) {
        console.log('[updater] running as Store app, skipping auto-updater');
        return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // Skip Windows Authenticode chain validation for self-signed certs.
    // Integrity is still protected by SHA-512 hash verification in latest.yml.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (autoUpdater as any).verifyUpdateCodeSignature = () => Promise.resolve(null);

    autoUpdater.on('checking-for-update', () => {
        console.log('[updater] checking for update…');
    });

    autoUpdater.on('update-available', (info) => {
        console.log('[updater] update available:', info.version);
        mainWindow?.webContents.send('update-status', {
            status: 'downloading',
            version: info.version,
        });
    });

    autoUpdater.on('update-not-available', () => {
        console.log('[updater] app is up to date');
    });

    autoUpdater.on('download-progress', (progress) => {
        mainWindow?.webContents.send('update-status', {
            status: 'downloading',
            percent: Math.round(progress.percent),
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('[updater] update downloaded:', info.version);
        mainWindow?.webContents.send('update-status', {
            status: 'ready',
            version: info.version,
        });
    });

    autoUpdater.on('error', (err) => {
        console.error('[updater] error:', err.message);
        mainWindow?.webContents.send('update-status', {
            status: 'error',
            error: err.message,
        });
    });

    ipcMain.handle('install-update', () => {
        // Force quit all windows and restart with the new version.
        // autoInstallOnAppQuit must be false so quitAndInstall actually installs now.
        autoUpdater.autoInstallOnAppQuit = false;
        setImmediate(() => {
            autoUpdater.quitAndInstall(false, true);
        });
    });

    ipcMain.handle('check-for-updates', async () => {
        if (!app.isPackaged) {
            console.log('[updater] skipping update check in dev mode');
            return { version: null };
        }
        try {
            const result = await autoUpdater.checkForUpdates();
            const latestVersion = result?.updateInfo?.version || null;
            const currentVersion = app.getVersion();
            // Only report an update if the server version is different from the running version.
            if (latestVersion && latestVersion !== currentVersion) {
                mainWindow?.webContents.send('update-status', {
                    status: 'downloading',
                    version: latestVersion,
                });
                return { version: latestVersion };
            }
            return { version: null };
        } catch {
            return { version: null };
        }
    });

}

// ── Version, changelog & store detection (always registered) ─────────

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-changelog', () => {
    try {
        const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
        return fs.readFileSync(changelogPath, 'utf-8');
    } catch {
        return '';
    }
});

ipcMain.handle('is-store-app', () => !!process.windowsStore);

// ── App lifecycle ────────────────────────────────────────────────────

app.whenReady().then(async () => {
    createWindow();
    setupIpcHandlers();
    setupAutoUpdater();
    await initMcp();

    // Eagerly initialize chat engine with saved settings so the first message
    // doesn't have to wait. Failure here is non-fatal; lazy init will retry.
    if (mcpManager) {
        const settings = loadSettings();
        const providerId = settings.provider || 'gemini';
        const providerMeta = AVAILABLE_PROVIDERS.find(p => p.id === providerId);
        const keyRequired = providerMeta?.requiresKey !== false;
        const apiKey = settings.apiKeys?.[providerId] || '';

        // For Ollama, validate that the saved model actually exists locally.
        // If not, auto-switch to the first available model.
        if (providerId === 'ollama') {
            const detected = await detectOllamaModels();
            if (detected && detected.length > 0) {
                const modelExists = detected.some(m => m.id === settings.model);
                if (!modelExists) {
                    settings.model = detected[0].id;
                    saveSettings(settings);
                    console.log(`[startup] Ollama model not found locally, switched to "${settings.model}"`);
                }
            } else {
                console.log('[startup] Ollama has no models installed, skipping chat engine init');
            }
        }

        if (!keyRequired || apiKey) {
            const result = createProvider(providerId, apiKey, settings.model);
            if (result) {
                chatEngine = new ChatEngine(result, mcpManager, settings.model);
                console.log(`[startup] chat engine ready: provider=${providerId}, model=${settings.model || 'default'}`);
            } else {
                console.warn(`[startup] could not create provider "${providerId}"`);
            }
        } else {
            console.log(`[startup] no API key for "${providerId}", skipping chat engine init`);
        }
    }

    // Only auto-check for updates in packaged (production) builds
    if (app.isPackaged) {
        setTimeout(() => {
            autoUpdater.checkForUpdates().catch(() => { /* ignore */ });
        }, 5000);
    } else {
        console.log('[updater] skipping auto-update check in dev mode');
    }
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
