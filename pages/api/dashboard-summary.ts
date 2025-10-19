// pages/api/dashboard-summary.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type TilePayload = {
  currentBalance: number;
  weeklyAvgSpend26: number;
  monthlyNetFlow: number;
};

type ApiResponse = {
  cached: boolean;
  generated_at: string;
  tiles: TilePayload;
  topCategories: Array<{ category: string; amount: number }>;
  topPayees: Array<{ payee: string; amount: number }>;
  recurring: Array<{ payee: string; avg_amount: number; frequency: string; last_date: string | null }>;
  upcomingBills: Array<{ payee: string; amount: number; next_date: string | null }>;
  charts: {
    weeklySeries26: Array<{ weekStart: string; amount: number }>;
    categoryDonut?: Array<{ category: string; amount: number }>;
    topPayeesBar?: Array<{ payee: string; amount: number }>;
    recurringSparkline?: Array<number>;
  };
  savingsScenarios: {
    methodUsed: string;
    weeklyNetFlowValue: number;
    conservative: { weekly: number; projection12: number; projection26: number };
    moderate: { weekly: number; projection12: number; projection26: number };
    aggressive: { weekly: number; projection12: number; projection26: number };
  };
  unmappedPayees?: string[];
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON) {
  // Warn at module load time — handler will still respond with 500 if missing
  console.warn('Missing SUPABASE env vars for dashboard-summary API.');
}

