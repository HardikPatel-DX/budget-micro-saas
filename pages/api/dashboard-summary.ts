// pages/api/dashboard-summary.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

type SummaryResponse = {
  cached: boolean;
  generated_at: string;
  tiles: {
    currentBalance: number;
    weeklyAvgSpend26: number;
    monthlyNetFlow: number;
  };
  topCategories: Array<{ category: string; amount: number }>;
  topPayees: Array<{ payee: string; amount: number }>;
  recurring: Array<{
    payee: string;
    avg_amount: number;
    frequency: 'weekly' | 'monthly' | 'unknown';
    last_date: string | null;
    next_date: string | null;
    occurrences: number;
  }>;
  upcomingBills: Array<{
    payee: string;
    amount: number;
    next_date: string | null;
  }>;
  charts: {
    weeklySeries26: { weekStart: string; amount: number }[];
    categoryDonut: { category: string; amount: number }[];
    topPayeesBar: { payee: string; amount: number }[];
    recurringSparklines: { payee: string; points: number[] }[];
  };
  unmappedPayees?: string[]; // suggestions
  savingsScenarios: {
    methodUsed: 'weeklyNetFlow' | 'weeklyAvgSpend';
    weeklyNetFlowValue: number;
    conservative: { weekly: number; projection12: number; projection26: number };
    moderate: { weekly: number; projection12: number; projection26: number };
    aggressive: { weekly: number; projection12: number; projection26: number };
  };
};

