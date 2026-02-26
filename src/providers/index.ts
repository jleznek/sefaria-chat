export type { ChatProvider, ProviderInfo, ProviderModel, ToolDeclaration, StreamResult, FunctionCall, Message, MessagePart, BalanceInfo } from './types';
export { GEMINI_INFO, GeminiProvider } from './gemini';
export { OPENAI_INFO, OpenAIProvider } from './openai';
export { ANTHROPIC_INFO, AnthropicProvider } from './anthropic';
export { GROK_INFO, GrokProvider } from './grok';
export { MISTRAL_INFO, MistralProvider } from './mistral';
export { DEEPSEEK_INFO, DeepSeekProvider } from './deepseek';
export { OLLAMA_INFO, OllamaProvider, detectOllamaModels } from './ollama';
export { GROQ_INFO, GroqProvider } from './groq';
export { OPENROUTER_INFO, OpenRouterProvider } from './openrouter';

import type { ChatProvider, ProviderInfo } from './types';
import { GEMINI_INFO, GeminiProvider } from './gemini';
import { OPENAI_INFO, OpenAIProvider } from './openai';
import { ANTHROPIC_INFO, AnthropicProvider } from './anthropic';
import { GROK_INFO, GrokProvider } from './grok';
import { MISTRAL_INFO, MistralProvider } from './mistral';
import { DEEPSEEK_INFO, DeepSeekProvider } from './deepseek';
import { OLLAMA_INFO, OllamaProvider } from './ollama';
import { GROQ_INFO, GroqProvider } from './groq';
import { OPENROUTER_INFO, OpenRouterProvider } from './openrouter';

/** Static list of all supported providers and their metadata. */
export const AVAILABLE_PROVIDERS: ProviderInfo[] = [
    GEMINI_INFO,
    OPENAI_INFO,
    ANTHROPIC_INFO,
    GROK_INFO,
    MISTRAL_INFO,
    DEEPSEEK_INFO,
    GROQ_INFO,
    OPENROUTER_INFO,
    OLLAMA_INFO,
];

/**
 * Create a ChatProvider instance for the given provider ID.
 * Returns null if the provider ID is unrecognized.
 */
export function createProvider(
    providerId: string,
    apiKey: string,
    model?: string,
): ChatProvider | null {
    switch (providerId) {
        case 'gemini':
            return new GeminiProvider(apiKey, model);
        case 'openai':
            return new OpenAIProvider(apiKey, model);
        case 'anthropic':
            return new AnthropicProvider(apiKey, model);
        case 'grok':
            return new GrokProvider(apiKey, model);
        case 'mistral':
            return new MistralProvider(apiKey, model);
        case 'deepseek':
            return new DeepSeekProvider(apiKey, model);
        case 'ollama':
            return new OllamaProvider(apiKey, model);
        case 'groq':
            return new GroqProvider(apiKey, model);
        case 'openrouter':
            return new OpenRouterProvider(apiKey, model);
        default:
            return null;
    }
}