function isoWeekStart(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0=Sun
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
    // Cache header (server-side caching)
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');

    // Extract bearer token
    const authHeader = (req.headers.authorization as string) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader || null;
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    }

    // Ensure Supabase envs present at runtime - return early so TS can narrow
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      return res.status(500).json({ error: 'Missing Supabase configuration on server' });
    }

    // Compute base URL now that we've asserted existence so TS accepts it
    const baseUrl = SUPABASE_URL.replace(/\/$/, '');

    // Helper to call PostgREST (supabase REST) — uses anon key + user token so RLS applies
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

    // Fetch recent transactions (limit to 2000)
    const rows: any[] = await (async () => {
      try {
        return await restFetch(`transactions?select=transaction_id,amount,date_parsed,created_at,category,payee&order=date_parsed.desc,created_at.desc&limit=2000`);
      } catch (err) {
        console.error('restFetch transactions error', err);
        return [];
      }
    })();

    // Normalize rows and filter invalid amounts
    const normalized = rows
      .map(r => {
        const date = (r.date_parsed || r.created_at || null);
        const amount = safeNum(r.amount);
        return { ...r, date, amount, category: r.category || 'Uncategorized', payee: r.payee || 'Unknown' };
      })
      .filter(r => Number.isFinite(r.amount) && !Number.isNaN(r.amount));

    const currentBalance = normalized.reduce((s, r) => s + r.amount, 0);

    // Build weekly buckets for last 26 weeks
    const now = new Date();
    const weeklyBuckets: Record<string, number> = {};
    for (let i = 0; i < 26; i++) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i * 7);
      const wk = isoWeekStart(d);
      weeklyBuckets[wk] = 0;
    }
    normalized.forEach(r => {
      const d = r.date ? new Date(r.date) : new Date();
      const wk = isoWeekStart(d);
      if (wk in weeklyBuckets) weeklyBuckets[wk] += r.amount;
    });
    const weeklyKeys = Object.keys(weeklyBuckets).sort();
    const weeklySeries26 = weeklyKeys.map(k => ({ weekStart: k, amount: Number(weeklyBuckets[k] || 0) }));

    // Weekly spend avg (absolute negative amounts)
    const weeklySpendValues: number[] = weeklyKeys.map(k => {
      return normalized
        .filter(r => isoWeekStart(new Date(r.date)) === k && r.amount < 0)
        .reduce((s, r) => s + Math.abs(r.amount), 0);
    });
    const totalSpend = weeklySpendValues.reduce((s, v) => s + v, 0);
    const weeklyAvgSpend26 = weeklySpendValues.length ? totalSpend / weeklySpendValues.length : 0;

    // Monthly net flow (last 30 days)
    const ms30 = 30 * 24 * 3600 * 1000;
    const since = new Date(Date.now() - ms30);
    const monthlyNetFlow = normalized.filter(r => new Date(r.date) >= since).reduce((s, r) => s + r.amount, 0);

    // Top categories & payees
    const catMap = new Map<string, number>();
    const payeeMap = new Map<string, number>();
    normalized.forEach(r => {
      catMap.set(r.category, (catMap.get(r.category) || 0) + r.amount);
      payeeMap.set(r.payee, (payeeMap.get(r.payee) || 0) + r.amount);
    });
    const topCategories = Array.from(catMap.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5);
    const topPayees = Array.from(payeeMap.entries())
      .map(([payee, amount]) => ({ payee, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 10);

    // Recurring detection (heuristic)
    const recent90 = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    const payeeGroups = new Map<string, any[]>();
    normalized.filter(r => new Date(r.date) >= recent90).forEach(r => {
      const arr = payeeGroups.get(r.payee) || [];
      arr.push(r);
      payeeGroups.set(r.payee, arr);
    });
    const recurring: Array<{ payee: string; avg_amount: number; frequency: string; last_date: string | null }> = [];
    payeeGroups.forEach((arr, payee) => {
      if (arr.length >= 3) {
        const avg = arr.reduce((s, t) => s + t.amount, 0) / arr.length;
        const dates = arr.map(a => new Date(a.date).getTime()).sort();
        let avgDeltaDays = 0;
        if (dates.length >= 2) {
          let sum = 0;
          for (let i = 1; i < dates.length; i++) sum += (dates[i] - dates[i - 1]);
          avgDeltaDays = Math.round((sum / (dates.length - 1)) / (24 * 3600 * 1000));
        }
        let freq: 'weekly' | 'monthly' | 'unknown' = 'unknown';
        if (avgDeltaDays > 0 && avgDeltaDays <= 10) freq = 'weekly';
        else if (avgDeltaDays > 10 && avgDeltaDays <= 40) freq = 'monthly';

        recurring.push({
          payee,
          avg_amount: Number(avg),
          frequency: freq,
          last_date: arr.map(a => a.date).sort().reverse()[0] || null
        });
      }
    });

    const upcomingBills = recurring.map(r => {
      let next: string | null = null;
      const last = r.last_date ? new Date(r.last_date) : null;
      if (last) {
        const addDays = r.frequency === 'weekly' ? 7 : r.frequency === 'monthly' ? 30 : 14;
        const nd = new Date(last);
        nd.setDate(nd.getDate() + addDays);
        next = nd.toISOString().slice(0, 10);
      }
      return { payee: r.payee, amount: r.avg_amount, next_date: next };
    });

    const unmappedPayees = topPayees.slice(0, 10).map(p => p.payee);

    const weeklyTotals = weeklyKeys.map(k =>
      normalized.filter(r => isoWeekStart(new Date(r.date)) === k).reduce((s, r) => s + r.amount, 0)
    );
    const weeklyNetFlowValue = weeklyTotals.length ? weeklyTotals.reduce((s, v) => s + v, 0) / weeklyTotals.length : 0;

    const conservativeWeekly = weeklyNetFlowValue * 0.05;
    const moderateWeekly = weeklyNetFlowValue * 0.10;
    const aggressiveWeekly = weeklyNetFlowValue * 0.15;

    const makeProj = (weekly: number) => ({
      weekly: Number(weekly),
      projection12: Number(weekly * 12),
      projection26: Number(weekly * 26)
    });

    const payload: ApiResponse = {
      cached: false,
      generated_at: new Date().toISOString(),
      tiles: {
        currentBalance: Number(currentBalance),
        weeklyAvgSpend26: Number(weeklyAvgSpend26),
        monthlyNetFlow: Number(monthlyNetFlow)
      },
      topCategories,
      topPayees,
      recurring,
      upcomingBills,
      charts: {
        weeklySeries26,
        categoryDonut: topCategories,
        topPayeesBar: topPayees,
        recurringSparkline: recurring.slice(0, 1).map(r => Number(r.avg_amount))
      },
      savingsScenarios: {
        methodUsed: 'weeklyNetFlow (avg of weekly totals)',
        weeklyNetFlowValue: Number(weeklyNetFlowValue),
        conservative: makeProj(conservativeWeekly),
        moderate: makeProj(moderateWeekly),
        aggressive: makeProj(aggressiveWeekly)
      },
      unmappedPayees
    };

    return res.status(200).json(payload);
  } catch (err: any) {
    console.error('dashboard-summary error', err);
    return res.status(500).json({ error: 'internal_error' } as any);
  }
}
