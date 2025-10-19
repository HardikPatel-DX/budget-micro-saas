// pages/dashboard.tsx
import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import type { NextPage } from 'next';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

type ApiResponse = any;

const small = (n:number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const Dashboard: NextPage = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchSummary() {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = (sessionData?.session?.access_token) || null;
      if (!token) {
        setError('Not authenticated. Please sign in.');
        setLoading(false);
        return;
      }
      const r = await fetch('/api/dashboard-summary', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!r.ok) {
        const text = await r.text();
        setError(`API error: ${r.status} ${text}`);
        setLoading(false);
        return;
      }
      const json = await r.json();
      setData(json);
    } catch (e:any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSummary();
    const id = setInterval(fetchSummary, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <div style={styles.page}>Loading dashboard...</div>;
  if (error) return <div style={styles.page}><div style={styles.card}><h3>Error</h3><pre>{error}</pre></div></div>;

  if (!data) return <div style={styles.page}><div style={styles.card}>No data</div></div>;

  const s = data;
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={{margin:0}}>Budget Dashboard</h1>
        <div style={{fontSize:12, color:'#9CA3AF'}}>{s.generated_at} {s.cached ? '(cached)' : ''}</div>
      </header>

      <section style={styles.grid}>
        <div style={styles.tile}>
          <div style={styles.tileTitle}>Current Balance</div>
          <div style={styles.tileValue}>${small(s.tiles.currentBalance)}</div>
        </div>
        <div style={styles.tile}>
          <div style={styles.tileTitle}>Weekly Avg Spend (26w)</div>
          <div style={styles.tileValue}>${small(s.tiles.weeklyAvgSpend26)}</div>
        </div>
        <div style={styles.tile}>
          <div style={styles.tileTitle}>Monthly Net Flow (last month)</div>
          <div style={styles.tileValue}>${small(s.tiles.monthlyNetFlow)}</div>
        </div>

        <div style={styles.cardFull}>
          <h3 style={styles.sectionTitle}>Weekly Spend — last 26 weeks</h3>
          <div style={styles.chartRow}>
            {s.charts.weeklySeries26.map((w:any) => (
              <div key={w.weekStart} style={{flex:1, margin:'0 4px', textAlign:'center'}}>
                <div style={{height:60, background: 'linear-gradient(180deg,#111827,#0b1220)', borderRadius:4, display:'flex', alignItems:'flex-end', justifyContent:'center', paddingBottom:4}}>
                  <div style={{width:'80%', height: `${Math.min(100, (w.amount / (s.tiles.weeklyAvgSpend26*3 || 1)) * 100)}%`, background:'#ef4444', borderRadius:2}} />
                </div>
                <div style={{fontSize:10, color:'#9CA3AF', marginTop:6}}>{w.weekStart.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>Top Categories</h3>
          <ul>
            {s.topCategories.map((c:any) => <li key={c.category}>{c.category}: ${small(c.amount)}</li>)}
          </ul>
        </div>

        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>Top Payees</h3>
          <ol>
            {s.topPayees.map((p:any)=> <li key={p.payee}>{p.payee}: ${small(p.amount)}</li>)}
          </ol>
        </div>

        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>Recurring Subscriptions</h3>
          <ul>
            {s.recurring.length === 0 && <li>No recurring items found</li>}
            {s.recurring.map((r:any) =>
              <li key={r.payee}>{r.payee} — ${small(r.avg_amount)} — next: {r.next_date || 'unknown'}</li>
            )}
          </ul>
        </div>

        <div style={styles.card}>
          <h3 style={styles.sectionTitle}>Upcoming Bills (from recurring)</h3>
          <ul>
            {s.upcomingBills.length === 0 && <li>No upcoming bills</li>}
            {s.upcomingBills.map((b:any)=> <li key={b.payee}>{b.payee}: ${small(b.amount)} — {b.next_date || 'N/A'}</li>)}
          </ul>
        </div>

        <div style={styles.cardFull}>
          <h3 style={styles.sectionTitle}>Savings Scenarios (weekly & projections)</h3>
          <div style={{display:'flex', gap:12}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12, color:'#9CA3AF'}}>Method used: {s.savingsScenarios.methodUsed} (weeklyNetFlow: ${small(s.savingsScenarios.weeklyNetFlowValue)})</div>
              <table style={{width:'100%', marginTop:8}}>
                <thead style={{textAlign:'left', color:'#9CA3AF'}}><tr><th>Scenario</th><th>Weekly</th><th>12-week</th><th>26-week</th></tr></thead>
                <tbody>
                  <tr><td>Conservative (5%)</td><td>${small(s.savingsScenarios.conservative.weekly)}</td><td>${small(s.savingsScenarios.conservative.projection12)}</td><td>${small(s.savingsScenarios.conservative.projection26)}</td></tr>
                  <tr><td>Moderate (10%)</td><td>${small(s.savingsScenarios.moderate.weekly)}</td><td>${small(s.savingsScenarios.moderate.projection12)}</td><td>${small(s.savingsScenarios.moderate.projection26)}</td></tr>
                  <tr><td>Aggressive (15%)</td><td>${small(s.savingsScenarios.aggressive.weekly)}</td><td>${small(s.savingsScenarios.aggressive.projection12)}</td><td>${small(s.savingsScenarios.aggressive.projection26)}</td></tr>
                </tbody>
              </table>
            </div>

            <div style={{width:300}}>
              <div style={{fontSize:12, color:'#9CA3AF'}}>Unmapped payees (top suggestions)</div>
              <ol>
                {(s.unmappedPayees || []).map((p:any) => <li key={p} style={{fontSize:12}}>{p}</li>)}
              </ol>
            </div>
          </div>
        </div>

      </section>

      <footer style={{color:'#9CA3AF', fontSize:12, textAlign:'center', marginTop:20}}>Tip: Data is read-only, RLS preserved. API cached server-side for 5 minutes.</footer>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  page: { background: '#0b1220', minHeight: '100vh', color: '#E5E7EB', padding: 20, fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto' },
  header: { display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:20 },
  grid: { display:'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 },
  tile: { background:'#071029', padding:16, borderRadius:8, boxShadow: '0 4px 14px rgba(2,6,23,0.6)' },
  tileTitle: { fontSize:12, color:'#9CA3AF' },
  tileValue: { fontSize:22, marginTop:8 },
  card: { background:'#071029', padding:16, borderRadius:8, boxShadow: '0 6px 24px rgba(2,6,23,0.6)' },
  cardFull: { gridColumn: '1 / -1', background:'#071029', padding:16, borderRadius:8 },
  sectionTitle: { margin:0, marginBottom:8, fontSize:14 },
  chartRow: { display:'flex', gap:8, paddingTop:8 }
};

export default Dashboard;
