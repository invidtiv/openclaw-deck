import { useState, type KeyboardEvent } from "react";
import type { AgentConfig } from "../types";
import { useDeckStore } from "../lib/store";
import styles from "./AddAgentModal.module.css";

const ACCENTS = [
  "#22d3ee", "#a78bfa", "#34d399", "#fb923c",
  "#f472b6", "#facc15", "#60a5fa", "#ef4444",
];

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
  const updateAgentConfig = useDeckStore((s) => s.updateAgentConfig);
  const moveColumn = useDeckStore((s) => s.moveColumn);
  const columnOrder = useDeckStore((s) => s.columnOrder);
  const agents = useDeckStore((s) => s.config.agents);

  const currentIndex = columnOrder.indexOf(agent.id);
  const totalColumns = columnOrder.length;

  const handleSave = () => {
    updateAgentConfig(agent.id, { name, icon, accent });
    onClose();
  };

  const handleMove = (direction: "left" | "right") => {
    moveColumn(agent.id, direction);
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
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
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
