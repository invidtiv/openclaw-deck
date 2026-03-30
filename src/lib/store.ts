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

// ─── Column Config + Persistence ───

const LAYOUT_STORAGE_KEY = "openclaw.deck.layout.v1";

interface ColumnConfig {
  id: string;
  name?: string;
  accent?: string;
  icon?: string;
}

interface SavedLayout {
  columnOrder: string[];
  agents: Record<string, { name?: string; icon?: string; accent?: string }>;
  sessionKeys?: Record<string, string>;
  columnWidths?: Record<string, number>;
}

function loadSavedLayout(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLayout(columnOrder: string[], agents: AgentConfig[]) {
  try {
    const layout: SavedLayout = {
      columnOrder,
      agents: Object.fromEntries(
        agents.map((a) => [a.id, { name: a.name, icon: a.icon, accent: a.accent }])
      ),
    };
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

let _columnConfig: ColumnConfig[] | null = null;

async function loadColumnConfig(): Promise<ColumnConfig[]> {
  if (_columnConfig) return _columnConfig;
  try {
    const res = await fetch("/deck.config.json");
    if (res.ok) {
      const data = await res.json();
      _columnConfig = data.columns ?? [];
      return _columnConfig!;
    }
  } catch {
    // No config file — use gateway order
  }
  _columnConfig = [];
  return [];
}

// ─── Store Shape ───

interface DeckStore {
  config: DeckConfig;
  sessions: Record<string, AgentSession>;
  gatewayConnected: boolean;
  columnOrder: string[];
  client: GatewayClient | null;
  theme: string;
  selectedAgents: Set<string>;
  columnWidths: Record<string, number>;

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
  updateAgentConfig: (agentId: string, updates: Partial<Pick<AgentConfig, "name" | "icon" | "accent">>) => void;
  moveColumn: (agentId: string, direction: "left" | "right") => void;
  toggleSelectedAgent: (agentId: string) => void;
  setColumnWidth: (agentId: string, width: number) => void;
  setAgentSessionKey: (agentId: string, sessionKey: string) => Promise<void>;
  listAgentSessions: (agentId: string) => Promise<Array<{ key: string; label: string; channel: string; updatedAt: number }>>;
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
  selectedAgents: new Set<string>(),
  columnWidths: {},

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

      // Load column config (file-based defaults) and saved layout (user customizations)
      const columns = await loadColumnConfig();
      const saved = loadSavedLayout();
      const gatewayAgentsById = new Map(
        result.agents.map((a) => [a.id, a])
      );
      const columnById = new Map(columns.map((c) => [c.id, c]));

      // Determine column order: saved > deck.config.json > gateway order
      const orderedIds: string[] = [];
      const usedIds = new Set<string>();

      // 1. Saved layout order (user customizations via settings modal)
      if (saved?.columnOrder?.length) {
        for (const id of saved.columnOrder) {
          if (gatewayAgentsById.has(id) && !usedIds.has(id)) {
            orderedIds.push(id);
            usedIds.add(id);
          }
        }
      }

      // 2. deck.config.json order (file-based defaults)
      for (const col of columns) {
        if (gatewayAgentsById.has(col.id) && !usedIds.has(col.id)) {
          orderedIds.push(col.id);
          usedIds.add(col.id);
        }
      }

      // 3. Remaining gateway agents not yet ordered
      for (const a of result.agents) {
        if (!usedIds.has(a.id)) {
          orderedIds.push(a.id);
        }
      }

      // Fetch session list to get real model info per agent
      let defaultModel = "";
      const agentModelMap = new Map<string, string>();
      try {
        const sessionsList = await client.listSessions({ limit: 100 });
        if (sessionsList.sessions) {
          // Default model from gateway
          const defaults = (sessionsList as Record<string, unknown>).defaults as
            { modelProvider?: string; model?: string } | undefined;
          if (defaults?.modelProvider && defaults?.model) {
            defaultModel = `${defaults.modelProvider}/${defaults.model}`;
          }
          // Find most recent session per agent to get its model
          for (const s of sessionsList.sessions) {
            const parts = s.key.split(":");
            const aid = parts.length >= 2 ? parts[1] : "";
            if (aid && !agentModelMap.has(aid) && s.modelProvider && s.model) {
              agentModelMap.set(aid, `${s.modelProvider}/${s.model}`);
            }
          }
        }
      } catch {
        // Non-critical — just won't have model info
      }

      // Build agents: saved overrides > deck.config.json > gateway identity > defaults
      const newAgents: AgentConfig[] = orderedIds.map((id, i) => {
        const gw = gatewayAgentsById.get(id)!;
        const col = columnById.get(id);
        const s = saved?.agents?.[id];
        return {
          id,
          name: s?.name || col?.name || gw.identity?.name || gw.name || id,
          icon: s?.icon || col?.icon || gw.identity?.emoji || String(i + 1),
          accent: s?.accent || col?.accent || AGENT_ACCENTS[i % AGENT_ACCENTS.length],
          model: agentModelMap.get(id) || defaultModel,
          context: "",
        };
      });

      // Build sessions, preserving any existing message history
      const existingSessions = get().sessions;
      const sessions: Record<string, AgentSession> = {};
      const columnOrder: string[] = [];

      for (const agent of newAgents) {
        sessions[agent.id] = existingSessions[agent.id]
          ? { ...existingSessions[agent.id], connected: true }
          : createSession(agent.id);
        sessions[agent.id].connected = true;
        // Restore saved session key
        const savedKeys = saved?.sessionKeys;
        if (savedKeys?.[agent.id]) {
          sessions[agent.id].sessionKey = savedKeys[agent.id];
        }
        columnOrder.push(agent.id);
      }

      set({
        config: { ...get().config, agents: newAgents },
        sessions,
        columnOrder,
        columnWidths: saved?.columnWidths || {},
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
      // Use the selected session key, or default to deck session
      const sessionKey = get().sessions[agentId]?.sessionKey || `agent:${agentId}:deck-${agentId}`;
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

  reorderColumns: (order) => {
    set({ columnOrder: order });
    saveLayout(order, get().config.agents);
  },

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
      // Use the selected session key, or default to deck session
      const sessionKey = get().sessions[agentId]?.sessionKey || `agent:${agentId}:deck-${agentId}`;
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
        const rawAgentId = parts.length >= 2 ? parts[1] : "main";

        // Find which column is displaying this session key
        // (could be a Telegram session shown in a deck column)
        let agentId = rawAgentId;
        if (sessionKey && !get().sessions[rawAgentId]?.activeRunId) {
          const matchBySessionKey = Object.values(get().sessions).find(
            (s) => s.sessionKey === sessionKey
          );
          if (matchBySessionKey) {
            agentId = matchBySessionKey.agentId;
          }
        }

        // Check if we have a session for this agent
        if (!get().sessions[agentId]) {
          const matchingAgent = Object.values(get().sessions).find(
            (s) => s.activeRunId === runId
          );
          if (!matchingAgent) break;
          agentId = matchingAgent.agentId;
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

  setColumnWidth: (agentId, width) => {
    const widths = { ...get().columnWidths, [agentId]: width };
    set({ columnWidths: widths });
    // Persist
    const saved = loadSavedLayout() || { columnOrder: [], agents: {} };
    saved.columnWidths = widths;
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(saved)); } catch { /* */ }
  },

  toggleSelectedAgent: (agentId) => {
    set((state) => {
      const next = new Set(state.selectedAgents);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return { selectedAgents: next };
    });
  },

  setAgentSessionKey: async (agentId, sessionKey) => {
    // Update the session key and reload history
    set((state) => {
      const session = state.sessions[agentId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [agentId]: {
            ...session,
            sessionKey,
            messages: [], // Clear messages before loading new session
            activeRunId: null,
            status: "idle",
          },
        },
      };
    });
    // Save to layout
    const saved = loadSavedLayout() || { columnOrder: [], agents: {} };
    saved.sessionKeys = { ...saved.sessionKeys, [agentId]: sessionKey };
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(saved));
    } catch { /* ignore */ }
    // Load history for the new session
    await get().loadChatHistory(agentId);
  },

  listAgentSessions: async (agentId) => {
    const { client } = get();
    if (!client?.connected) return [];
    try {
      const result = await client.listSessions({ limit: 100, includeDerivedTitles: true });
      const prefix = `agent:${agentId}:`;
      return result.sessions
        .filter((s) => s.key.startsWith(prefix))
        .map((s) => {
          const suffix = s.key.slice(prefix.length);
          // Build a human-readable label
          let label = s.displayName || s.label || s.derivedTitle || suffix;
          // Clean up derived titles (remove timestamps)
          if (label.startsWith("[")) {
            const closeBracket = label.indexOf("]");
            if (closeBracket > 0) label = label.slice(closeBracket + 2) || suffix;
          }
          // Truncate
          if (label.length > 60) label = label.slice(0, 57) + "...";
          return {
            key: s.key,
            label: label || suffix,
            channel: s.channel || (suffix.includes("telegram") ? "telegram" : suffix.includes("cron") ? "cron" : suffix.includes("deck") ? "deck" : ""),
            updatedAt: s.updatedAt || 0,
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (err) {
      console.warn("[DeckStore] Failed to list sessions:", err);
      return [];
    }
  },

  updateAgentConfig: (agentId, updates) => {
    set((state) => {
      const agents = state.config.agents.map((a) =>
        a.id === agentId ? { ...a, ...updates } : a
      );
      saveLayout(state.columnOrder, agents);
      return { config: { ...state.config, agents } };
    });
  },

  moveColumn: (agentId, direction) => {
    const order = [...get().columnOrder];
    const idx = order.indexOf(agentId);
    if (idx < 0) return;
    const targetIdx = direction === "left" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= order.length) return;
    [order[idx], order[targetIdx]] = [order[targetIdx], order[idx]];
    set({ columnOrder: order });
    saveLayout(order, get().config.agents);
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
