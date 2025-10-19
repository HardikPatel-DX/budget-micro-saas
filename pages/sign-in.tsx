// pages/sign-in.tsx
import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import Nav from '../components/Nav';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setMessage(null);
    try {
      // use the correct option name expected by this supabase-js version
      const emailRedirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/dashboard` : undefined;

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo }
      });

      if (error) setMessage(`Error: ${error.message}`);
      else setMessage('Check your email for the sign-in link. If it doesn’t arrive, check spam.');
    } catch (err: any) {
      setMessage(String(err?.message || err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ background: '#071029', minHeight: '100vh', color: '#E5E7EB', padding: 24 }}>
      <Nav />
      <main style={{ maxWidth: 720, margin: '36px auto', padding: 20, background: '#0b1220', borderRadius: 8 }}>
        <h1>Sign in</h1>
        <form onSubmit={sendMagicLink} style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 6,
              border: '1px solid #233',
              background: '#071029',
              color: '#fff'
            }}
          />
          <button
            disabled={sending}
            style={{
              padding: '10px 16px',
              borderRadius: 6,
              background: '#2563EB',
              color: '#fff',
              border: 'none'
            }}
          >
            {sending ? 'Sending…' : 'Send link'}
          </button>
        </form>
        {message && <div style={{ marginTop: 12, color: '#D1FAE5' }}>{message}</div>}
      </main>
    </div>
  );
}
