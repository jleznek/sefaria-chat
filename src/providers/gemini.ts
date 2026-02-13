import type { ChatProvider, ProviderInfo, Message, ToolDeclaration, StreamResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _genaiModule: any = null;

// @google/genai is ESM-only; we dynamically import it at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getGenAIModule(): Promise<any> {
    if (!_genaiModule) {
        _genaiModule = await import('@google/genai');
    }
    return _genaiModule;
}

export const GEMINI_INFO: ProviderInfo = {
    id: 'gemini',
    name: 'Google Gemini',
    models: [
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', rpm: 5 },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', rpm: 30 },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', rpm: 5 },
        { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', rpm: 10 },
    ],
    defaultModel: 'gemini-2.5-flash',
    rateLimit: { rpm: 5, windowMs: 60_000 },
    keyPlaceholder: 'AIza...',
    keyHelpUrl: 'https://aistudio.google.com/apikey',
    keyHelpLabel: 'Google AI Studio',
};

export class GeminiProvider implements ChatProvider {
    readonly info = GEMINI_INFO;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private ai: any = null;
    private apiKey: string;
    private model: string;

    constructor(apiKey: string, model?: string) {
        this.apiKey = apiKey;
        this.model = model || GEMINI_INFO.defaultModel;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private async getAI(): Promise<any> {
        if (!this.ai) {
            const mod = await getGenAIModule();
            this.ai = new mod.GoogleGenAI({ apiKey: this.apiKey });
        }
        return this.ai;
    }

    async streamChat(
        history: Message[],
        systemPrompt: string,
        tools: ToolDeclaration[],
        onTextChunk: (text: string) => void,
    ): Promise<StreamResult> {
        const ai = await this.getAI();

        const functionDeclarations = tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
        }));

        const response = await ai.models.generateContentStream({
            model: this.model,
            contents: history,
            config: {
                systemInstruction: systemPrompt,
                tools: functionDeclarations.length > 0
                    ? [{ functionDeclarations }]
                    : undefined,
            },
        });

        let text = '';
        const functionCalls: StreamResult['functionCalls'] = [];

        for await (const chunk of response) {
            const parts = chunk.candidates?.[0]?.content?.parts;
            if (parts && Array.isArray(parts)) {
                for (const part of parts) {
                    if (part.text) {
                        text += part.text;
                        onTextChunk(part.text);
                    }
                    if (part.functionCall && part.functionCall.name) {
                        functionCalls.push({
                            name: part.functionCall.name,
                            args: (part.functionCall.args || {}) as Record<string, unknown>,
                        });
                    }
                }
            } else if (chunk.text) {
                text += chunk.text;
                onTextChunk(chunk.text);
            }
        }

        return { text, functionCalls };
    }

    async generateOnce(prompt: string): Promise<string> {
        const ai = await this.getAI();
        const response = await ai.models.generateContent({
            model: this.model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });

        let text = '';
        try {
            text = response?.text || '';
        } catch {
            text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
        return text;
    }
}
