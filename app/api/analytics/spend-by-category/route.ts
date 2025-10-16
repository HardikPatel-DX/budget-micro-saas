import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sumAmountsByCategory(rows: Array<any>) {
  const map: Record<string, number> = {};
  for (const r of rows) {
    const cat = r.category || 'Uncategorized';
    const amt = Number(r.amount || r.amount_num || 0);
    map[cat] = (map[cat] || 0) + (isNaN(amt) ? 0 : amt);
  }
  const out = Object.entries(map).map(([category, total]) => ({ category, total }));
  out.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  return out;
}

export async function GET() {
  try {
    // last 30 days (server-side)
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const startIso = start.toISOString().split('T')[0];

    // Query supabase REST for category + amount for rows in last 30 days
    // limit set to 10000 to avoid runaway fetches; adjust if needed
    const url = `${SUPABASE_URL}/rest/v1/transactions?select=category,amount,amount_num,date&date=gte.${startIso}&limit=10000`;
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('Supabase fetch failed', res.status, txt);
      return NextResponse.json({ ok: false, error: txt }, { status: 502 });
    }

    const rows = await res.json();
    const data = sumAmountsByCategory(rows);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error('analytics error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
