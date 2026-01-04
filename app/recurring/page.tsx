// app/recurring/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RecRow = {
  payee?: string | null;
  typical_amount_cad?: number | null;
  occurrences?: number | null;
  inferred_frequency?: string | null;
  last_observed_date?: string | null;
  next_expected_date?: string | null;
  estimated_monthly_cost?: number | null;
};

function getSupabaseBrowserClient(): SupabaseClient | null {
  if (typeof window === "undefined") return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  return createClient(url, anon);
}

export default function RecurringPage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RecRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      try {
        setLoading(true);
        setError(null);

        if (!supabase) {
          setError("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
          setLoading(false);
          return;
        }

        // NOTE: RLS is currently off in your DB, so this will read all rows.
        // We will fix multi-user + RLS later, after CSV import pipeline is fully locked.
        const { data, error } = await supabase
          .from("recurring_summary")
          .select(
            "payee,typical_amount_cad,occurrences,inferred_frequency,last_observed_date,next_expected_date,estimated_monthly_cost"
          )
          .order("estimated_monthly_cost", { ascending: false })
          .limit(200);

        if (error) throw error;
        setRows((data as any) || []);
      } catch (e: any) {
        setError(String(e?.message || e));
      } finally {
        setLoading(false);
      }
    }

    run();
  }, [supabase]);

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui, Arial" }}>
      <h1 style={{ marginTop: 0 }}>Recurring</h1>

      {loading && <p>Loading…</p>}

      {!loading && error && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <strong>Error</strong>
          <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{error}</div>
        </div>
      )}

      {!loading && !error && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Payee</th>
                <th style={th}>Typical</th>
                <th style={th}>Occurrences</th>
                <th style={th}>Frequency</th>
                <th style={th}>Last</th>
                <th style={th}>Next</th>
                <th style={th}>Monthly Est</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.payee || "unknown"}-${i}`}>
                  <td style={td}>{r.payee || "Unknown"}</td>
                  <td style={td}>{fmt(r.typical_amount_cad)}</td>
                  <td style={td}>{r.occurrences ?? ""}</td>
                  <td style={td}>{r.inferred_frequency || ""}</td>
                  <td style={td}>{r.last_observed_date || ""}</td>
                  <td style={td}>{r.next_expected_date || ""}</td>
                  <td style={td}>{fmt(r.estimated_monthly_cost)}</td>
                </tr>
              ))}

              {rows.length === 0 && (
                <tr>
                  <td style={td} colSpan={7}>
                    No recurring rows found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function fmt(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 12,
  color: "#555",
  borderBottom: "1px solid #ddd",
  padding: "10px 8px",
};

const td: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: "10px 8px",
  fontSize: 13,
};
