import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverName: string;
}

interface ServerConfig {
    name: string;
    url: string;
}

const SEFARIA_SERVERS: ServerConfig[] = [
    { name: 'sefaria-texts', url: 'https://mcp.sefaria.org/sse' },
    { name: 'sefaria-developers', url: 'https://developers.sefaria.org/mcp' },
];

export class McpClientManager {
    private clients: Map<string, Client> = new Map();
    private toolToServer: Map<string, string> = new Map();
    private tools: McpTool[] = [];
    private connectionErrors: Map<string, string> = new Map();

    async connect(): Promise<void> {
        const connectPromises = SEFARIA_SERVERS.map(async (server) => {
            try {
                console.log(`Connecting to MCP server: ${server.name} (${server.url})...`);

                const client = new Client({
                    name: 'sefaria-desktop',
                    version: '1.0.0',
                });

                // Try Streamable HTTP first, fall back to SSE
                const url = new URL(server.url);
                let connected = false;

                try {
                    const transport = new StreamableHTTPClientTransport(url);
                    await client.connect(transport);
                    connected = true;
                } catch (streamableErr) {
                    console.log(`Streamable HTTP failed for ${server.name}, trying SSE fallback...`);
                    try {
                        const sseTransport = new SSEClientTransport(url);
                        await client.connect(sseTransport);
                        connected = true;
                    } catch (sseErr) {
                        throw new Error(
                            `Both transports failed – Streamable HTTP: ${streamableErr instanceof Error ? streamableErr.message : streamableErr}; SSE: ${sseErr instanceof Error ? sseErr.message : sseErr}`
                        );
                    }
                }

                if (!connected) return;

                this.clients.set(server.name, client);

                // Only list tools if the server declares the tools capability
                const caps = client.getServerCapabilities();
                if (caps?.tools) {
                    const result = await client.listTools();
                    for (const tool of result.tools) {
                        this.tools.push({
                            name: tool.name,
                            description: tool.description || '',
                            inputSchema: tool.inputSchema as Record<string, unknown>,
                            serverName: server.name,
                        });
                        this.toolToServer.set(tool.name, server.name);
                    }
                    console.log(`Connected to ${server.name}: ${result.tools.length} tools available`);
                } else {
                    console.log(`Connected to ${server.name}: no tools capability (context-only server)`);
                }
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                console.error(`Failed to connect to ${server.name}: ${errorMsg}`);
                this.connectionErrors.set(server.name, errorMsg);
            }
        });

        await Promise.all(connectPromises);
    }

    listAllTools(): McpTool[] {
        return this.tools;
    }

    getConnectionStatus(): { connected: string[]; failed: { name: string; error: string }[] } {
        const connected: string[] = [];
        const failed: { name: string; error: string }[] = [];

        for (const server of SEFARIA_SERVERS) {
            if (this.clients.has(server.name)) {
                connected.push(server.name);
            } else {
                failed.push({
                    name: server.name,
                    error: this.connectionErrors.get(server.name) || 'Unknown error',
                });
            }
        }

        return { connected, failed };
    }

    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        const serverName = this.toolToServer.get(name);
        if (!serverName) {
            throw new Error(`Unknown tool: ${name}`);
        }

        const client = this.clients.get(serverName);
        if (!client) {
            throw new Error(`Server not connected: ${serverName}`);
        }

        const result = await client.callTool({ name, arguments: args });
        return result;
    }

    async disconnect(): Promise<void> {
        for (const [, client] of this.clients) {
            try {
                await client.close();
            } catch {
                // Ignore close errors
            }
        }
        this.clients.clear();
        this.tools = [];
        this.toolToServer.clear();
    }
}
