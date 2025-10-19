// pages/api/dashboard-summary.ts
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Dashboard summary API (owner-aware)
 * - Uses caller's Bearer token + anon key to call Supabase PostgREST (RLS preserved)
 * - Aggregates transactions, categories, payees, recurring (with fallback heuristic)
 * - Returns tiles, charts, savings scenarios, unmapped payees suggestions
 * - In-memory cache TTL: 5 minutes
 *
 * NOTE: keep this file server-only. Do NOT put service-role keys here.
 */

type Tiles = {
  currentBalance: number;
  weeklyAvgSpend26: number;
  monthlyNetFlow: number;
};

type RecurringOut = {
  payee: string;
  avg_amount: number;
  frequency: 'weekly' | 'monthly' | 'unknown';
  last_date: string | null;
  next_date: string | null;
  occurrences: number;
};

type ChartWeekly = { weekStart: string; amount: number };

type ApiResponse = {
  cached: boolean;
  generated_at: string;
  tiles: Tiles;
  topCategories: Array<{ category: string; amount: number }>;
  topPayees: Array<{ payee: string; amount: number }>;
  recurring: RecurringOut[];
  upcomingBills: Array<{ payee: string; amount: number; next_date: string | null }>;
  charts: {
    weeklySeries26: ChartWeekly[];
    categoryDonut: Array<{ category: string; amount: number }>;
    topPayeesBar: Array<{ payee: string; amount: number }>;
    recurringSparklines: Array<{ payee: string; points: number[] }>;
  };
  unmappedPayees?: string[];
  savingsScenarios: {
    methodUsed: 'weeklyNetFlow' | 'weeklyAvgSpend';
    weeklyNetFlowValue: number;
    conservative: { weekly: number; projection12: number; projection26: number };
    moderate: { weekly: number; projection12: number; projection26: number };
    aggressive: { weekly: number; projection12: number; projection26: number };
  };
};

