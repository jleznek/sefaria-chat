import type { ChatProvider, ProviderInfo, Message, ToolDeclaration, StreamResult } from './types';

// Reuse the OpenAI SDK — Ollama exposes an OpenAI-compatible API at localhost:11434/v1
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _openaiModule: any = null;

/** How long to wait for the first token from Ollama (model may need loading). */
const FIRST_TOKEN_TIMEOUT_MS = 180_000; // 3 minutes
/** How long to wait between tokens before assuming the model stalled. */
const IDLE_TIMEOUT_MS = 60_000; // 60 seconds

export const OLLAMA_INFO: ProviderInfo = {
    id: 'ollama',
    name: 'Ollama (Local)',
    models: [
        // Popular defaults — the app also auto-detects installed models
        { id: 'llama3.2', name: 'Llama 3.2' },
        { id: 'mistral', name: 'Mistral' },
        { id: 'phi3', name: 'Phi-3' },
        { id: 'gemma2', name: 'Gemma 2' },
        { id: 'qwen2.5', name: 'Qwen 2.5' },
    ],
    defaultModel: 'llama3.2',
    rateLimit: { rpm: 9999, windowMs: 60_000 }, // effectively unlimited locally
    requiresKey: false,
    keyPlaceholder: '',
    keyHelpUrl: 'https://ollama.com/download',
    keyHelpLabel: 'Download Ollama',
};

/**
 * Detect which models are installed in the local Ollama instance.
 * Returns an array of { id, name } or null if Ollama is not reachable.
 */
export async function detectOllamaModels(): Promise<{ id: string; name: string }[] | null> {
    try {
        const resp = await fetch('http://localhost:11434/api/tags', {
            signal: AbortSignal.timeout(3000),
        });
        if (!resp.ok) { return null; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any = await resp.json();
        if (!data.models || !Array.isArray(data.models)) { return null; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return data.models.map((m: any) => {
            const id: string = m.name || m.model || '';
            // Clean up display name: "llama3.2:latest" → "Llama 3.2"
            const baseName = id.replace(/:latest$/, '');
            return { id: baseName, name: baseName };
        });
    } catch {
        return null;
    }
}

export class OllamaProvider implements ChatProvider {
    readonly info = OLLAMA_INFO;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private client: any = null;
    private model: string;

    constructor(_apiKey: string, model?: string) {
        this.model = model || OLLAMA_INFO.defaultModel;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async getClient(): Promise<any> {
        if (!this.client) {
            if (!_openaiModule) {
                _openaiModule = await import('openai');
            }
            const OpenAI = _openaiModule.default || _openaiModule.OpenAI;
            this.client = new OpenAI({
                baseURL: 'http://localhost:11434/v1',
                apiKey: 'ollama', // Ollama doesn't need a real key
            });
        }
        return this.client;
    }

    /**
     * Convert canonical Gemini-style history to OpenAI message format.
     * (Same logic as the OpenAI provider.)
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private convertHistory(history: Message[], systemPrompt: string): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages: any[] = [{ role: 'system', content: systemPrompt }];

        for (const msg of history) {
            if (msg.role === 'user') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const hasToolResponses = msg.parts.some((p: any) => p.functionResponse);
                if (hasToolResponses) {
                    for (const part of msg.parts) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const p = part as any;
                        if (p.functionResponse) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: p.functionResponse.callId || p.functionResponse.name,
                                content: JSON.stringify(p.functionResponse.response),
                            });
                        } else if (p.text) {
                            messages.push({ role: 'user', content: p.text });
                        }
                    }
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const textParts = msg.parts.filter((p: any) => p.text).map((p: any) => p.text);
                    if (textParts.length > 0) {
                        messages.push({ role: 'user', content: textParts.join('\n') });
                    }
                }
            } else if (msg.role === 'model') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const textParts = msg.parts.filter((p: any) => p.text).map((p: any) => p.text);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const toolCalls = msg.parts.filter((p: any) => p.functionCall).map((p: any) => ({
                    id: p.functionCall.id || `call_${p.functionCall.name}`,
                    type: 'function',
                    function: {
                        name: p.functionCall.name,
                        arguments: JSON.stringify(p.functionCall.args || {}),
                    },
                }));

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const assistantMsg: any = {
                    role: 'assistant',
                    content: textParts.join('\n') || null,
                };
                if (toolCalls.length > 0) {
                    assistantMsg.tool_calls = toolCalls;
                }
                messages.push(assistantMsg);
            }
        }

        return messages;
    }

    async streamChat(
        history: Message[],
        systemPrompt: string,
        _tools: ToolDeclaration[],
        onTextChunk: (text: string) => void,
    ): Promise<StreamResult> {
        const client = await this.getClient();
        const messages = this.convertHistory(history, systemPrompt);

        // Don't pass tools to Ollama — most local models don't support
        // the OpenAI tool-calling format reliably and will hang or error.
        // The system prompt already has Sefaria context, so the model can
        // answer from its training knowledge.

        const abortController = new AbortController();

        const stream = await client.chat.completions.create(
            {
                model: this.model,
                messages,
                stream: true,
            },
            { signal: abortController.signal },
        );

        let text = '';
        let receivedFirstToken = false;

        // Timer that aborts if we don't receive data in time.
        // Starts with a generous timeout for model loading, then tightens.
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        const resetIdleTimer = () => {
            if (idleTimer) { clearTimeout(idleTimer); }
            const timeout = receivedFirstToken ? IDLE_TIMEOUT_MS : FIRST_TOKEN_TIMEOUT_MS;
            idleTimer = setTimeout(() => {
                abortController.abort();
            }, timeout);
        };

        // Start initial "first token" timer
        resetIdleTimer();

        try {
            for await (const chunk of stream) {
                const delta = chunk.choices?.[0]?.delta;
                if (!delta) { continue; }

                if (delta.content) {
                    if (!receivedFirstToken) { receivedFirstToken = true; }
                    text += delta.content;
                    onTextChunk(delta.content);
                    resetIdleTimer();
                }
            }
        } catch (err: unknown) {
            // If we aborted due to timeout, provide a helpful message
            if (abortController.signal.aborted) {
                const phase = receivedFirstToken ? 'responding' : 'loading';
                throw new Error(
                    receivedFirstToken
                        ? `Ollama stopped ${phase} (no data for ${IDLE_TIMEOUT_MS / 1000}s). The model may have run out of memory. Try a smaller model or restart Ollama.`
                        : `Ollama timed out while ${phase} the model (waited ${FIRST_TOKEN_TIMEOUT_MS / 1000}s). Make sure Ollama is running and the model "${this.model}" is available. Try running "ollama pull ${this.model}" first.`,
                );
            }
            throw err;
        } finally {
            if (idleTimer) { clearTimeout(idleTimer); }
        }

        // Ollama models don't use tool calls — always return empty
        return { text, functionCalls: [] };
    }

    async generateOnce(prompt: string): Promise<string> {
        const client = await this.getClient();
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), FIRST_TOKEN_TIMEOUT_MS);
        try {
            const response = await client.chat.completions.create(
                {
                    model: this.model,
                    messages: [{ role: 'user', content: prompt }],
                },
                { signal: abortController.signal },
            );
            return response.choices?.[0]?.message?.content || '';
        } catch (err: unknown) {
            if (abortController.signal.aborted) {
                throw new Error(`Ollama timed out generating a response (waited ${FIRST_TOKEN_TIMEOUT_MS / 1000}s). Make sure Ollama is running and the model is loaded.`);
            }
            throw err;
        } finally {
            clearTimeout(timeout);
        }
    }
}
