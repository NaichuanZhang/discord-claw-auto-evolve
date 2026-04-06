import React, { useState, useEffect } from "react";
import { apiFetch, relativeTime, C, S } from "../App";

// ── Soul Editor ──────────────────────────────────────────────────────

function SoulEditor() {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch<{ content: string }>("/api/soul")
      .then((d) => setContent(d.content))
      .catch((e) => setError(e.message));
  }, []);

  const save = () => {
    setSaving(true);
    setSaved(false);
    apiFetch("/api/soul", {
      method: "PUT",
      body: JSON.stringify({ content }),
    })
      .then(() => {
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch((e) => {
        setSaving(false);
        setError(e.message);
      });
  };

  return (
    <div style={S.card}>
      <h3 style={S.h3}>Soul Editor (SOUL.md)</h3>
      {error && (
        <div style={{ color: C.error, fontSize: 13, marginBottom: 8 }}>
          {error}
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={16}
        style={{ ...S.textarea, minHeight: 300 }}
      />
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <button
          style={{ ...S.btnSuccess, opacity: saving ? 0.6 : 1 }}
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving..." : "Save Soul"}
        </button>
        {saved && (
          <span style={{ color: C.success, fontSize: 12 }}>Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Memory Browser ───────────────────────────────────────────────────

interface MemFile {
  path: string;
  size: number;
  mtime: string;
}

function MemoryBrowser() {
  const [files, setFiles] = useState<MemFile[]>([]);
  const [error, setError] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch<{ files: MemFile[] }>("/api/memory")
      .then((d) => setFiles(d.files))
      .catch((e) => setError(e.message));
  }, []);

  const openFile = (path: string) => {
    if (selectedPath === path) {
      setSelectedPath(null);
      return;
    }
    setSelectedPath(path);
    apiFetch<{ path: string; content: string }>(
      `/api/memory/${encodeURIComponent(path)}`,
    )
      .then((d) => setFileContent(d.content))
      .catch((e) => setError(e.message));
  };

  const saveFile = () => {
    if (!selectedPath) return;
    setSaving(true);
    setSaved(false);
    apiFetch(`/api/memory/${encodeURIComponent(selectedPath)}`, {
      method: "PUT",
      body: JSON.stringify({ content: fileContent }),
    })
      .then(() => {
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch((e) => {
        setSaving(false);
        setError(e.message);
      });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div style={S.card}>
      <h3 style={S.h3}>Memory Browser</h3>
      {error && (
        <div style={{ color: C.error, fontSize: 13, marginBottom: 8 }}>
          {error}
        </div>
      )}

      {files.length === 0 ? (
        <div style={{ color: C.textDim, fontSize: 13 }}>No memory files</div>
      ) : (
        <div>
          {files.map((f) => (
            <div key={f.path}>
              <div
                onClick={() => openFile(f.path)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 4,
                  cursor: "pointer",
                  background:
                    selectedPath === f.path ? C.primary + "33" : "transparent",
                  fontSize: 13,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                  {f.path}
                </span>
                <span style={{ color: C.textDim, fontSize: 11 }}>
                  {formatSize(f.size)} &middot; {relativeTime(f.mtime)}
                </span>
              </div>

              {selectedPath === f.path && (
                <div style={{ padding: "8px 0" }}>
                  <textarea
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    rows={10}
                    style={S.textarea}
                  />
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <button
                      style={{ ...S.btn, opacity: saving ? 0.6 : 1 }}
                      disabled={saving}
                      onClick={saveFile}
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    {saved && (
                      <span style={{ color: C.success, fontSize: 12 }}>
                        Saved
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Global Config ────────────────────────────────────────────────────

function GlobalConfig() {
  const [config, setConfig] = useState<Record<string, any>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  const load = () => {
    apiFetch<Record<string, any>>("/api/config")
      .then((d) => {
        setConfig(d);
        setError("");
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const updateKey = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const removeKey = (key: string) => {
    setConfig((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addKey = () => {
    if (!newKey.trim()) return;
    setConfig((prev) => ({ ...prev, [newKey.trim()]: newVal }));
    setNewKey("");
    setNewVal("");
  };

  const save = () => {
    setSaving(true);
    setSaved(false);
    apiFetch("/api/config", {
      method: "PUT",
      body: JSON.stringify(config),
    })
      .then(() => {
        setSaving(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch((e) => {
        setSaving(false);
        setError(e.message);
      });
  };

  const entries = Object.entries(config);

  return (
    <div style={S.card}>
      <h3 style={S.h3}>Global Config</h3>
      {error && (
        <div style={{ color: C.error, fontSize: 13, marginBottom: 8 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        {entries.map(([key, val]) => (
          <div
            key={key}
            style={{ display: "flex", gap: 8, alignItems: "center" }}
          >
            <input
              value={key}
              readOnly
              style={{
                ...S.input,
                width: 180,
                fontSize: 12,
                fontFamily: "monospace",
                opacity: 0.8,
              }}
            />
            <input
              value={String(val)}
              onChange={(e) => updateKey(key, e.target.value)}
              style={{ ...S.input, flex: 1, fontSize: 12 }}
            />
            <button style={S.btnDanger} onClick={() => removeKey(key)}>
              X
            </button>
          </div>
        ))}
      </div>

      {/* Add new key */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          paddingTop: 8,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        <input
          placeholder="key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          style={{ ...S.input, width: 180, fontSize: 12 }}
        />
        <input
          placeholder="value"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          style={{ ...S.input, flex: 1, fontSize: 12 }}
        />
        <button style={S.btnSmall} onClick={addKey}>
          Add
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          style={{ ...S.btnSuccess, opacity: saving ? 0.6 : 1 }}
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving..." : "Save Config"}
        </button>
        {saved && (
          <span style={{ color: C.success, fontSize: 12 }}>Saved</span>
        )}
      </div>
    </div>
  );
}

// ── Config Page ──────────────────────────────────────────────────────

export default function Config() {
  return (
    <div>
      <h2 style={S.h2}>Config</h2>
      <SoulEditor />
      <MemoryBrowser />
      <GlobalConfig />
    </div>
  );
}