// Simple in-memory cache (TTL 5 minutes)
let CACHE: { ts: number; payload: ApiResponse } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.warn('Missing SUPABASE env vars for dashboard-summary API.');
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function isoWeekStart(d: Date) {
  // Monday as week start (UTC-based)
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 = Sun
  const diff = (day + 6) % 7; // days since Monday
  date.setUTCDate(date.getUTCDate() - diff);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
}
function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse | { error: string }>) {
  try {
    // Cache header & server-side cache
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');

    // Get bearer token from Authorization header or cookie fallback
    const authHeader = (req.headers.authorization as string) || '';
    let token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader || null;

    if (!token && req.cookies && req.cookies['sb-access-token']) {
      try {
        const ck = req.cookies['sb-access-token'];
        const parsed = typeof ck === 'string' && ck.startsWith('{') ? JSON.parse(ck) : ck;
        const maybe = parsed?.access_token || parsed;
        if (maybe && typeof maybe === 'string') token = maybe;
      } catch (e) {
        // ignore
      }
    }

    if (!token) return res.status(401).json({ error: 'Missing Authorization Bearer token' });

    if (!SUPABASE_URL || !SUPABASE_ANON) return res.status(500).json({ error: 'Missing Supabase configuration on server' });

    // Serve cached if fresh
    if (CACHE && Date.now() - CACHE.ts < CACHE_TTL_MS) {
      const copy = { ...CACHE.payload, cached: true };
      return res.status(200).json(copy);
    }

    // Prepare PostgREST base URL and helper (TS-safe because we've asserted envs)
    const baseUrl = SUPABASE_URL.replace(/\/$/, '');
    async function restFetch(path: string) {
      const url = `${baseUrl}/rest/v1/${path}`;
      const r = await fetch(url, {
        method: 'GET',
        headers: {
          apikey: SUPABASE_ANON!,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Supabase REST error ${r.status}: ${text}`);
      }
      return r.json();
    }

    // Fetch transactions allowed by RLS for this user
    const rows: any[] = await (async () => {
      try {
        // fetch key columns; fallback to created_at if date_parsed missing will be handled later
        return await restFetch(
          `transactions?select=transaction_id,amount,date_parsed,created_at,category,payee_clean,payee_norm,description&order=date_parsed.desc,created_at.desc&limit=5000`
        );
      } catch (err) {
        console.error('restFetch transactions error', err);
        return [];
      }
    })();

    // Normalize rows: date fallback, numeric amounts, fill categories/payees
    const normalized = (rows || [])
      .map((r: any) => {
        const dateRaw = r.date_parsed || r.created_at || null;
        const dateObj = dateRaw ? new Date(dateRaw) : null;
        const amount = safeNum(r.amount);
        const payeeNorm = r.payee_norm || r.payee_clean || (r.description || 'Unknown');
        return {
          id: r.transaction_id || null,
          amount,
          date: dateObj,
          category: r.category || 'Uncategorized',
          payee: payeeNorm,
          rawPayee: r.payee_clean || r.payee_norm || (r.description || 'Unknown')
        };
      })
      // keep only rows that have a valid date and numeric amount
      .filter((t: any) => t.date && typeof t.amount === 'number' && !Number.isNaN(t.amount));

    // Make a typed, non-null-date transactions array to satisfy TypeScript
    const txs: Array<{
      id: any;
      amount: number;
      date: Date;
      category: string;
      payee: string;
      rawPayee: string;
    }> = normalized.map(t => ({ ...t, date: t.date as Date }));

    // If no transactions, return an empty payload (but cache)
    if (!txs || txs.length === 0) {
      const empty: ApiResponse = {
        cached: false,
        generated_at: new Date().toISOString(),
        tiles: { currentBalance: 0, weeklyAvgSpend26: 0, monthlyNetFlow: 0 },
        topCategories: [],
        topPayees: [],
        recurring: [],
        upcomingBills: [],
        charts: { weeklySeries26: [], categoryDonut: [], topPayeesBar: [], recurringSparklines: [] },
        unmappedPayees: [],
        savingsScenarios: {
          methodUsed: 'weeklyAvgSpend',
          weeklyNetFlowValue: 0,
          conservative: { weekly: 0, projection12: 0, projection26: 0 },
          moderate: { weekly: 0, projection12: 0, projection26: 0 },
          aggressive: { weekly: 0, projection12: 0, projection26: 0 }
        }
      };
      CACHE = { ts: Date.now(), payload: empty };
      return res.status(200).json(empty);
    }

    // Current balance
    const currentBalance = txs.reduce((s: number, t: any) => s + t.amount, 0);

    // Weekly series (last 26 weeks) — using absolute spend (negative amounts as spend)
    const now = new Date();
    const weeklyBuckets: Record<string, number> = {};
    for (let i = 0; i < 26; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i * 7);
      weeklyBuckets[isoWeekStart(d)] = 0;
    }
    txs.forEach(t => {
      const wk = isoWeekStart(t.date);
      if (wk in weeklyBuckets) weeklyBuckets[wk] += t.amount < 0 ? Math.abs(t.amount) : 0;
    });
    const weeklyKeys = Object.keys(weeklyBuckets).sort();
    const weeklySeries26 = weeklyKeys.map(k => ({ weekStart: k, amount: Number(weeklyBuckets[k].toFixed(2)) }));
    const weeklyAvgSpend26 =
      weeklySeries26.length > 0 ? weeklySeries26.reduce((s, w) => s + w.amount, 0) / weeklySeries26.length : 0;

    // Monthly net flow (last 30 days)
    const ms30 = 30 * 24 * 3600 * 1000;
    const since = new Date(Date.now() - ms30);
    const monthlyNetFlow = txs.filter(t => t.date >= since).reduce((s, t) => s + t.amount, 0);

    // Top categories and top payees
    const catMap = new Map<string, number>();
    const payeeMap = new Map<string, number>();
    txs.forEach(t => {
      catMap.set(t.category, (catMap.get(t.category) || 0) + t.amount);
      payeeMap.set(t.payee, (payeeMap.get(t.payee) || 0) + t.amount);
    });
    const topCategories = Array.from(catMap.entries())
      .map(([category, amount]) => ({ category, amount: Number(amount.toFixed(2)) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5);
    const topPayees = Array.from(payeeMap.entries())
      .map(([payee, amount]) => ({ payee, amount: Number(amount.toFixed(2)) }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 10);

    // Attempt to read recurring_summary table; if empty, build heuristics
    let recurringData: RecurringOut[] = [];
    try {
      const recRows = await restFetch(`recurring_summary?select=payee,avg_amount,frequency,last_date,next_date,occurrences&limit=100`);
      if (recRows && Array.isArray(recRows) && recRows.length > 0) {
        recurringData = recRows.map((r: any) => ({
          payee: r.payee || 'Unknown',
          avg_amount: safeNum(r.avg_amount || r.amount || 0),
          frequency: (r.frequency || 'monthly') as RecurringOut['frequency'],
          last_date: r.last_date || null,
          next_date: r.next_date || null,
          occurrences: r.occurrences || 1
        }));
      }
    } catch (e) {
      // If reading recurring_summary fails, we'll fall back to heuristics below.
      recurringData = [];
    }

    if (!recurringData || recurringData.length === 0) {
      // Heuristic: find payees with >=3 occurrences in last 90 days and reasonably consistent intervals
      const recent90 = new Date(Date.now() - 90 * 24 * 3600 * 1000);
      const byPayee = new Map<string, typeof txs>();
      txs.filter(t => t.date >= recent90).forEach(t => {
        const k = (t.payee || 'Unknown') as string;
        const arr = byPayee.get(k) || [];
        arr.push(t);
        byPayee.set(k, arr);
      });
      const heuristics: RecurringOut[] = [];
      for (const [payee, arr] of byPayee.entries()) {
        if (!arr || arr.length < 3) continue;
        const sorted = arr.slice().sort((a: any, b: any) => a.date.getTime() - b.date.getTime());
        const intervals: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          intervals.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / (1000 * 60 * 60 * 24));
        }
        const avgInterval = intervals.reduce((s, n) => s + n, 0) / intervals.length;
        const sd = Math.sqrt(intervals.map(x => (x - avgInterval) ** 2).reduce((s, y) => s + y, 0) / intervals.length);
        // simple acceptance thresholds
        if (avgInterval >= 6 && avgInterval <= 40 && sd <= 15) {
          const freq: RecurringOut['frequency'] = avgInterval <= 10 ? 'weekly' : 'monthly';
          const avgAmount = sorted.reduce((s: number, r: any) => s + r.amount, 0) / sorted.length;
          const lastDate = sorted[sorted.length - 1].date;
          const nextDate = new Date(lastDate);
          nextDate.setDate(nextDate.getDate() + Math.round(avgInterval));
          heuristics.push({
            payee,
            avg_amount: Number(avgAmount.toFixed(2)),
            frequency: freq,
            last_date: isoDate(lastDate),
            next_date: isoDate(nextDate),
            occurrences: sorted.length
          });
        }
      }
      recurringData = heuristics;
    }

    // Upcoming bills from recurringData
    const upcomingBills = (recurringData || []).map(r => ({
      payee: r.payee,
      amount: Number(r.avg_amount),
      next_date: r.next_date || null
    }));

    // Recurring sparklines (12 points) for up to top 10 recurring payees
    const recurringSparklines = (recurringData || []).slice(0, 10).map((r: any) => {
      // only include transactions that have a date and match the payee (case-insensitive)
      const related = txs.filter(t => t.date && (t.payee || '').toLowerCase().includes((r.payee || '').toLowerCase()));

      const points: number[] = [];
      const periods = 12;

      if (r.frequency === 'weekly') {
        // compute this week Monday as start
        const thisWeekStart = new Date();
        const day = (thisWeekStart.getDay() + 6) % 7;
        thisWeekStart.setDate(thisWeekStart.getDate() - day);
        thisWeekStart.setHours(0, 0, 0, 0);

        for (let i = periods - 1; i >= 0; i--) {
          const start = new Date(thisWeekStart);
          start.setDate(start.getDate() - i * 7);
          const end = new Date(start);
          end.setDate(end.getDate() + 7);

          const sum = related
            .filter(t => t.date >= start && t.date < end)
            .reduce((s, t) => s + Math.abs(t.amount), 0);

          points.push(Number(sum.toFixed(2)));
        }
      } else {
        const nowM = new Date();
        for (let i = periods - 1; i >= 0; i--) {
          const start = new Date(nowM.getFullYear(), nowM.getMonth() - i, 1);
          const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);

          const sum = related
            .filter(t => t.date >= start && t.date < end)
            .reduce((s, t) => s + Math.abs(t.amount), 0);

          points.push(Number(sum.toFixed(2)));
        }
      }

      return { payee: r.payee, points };
    });

    // Payee mapping: fetch normalized names to avoid suggesting mapped payees
    let mappedSet = new Set<string>();
    try {
      const mappings = await restFetch(`payee_mapping?select=normalized,pattern&limit=1000`);
      mappedSet = new Set((mappings || []).map((m: any) => (m.normalized || '').trim()));
    } catch (e) {
      mappedSet = new Set();
    }

    // Unmapped payees (top unmatched by frequency)
    const rawCount = new Map<string, number>();
    txs.forEach(t => {
      const key = ((t.rawPayee || '').trim() || (t.payee || '')).trim();
      if (!key) return;
      rawCount.set(key, (rawCount.get(key) || 0) + 1);
    });
    const unmappedPayees = Array.from(rawCount.entries())
      .filter(([k]) => !!k && !mappedSet.has(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);

    // Charts
    const categoryDonut = topCategories.map(c => ({ category: c.category, amount: c.amount }));
    const topPayeesBar = topPayees.map(p => ({ payee: p.payee, amount: p.amount }));

    // Savings scenarios: baseline is weekly net flow (last 7 days) else weeklyAvgSpend26
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);
    const weeklyNetFlow = txs.filter(t => t.date >= sevenDaysAgo).reduce((s, t) => s + t.amount, 0);
    const methodUsed: ApiResponse['savingsScenarios']['methodUsed'] = weeklyNetFlow !== 0 ? 'weeklyNetFlow' : 'weeklyAvgSpend';
    const baseWeekly = Math.abs(weeklyNetFlow !== 0 ? weeklyNetFlow : -weeklyAvgSpend26);
    const weeklyNetFlowValue = Number(baseWeekly.toFixed(2));

    const conservativeWeekly = Number((weeklyNetFlowValue * 0.05).toFixed(2));
    const moderateWeekly = Number((weeklyNetFlowValue * 0.10).toFixed(2));
    const aggressiveWeekly = Number((weeklyNetFlowValue * 0.15).toFixed(2));
    const makeProj = (w: number) => ({ weekly: w, projection12: Number((w * 12).toFixed(2)), projection26: Number((w * 26).toFixed(2)) });

    const payload: ApiResponse = {
      cached: false,
      generated_at: new Date().toISOString(),
      tiles: {
        currentBalance: Number(currentBalance.toFixed(2)),
        weeklyAvgSpend26: Number(weeklyAvgSpend26.toFixed(2)),
        monthlyNetFlow: Number(monthlyNetFlow.toFixed(2))
      },
      topCategories,
      topPayees,
      recurring: recurringData,
      upcomingBills,
      charts: {
        weeklySeries26,
        categoryDonut,
        topPayeesBar,
        recurringSparklines
      },
      unmappedPayees,
      savingsScenarios: {
        methodUsed,
        weeklyNetFlowValue,
        conservative: makeProj(conservativeWeekly),
        moderate: makeProj(moderateWeekly),
        aggressive: makeProj(aggressiveWeekly)
      }
    };

    // Cache and return
    CACHE = { ts: Date.now(), payload };
    return res.status(200).json(payload);
  } catch (err: any) {
    console.error('dashboard-summary error', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
