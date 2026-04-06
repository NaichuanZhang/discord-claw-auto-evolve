import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, S } from "../App";

interface LogEntry {
  timestamp: string;
  message: string;
  level?: string;
  [key: string]: any;
}

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/logs`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        const entry: LogEntry =
          typeof data === "string"
            ? { timestamp: new Date().toISOString(), message: data }
            : {
                timestamp: data.timestamp || new Date().toISOString(),
                message:
                  data.message || data.msg || data.content || JSON.stringify(data),
                level: data.level,
                ...data,
              };
        setLogs((prev) => [...prev, entry]);
      } catch {
        setLogs((prev) => [
          ...prev,
          { timestamp: new Date().toISOString(), message: ev.data },
        ]);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  };

  const clear = () => setLogs([]);

  const filtered = filter
    ? logs.filter((l) =>
        l.message.toLowerCase().includes(filter.toLowerCase()),
      )
    : logs;

  const levelColor = (level?: string) => {
    if (!level) return C.text;
    const l = level.toLowerCase();
    if (l === "error" || l === "fatal") return C.error;
    if (l === "warn" || l === "warning") return C.warning;
    if (l === "debug" || l === "trace") return C.textDim;
    return C.text;
  };

  const formatTs = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
    } catch {
      return iso;
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 48px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ ...S.h2, marginBottom: 0 }}>Logs</h2>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: connected ? C.success : C.error,
              }}
            />
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            style={{ ...S.input, width: 200, fontSize: 12 }}
          />
          <button style={S.btnSmall} onClick={clear}>
            Clear
          </button>
          <span style={{ fontSize: 11, color: C.textDim }}>
            {filtered.length} entries
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          background: C.surface,
          borderRadius: 6,
          padding: 12,
          overflowY: "auto",
          fontFamily: "monospace",
          fontSize: 12,
          lineHeight: 1.7,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: C.textDim }}>
            {logs.length === 0
              ? "Waiting for log messages..."
              : "No matches for filter"}
          </div>
        ) : (
          filtered.map((entry, i) => (
            <div
              key={i}
              style={{
                borderBottom: `1px solid ${C.border}22`,
                padding: "2px 0",
                display: "flex",
                gap: 10,
              }}
            >
              <span style={{ color: C.textDim, flexShrink: 0 }}>
                {formatTs(entry.timestamp)}
              </span>
              {entry.level && (
                <span
                  style={{
                    color: levelColor(entry.level),
                    fontWeight: 600,
                    width: 42,
                    flexShrink: 0,
                    textTransform: "uppercase",
                  }}
                >
                  {entry.level.slice(0, 5)}
                </span>
              )}
              <span
                style={{
                  color: levelColor(entry.level),
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>

      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (containerRef.current) {
              containerRef.current.scrollTop =
                containerRef.current.scrollHeight;
            }
          }}
          style={{
            ...S.btnSmall,
            position: "fixed",
            bottom: 24,
            right: 24,
            background: C.accent,
            padding: "6px 14px",
            zIndex: 10,
          }}
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}
