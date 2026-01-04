"use client";

import React, { useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getSupabaseBrowserClient(): SupabaseClient | null {
  // Never run during build/server
  if (typeof window === "undefined") return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Do not throw. Missing env should not break builds.
  if (!url || !anon) return null;

  return createClient(url, anon);
}

export default function TryDemoButton() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setMsg(null);

    if (!supabase) {
      setMsg("Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        setMsg("Not signed in. Demo seeding requires an authenticated session.");
        return;
      }

      const res = await fetch("/api/seed-demo-trigger", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const text = await res.text();
      if (!res.ok) {
        setMsg(`Seed failed: ${res.status} ${text}`);
        return;
      }

      setMsg("Demo seeded successfully. Go to Dashboard.");
    } catch (e: any) {
      setMsg(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={run}
        disabled={loading}
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: loading ? "#374151" : "#111827",
          color: "#fff",
          border: "1px solid #1f2937",
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Seeding..." : "Try Demo"}
      </button>

      {msg && (
        <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280", whiteSpace: "pre-wrap" }}>
          {msg}
        </div>
      )}
    </div>
  );
}
