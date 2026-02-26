import { contextBridge, ipcRenderer } from 'electron';

export interface ProviderModel {
    id: string;
    name: string;
}

export interface ProviderInfo {
    id: string;
    name: string;
    models: ProviderModel[];
    defaultModel: string;
    rateLimit: { rpm: number; windowMs: number };
    requiresKey?: boolean;
    keyPlaceholder: string;
    keyHelpUrl: string;
    keyHelpLabel: string;
}

export interface SefariaApi {
    // Provider management
    getProviders(): Promise<ProviderInfo[]>;
    getProviderConfig(): Promise<{ providerId: string; modelId: string; hasKey: boolean }>;
    saveProviderConfig(config: { providerId: string; modelId: string; apiKey?: string }): Promise<boolean>;
    getConfiguredProviders(): Promise<(ProviderInfo & { hasKey: boolean })[]>;
    switchProvider(providerId: string, modelId: string): Promise<{ success?: boolean; error?: string }>;
    removeProviderKey(providerId: string): Promise<{ success?: boolean; switchedTo?: string; modelId?: string }>;
    validateApiKey(providerId: string, apiKey: string): Promise<{ valid: boolean; error?: string; warning?: string }>;
    detectOllama(): Promise<{ available: boolean; models: Array<{ id: string; name: string }> }>;
    hasNpu(): Promise<boolean>;

    // Legacy key helpers (still used internally)
    getApiKey(): Promise<string>;
    setApiKey(key: string): Promise<boolean>;

    getMcpStatus(): Promise<{
        connected: boolean;
        toolCount: number;
        servers?: { connected: string[]; failed: { name: string; error: string }[] };
    }>;
    sendMessage(
        message: string,
        responseLength?: string,
    ): Promise<{ success?: boolean; error?: string; retryable?: boolean; chatId?: string; cancelled?: boolean }>;
    cancelMessage(): Promise<{ success?: boolean }>;
    clearChat(): Promise<boolean>;
    reconnectMcp(): Promise<boolean>;

    // Chat history
    listChats(): Promise<Array<{ id: string; title: string; createdAt: string; updatedAt: string }>>;
    loadChat(chatId: string): Promise<{ id: string; title: string; messages: Array<{ role: string; text: string }>; history: unknown[] } | null>;
    deleteChat(chatId: string): Promise<boolean>;
    newChat(): Promise<boolean>;

    onChatStream(callback: (data: { chunk: string }) => void): void;
    onChatStreamEnd(callback: (data: { followUps?: string[] }) => void): void;
    onFollowUps(callback: (data: { followUps: string[] }) => void): void;
    onToolStatus(
        callback: (data: { toolName: string; status: string }) => void,
    ): void;
    onMcpStatus(
        callback: (data: {
            connected: boolean;
            toolCount?: number;
            error?: string;
        }) => void,
    ): void;
    onOpenUrl(callback: (url: string) => void): void;
    onUsageUpdate(callback: (data: { used: number; limit: number; resetsInSeconds: number }) => void): void;
    getUsageStats(): Promise<{ used: number; limit: number; resetsInSeconds: number }>;
    getBalance(): Promise<{ balance: number; currency: string } | null>;
    resizeForWebview(open: boolean): Promise<void>;
    printChat(html: string): Promise<void>;

    getAppVersion(): Promise<string>;
    getChangelog(): Promise<string>;
}

contextBridge.exposeInMainWorld('sefaria', {
    // Provider management
    getProviders: () => ipcRenderer.invoke('get-providers'),
    getProviderConfig: () => ipcRenderer.invoke('get-provider-config'),
    saveProviderConfig: (config: { providerId: string; modelId: string; apiKey?: string }) =>
        ipcRenderer.invoke('save-provider-config', config),
    getConfiguredProviders: () => ipcRenderer.invoke('get-configured-providers'),
    switchProvider: (providerId: string, modelId: string) =>
        ipcRenderer.invoke('switch-provider', { providerId, modelId }),
    removeProviderKey: (providerId: string) =>
        ipcRenderer.invoke('remove-provider-key', providerId),
    validateApiKey: (providerId: string, apiKey: string) =>
        ipcRenderer.invoke('validate-api-key', { providerId, apiKey }),
    detectOllama: () => ipcRenderer.invoke('detect-ollama'),
    hasNpu: () => ipcRenderer.invoke('has-npu'),

    // Legacy key helpers
    getApiKey: () => ipcRenderer.invoke('get-api-key'),
    setApiKey: (key: string) => ipcRenderer.invoke('set-api-key', key),

    getMcpStatus: () => ipcRenderer.invoke('get-mcp-status'),
    sendMessage: (message: string, responseLength?: string) =>
        ipcRenderer.invoke('send-message', { message, responseLength }),
    cancelMessage: () => ipcRenderer.invoke('cancel-message'),
    clearChat: () => ipcRenderer.invoke('clear-chat'),
    reconnectMcp: () => ipcRenderer.invoke('reconnect-mcp'),

    // Chat history
    listChats: () => ipcRenderer.invoke('list-chats'),
    loadChat: (chatId: string) => ipcRenderer.invoke('load-chat', chatId),
    deleteChat: (chatId: string) => ipcRenderer.invoke('delete-chat', chatId),
    newChat: () => ipcRenderer.invoke('new-chat'),

    // Event listeners (main → renderer)
    onChatStream: (callback: (data: { chunk: string }) => void) => {
        ipcRenderer.on('chat-stream', (_event, data) => callback(data));
    },
    onChatStreamEnd: (callback: (data: { followUps?: string[] }) => void) => {
        ipcRenderer.on('chat-stream-end', (_event, data) => callback(data || {}));
    },
    onFollowUps: (callback: (data: { followUps: string[] }) => void) => {
        ipcRenderer.on('chat-follow-ups', (_event, data) => callback(data));
    },
    onToolStatus: (
        callback: (data: { toolName: string; status: string }) => void,
    ) => {
        ipcRenderer.on('tool-status', (_event, data) => callback(data));
    },
    onMcpStatus: (
        callback: (data: {
            connected: boolean;
            toolCount?: number;
            error?: string;
        }) => void,
    ) => {
        ipcRenderer.on('mcp-status', (_event, data) => callback(data));
    },
    onOpenUrl: (callback: (url: string) => void) => {
        ipcRenderer.on('open-url', (_event, url) => callback(url));
    },
    onUsageUpdate: (callback: (data: { used: number; limit: number; resetsInSeconds: number }) => void) => {
        ipcRenderer.on('usage-update', (_event, data) => callback(data));
    },
    getUsageStats: () => ipcRenderer.invoke('get-usage-stats'),
    getBalance: () => ipcRenderer.invoke('get-balance'),
    resizeForWebview: (open: boolean) => ipcRenderer.invoke('resize-for-webview', open),
    printChat: (html: string) => ipcRenderer.invoke('print-chat', { html }),

    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getChangelog: () => ipcRenderer.invoke('get-changelog'),
} satisfies SefariaApi);
