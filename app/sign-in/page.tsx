'use client';
import { useState } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

export default function SignInPage() {
  const supabase = createClientComponentClient();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) {
      setStatus('error: ' + error.message);
    } else {
      setStatus('magic link sent — check your email');
    }
  };

  return (
    <main className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Sign in / Create account</h1>
      <form onSubmit={sendLink} className="space-y-3">
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="w-full p-2 border rounded" />
        <div className="flex items-center space-x-2">
          <button className="px-4 py-2 bg-blue-600 text-white rounded">Send magic link</button>
          <span>{status}</span>
        </div>
      </form>
      <p className="mt-4 text-sm text-gray-600">No password, instant sign-in link.</p>
    </main>
  );
}
