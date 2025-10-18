// pages/upload.tsx
import React, { useState } from 'react';
import Nav from '../components/Nav';

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setError(null);
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // keep this call to /api/import so existing behavior is preserved
      const res = await fetch('/api/import', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      setResult({ status: res.status, body: json });
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{background:'#071029', minHeight:'100vh', color:'#E5E7EB', padding:24}}>
      <Nav />
      <main style={{maxWidth:760, margin:'36px auto', padding:20, background:'#0b1220', borderRadius:8}}>
        <h1>Upload bank statement</h1>
        <p style={{color:'#9CA3AF'}}>Select a CSV/Plaid export or other statement file to upload. This will POST to <code>/api/import</code>.</p>

        <form onSubmit={submit} style={{display:'flex', flexDirection:'column', gap:12, marginTop:16}}>
          <input type="file" accept=".csv,application/csv,text/csv,application/octet-stream" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          <button disabled={loading} style={{padding:'10px 16px', borderRadius:6, background:'#10B981', color:'#06291B', border:'none', width:150}}>
            {loading ? 'Uploading…' : 'Upload'}
          </button>
        </form>

        {error && <div style={{marginTop:12, color:'#FCA5A5'}}>Error: {error}</div>}

        {result && (
          <div style={{marginTop:12, background:'#07202B', padding:12, borderRadius:6}}>
            <div style={{color:'#9CA3AF'}}>API response (status {result.status}):</div>
            <pre style={{whiteSpace:'pre-wrap', color:'#E6FFFA'}}>{JSON.stringify(result.body, null, 2)}</pre>
          </div>
        )}

        <section style={{marginTop:20, color:'#9CA3AF'}}>
          <div>Tip: after successful import, check <code>/dashboard</code> to see the new transaction(s).</div>
        </section>
      </main>
    </div>
  );
}
