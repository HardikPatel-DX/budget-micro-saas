'use client';
import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function TryDemoButton() {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supabase = createClientComponentClient();

  const onClick = async () => {
    setLoading(true);
    setMsg(null);
    try {
      // get current session & access token
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) {
        throw new Error('Not signed in — please sign in first.');
      }

      const res = await fetch('/api/seed-demo-trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'seed failed');
      setMsg('Demo data seeded ✅');
    } catch (err: any) {
      setMsg('Error: ' + (err.message || 'unknown'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={onClick}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded"
      >
        {loading ? 'Seeding…' : 'Try demo'}
      </button>
      {msg && <div className="mt-2 text-sm">{msg}</div>}
    </div>
  );
}
