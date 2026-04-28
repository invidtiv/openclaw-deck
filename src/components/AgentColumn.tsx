import { useCallback, useEffect, useRef as useReactRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import {
  useAgentSession,
  useAgentConfig,
  useSendMessage,
  useAutoScroll,
} from "../hooks";
import { useDeckStore } from "../lib/store";
import { AgentSettingsModal } from "./AgentSettingsModal";
import { VoiceRecordButton } from "./VoiceRecordButton";
import type { AgentStatus, ChatMessage, AgentSession } from "../types";
import styles from "./AgentColumn.module.css";

interface SessionOption {
  key: string;
  label: string;
  channel: string;
  updatedAt: number;
}

// ─── Status Indicator ───

function StatusBadge({
  status,
  accent,
}: {
  status: AgentStatus;
  accent: string;
}) {
  const color =
    status === "streaming" || status === "thinking" || status === "tool_use"
      ? accent
      : status === "error"
        ? "#ef4444"
        : status === "disconnected"
          ? "#6b7280"
          : "rgba(255,255,255,0.25)";

  const label =
    status === "tool_use" ? "tool use" : status;

  const isActive =
    status === "streaming" || status === "thinking" || status === "tool_use";

  return (
    <div className={styles.statusBadge}>
      <div
        className={isActive ? styles.statusDotPulse : styles.statusDot}
        style={{ backgroundColor: color }}
      />
      <span className={styles.statusLabel} style={{ color }}>
        {label}
      </span>
    </div>
  );
}

// ─── Message Bubble ───

function MessageBubble({
  message,
  accent,
}: {
  message: ChatMessage;
  accent: string;
}) {
  const isUser = message.role === "user";

  if (message.thinking) {
    return (
      <div className={styles.thinkingBubble}>
        <span className={styles.thinkingDot} style={{ color: accent }}>
          ●
        </span>
        <span style={{ color: accent }}>{message.text}</span>
      </div>
    );
  }

  if (message.toolUse) {
    return (
      <div className={styles.toolBubble}>
        <span className={styles.toolIcon}>⚙</span>
        <span>
          {message.toolUse.name}
          {message.toolUse.status === "running" && (
            <span className={styles.thinkingDot}> ...</span>
          )}
        </span>
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <div className={`${styles.messageBubble} ${styles.assistantMsg}`}>
        <div className={styles.roleLabel} style={{ color: "#ef4444" }}>System</div>
        <div className={styles.messageText} style={{ color: "#ef4444", opacity: 0.9 }}>
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.messageBubble} ${
        isUser ? styles.userMsg : styles.assistantMsg
      }`}
    >
      {isUser && <div className={styles.roleLabel}>You</div>}
      {!isUser && <div className={styles.roleLabel}>Assistant</div>}
      <div
        className={styles.messageText}
        style={
          isUser
            ? undefined
            : { borderLeft: `2px solid ${accent}33`, paddingLeft: 12 }
        }
      >
        {isUser ? (
          message.text
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              a: ({ node, ...props }) => (
                <a {...props} target="_blank" rel="noopener noreferrer" />
              ),
            }}
          >
            {message.text}
          </ReactMarkdown>
        )}
        {message.streaming && (
          <span className={styles.cursor} style={{ backgroundColor: accent }} />
        )}
      </div>
    </div>
  );
}

// ─── Compaction Divider ───

function CompactionDivider({ message }: { message: ChatMessage }) {
  const c = message.compaction;
  if (!c) return null;

  return (
    <div className={styles.compactionDivider}>
      <div className={styles.compactionLine} />
      <span className={styles.compactionLabel}>
        context compacted &middot; {c.droppedMessages} msgs dropped &middot;{" "}
        {c.beforeTokens.toLocaleString()} &rarr; {c.afterTokens.toLocaleString()} tokens
      </span>
      <div className={styles.compactionLine} />
    </div>
  );
}

// ─── Failover Badge ───

function FailoverBadge({ session }: { session: AgentSession }) {
  const failover = session.usage?.failover;
  if (!failover) return null;

  return (
    <span className={styles.failoverBadge} title={failover.reason}>
      failover: {failover.from} &rarr; {failover.to}
    </span>
  );
}

function SessionPicker({
  agentId,
  accent,
  currentSessionKey,
}: {
  agentId: string;
  accent: string;
  currentSessionKey: string;
}) {
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [loading, setLoading] = useState(false);
  const listAgentSessions = useDeckStore((s) => s.listAgentSessions);
  const setAgentSessionKey = useDeckStore((s) => s.setAgentSessionKey);
  const gatewayConnected = useDeckStore((s) => s.gatewayConnected);

  useEffect(() => {
    if (!gatewayConnected) return;
    let cancelled = false;
    setLoading(true);
    listAgentSessions(agentId)
      .then((result) => {
        if (!cancelled) setSessions(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agentId, gatewayConnected, listAgentSessions]);

  const options = sessions.some((s) => s.key === currentSessionKey)
    ? sessions
    : [
        {
          key: currentSessionKey,
          label: currentSessionKey.split(":").slice(2).join(":") || "Current session",
          channel: "",
          updatedAt: 0,
        },
        ...sessions,
      ];

  return (
    <select
      className={styles.sessionSelect}
      value={currentSessionKey}
      disabled={loading || options.length === 0}
      title="Continue from session"
      onChange={(e) => {
        void setAgentSessionKey(agentId, e.target.value);
      }}
      style={{ borderColor: `${accent}44` }}
    >
      {loading && options.length === 0 ? (
        <option value={currentSessionKey}>Loading sessions...</option>
      ) : (
        options.map((s) => (
          <option key={s.key} value={s.key}>
            {s.channel ? `${s.channel}: ${s.label}` : s.label}
          </option>
        ))
      )}
    </select>
  );
}

// ─── Main Column ───

export function AgentColumn({
  agentId,
  columnIndex,
  popOut = false,
  onPopOut,
  onPopIn,
  columnWidth,
  onResize,
}: {
  agentId: string;
  columnIndex: number;
  popOut?: boolean;
  onPopOut?: (agentId: string) => void;
  onPopIn?: () => void;
  columnWidth?: number;
  onResize?: (agentId: string, width: number) => void;
}) {
  const session = useAgentSession(agentId);
  const config = useAgentConfig(agentId);
  const send = useSendMessage(agentId);
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useAutoScroll(session?.messages);
  const columnRef = useReactRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!onResize || !columnRef.current) return;
    setResizing(true);
    const startX = e.clientX;
    const startWidth = columnRef.current.getBoundingClientRect().width;

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.max(280, Math.min(800, startWidth + ev.clientX - startX));
      onResize(agentId, newWidth);
    };

    const onMouseUp = () => {
      setResizing(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [agentId, onResize]);

  if (!config || !session) return null;

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    send(text);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Tab") {
      const offset = e.shiftKey ? -1 : 1;
      const next = document.querySelector<HTMLTextAreaElement>(
        `[data-deck-input="${columnIndex + offset}"]`
      );
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  };

  const isActive =
    session.status === "streaming" ||
    session.status === "thinking" ||
    session.status === "tool_use";

  // Determine if agent has completed work ready to review
  const lastMessage = session.messages[session.messages.length - 1];
  const hasCompletedWork = 
    session.status === "idle" &&
    session.messages.length > 0 &&
    lastMessage?.role === "assistant" &&
    !lastMessage?.streaming;
  const currentSessionKey = session.sessionKey || `agent:${agentId}:deck-${agentId}`;

  const columnContent = (
    <>
      {/* Header */}
      <div className={styles.header}>
        <div
          className={styles.agentIcon}
          style={{
            color: config.accent,
            backgroundColor: `${config.accent}15`,
            borderColor: `${config.accent}30`,
          }}
        >
          {columnIndex + 1}
        </div>
        <div className={styles.headerInfo}>
          <div className={styles.headerRow}>
            <span className={styles.agentName}>{config.name}</span>
            <StatusBadge status={session.status} accent={config.accent} />
          </div>
          <div className={styles.headerMeta}>
            <span style={{ color: config.accent, opacity: 0.6 }}>
              {session.usage?.model
                ? `${session.usage.model}${session.usage.failover ? ` (from ${session.usage.failover.from})` : ""}`
                : config.model || "default model"}
            </span>
            <FailoverBadge session={session} />
          </div>
          <SessionPicker
            agentId={agentId}
            accent={config.accent}
            currentSessionKey={currentSessionKey}
          />
        </div>
        <div className={styles.headerActions}>
          {!popOut && onPopOut && (
            <button className={styles.headerBtn} title="Pop out" onClick={() => onPopOut(agentId)}>
              ⇱
            </button>
          )}
          {popOut && onPopIn && (
            <button className={styles.headerBtn} title="Pop back in" onClick={onPopIn}>
              ⇲
            </button>
          )}
          <button className={styles.headerBtn} title="Settings" onClick={() => setShowSettings(true)}>
            ⚙
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className={styles.messages}>
        {session.messages.length === 0 && (
          <div className={styles.emptyState}>
            <div
              className={styles.emptyIcon}
              style={{ color: config.accent }}
            >
              {columnIndex + 1}
            </div>
            <p>Send a message to start a conversation with {config.name}</p>
          </div>
        )}
        {session.messages.map((msg) =>
          msg.role === "compaction" ? (
            <CompactionDivider key={msg.id} message={msg} />
          ) : (
            <MessageBubble key={msg.id} message={msg} accent={config.accent} />
          )
        )}
      </div>

      {/* Input */}
      <div className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${config.name}...`}
            className={styles.input}
            data-deck-input={columnIndex}
            autoComplete="off"
            autoCapitalize="off"
            rows={4}
          />
          <VoiceRecordButton
            accent={config.accent}
            onTranscript={(text) => setInput(text)}
            onSendAudio={(_base64, _mime, transcript) => {
              if (transcript && transcript !== "[voice message]") {
                send(transcript);
              }
            }}
          />
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim()}
            style={
              input.trim()
                ? { backgroundColor: config.accent, color: "#000" }
                : undefined
            }
          >
            ↑
          </button>
        </div>
        {isActive && (
          <div
            className={styles.streamingBar}
            style={{ backgroundColor: config.accent }}
          />
        )}
      </div>

      {showSettings && (
        <AgentSettingsModal
          agent={config}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );

  if (popOut) {
    return (
      <div className={styles.popOutOverlay} onClick={onPopIn}>
        <div
          className={`${styles.column} ${styles.popOutColumn}`}
          data-status={session.status}
          onClick={(e) => e.stopPropagation()}
        >
          {columnContent}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={columnRef}
      className={`${styles.column} ${resizing ? styles.columnResizing : ""}`}
      data-status={session.status}
      data-has-completed-work={hasCompletedWork}
      style={columnWidth ? { minWidth: columnWidth, maxWidth: columnWidth } : undefined}
    >
      {columnContent}
      {!popOut && onResize && (
        <div className={styles.resizeHandle} onMouseDown={handleResizeStart} />
      )}
    </div>
  );
}
