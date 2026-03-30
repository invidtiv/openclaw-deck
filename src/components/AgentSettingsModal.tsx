import { useState, useEffect, type KeyboardEvent } from "react";
import type { AgentConfig } from "../types";
import { useDeckStore } from "../lib/store";
import styles from "./AddAgentModal.module.css";

const ACCENTS = [
  "#22d3ee", "#a78bfa", "#34d399", "#fb923c",
  "#f472b6", "#facc15", "#60a5fa", "#ef4444",
];

interface SessionEntry {
  key: string;
  label: string;
  channel: string;
  updatedAt: number;
}

function channelBadge(channel: string) {
  const colors: Record<string, string> = {
    telegram: "#229ED9",
    "telegram-mtproto": "#229ED9",
    cron: "#f59e0b",
    deck: "#22d3ee",
  };
  if (!channel) return null;
  return (
    <span
      style={{
        fontSize: 9,
        padding: "1px 5px",
        borderRadius: 3,
        background: (colors[channel] || "#6b7280") + "22",
        color: colors[channel] || "#6b7280",
        border: `1px solid ${(colors[channel] || "#6b7280")}44`,
        marginRight: 6,
        fontFamily: "JetBrains Mono, monospace",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {channel}
    </span>
  );
}

export function AgentSettingsModal({
  agent,
  onClose,
}: {
  agent: AgentConfig;
  onClose: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [icon, setIcon] = useState(agent.icon);
  const [accent, setAccent] = useState(agent.accent);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const updateAgentConfig = useDeckStore((s) => s.updateAgentConfig);
  const moveColumn = useDeckStore((s) => s.moveColumn);
  const setAgentSessionKey = useDeckStore((s) => s.setAgentSessionKey);
  const listAgentSessions = useDeckStore((s) => s.listAgentSessions);
  const setColumnWidth = useDeckStore((s) => s.setColumnWidth);
  const currentWidth = useDeckStore((s) => s.columnWidths[agent.id] || 0);
  const columnOrder = useDeckStore((s) => s.columnOrder);
  const agents = useDeckStore((s) => s.config.agents);
  const currentSessionKey = useDeckStore(
    (s) => s.sessions[agent.id]?.sessionKey || `agent:${agent.id}:deck-${agent.id}`
  );
  const [colWidth, setColWidth] = useState(currentWidth || 400);

  const currentIndex = columnOrder.indexOf(agent.id);
  const totalColumns = columnOrder.length;

  // Load sessions on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingSessions(true);
    listAgentSessions(agent.id).then((result) => {
      if (!cancelled) {
        setSessions(result);
        setLoadingSessions(false);
      }
    });
    return () => { cancelled = true; };
  }, [agent.id, listAgentSessions]);

  const handleSave = () => {
    updateAgentConfig(agent.id, { name, icon, accent });
    onClose();
  };

  const handleMove = (direction: "left" | "right") => {
    moveColumn(agent.id, direction);
  };

  const handleSessionSelect = async (sessionKey: string) => {
    await setAgentSessionKey(agent.id, sessionKey);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.stopPropagation();
      handleSave();
    }
    if (e.key === "Escape") onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxHeight: "85vh", overflowY: "auto" }}
      >
        <div className={styles.title}>
          Agent Settings
          <span style={{ opacity: 0.4, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
            {agent.id}
          </span>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Display Name</label>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>
          <div className={styles.fieldSmall}>
            <label className={styles.label}>Icon</label>
            <input
              className={styles.input}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ textAlign: "center" }}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Color</label>
          <div className={styles.colors}>
            {ACCENTS.map((c) => (
              <div
                key={c}
                className={`${styles.colorSwatch} ${accent === c ? styles.colorSwatchActive : ""}`}
                style={{ backgroundColor: c }}
                onClick={() => setAccent(c)}
              />
            ))}
          </div>
        </div>

        {/* Column Position */}
        <div className={styles.field}>
          <label className={styles.label}>Column Position ({currentIndex + 1} of {totalColumns})</label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button
              className={styles.cancelBtn}
              style={{ flex: 1 }}
              disabled={currentIndex <= 0}
              onClick={() => handleMove("left")}
            >
              Move Left
            </button>
            <button
              className={styles.cancelBtn}
              style={{ flex: 1 }}
              disabled={currentIndex >= totalColumns - 1}
              onClick={() => handleMove("right")}
            >
              Move Right
            </button>
          </div>
          <div style={{ marginTop: 8 }}>
            <label className={styles.label}>Jump to position</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {agents.map((a, i) => (
                <button
                  key={a.id}
                  className={styles.cancelBtn}
                  style={{
                    padding: "4px 10px",
                    fontSize: 11,
                    background: columnOrder[i] === agent.id ? accent + "22" : undefined,
                    borderColor: columnOrder[i] === agent.id ? accent + "55" : undefined,
                    color: columnOrder[i] === agent.id ? accent : undefined,
                  }}
                  onClick={() => {
                    const order = columnOrder.filter((id) => id !== agent.id);
                    order.splice(i, 0, agent.id);
                    useDeckStore.getState().reorderColumns(order);
                  }}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Column Width */}
        <div className={styles.field}>
          <label className={styles.label}>
            Column Width ({colWidth === 0 ? "default" : `${colWidth}px`})
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <input
              type="range"
              min={280}
              max={800}
              step={10}
              value={colWidth || 400}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setColWidth(v);
                setColumnWidth(agent.id, v);
              }}
              style={{ flex: 1, accentColor: accent }}
            />
            <button
              className={styles.cancelBtn}
              style={{ padding: "3px 8px", fontSize: 10 }}
              onClick={() => {
                setColWidth(0);
                setColumnWidth(agent.id, 0);
              }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Session Selector */}
        <div className={styles.field}>
          <label className={styles.label}>Active Session</label>
          {loadingSessions ? (
            <div style={{ fontSize: 12, color: "var(--theme-textMuted)", padding: "8px 0" }}>
              Loading sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--theme-textMuted)", padding: "8px 0" }}>
              No sessions found for this agent
            </div>
          ) : (
            <div
              style={{
                maxHeight: 200,
                overflowY: "auto",
                border: "1px solid var(--theme-border)",
                borderRadius: 6,
                marginTop: 4,
              }}
            >
              {sessions.map((s) => {
                const isActive = s.key === currentSessionKey;
                return (
                  <button
                    key={s.key}
                    onClick={() => handleSessionSelect(s.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      padding: "7px 10px",
                      border: "none",
                      borderBottom: "1px solid var(--theme-border)",
                      background: isActive ? accent + "15" : "transparent",
                      color: isActive ? accent : "var(--theme-text)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 12,
                      fontFamily: "'DM Sans', sans-serif",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = "var(--theme-inputBg)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isActive ? accent + "15" : "transparent";
                    }}
                  >
                    {isActive && (
                      <span style={{ marginRight: 6, fontSize: 10 }}>●</span>
                    )}
                    {channelBadge(s.channel)}
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.label}
                    </span>
                    {s.updatedAt > 0 && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--theme-textMuted)",
                          marginLeft: 8,
                          flexShrink: 0,
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {new Date(s.updatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.createBtn} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
