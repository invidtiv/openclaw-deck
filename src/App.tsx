import { useState, useEffect, useCallback } from "react";
import { useDeckInit } from "./hooks";
import { useDeckStore } from "./lib/store";
import { AgentColumn } from "./components/AgentColumn";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { AddAgentModal } from "./components/AddAgentModal";
import type { AgentConfig } from "./types";
import { themes, applyTheme } from "./themes";
import "./App.css";

function buildFallbackAgents(): AgentConfig[] {
  return [
    {
      id: "main",
      name: "Main",
      icon: "1",
      accent: "#22d3ee",
      context: "",
    },
  ];
}

function getGatewayConfig() {
  const params = new URLSearchParams(window.location.search);
  let gatewayUrl =
    params.get("gateway") ||
    import.meta.env.VITE_GATEWAY_URL ||
    "ws://127.0.0.1:18789";

  if (gatewayUrl.startsWith("/")) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    gatewayUrl = `${proto}//${window.location.host}${gatewayUrl}`;
  }

  return {
    gatewayUrl,
    token:
      params.get("token") ||
      import.meta.env.VITE_GATEWAY_TOKEN ||
      undefined,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState("All Agents");
  const [showAddModal, setShowAddModal] = useState(false);
  const [popOutAgentId, setPopOutAgentId] = useState<string | null>(null);
  const [initialAgents] = useState<AgentConfig[]>(() =>
    buildFallbackAgents()
  );
  const columnOrder = useDeckStore((s) => s.columnOrder);
  const sessions = useDeckStore((s) => s.sessions);
  const selectedAgents = useDeckStore((s) => s.selectedAgents);
  const squads = useDeckStore((s) => s.squads);
  const viewColumnWidths = useDeckStore((s) => s.viewColumnWidths);
  const columnWidths = useDeckStore((s) => s.columnWidths);
  const setViewColumnWidth = useDeckStore((s) => s.setViewColumnWidth);
  const createAgentOnGateway = useDeckStore((s) => s.createAgentOnGateway);
  const theme = useDeckStore((s) => s.theme);

  const { gatewayUrl, token } = getGatewayConfig();

  useEffect(() => {
    const selectedTheme = themes[theme];
    if (selectedTheme) {
      applyTheme(selectedTheme);
    }
  }, [theme]);

  useDeckInit({
    gatewayUrl,
    token,
    agents: initialAgents,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key, 10) - 1;
        const input = document.querySelector<HTMLTextAreaElement>(
          `[data-deck-input="${index}"]`
        );
        if (input) {
          e.preventDefault();
          input.focus();
        }
      } else if (e.metaKey && e.key === "k") {
        e.preventDefault();
        setShowAddModal((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const activeSquad = squads.find((s) => s.id === activeTab);

  const getColumnWidth = useCallback((agentId: string): number | undefined => {
    return viewColumnWidths[activeTab]?.[agentId] ?? columnWidths[agentId] ?? undefined;
  }, [activeTab, viewColumnWidths, columnWidths]);

  const handleResize = useCallback((agentId: string, width: number) => {
    setViewColumnWidth(activeTab, agentId, width);
  }, [activeTab, setViewColumnWidth]);

  return (
    <div className="deck-root">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onAddAgent={() => setShowAddModal(true)}
      />

      <div className="deck-columns">
        {columnOrder
          .filter((agentId) => {
            if (activeTab === "All Agents") return true;
            if (activeTab === "Selected") return selectedAgents.has(agentId);
            if (activeSquad) return activeSquad.agentIds.includes(agentId);
            const s = sessions[agentId];
            if (!s) return false;
            if (activeTab === "Active")
              return s.status === "streaming" || s.status === "thinking" || s.status === "tool_use";
            if (activeTab === "Queued") return s.status === "thinking";
            if (activeTab === "Completed") {
              const last = s.messages[s.messages.length - 1];
              return s.status === "idle" && last?.role === "assistant" && !last?.streaming;
            }
            return true;
          })
          .map((agentId, index) => (
          <AgentColumn
            key={agentId}
            agentId={agentId}
            columnIndex={index}
            onPopOut={setPopOutAgentId}
            columnWidth={getColumnWidth(agentId)}
            onResize={handleResize}
          />
        ))}
      </div>

      <StatusBar />

      {popOutAgentId && (
        <AgentColumn
          agentId={popOutAgentId}
          columnIndex={columnOrder.indexOf(popOutAgentId)}
          popOut
          onPopIn={() => setPopOutAgentId(null)}
        />
      )}

      {showAddModal && (
        <AddAgentModal
          onClose={() => setShowAddModal(false)}
          onCreate={createAgentOnGateway}
        />
      )}
    </div>
  );
}
