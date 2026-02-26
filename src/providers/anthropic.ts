import type { ChatProvider, ProviderInfo, Message, ToolDeclaration, StreamResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _anthropicModule: any = null;

export const ANTHROPIC_INFO: ProviderInfo = {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
        { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    rateLimit: { rpm: 50, windowMs: 60_000 },
    keyPlaceholder: 'sk-ant-...',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    keyHelpLabel: 'Anthropic Console',
};

export class AnthropicProvider implements ChatProvider {
    readonly info = ANTHROPIC_INFO;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private client: any = null;
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || ANTHROPIC_INFO.defaultModel;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async getClient(): Promise<any> {
        if (!this.client) {
            if (!_anthropicModule) {
                _anthropicModule = await import('@anthropic-ai/sdk');
            }
            const Anthropic = _anthropicModule.default || _anthropicModule.Anthropic;
            this.client = new Anthropic({ apiKey: this.apiKey });
        }
        return this.client;
    }

    /**
     * Convert our canonical Gemini-style history to Anthropic's message format.
     * Note: Anthropic uses 'assistant' instead of 'model', and tool results
     * are sent as user messages with content_block type 'tool_result'.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private convertHistory(history: Message[]): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const messages: any[] = [];

        for (const msg of history) {
            if (msg.role === 'user') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const hasToolResponses = msg.parts.some((p: any) => p.functionResponse);
                if (hasToolResponses) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const content: any[] = [];
                    for (const part of msg.parts) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const p = part as any;
                        if (p.functionResponse) {
                            content.push({
                                type: 'tool_result',
                                tool_use_id: p.functionResponse.callId || p.functionResponse.name,
                                content: JSON.stringify(p.functionResponse.response),
                            });
                        } else if (p.text) {
                            content.push({ type: 'text', text: p.text });
                        }
                    }
                    messages.push({ role: 'user', content });
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const textParts = msg.parts.filter((p: any) => p.text).map((p: any) => p.text);
                    if (textParts.length > 0) {
                        messages.push({ role: 'user', content: textParts.join('\n') });
                    }
                }
            } else if (msg.role === 'model') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const content: any[] = [];
                for (const part of msg.parts) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const p = part as any;
                    if (p.text) {
                        content.push({ type: 'text', text: p.text });
                    }
                    if (p.functionCall) {
                        content.push({
                            type: 'tool_use',
                            id: p.functionCall.id || `tool_${p.functionCall.name}`,
                            name: p.functionCall.name,
                            input: p.functionCall.args || {},
                        });
                    }
                }
                if (content.length > 0) {
                    messages.push({ role: 'assistant', content });
                }
            }
        }

        return messages;
    }

    async streamChat(
        history: Message[],
        systemPrompt: string,
        tools: ToolDeclaration[],
        onTextChunk: (text: string) => void,
        signal?: AbortSignal,
    ): Promise<StreamResult> {
        const client = await this.getClient();
        const messages = this.convertHistory(history);

        const anthropicTools = tools.length > 0
            ? tools.map(t => ({
                name: t.name,
                description: t.description || '',
                input_schema: t.parameters,
            }))
            : undefined;

        // Use the streaming API
        const stream = client.messages.stream({
            model: this.model,
            max_tokens: 8192,
            system: systemPrompt,
            messages,
            tools: anthropicTools,
        });

        // Wire external cancel signal to the Anthropic stream
        if (signal) {
            const onAbort = () => stream.abort();
            if (signal.aborted) { stream.abort(); }
            else { signal.addEventListener('abort', onAbort, { once: true }); }
        }

        let text = '';
        stream.on('text', (delta: string) => {
            text += delta;
            onTextChunk(delta);
        });

        const finalMessage = await stream.finalMessage();

        // Extract tool calls from the final message
        const functionCalls: StreamResult['functionCalls'] = [];
        for (const block of finalMessage.content) {
            if (block.type === 'tool_use') {
                functionCalls.push({
                    name: block.name,
                    args: (block.input || {}) as Record<string, unknown>,
                    id: block.id,
                });
            }
        }

        return { text, functionCalls };
    }

    async generateOnce(prompt: string): Promise<string> {
        const client = await this.getClient();
        const response = await client.messages.create({
            model: this.model,
            max_tokens: 2048,
            messages: [{ role: 'user', content: prompt }],
        });
        const textBlocks = response.content.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (b: any) => b.type === 'text',
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return textBlocks.map((b: any) => b.text).join('') || '';
    }
}
