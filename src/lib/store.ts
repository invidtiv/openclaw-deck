import { create } from "zustand";
import type {
  AgentConfig,
  AgentSession,
  AgentStatus,
  ChatMessage,
  DeckConfig,
  GatewayEvent,
  SessionUsage,
} from "../types";
import { GatewayClient } from "./gateway-client";
import { themes, applyTheme } from "../themes";

// ─── Default Config ───

const DEFAULT_CONFIG: DeckConfig = {
  gatewayUrl: "ws://127.0.0.1:18789",
  token: undefined,
  agents: [],
};

const AGENT_ACCENTS = [
  "#22d3ee",
  "#a78bfa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#60a5fa",
  "#facc15",
  "#fb7185",
  "#4ade80",
  "#c084fc",
  "#f97316",
  "#2dd4bf",
];

// ─── Store Shape ───

interface DeckStore {
  config: DeckConfig;
  sessions: Record<string, AgentSession>;
  gatewayConnected: boolean;
  columnOrder: string[];
  client: GatewayClient | null;
  theme: string;

  // Actions
  initialize: (config: Partial<DeckConfig>) => void;
  addAgent: (agent: AgentConfig) => void;
  removeAgent: (agentId: string) => void;
  reorderColumns: (order: string[]) => void;
  sendMessage: (agentId: string, text: string) => Promise<void>;
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  appendMessageChunk: (agentId: string, runId: string, chunk: string) => void;
  finalizeMessage: (agentId: string, runId: string) => void;
  handleGatewayEvent: (event: GatewayEvent) => void;
  createAgentOnGateway: (agent: AgentConfig) => Promise<void>;
  deleteAgentOnGateway: (agentId: string) => Promise<void>;
  fetchAgentsFromGateway: () => Promise<void>;
  loadChatHistory: (agentId: string) => Promise<void>;
  disconnect: () => void;
  setTheme: (themeId: string) => void;
}

// ─── Helpers ───

/**
 * Convert an Anthropic-format message from chat.history into our ChatMessage.
 * Extracts text from content blocks, skips tool results and thinking blocks.
 */
function convertGatewayMessage(msg: Record<string, unknown>): ChatMessage | null {
  const role = msg.role as string;
  const timestamp = (msg.timestamp as number) || Date.now();
  const content = msg.content;

  if (role === "user") {
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((c: Record<string, unknown>) => c.type === "text")
        .map((c: Record<string, unknown>) => c.text as string)
        .join("\n");
    }
    if (!text) return null;
    return { id: makeId(), role: "user", text, timestamp };
  }

  if (role === "assistant") {
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((c: Record<string, unknown>) => c.type === "text")
        .map((c: Record<string, unknown>) => c.text as string)
        .join("\n");
    }
    if (!text) return null;
    return { id: makeId(), role: "assistant", text, timestamp };
  }

  // Skip toolResult, system, etc.
  return null;
}

