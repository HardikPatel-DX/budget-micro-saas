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
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');

    const authHeader = (req.headers.authorization as string) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader || null;
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization Bearer token' });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON) {
      return res.status(500).json({ error: 'Missing Supabase configuration on server' });
    }

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

    const rows: any[] = await (async () => {
      try {
        return await restFetch(`transactions?select=transaction_id,amount,date_parsed,created_at,category,payee&order=date_parsed.desc,created_at.desc&limit=2000`);
      } catch (err) {
        console.error('restFetch transactions error', err);
        return [];
      }
    })();

    const normalized = rows
      .map(r => {
        const date = (r.date_parsed || r.created_at || null);
        const amount = safeNum(r.amount);
        return { ...r, date, amount, category: r.category || 'Uncategorized', payee: r.payee || 'Unknown' };
      })
      .filter(r => Number.isFinite(r.amount) && !Number.isNaN(r.amount));

    const currentBalance = normalized.reduce((s, r) => s + r.amount, 0);

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

    const weeklySpendValues: number[] = weeklyKeys.map(k => {
      return normalized
        .filter(r => isoWeekStart(new Date(r.date)) === k && r.amount < 0)
        .reduce((s, r) => s + Math.abs(r.amount), 0);
    });
    const totalSpend = weeklySpendValues.reduce((s, v) => s + v, 0);
    const weeklyAvgSpend26 = weeklySpendValues.length ? totalSpend / weeklySpendValues.length : 0;

    const ms30 = 30 * 24 * 3600 * 1000;
    const since = new Date(Date.now() - ms30);
    const monthlyNetFlow = normalized.filter(r => new Date(r.date) >= since).reduce((s, r) => s + r.amount, 0);

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

    // Build by-payee groups safely (TS-safe)
    const byPayee = new Map<string, any[]>();
    normalized.forEach(t => {
      const k = (t.payee || 'Unknown') as string;
      const arr = byPayee.get(k) || [];
      arr.push(t);
      byPayee.set(k, arr);
    });

    // Recurring detection heuristic
    const heuristics: { payee: string; avg_amount: number; frequency: string; last_date: string | null }[] = [];
    const recent90 = new Date(Date.now() - 90 * 24 * 3600 * 1000);
    for (const [payee, arr] of byPayee.entries()) {
      // consider only recent group members (last 90 days)
      const recentArr = arr.filter((x: any) => new Date(x.date) >= recent90);
      if (recentArr.length >= 3) {
        const avg = recentArr.reduce((s: number, t: any) => s + t.amount, 0) / recentArr.length;
        const dates = recentArr.map((a: any) => new Date(a.date).getTime()).sort();
        let avgDeltaDays = 0;
        if (dates.length >= 2) {
          let sum = 0;
          for (let i = 1; i < dates.length; i++) sum += (dates[i] - dates[i - 1]);
          avgDeltaDays = Math.round((sum / (dates.length - 1)) / (24 * 3600 * 1000));
        }
        let freq: 'weekly' | 'monthly' | 'unknown' = 'unknown';
        if (avgDeltaDays > 0 && avgDeltaDays <= 10) freq = 'weekly';
        else if (avgDeltaDays > 10 && avgDeltaDays <= 40) freq = 'monthly';

        heuristics.push({
          payee,
          avg_amount: Number(avg),
          frequency: freq,
          last_date: recentArr.map((a: any) => a.date).sort().reverse()[0] || null
        });
      }
    }

    const recurring = heuristics;

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
