import React, { useState, useEffect } from "react";
import { apiFetch, relativeTime, C, S } from "../App";

interface Session {
  id: string;
  discordKey: string;
  guildId: string;
  guildName?: string;
  lastActive: string;
  messageCount?: number;
}

interface Message {
  role: string;
  content: string;
  timestamp: string;
}

const PAGE_SIZE = 20;

export default function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);

  const load = (off: number) => {
    apiFetch<{ sessions: Session[]; total: number }>(
      `/api/sessions?limit=${PAGE_SIZE}&offset=${off}`,
    )
      .then((d) => {
        setSessions(d.sessions);
        setTotal(d.total);
        setError("");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load(offset);
  }, [offset]);

  const handleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setMessages([]);
      return;
    }
    setExpandedId(id);
    setMsgLoading(true);
    apiFetch<{ session: Session; messages: Message[] }>(`/api/sessions/${id}`)
      .then((d) => {
        setMessages(d.messages);
        setMsgLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setMsgLoading(false);
      });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this session?")) return;
    apiFetch(`/api/sessions/${id}`, { method: "DELETE" })
      .then(() => {
        if (expandedId === id) {
          setExpandedId(null);
          setMessages([]);
        }
        load(offset);
      })
      .catch((e) => setError(e.message));
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div>
      <h2 style={S.h2}>Sessions</h2>

      {error && (
        <div style={{ ...S.card, color: C.error, fontSize: 13 }}>{error}</div>
      )}

      <div style={S.card}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <span style={{ color: C.textDim, fontSize: 13 }}>
            {total} session{total !== 1 ? "s" : ""}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              style={{ ...S.btnSmall, opacity: offset === 0 ? 0.4 : 1 }}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Prev
            </button>
            <span style={{ fontSize: 12, color: C.textDim, lineHeight: "24px" }}>
              {currentPage} / {totalPages || 1}
            </span>
            <button
              style={{
                ...S.btnSmall,
                opacity: offset + PAGE_SIZE >= total ? 0.4 : 1,
              }}
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </div>

        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>ID</th>
              <th style={S.th}>Discord Key</th>
              <th style={S.th}>Guild</th>
              <th style={S.th}>Last Active</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <React.Fragment key={s.id}>
                <tr>
                  <td
                    style={{
                      ...S.td,
                      fontFamily: "monospace",
                      fontSize: 12,
                    }}
                  >
                    {s.id.slice(0, 12)}...
                  </td>
                  <td style={{ ...S.td, fontSize: 12 }}>{s.discordKey}</td>
                  <td style={S.td}>{s.guildName || s.guildId}</td>
                  <td style={{ ...S.td, color: C.textDim }}>
                    {relativeTime(s.lastActive)}
                  </td>
                  <td style={S.td}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        style={S.btnSmall}
                        onClick={() => handleExpand(s.id)}
                      >
                        {expandedId === s.id ? "Close" : "View"}
                      </button>
                      <button
                        style={S.btnDanger}
                        onClick={() => handleDelete(s.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Expanded messages */}
                {expandedId === s.id && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{
                        padding: "12px",
                        background: C.bg,
                        borderBottom: `1px solid ${C.border}`,
                      }}
                    >
                      {msgLoading ? (
                        <div style={{ color: C.textDim, fontSize: 13 }}>
                          Loading messages...
                        </div>
                      ) : messages.length === 0 ? (
                        <div style={{ color: C.textDim, fontSize: 13 }}>
                          No messages
                        </div>
                      ) : (
                        <div
                          style={{
                            maxHeight: 400,
                            overflowY: "auto",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          {messages.map((m, i) => (
                            <div
                              key={i}
                              style={{
                                padding: "6px 10px",
                                borderRadius: 4,
                                background:
                                  m.role === "assistant"
                                    ? C.primary + "33"
                                    : C.accent + "22",
                                fontSize: 13,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  color: C.textDim,
                                  marginBottom: 2,
                                }}
                              >
                                <strong
                                  style={{
                                    color:
                                      m.role === "assistant"
                                        ? C.success
                                        : C.warning,
                                  }}
                                >
                                  {m.role}
                                </strong>
                                {m.timestamp && (
                                  <span style={{ marginLeft: 8 }}>
                                    {relativeTime(m.timestamp)}
                                  </span>
                                )}
                              </div>
                              <div
                                style={{
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                }}
                              >
                                {m.content}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{ ...S.td, color: C.textDim, textAlign: "center" }}
                >
                  No sessions found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
