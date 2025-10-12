// app/recurring/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type RecurringRow = {
  payee: string;
  typical_amount_cad: number;
  occurrences: number;
  inferred_frequency: string;
  last_observed_date: string | null;
  next_expected_date: string | null;
  estimated_monthly_cost: number;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
  // Will surface an obvious error in the browser if env-vars not set
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

export default function RecurringPage() {
  const [rows, setRows] = useState<RecurringRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from<RecurringRow>('recurring_summary')
          .select('*')
          .order('estimated_monthly_cost', { ascending: false })
          .limit(100);

        if (error) throw error;
        if (mounted) setRows(data ?? []);
      } catch (e: any) {
        console.error(e);
        if (mounted) setErr(e.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <main style={{ padding: 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1>Recurring summary (MVP)</h1>
      <p>
        This page reads <code>public.recurring_summary</code> from Supabase using your
        <code>NEXT_PUBLIC_SUPABASE_*</code> env vars.
      </p>

      {loading && <p>Loading…</p>}
      {err && <div style={{ color: 'crimson' }}><strong>Error:</strong> {err}</div>}

      {!loading && !err && rows && rows.length === 0 && <p>No recurring rows found.</p>}

      {!loading && !err && rows && rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
            <thead style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
              <tr>
                <th style={{ padding: 8 }}>Payee</th>
                <th style={{ padding: 8 }}>Typical</th>
                <th style={{ padding: 8 }}>Occur</th>
                <th style={{ padding: 8 }}>Freq</th>
                <th style={{ padding: 8 }}>Last</th>
                <th style={{ padding: 8 }}>Next</th>
                <th style={{ padding: 8 }}>Est / month</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: 8 }}>{r.payee}</td>
                  <td style={{ padding: 8 }}>{Number(r.typical_amount_cad).toFixed(2)}</td>
                  <td style={{ padding: 8 }}>{r.occurrences}</td>
                  <td style={{ padding: 8 }}>{r.inferred_frequency}</td>
                  <td style={{ padding: 8 }}>{r.last_observed_date ?? '—'}</td>
                  <td style={{ padding: 8 }}>{r.next_expected_date ?? '—'}</td>
                  <td style={{ padding: 8 }}>{Number(r.estimated_monthly_cost).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
