import type { ChatProvider, ProviderInfo, Message, ToolDeclaration, StreamResult } from './types';

let _openaiModule: any = null;

export const MISTRAL_INFO: ProviderInfo = {
    id: 'mistral',
    name: 'Mistral AI',
    models: [
        { id: 'mistral-small-latest', name: 'Mistral Small' },
        { id: 'mistral-medium-latest', name: 'Mistral Medium' },
        { id: 'mistral-large-latest', name: 'Mistral Large' },
    ],
    defaultModel: 'mistral-small-latest',
    rateLimit: { rpm: 60, windowMs: 60_000 },
    keyPlaceholder: '',
    keyHelpUrl: 'https://console.mistral.ai/api-keys',
    keyHelpLabel: 'Mistral Console',
};

export class MistralProvider implements ChatProvider {
    readonly info = MISTRAL_INFO;
    private client: any = null;
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || MISTRAL_INFO.defaultModel;
    }

    private async getClient(): Promise<any> {
        if (!this.client) {
            if (!_openaiModule) {
                _openaiModule = await import('openai');
            }
            const OpenAI = _openaiModule.default || _openaiModule.OpenAI;
            this.client = new OpenAI({
                apiKey: this.apiKey,
                baseURL: 'https://api.mistral.ai/v1',
            });
        }
        return this.client;
    }

    private convertHistory(history: Message[], systemPrompt: string): any[] {
        const messages: any[] = [{ role: 'system', content: systemPrompt }];

        for (const msg of history) {
            if (msg.role === 'user') {
                const hasToolResponses = msg.parts.some((p: any) => p.functionResponse);
                if (hasToolResponses) {
                    for (const part of msg.parts) {
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
                    const textParts = msg.parts.filter((p: any) => p.text).map((p: any) => p.text);
                    if (textParts.length > 0) {
                        messages.push({ role: 'user', content: textParts.join('\n') });
                    }
                }
            } else if (msg.role === 'model') {
                const textParts = msg.parts.filter((p: any) => p.text).map((p: any) => p.text);
                const toolCalls = msg.parts.filter((p: any) => p.functionCall).map((p: any) => ({
                    id: p.functionCall.id || `call_${p.functionCall.name}`,
                    type: 'function',
                    function: {
                        name: p.functionCall.name,
                        arguments: JSON.stringify(p.functionCall.args || {}),
                    },
                }));

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
        tools: ToolDeclaration[],
        onTextChunk: (text: string) => void,
    ): Promise<StreamResult> {
        const client = await this.getClient();
        const messages = this.convertHistory(history, systemPrompt);

        const openaiTools = tools.length > 0
            ? tools.map(t => ({
                type: 'function' as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            }))
            : undefined;

        const stream = await client.chat.completions.create({
            model: this.model,
            messages,
            tools: openaiTools,
            stream: true,
        });

        let text = '';
        const toolCallsMap: Map<number, { id: string; name: string; args: string }> = new Map();

        for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) { continue; }

            if (delta.content) {
                text += delta.content;
                onTextChunk(delta.content);
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallsMap.has(idx)) {
                        toolCallsMap.set(idx, { id: tc.id || '', name: '', args: '' });
                    }
                    const entry = toolCallsMap.get(idx)!;
                    if (tc.id) { entry.id = tc.id; }
                    if (tc.function?.name) { entry.name += tc.function.name; }
                    if (tc.function?.arguments) { entry.args += tc.function.arguments; }
                }
            }
        }

        const functionCalls = Array.from(toolCallsMap.values()).map(tc => ({
            name: tc.name,
            args: JSON.parse(tc.args || '{}') as Record<string, unknown>,
            id: tc.id,
        }));

        return { text, functionCalls };
    }

    async generateOnce(prompt: string): Promise<string> {
        const client = await this.getClient();
        const response = await client.chat.completions.create({
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
        });
        return response.choices?.[0]?.message?.content || '';
    }
}