function createSession(agentId: string): AgentSession {
  return {
    agentId,
    status: "idle",
    messages: [],
    activeRunId: null,
    tokenCount: 0,
    connected: false,
  };
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Store ───

export const useDeckStore = create<DeckStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  sessions: {},
  gatewayConnected: false,
  columnOrder: [],
  client: null,
  theme: 'midnight',

  initialize: (partialConfig) => {
    const config = { ...DEFAULT_CONFIG, ...partialConfig };
    // Start with whatever agents are passed (fallback defaults)
    const sessions: Record<string, AgentSession> = {};
    const columnOrder: string[] = [];

    for (const agent of config.agents) {
      sessions[agent.id] = createSession(agent.id);
      columnOrder.push(agent.id);
    }

    // Create the gateway client
    const client = new GatewayClient({
      url: config.gatewayUrl,
      token: config.token,
      onEvent: (event) => get().handleGatewayEvent(event),
      onConnection: (connected) => {
        set({ gatewayConnected: connected });
        if (connected) {
          // Mark all agent sessions as connected
          const sessions = { ...get().sessions };
          for (const id of Object.keys(sessions)) {
            sessions[id] = { ...sessions[id], connected: true };
          }
          set({ sessions });
          // Fetch real agent list from gateway (small delay to let handshake fully settle)
          setTimeout(() => {
            get().fetchAgentsFromGateway().catch((err) => {
              console.error("[DeckStore] fetchAgentsFromGateway error:", err);
            });
          }, 100);
        }
      },
    });

    set({ config, sessions, columnOrder, client });
    client.connect();
  },

  fetchAgentsFromGateway: async () => {
    const { client } = get();
    if (!client?.connected) {
      console.warn("[DeckStore] fetchAgentsFromGateway: client not connected, skipping");
      return;
    }

    try {
      console.log("[DeckStore] Fetching agents from gateway...");
      const result = await client.listAgents();
      console.log("[DeckStore] Gateway agents.list response:", JSON.stringify(result));

      if (!result?.agents?.length) {
        console.warn("[DeckStore] No agents returned from gateway");
        return;
      }

      const newAgents: AgentConfig[] = result.agents.map((a, i) => ({
        id: a.id,
        name: a.identity?.name || a.name || a.id,
        icon: a.identity?.emoji || String(i + 1),
        accent: AGENT_ACCENTS[i % AGENT_ACCENTS.length],
        context: "",
      }));

      // Build sessions, preserving any existing message history
      const existingSessions = get().sessions;
      const sessions: Record<string, AgentSession> = {};
      const columnOrder: string[] = [];

      for (const agent of newAgents) {
        sessions[agent.id] = existingSessions[agent.id]
          ? { ...existingSessions[agent.id], connected: true }
          : createSession(agent.id);
        sessions[agent.id].connected = true;
        columnOrder.push(agent.id);
      }

      set({
        config: { ...get().config, agents: newAgents },
        sessions,
        columnOrder,
      });

      // Load chat history for each agent in parallel
      await Promise.allSettled(
        newAgents.map((agent) => get().loadChatHistory(agent.id))
      );
    } catch (err) {
      console.warn("[DeckStore] Failed to fetch agents from gateway:", err);
      // Keep fallback agents
    }
  },

  loadChatHistory: async (agentId) => {
    const { client } = get();
    if (!client?.connected) return;

    try {
      // Use the same sessionKey format as sendMessage
      const sessionKey = `agent:${agentId}:deck-${agentId}`;
      const result = await client.chatHistory(sessionKey, 50);
      const rawMessages = result?.messages ?? [];
      if (!rawMessages.length) return;

      const messages: ChatMessage[] = [];
      for (const raw of rawMessages) {
        const msg = convertGatewayMessage(raw as Record<string, unknown>);
        if (msg) messages.push(msg);
      }

      if (!messages.length) return;

      set((state) => {
        const session = state.sessions[agentId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [agentId]: {
              ...session,
              // Prepend history before any new messages
              messages: [...messages, ...session.messages],
            },
          },
        };
      });
      console.log(`[DeckStore] Loaded ${messages.length} history messages for ${agentId}`);
    } catch (err) {
      // Session might not exist yet — that's fine
      console.debug(`[DeckStore] No chat history for ${agentId}:`, err);
    }
  },

  addAgent: (agent) => {
    set((state) => ({
      config: {
        ...state.config,
        agents: [...state.config.agents, agent],
      },
      sessions: {
        ...state.sessions,
        [agent.id]: createSession(agent.id),
      },
      columnOrder: [...state.columnOrder, agent.id],
    }));
  },

  removeAgent: (agentId) => {
    set((state) => {
      const { [agentId]: _, ...sessions } = state.sessions;
      return {
        config: {
          ...state.config,
          agents: state.config.agents.filter((a) => a.id !== agentId),
        },
        sessions,
        columnOrder: state.columnOrder.filter((id) => id !== agentId),
      };
    });
  },

  reorderColumns: (order) => set({ columnOrder: order }),

  sendMessage: async (agentId, text) => {
    const { client, sessions } = get();
    if (!client?.connected) {
      console.error("Gateway not connected");
      return;
    }

    // Add user message immediately
    const userMsg: ChatMessage = {
      id: makeId(),
      role: "user",
      text,
      timestamp: Date.now(),
    };

    const session = sessions[agentId];
    if (!session) return;

    set((state) => ({
      sessions: {
        ...state.sessions,
        [agentId]: {
          ...session,
          messages: [...session.messages, userMsg],
          status: "thinking",
        },
      },
    }));

    try {
      // Route to the actual agent on the gateway (not hardcoded "main")
      const sessionKey = `agent:${agentId}:deck-${agentId}`;
      const { runId } = await client.runAgent(agentId, text, sessionKey);

      // Create placeholder assistant message for streaming
      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: "assistant",
        text: "",
        timestamp: Date.now(),
        streaming: true,
        runId,
      };

      set((state) => ({
        sessions: {
          ...state.sessions,
          [agentId]: {
            ...state.sessions[agentId],
            messages: [...state.sessions[agentId].messages, assistantMsg],
            activeRunId: runId,
            status: "streaming",
          },
        },
      }));
    } catch (err) {
      console.error(`Failed to run agent ${agentId}:`, err);
      // Show error as a system message so the user can see what went wrong
      const errorMsg: ChatMessage = {
        id: makeId(),
        role: "system",
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      set((state) => ({
        sessions: {
          ...state.sessions,
          [agentId]: {
            ...state.sessions[agentId],
            messages: [...state.sessions[agentId].messages, errorMsg],
            status: "error",
          },
        },
      }));
    }
  },

  setAgentStatus: (agentId, status) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [agentId]: {
          ...state.sessions[agentId],
          status,
        },
      },
    }));
  },

  appendMessageChunk: (agentId, runId, chunk) => {
    set((state) => {
      const session = state.sessions[agentId];
      if (!session || !session.messages) return state;

      const messages = session.messages.map((msg) => {
        if (msg.runId === runId && msg.streaming) {
          return { ...msg, text: msg.text + chunk };
        }
        return msg;
      });

      return {
        sessions: {
          ...state.sessions,
          [agentId]: {
            ...session,
            messages,
            tokenCount: session.tokenCount + chunk.length, // approximate
          },
        },
      };
    });
  },

  finalizeMessage: (agentId, runId) => {
    set((state) => {
      const session = state.sessions[agentId];
      if (!session || !session.messages) return state;

      const messages = session.messages.map((msg) => {
        if (msg.runId === runId) {
          return { ...msg, streaming: false };
        }
        return msg;
      });

      return {
        sessions: {
          ...state.sessions,
          [agentId]: {
            ...session,
            messages,
            activeRunId: null,
            status: "idle",
          },
        },
      };
    });
  },

  handleGatewayEvent: (event) => {
    const payload = event.payload as Record<string, unknown>;

    switch (event.event) {
      // Agent streaming events
      // Format: { runId, stream: "assistant"|"lifecycle"|"tool"|"error", data: {...}, sessionKey: "agent:<id>:<key>" }
      case "agent": {
        const runId = payload.runId as string;
        const stream = payload.stream as string | undefined;
        const data = payload.data as Record<string, unknown> | undefined;
        const sessionKey = payload.sessionKey as string | undefined;

        // Extract agent ID from sessionKey "agent:<agentId>:<suffix>"
        const parts = sessionKey?.split(":") ?? [];
        const agentId = parts.length >= 2 ? parts[1] : "main";

        // Check if we have a session for this agent
        if (!get().sessions[agentId]) {
          // Try matching by runId across all sessions
          const matchingAgent = Object.values(get().sessions).find(
            (s) => s.activeRunId === runId
          );
          if (!matchingAgent) break;
        }

        if (stream === "assistant" && data?.delta) {
          get().appendMessageChunk(agentId, runId, data.delta as string);
          get().setAgentStatus(agentId, "streaming");
        } else if (stream === "lifecycle") {
          const phase = data?.phase as string | undefined;
          if (phase === "start") {
            get().setAgentStatus(agentId, "thinking");
          } else if (phase === "end") {
            get().finalizeMessage(agentId, runId);
          } else if (phase === "error") {
            // Show error message from lifecycle error
            const errorText = (data?.error as string) || "Agent run failed";
            const session = get().sessions[agentId];
            if (session) {
              const errorMsg: ChatMessage = {
                id: makeId(),
                role: "system",
                text: `Error: ${errorText}`,
                timestamp: Date.now(),
              };
              set((state) => ({
                sessions: {
                  ...state.sessions,
                  [agentId]: {
                    ...state.sessions[agentId],
                    messages: [...state.sessions[agentId].messages, errorMsg],
                    activeRunId: null,
                    status: "error",
                  },
                },
              }));
            }
          }
        } else if (stream === "tool") {
          // Gateway uses "tool" not "tool_use"
          get().setAgentStatus(agentId, "tool_use");
        } else if (stream === "error") {
          const reason = (data?.reason as string) || "Unknown error";
          const session = get().sessions[agentId];
          if (session) {
            const errorMsg: ChatMessage = {
              id: makeId(),
              role: "system",
              text: `Error: ${reason}`,
              timestamp: Date.now(),
            };
            set((state) => ({
              sessions: {
                ...state.sessions,
                [agentId]: {
                  ...state.sessions[agentId],
                  messages: [...state.sessions[agentId].messages, errorMsg],
                  activeRunId: null,
                  status: "error",
                },
              },
            }));
          }
        }
        break;
      }

      // Presence changes (agents coming online/offline)
      case "presence": {
        const agents = payload.agents as
          | Record<string, { online: boolean }>
          | undefined;
        if (agents) {
          set((state) => {
            const sessions = { ...state.sessions };
            for (const [id, info] of Object.entries(agents)) {
              if (sessions[id]) {
                sessions[id] = {
                  ...sessions[id],
                  connected: info.online,
                  status: info.online ? sessions[id].status : "disconnected",
                };
              }
            }
            return { sessions };
          });
        }
        break;
      }

      // Tick events (keep-alive, can update token counts, etc.)
      case "tick": {
        // Could update token usage, cost, etc.
        break;
      }

      // Context compaction dividers
      case "compaction": {
        const sessionKey = payload.sessionKey as string | undefined;
        const parts = sessionKey?.split(":") ?? [];
        const agentId = parts.length >= 2 ? parts[1] : "main";
        const beforeTokens = (payload.beforeTokens as number) ?? 0;
        const afterTokens = (payload.afterTokens as number) ?? 0;
        const droppedMessages = (payload.droppedMessages as number) ?? 0;

        const compactionMsg: ChatMessage = {
          id: makeId(),
          role: "compaction",
          text: "",
          timestamp: Date.now(),
          compaction: { beforeTokens, afterTokens, droppedMessages },
        };

        set((state) => {
          const session = state.sessions[agentId];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [agentId]: {
                ...session,
                messages: [...session.messages, compactionMsg],
              },
            },
          };
        });
        break;
      }

      // Real usage data from gateway
      case "sessions.usage": {
        const sessionKey = payload.sessionKey as string | undefined;
        const parts = sessionKey?.split(":") ?? [];
        const agentId = parts.length >= 2 ? parts[1] : "main";
        const usage = payload.usage as SessionUsage | undefined;

        if (usage) {
          set((state) => {
            const session = state.sessions[agentId];
            if (!session) return state;
            return {
              sessions: {
                ...state.sessions,
                [agentId]: {
                  ...session,
                  usage,
                  tokenCount: usage.totalTokens,
                },
              },
            };
          });
        }
        break;
      }

      default:
        console.log("[DeckStore] Unhandled event:", event.event, payload);
    }
  },

  createAgentOnGateway: async (agent) => {
    const { client } = get();
    try {
      if (client?.connected) {
        // Gateway requires name + workspace; workspace defaults to ~/.openclaw/workspace-<id>
        const result = await client.createAgent({
          name: agent.name,
          workspace: `~/.openclaw/workspace-${agent.id}`,
          emoji: agent.icon.length <= 2 ? agent.icon : undefined,
        });
        // Use the agentId the gateway assigned (normalized from name)
        agent = { ...agent, id: result.agentId };
      }
    } catch (err) {
      console.warn("[DeckStore] Gateway createAgent failed:", err);
      throw err; // Propagate so the UI shows the error
    }
    get().addAgent(agent);
  },

  deleteAgentOnGateway: async (agentId) => {
    const { client } = get();
    // Prevent deleting the main agent
    if (agentId === "main") {
      console.warn("[DeckStore] Cannot delete the main agent");
      return;
    }
    try {
      if (client?.connected) {
        await client.deleteAgent(agentId);
      }
    } catch (err) {
      console.warn("[DeckStore] Gateway deleteAgent failed, removing locally:", err);
    }
    get().removeAgent(agentId);
  },

  disconnect: () => {
    get().client?.disconnect();
    set({ gatewayConnected: false, client: null });
  },

  setTheme: (themeId: string) => {
    set({ theme: themeId });
    const theme = themes[themeId];
    if (theme) {
      applyTheme(theme);
    }
  },
}));
