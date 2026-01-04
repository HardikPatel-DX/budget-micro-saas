import { useMemo, useState } from "react";

type ImportResult = {
  ok: boolean;
  status: number;
  data?: any;
  error?: string;
};

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const canSubmit = useMemo(() => {
    return !!file && apiKey.trim().length > 0 && !busy;
  }, [file, apiKey, busy]);

  async function onUpload() {
    if (!file) return;

    setBusy(true);
    setResult(null);

    try {
      const text = await file.text();

      // MVP assumption: CSV file content gets posted as raw text.
      // If your /api/import expects different shape, we will adapt after we see the error response.
      const res = await fetch("/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
        },
        body: JSON.stringify({
          filename: file.name,
          content: text,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await res.json()
        : await res.text();

      if (!res.ok) {
        setResult({
          ok: false,
          status: res.status,
          error: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
          data: typeof payload === "string" ? undefined : payload,
        });
        return;
      }

      setResult({ ok: true, status: res.status, data: payload });
    } catch (e: any) {
      setResult({ ok: false, status: 0, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, Arial" }}>
      <h1 style={{ marginBottom: 8 }}>Upload statement (CSV)</h1>
      <p style={{ marginTop: 0, color: "#444" }}>
        MVP: upload a CSV file and send it to <code>/api/import</code>.
      </p>

      <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16, marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>CSV file</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          {file ? (
            <div style={{ marginTop: 8, fontSize: 13, color: "#333" }}>
              Selected: <b>{file.name}</b> ({Math.round(file.size / 1024)} KB)
            </div>
          ) : null}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>IMPORT_API_KEY</label>
          <input
            type="password"
            placeholder="Paste your IMPORT_API_KEY"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />
          <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
            This is only for MVP testing. We will remove this once Auth is enforced.
          </div>
        </div>

        <button
          onClick={onUpload}
          disabled={!canSubmit}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: canSubmit ? "#111" : "#999",
            color: "#fff",
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
        >
          {busy ? "Uploading..." : "Upload and import"}
        </button>
      </section>

      {result ? (
        <section style={{ marginTop: 16 }}>
          <h2 style={{ marginBottom: 8 }}>Result</h2>
          <div style={{ fontSize: 14, marginBottom: 8 }}>
            Status: <b>{result.status}</b>, OK: <b>{String(result.ok)}</b>
          </div>
          {result.error ? (
            <pre style={{ whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 12, borderRadius: 10 }}>
              {result.error}
            </pre>
          ) : (
            <pre style={{ whiteSpace: "pre-wrap", background: "#f7f7f7", padding: 12, borderRadius: 10 }}>
              {JSON.stringify(result.data, null, 2)}
            </pre>
          )}
        </section>
      ) : null}
    </main>
  );
}
