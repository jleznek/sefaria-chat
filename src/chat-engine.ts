import { McpClientManager } from './mcp-client';
import { SEFARIA_SYSTEM_PROMPT } from './prompts';
import type { ChatProvider } from './providers/types';

type TextChunkCallback = (chunk: string) => void;
type ToolStatusCallback = (toolName: string, status: 'calling' | 'done') => void;

export class ChatEngine {
    private provider: ChatProvider;
    private mcpManager: McpClientManager;
    private modelId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private conversationHistory: any[] = [];

    // Rate limit tracking – limits come from the active provider
    private requestTimestamps: number[] = [];

    constructor(provider: ChatProvider, mcpManager: McpClientManager, modelId?: string) {
        this.provider = provider;
        this.mcpManager = mcpManager;
        this.modelId = modelId || provider.info.defaultModel;
    }

    /** Swap the active provider (e.g. when the user changes settings). */
    updateProvider(provider: ChatProvider, modelId?: string): void {
        this.provider = provider;
        this.modelId = modelId || provider.info.defaultModel;
    }

    /** Get the effective RPM for the active model (per-model override or provider default). */
    private getEffectiveRpm(): number {
        const model = this.provider.info.models.find(m => m.id === this.modelId);
        return model?.rpm ?? this.provider.info.rateLimit.rpm;
    }