// Simple in-memory cache (TTL 5 minutes).
let CACHE: { ts: number; payload: SummaryResponse } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function safeNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Require user token from Authorization Bearer or cookie
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    if (!token && req.cookies['sb-access-token']) {
      // fallback cookie name often used by supabase
      // (cookie may contain an object; if it's raw token, use it)
      // Expecting raw token
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const ck = req.cookies['sb-access-token'];
      // if cookie contains JSON session, try to parse
      try {
        const parsed = typeof ck === 'string' && ck.startsWith('{') ? JSON.parse(ck) : ck;
        const maybe = parsed?.access_token || parsed;
        if (maybe && typeof maybe === 'string') {
          // override token
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          (token as any) = maybe;
        }
      } catch (e) {
        // ignore
      }
    }

    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization token (Bearer <token>)' });
    }

    // Return cached if fresh
    if (CACHE && Date.now() - CACHE.ts < CACHE_TTL_MS) {
      // still valid
      const copy = { ...CACHE.payload, cached: true };
      return res.status(200).json(copy);
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      return res.status(500).json({ error: 'Supabase env vars not configured' });
    }

    // Create supabase client using anon/public key and then set auth to user token
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: false, detectSessionInUrl: false },
    });

    // Attach user JWT so RLS applies.
    supabase.auth.setAuth(token);

    // Get user (owner) id when possible
    const userRes = await supabase.auth.getUser();
    const userId = userRes?.data?.user?.id ?? null;

    // Fetch transactions for this user (owner-aware). We'll guard amounts and dates.
    // We select necessary fields only.
    let q = supabase.from('transactions').select('id, amount, date_parsed, date, created_at, category, payee_clean, payee_norm, description').order('date_parsed', { ascending: false }).limit(5000);
    if (userId) q = q.eq('owner', userId);

    const { data: txRows, error: txError } = await q;
    if (txError) {
      console.error('transactions select error', txError);
      return res.status(500).json({ error: 'Error fetching transactions' });
    }
    const transactions = (txRows || []).map((r: any) => {
      const dateStr = r.date_parsed || r.date || r.created_at;
      const dateObj = dateStr ? new Date(dateStr) : null;
      return {
        id: r.id,
        amount: safeNumber(r.amount),
        date: dateObj,
        category: r.category || 'Uncategorized',
        payee: r.payee_norm || r.payee_clean || (r.description || 'Unknown'),
        rawPayee: r.payee_clean || r.payee_norm || (r.description || 'Unknown'),
      };
    }).filter((t: any) => typeof t.amount === 'number' && !Number.isNaN(t.amount) && t.date);

    // If no transactions, short-circuit
    if (transactions.length === 0) {
      const emptyPayload: SummaryResponse = {
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
          aggressive: { weekly: 0, projection12: 0, projection26: 0 },
        }
      };
      CACHE = { ts: Date.now(), payload: emptyPayload };
      return res.status(200).json({ ...emptyPayload, cached: false });
    }

    // Current balance: sum of amounts (assumes positive = inflow, negative = outflow)
    const currentBalance = transactions.reduce((s: number, t: any) => s + t.amount, 0);

    // Weekly time-series for last 26 weeks (week start = day-6..)
    const now = new Date();
    // compute 26 week windows ending this week (week start = Monday of each week)
    function startOfWeek(d: Date) {
      // Monday start
      const dd = new Date(d);
      const day = (dd.getDay() + 6) % 7; // Monday=0
      dd.setDate(dd.getDate() - day);
      dd.setHours(0,0,0,0);
      return dd;
    }
    const thisWeekStart = startOfWeek(now);
    const weeklySeries26: { weekStart: string; amount: number }[] = [];
    for (let i = 25; i >= 0; i--) {
      const ws = new Date(thisWeekStart);
      ws.setDate(ws.getDate() - i * 7);
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      const total = transactions.filter((t: any) => t.date >= ws && t.date < we).reduce((s: number, t: any) => s + (t.amount < 0 ? -t.amount : 0), 0);
      // we treat weeklySeries amount as total spend (positive number)
      weeklySeries26.push({ weekStart: isoDate(ws), amount: Number(total.toFixed(2)) });
    }

    // Weekly avg spend (last 26 weeks)
    const weeklyAvgSpend26 = (weeklySeries26.reduce((s, w) => s + w.amount, 0) / 26) || 0;

    // Monthly net flow (last full calendar month)
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyNetFlow = transactions.filter((t: any) => t.date >= lastMonthStart && t.date < lastMonthEnd).reduce((s: number, t: any) => s + t.amount, 0);

    // Top 5 categories (by absolute spend/flow)
    const categoryMap = new Map<string, number>();
    for (const t of transactions) {
      const key = t.category || 'Uncategorized';
      categoryMap.set(key, (categoryMap.get(key) || 0) + t.amount);
    }
    const topCategories = Array.from(categoryMap.entries())
      .map(([category, amount]) => ({ category, amount: Number(amount.toFixed(2)) }))
      .sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 5);

    // Top 10 payees (by total absolute spent)
    const payeeMap = new Map<string, number>();
    for (const t of transactions) {
      const k = t.payee || 'Unknown';
      payeeMap.set(k, (payeeMap.get(k) || 0) + t.amount);
    }
    const topPayees = Array.from(payeeMap.entries())
      .map(([payee, amount]) => ({ payee, amount: Number(amount.toFixed(2)) }))
      .sort((a,b) => Math.abs(b.amount) - Math.abs(a.amount))
      .slice(0, 10);

    // Try to read recurring_summary table for this user
    let recurringData: any[] = [];
    try {
      let rq = supabase.from('recurring_summary').select('*');
      if (userId) rq = rq.eq('owner', userId);
      const { data: recRows } = await rq;
      recurringData = recRows || [];
    } catch (e) {
      recurringData = [];
    }

    // If recurring_summary empty, fallback heuristic:
    if (!recurringData || recurringData.length === 0) {
      // heuristic: group by payee, require >=3 occurrences and consistent intervals
      const byPayee = new Map<string, any[]>();
      for (const t of transactions) {
        const k = t.payee || 'Unknown';
        if (!byPayee.has(k)) byPayee.set(k, []);
        byPayee.get(k).push(t);
      }
      const heuristics: any[] = [];
      for (const [payee, items] of byPayee.entries()) {
        if (items.length < 3) continue;
        // sort by date ascending
        const sorted = items.slice().sort((a,b) => a.date - b.date);
        const intervals: number[] = [];
        for (let i = 1; i < sorted.length; i++) {
          intervals.push((sorted[i].date.getTime() - sorted[i-1].date.getTime()) / (1000*60*60*24));
        }
        const avgInterval = intervals.reduce((s,n)=>s+n,0) / intervals.length;
        const sd = Math.sqrt(intervals.map(x => (x - avgInterval)**2).reduce((s,y)=>s+y,0)/intervals.length);
        // require SD not huge (<=15 days) and avgInterval between 6-40
        if (avgInterval >= 6 && avgInterval <= 40 && sd <= 15) {
          // frequency guess
          const freq = avgInterval <= 10 ? 'weekly' : 'monthly';
          const avgAmount = sorted.reduce((s:number, r:any) => s + r.amount, 0) / sorted.length;
          const lastDate = sorted[sorted.length -1].date;
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
    } else {
      // map recurring_summary rows to expected shape (best-effort)
      recurringData = recurringData.map((r: any) => ({
        payee: r.payee || r.payee_norm || 'Unknown',
        avg_amount: safeNumber(r.avg_amount || r.amount || 0),
        frequency: r.frequency || 'monthly',
        last_date: r.last_date || null,
        next_date: r.next_date || null,
        occurrences: r.occurrences || 1
      }));
    }

    // Upcoming bills: pick recurring items with next_date (or estimate)
    const upcomingBills = (recurringData || []).map((r: any) => ({
      payee: r.payee,
      amount: Number(r.avg_amount),
      next_date: r.next_date || null
    }));

    // Recurring sparklines: for each recurring payee produce last 12 points (monthly/weekly split)
    const recurringSparklines = (recurringData || []).slice(0,10).map((r: any) => {
      // points = extracted from transactions matching payee for last 12 periods
      const related = transactions.filter((t:any) => (t.payee || '').toLowerCase().includes((r.payee||'').toLowerCase()));
      // produce 12 points monthly aggregates if monthly, else weekly
      const points: number[] = [];
      const periods = 12;
      if (r.frequency === 'weekly') {
        // last 12 weeks
        for (let i = periods-1; i >= 0; i--) {
          const start = new Date(thisWeekStart);
          start.setDate(start.getDate() - i*7);
          const end = new Date(start); end.setDate(end.getDate()+7);
          const sum = related.filter((t:any)=>t.date >= start && t.date < end).reduce((s:number,t:any)=>s + Math.abs(t.amount),0);
          points.push(Number(sum.toFixed(2)));
        }
      } else {
        // monthly
        const nowM = new Date();
        for (let i = periods-1; i >= 0; i--) {
          const start = new Date(nowM.getFullYear(), nowM.getMonth() - i, 1);
          const end = new Date(start.getFullYear(), start.getMonth()+1, 1);
          const sum = related.filter((t:any) => t.date >= start && t.date < end).reduce((s:number,t:any)=>s + Math.abs(t.amount),0);
          points.push(Number(sum.toFixed(2)));
        }
      }
      return { payee: r.payee, points };
    });

    // Unmapped payees: query payee_mapping and compare
    const { data: mappingRows } = await supabase.from('payee_mapping').select('normalized,pattern').limit(1000);
    const mappedSet = new Set((mappingRows||[]).map((r:any)=>r.normalized));
    // Count raw payees occurrences
    const rawCounts = new Map<string, number>();
    for (const t of transactions) {
      const key = (t.rawPayee || '').trim();
      rawCounts.set(key, (rawCounts.get(key)||0) + 1);
    }
    const unmapped = Array.from(rawCounts.entries())
      .filter(([k]) => !mappedSet.has(k))
      .sort((a,b)=> b[1]-a[1])
      .slice(0, 10)
      .map(([k]) => k);

    // Charts: categoryDonut and topPayeesBar
    const categoryDonut = topCategories.map(c => ({ category: c.category, amount: c.amount }));
    const topPayeesBar = topPayees.map(p => ({ payee: p.payee, amount: p.amount }));

    // Savings scenarios: compute weeklyNetFlow (last 7 days) and fallback to weeklyAvgSpend26
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(now.getDate() - 7);
    const weeklyNetFlow = transactions.filter((t:any) => t.date >= sevenDaysAgo).reduce((s:number,t:any)=>s + t.amount, 0);
    const methodUsed = weeklyNetFlow !== 0 ? 'weeklyNetFlow' : 'weeklyAvgSpend';
    const baseWeekly = Math.abs(weeklyNetFlow) > 0 ? weeklyNetFlow : -weeklyAvgSpend26; // if net flow positive it's inflow; we want positive weekly numbers for saving logic; use negative of spend for positive
    const weeklyBaseValue = Math.abs(baseWeekly);

    function projection(weekly:number, weeks:number) {
      // simple linear projection
      return Number((weekly * weeks).toFixed(2));
    }
    const conservativeWeekly = Number((weeklyBaseValue * 0.05).toFixed(2));
    const moderateWeekly = Number((weeklyBaseValue * 0.10).toFixed(2));
    const aggressiveWeekly = Number((weeklyBaseValue * 0.15).toFixed(2));

    const summary: SummaryResponse = {
      cached: false,
      generated_at: new Date().toISOString(),
      tiles: {
        currentBalance: Number(currentBalance.toFixed(2)),
        weeklyAvgSpend26: Number(weeklyAvgSpend26.toFixed(2)),
        monthlyNetFlow: Number(monthlyNetFlow.toFixed(2))
      },
      topCategories,
      topPayees,
      recurring: recurringData.map((r:any)=>({
        payee: r.payee,
        avg_amount: Number(r.avg_amount),
        frequency: r.frequency || 'unknown',
        last_date: r.last_date || null,
        next_date: r.next_date || null,
        occurrences: r.occurrences || 1
      })),
      upcomingBills,
      charts: {
        weeklySeries26,
        categoryDonut,
        topPayeesBar,
        recurringSparklines
      },
      unmappedPayees: unmapped,
      savingsScenarios: {
        methodUsed: methodUsed as any,
        weeklyNetFlowValue: Number(weeklyNetFlow.toFixed(2)),
        conservative: { weekly: conservativeWeekly, projection12: projection(conservativeWeekly, 12), projection26: projection(conservativeWeekly, 26) },
        moderate: { weekly: moderateWeekly, projection12: projection(moderateWeekly, 12), projection26: projection(moderateWeekly, 26) },
        aggressive: { weekly: aggressiveWeekly, projection12: projection(aggressiveWeekly, 12), projection26: projection(aggressiveWeekly, 26) },
      }
    };

    // cache it
    CACHE = { ts: Date.now(), payload: summary };

    return res.status(200).json({ ...summary, cached: false });
  } catch (err: any) {
    console.error('dashboard-summary error', err);
    return res.status(500).json({ error: 'Unexpected error' });
  }
}
