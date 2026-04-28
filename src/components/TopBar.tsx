import { useState, useEffect, useRef } from "react";
import { useDeckStats } from "../hooks";
import { useDeckStore } from "../lib/store";
import styles from "./TopBar.module.css";

const BUILT_IN_TABS = ["All Agents", "Active", "Queued", "Completed", "Selected"] as const;

function SelectedDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const agents = useDeckStore((s) => s.config.agents);
  const selectedAgents = useDeckStore((s) => s.selectedAgents);
  const toggleSelectedAgent = useDeckStore((s) => s.toggleSelectedAgent);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={styles.dropdownBtn} onClick={() => setOpen(!open)}>
        {selectedAgents.size}/{agents.length} ▾
      </button>
      {open && (
        <div className={styles.dropdown}>
          {agents.map((a) => (
            <label key={a.id} className={styles.dropdownItem}>
              <input
                type="checkbox"
                checked={selectedAgents.has(a.id)}
                onChange={() => toggleSelectedAgent(a.id)}
              />
              <span
                className={styles.dropdownDot}
                style={{ backgroundColor: a.accent }}
              />
              {a.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function SquadDropdown({ squadId }: { squadId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const agents = useDeckStore((s) => s.config.agents);
  const squad = useDeckStore((s) => s.squads.find((sq) => sq.id === squadId));
  const toggleAgentInSquad = useDeckStore((s) => s.toggleAgentInSquad);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!squad) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={styles.dropdownBtn} onClick={() => setOpen(!open)}>
        {squad.agentIds.length}/{agents.length} ▾
      </button>
      {open && (
        <div className={styles.dropdown}>
          {agents.map((a) => (
            <label key={a.id} className={styles.dropdownItem}>
              <input
                type="checkbox"
                checked={squad.agentIds.includes(a.id)}
                onChange={() => toggleAgentInSquad(squadId, a.id)}
              />
              <span
                className={styles.dropdownDot}
                style={{ backgroundColor: a.accent }}
              />
              {a.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateSquadButton({ onCreated }: { onCreated: (tabId: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const createSquad = useDeckStore((s) => s.createSquad);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setEditing(false);
      return;
    }
    const id = createSquad(trimmed);
    setName("");
    setEditing(false);
    onCreated(id);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={styles.squadInput}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") { setEditing(false); setName(""); }
        }}
        onBlur={handleCreate}
        placeholder="Squad name..."
      />
    );
  }

  return (
    <button className={styles.squadCreateBtn} onClick={() => setEditing(true)} title="Create squad">
      + Squad
    </button>
  );
}

export function TopBar({
  activeTab,
  onTabChange,
  onAddAgent,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onAddAgent: () => void;
}) {
  const stats = useDeckStats();
  const selectedCount = useDeckStore((s) => s.selectedAgents.size);
  const squads = useDeckStore((s) => s.squads);
  const deleteSquad = useDeckStore((s) => s.deleteSquad);
  const renameSquad = useDeckStore((s) => s.renameSquad);
  const [renamingSquadId, setRenamingSquadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingSquadId) renameRef.current?.focus();
  }, [renamingSquadId]);

  const activeSquad = squads.find((s) => s.id === activeTab);

  return (
    <div className={styles.bar}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon}>◈</div>
        <span className={styles.logoText}>OpenClaw</span>
        <span className={styles.logoBadge}>DECK</span>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {BUILT_IN_TABS.map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
            onClick={() => onTabChange(tab)}
          >
            {tab}
            {tab === "All Agents" && (
              <span className={styles.tabCount}>{stats.totalAgents}</span>
            )}
            {tab === "Active" && stats.active > 0 && (
              <span className={styles.tabCount}>{stats.active}</span>
            )}
            {tab === "Selected" && selectedCount > 0 && (
              <span className={styles.tabCount}>{selectedCount}</span>
            )}
          </button>
        ))}
        {activeTab === "Selected" && <SelectedDropdown />}

        {/* Divider between built-in tabs and squads */}
        {squads.length > 0 && <div className={styles.tabDivider} />}

        {/* Squad tabs */}
        {squads.map((squad) => (
          <div key={squad.id} className={styles.squadTabWrapper}>
            {renamingSquadId === squad.id ? (
              <input
                ref={renameRef}
                className={styles.squadInput}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (renameValue.trim()) renameSquad(squad.id, renameValue.trim());
                    setRenamingSquadId(null);
                  }
                  if (e.key === "Escape") setRenamingSquadId(null);
                }}
                onBlur={() => {
                  if (renameValue.trim()) renameSquad(squad.id, renameValue.trim());
                  setRenamingSquadId(null);
                }}
              />
            ) : (
              <button
                className={`${styles.tab} ${styles.squadTab} ${activeTab === squad.id ? styles.tabActive : ""}`}
                onClick={() => onTabChange(squad.id)}
                onDoubleClick={() => {
                  setRenamingSquadId(squad.id);
                  setRenameValue(squad.name);
                }}
              >
                {squad.name}
                <span className={styles.tabCount}>{squad.agentIds.length}</span>
              </button>
            )}
            {activeTab === squad.id && (
              <button
                className={styles.squadDeleteBtn}
                onClick={() => {
                  deleteSquad(squad.id);
                  onTabChange("All Agents");
                }}
                title="Delete squad"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {activeTab && activeSquad && <SquadDropdown squadId={activeSquad.id} />}

        <CreateSquadButton onCreated={(id) => onTabChange(id)} />
      </div>

      {/* Stats - just streaming indicator */}
      <div className={styles.stats}>
        <div className={styles.stat}>
          <div
            className={styles.statDot}
            style={{
              backgroundColor: stats.gatewayConnected ? "#34d399" : "#ef4444",
            }}
          />
          <span>
            <span
              style={{
                color: stats.gatewayConnected ? "#34d399" : "#ef4444",
              }}
            >
              {stats.active}
            </span>{" "}
            streaming
          </span>
        </div>
      </div>

      <button className={styles.addBtn} onClick={onAddAgent}>
        <span>+</span> New Agent
      </button>
    </div>
  );
}