    /** Record an API request and prune old entries outside the window. */
    private recordRequest(): void {
        const now = Date.now();
        this.requestTimestamps.push(now);
        const cutoff = now - this.provider.info.rateLimit.windowMs;
        this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff);
    }

    /** Prune and return current count of requests in the rate-limit window. */
    private currentUsage(): number {
        const now = Date.now();
        const cutoff = now - this.provider.info.rateLimit.windowMs;
        this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff);
        return this.requestTimestamps.length;
    }

    /**
     * Wait until there is capacity to make another API request.
     * If we are at or over the RPM limit, delay until the oldest
     * request falls outside the window.
     */
    private async waitForCapacity(): Promise<void> {
        const rpm = this.getEffectiveRpm();
        const { windowMs } = this.provider.info.rateLimit;
        // Keep a 1-request safety margin
        const effectiveLimit = Math.max(1, rpm - 1);
        while (this.currentUsage() >= effectiveLimit) {
            const oldest = this.requestTimestamps[0];
            const waitMs = oldest
                ? Math.max(500, oldest + windowMs - Date.now() + 200)
                : 2000;
            console.log(`[ChatEngine] rate limit reached (${this.currentUsage()}/${rpm}), waiting ${waitMs}ms…`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }

    /** True if we have used less than 60% of the RPM budget. */
    hasCapacityForFollowUps(): boolean {
        const rpm = this.getEffectiveRpm();
        return this.currentUsage() < Math.floor(rpm * 0.6);
    }

    /** Get current usage stats for the rate limit status bar. */
    getUsageStats(): { used: number; limit: number; resetsInSeconds: number } {
        const now = Date.now();
        const rpm = this.getEffectiveRpm();
        const { windowMs } = this.provider.info.rateLimit;
        const cutoff = now - windowMs;
        this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff);
        const used = this.requestTimestamps.length;
        const oldest = this.requestTimestamps[0];
        const resetsInSeconds = oldest
            ? Math.max(0, Math.ceil((oldest + windowMs - now) / 1000))
            : 0;
        return { used, limit: rpm, resetsInSeconds };
    }

    /** Fetch the account balance from the current provider, if supported. */
    async getBalance(): Promise<{ balance: number; currency: string } | null> {
        if (this.provider.getBalance) {
            return this.provider.getBalance();
        }
        return null;
    }

    async sendMessage(
        userMessage: string,
        responseLength: string | null,
        onTextChunk: TextChunkCallback,
        onToolStatus: ToolStatusCallback,
    ): Promise<void> {
        // Build system prompt with response length preference
        let systemContent = SEFARIA_SYSTEM_PROMPT;
        if (responseLength === 'concise') {
            systemContent += '\n\nIMPORTANT: The user has requested a CONCISE response. Keep your answer brief and to the point — a few sentences to a short paragraph. Focus on the key facts. Omit lengthy commentary unless specifically asked.';
        } else if (responseLength === 'detailed') {
            systemContent += '\n\nIMPORTANT: The user has requested a DETAILED response. Provide a comprehensive, thorough answer. Include extensive commentary, multiple perspectives, cross-references, historical context, and full Hebrew/Aramaic text with translations.';
        } else {
            systemContent += '\n\nProvide a balanced response — moderately detailed with key sources and context, but not exhaustively long.';
        }

        // Add user message to history
        this.conversationHistory.push({
            role: 'user',
            parts: [{ text: userMessage }],
        });

        // Get available MCP tools
        const mcpTools = this.mcpManager.listAllTools();
        const tools = mcpTools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema as Record<string, unknown>,
        }));

        // Tool-calling loop: stream responses, handle tool calls, repeat
        const maxRounds = 10;

        for (let round = 0; round < maxRounds; round++) {
            // Wait for capacity before calling the API to avoid 429s
            await this.waitForCapacity();

            const result = await this.provider.streamChat(
                this.conversationHistory,
                systemContent,
                tools,
                onTextChunk,
            );
            this.recordRequest();

            // If no function calls, save the final response and stop
            if (result.functionCalls.length === 0) {
                this.conversationHistory.push({
                    role: 'model',
                    parts: [{ text: result.text || '' }],
                });
                break;
            }

            // Add model response (with function calls) to history
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const modelParts: any[] = [];
            if (result.text) {
                modelParts.push({ text: result.text });
            }
            for (const fc of result.functionCalls) {
                modelParts.push({
                    functionCall: { name: fc.name, args: fc.args, id: fc.id },
                });
            }
            this.conversationHistory.push({ role: 'model', parts: modelParts });

            // Execute each function call via MCP
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const responseParts: any[] = [];
            for (const fc of result.functionCalls) {
                onToolStatus(fc.name, 'calling');
                try {
                    const mcpResult = await this.mcpManager.callTool(fc.name, fc.args);
                    const serialized = typeof mcpResult === 'string'
                        ? { result: mcpResult }
                        : (mcpResult as Record<string, unknown>);
                    responseParts.push({
                        functionResponse: { name: fc.name, response: serialized, callId: fc.id },
                    });
                } catch (err) {
                    responseParts.push({
                        functionResponse: {
                            name: fc.name,
                            response: {
                                error: `Error invoking tool ${fc.name}: ${err instanceof Error ? err.message : String(err)}`,
                            },
                            callId: fc.id,
                        },
                    });
                }
                onToolStatus(fc.name, 'done');
            }

            // Add function responses to history (role: 'user' per Gemini convention)
            this.conversationHistory.push({ role: 'user', parts: responseParts });
        }
    }

    clearHistory(): void {
        this.conversationHistory = [];
    }

    /**
     * Generate 2-3 short follow-up question suggestions based on the conversation so far.
     */
    async generateFollowUps(): Promise<string[]> {
        try {
            // Extract only user questions and model text replies (skip tool call/response entries)
            const cleanMessages: Array<{ role: string; text: string }> = [];
            for (const m of this.conversationHistory) {
                const textParts = (m.parts || [])
                    .filter((p: Record<string, unknown>) => typeof p.text === 'string' && p.text)
                    .map((p: Record<string, unknown>) => String(p.text));
                if (textParts.length === 0) { continue; }
                const role = m.role === 'model' ? 'model' : 'user';
                cleanMessages.push({ role, text: textParts.join(' ').slice(0, 500) });
            }

            // Take only the last few meaningful exchanges
            const recent = cleanMessages.slice(-4);
            if (recent.length === 0) {
                console.log('[generateFollowUps] no clean messages to base suggestions on');
                return [];
            }

            // Build a single-turn prompt summarizing the conversation
            const summary = recent.map(m =>
                `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`
            ).join('\n\n');

            const prompt = `Here is a conversation about Jewish texts:\n\n${summary}\n\nBased on this conversation, suggest exactly 3 short follow-up questions the user might want to ask next. Return ONLY a JSON array of 3 strings, nothing else. Each question should be concise (under 60 characters). Example format: ["Question one?","Question two?","Question three?"]`;

            console.log('[generateFollowUps] requesting suggestions...');

            // Retry logic for rate limiting (429)
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    await this.waitForCapacity();
                    const text = await this.provider.generateOnce(prompt);
                    this.recordRequest();

                    console.log('[generateFollowUps] raw response:', text.slice(0, 300));

                    // Extract JSON array from the response
                    const match = text.match(/\[.*\]/s);
                    if (match) {
                        const parsed = JSON.parse(match[0]);
                        if (Array.isArray(parsed)) {
                            return parsed.filter((s: unknown) => typeof s === 'string').slice(0, 3);
                        }
                    }
                    console.log('[generateFollowUps] could not parse follow-ups from response');
                    return [];
                } catch (err: unknown) {
                    const status = (err as { status?: number }).status;
                    if (status === 429 && attempt < 2) {
                        const delay = (attempt + 1) * 5000;
                        console.log(`[generateFollowUps] rate limited, retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    } else {
                        throw err;
                    }
                }
            }

            return [];
        } catch (err) {
            console.error('[generateFollowUps] error:', err);
            return [];
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getHistory(): any[] {
        return this.conversationHistory;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    restoreHistory(history: any[]): void {
        this.conversationHistory = history;
    }
}
