/**
 * Common types shared across all LLM providers.
 */

export interface ToolDeclaration {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface FunctionCall {
    name: string;
    args: Record<string, unknown>;
    /** Provider-assigned ID (required by OpenAI/Anthropic for tool responses). */
    id?: string;
}

export interface StreamResult {
    text: string;
    functionCalls: FunctionCall[];
}

export interface ProviderModel {
    id: string;
    name: string;
    /** Optional per-model RPM override (free-tier). Falls back to provider-level rateLimit. */
    rpm?: number;
}

export interface ProviderInfo {
    id: string;
    name: string;
    models: ProviderModel[];
    defaultModel: string;
    rateLimit: { rpm: number; windowMs: number };
    /** If false, this provider works without an API key (e.g. Ollama local). Defaults to true. */
    requiresKey?: boolean;
    keyPlaceholder: string;
    keyHelpUrl: string;
    keyHelpLabel: string;
}

/**
 * Conversation history uses a Gemini-like format as the canonical representation.
 * Each provider converts from this format to its own API format internally.
 *
 * Parts can be:
 *   { text: string }
 *   { functionCall: { name, args, id? } }
 *   { functionResponse: { name, response, callId? } }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessagePart = Record<string, any>;

export interface Message {
    role: 'user' | 'model';
    parts: MessagePart[];
}

export interface BalanceInfo {
    /** Balance amount in USD (or equivalent). */
    balance: number;
    /** ISO currency code (e.g. 'USD', 'CNY'). */
    currency: string;
}

export interface ChatProvider {
    readonly info: ProviderInfo;

    /**
     * Stream a chat response given conversation history, system prompt, and tools.
     * Calls onTextChunk for each incremental text fragment.
     * Returns the complete text and any function/tool calls.
     */
    streamChat(
        history: Message[],
        systemPrompt: string,
        tools: ToolDeclaration[],
        onTextChunk: (text: string) => void,
    ): Promise<StreamResult>;

    /**
     * Generate a single non-streaming response (used for follow-up suggestions).
     */
    generateOnce(prompt: string): Promise<string>;

    /**
     * Fetch the account balance/credits, if supported by this provider.
     * Returns null if balance checking is not supported.
     */
    getBalance?(): Promise<BalanceInfo | null>;
}
