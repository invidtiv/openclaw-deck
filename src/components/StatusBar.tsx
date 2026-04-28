import { useState, useEffect } from "react";
import { useDeckStats } from "../hooks";
import { useDeckStore } from "../lib/store";
import { ThemeSwitcher } from "./ThemeSwitcher";
import styles from "./StatusBar.module.css";

export function StatusBar() {
  const stats = useDeckStats();
  const gatewayUrl = useDeckStore((s) => s.config.gatewayUrl);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={styles.bar}>
      <span>
        {gatewayUrl}{" "}
        <span
          className={
            !stats.gatewayConnected
              ? styles.disconnected
              : stats.waitingForUser > 0
                ? styles.connectedReady
                : styles.connectedIdle
          }
        >
          {!stats.gatewayConnected
            ? "disconnected"
            : stats.waitingForUser > 0
              ? "connected · waiting"
              : "connected"}
        </span>
      </span>
      <span className={styles.sep}>·</span>
      <span>
        {stats.totalAgents} agents · {stats.active} active
        {stats.waitingForUser > 0 && <> · {stats.waitingForUser} waiting</>}
        {stats.errors > 0 && <> · <span className={styles.error}>{stats.errors} {stats.errors === 1 ? "error" : "errors"}</span></>}
      </span>
      <span className={styles.spacer} />
      <span className={styles.footerStat}>
        tokens: {stats.totalTokens.toLocaleString()}
      </span>
      <span className={styles.sep}>·</span>
      <ThemeSwitcher />
      <span className={styles.sep}>·</span>
      <span className={styles.footerStat}>
        {time.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })}
      </span>
      <span className={styles.sep}>·</span>
      <span>openclaw-deck v2026.2.9</span>
    </div>
  );
}
