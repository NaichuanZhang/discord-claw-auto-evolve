import React, { useState, useEffect } from "react";
import { apiFetch, formatDuration, C, S } from "../App";

interface Guild {
  id: string;
  name: string;
  memberCount: number;
  channelCount: number;
}

interface StatusData {
  online: boolean;
  guilds: Guild[];
  uptime: number;
  memoryUsage: { rss: number; heapUsed: number };
}

export default function Status() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    apiFetch<StatusData>("/api/status")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 10_000);
    return () => clearInterval(iv);
  }, []);

  if (error && !data) {
    return (
      <div>
        <h2 style={S.h2}>Status</h2>
        <div style={{ ...S.card, color: C.error }}>{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <h2 style={S.h2}>Status</h2>
        <div style={{ ...S.card, color: C.textDim }}>Loading...</div>
      </div>
    );
  }

  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + " MB";

  return (
    <div>
      <h2 style={S.h2}>Status</h2>

      {error && (
        <div
          style={{
            ...S.badge(C.warning),
            marginBottom: 12,
            display: "inline-block",
          }}
        >
          refresh error: {error}
        </div>
      )}

      {/* Online indicator + uptime */}
      <div style={{ ...S.card, display: "flex", gap: 32, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: data.online ? C.success : C.error,
            }}
          />
          <span style={{ fontWeight: 600 }}>
            {data.online ? "Online" : "Offline"}
          </span>
        </div>
        <div>
          <span style={{ color: C.textDim, fontSize: 12, marginRight: 6 }}>
            Uptime
          </span>
          <span style={{ fontWeight: 600 }}>{formatDuration(data.uptime)}</span>
        </div>
        <div>
          <span style={{ color: C.textDim, fontSize: 12, marginRight: 6 }}>
            RSS
          </span>
          <span style={{ fontWeight: 600 }}>{mb(data.memoryUsage.rss)}</span>
        </div>
        <div>
          <span style={{ color: C.textDim, fontSize: 12, marginRight: 6 }}>
            Heap
          </span>
          <span style={{ fontWeight: 600 }}>
            {mb(data.memoryUsage.heapUsed)}
          </span>
        </div>
      </div>

      {/* Guilds */}
      <div style={S.card}>
        <h3 style={S.h3}>
          Guilds ({data.guilds.length})
        </h3>
        {data.guilds.length === 0 ? (
          <div style={{ color: C.textDim, fontSize: 13 }}>
            No guilds connected
          </div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Name</th>
                <th style={S.th}>ID</th>
                <th style={S.th}>Members</th>
                <th style={S.th}>Channels</th>
              </tr>
            </thead>
            <tbody>
              {data.guilds.map((g) => (
                <tr key={g.id}>
                  <td style={S.td}>{g.name}</td>
                  <td style={{ ...S.td, fontFamily: "monospace", fontSize: 12 }}>
                    {g.id}
                  </td>
                  <td style={S.td}>{g.memberCount.toLocaleString()}</td>
                  <td style={S.td}>{g.channelCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
