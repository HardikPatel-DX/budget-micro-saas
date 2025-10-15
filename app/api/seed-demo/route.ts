import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: Request) {
  try {
    // You may want to verify session / user here via cookies or Authorization if needed.
    const demoData = [
      { date_raw: '2025-09-01', transaction_type: 'Card', amount_raw: '-25.00', description: 'Coffee' },
      { date_raw: '2025-09-02', transaction_type: 'Card', amount_raw: '-120.00', description: 'Groceries' },
      // ... add ~20 rows to give a feel of data
    ];
    const url = `${SUPABASE_URL}/rest/v1/staging_import`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: 'return=representation'
      },
      body: JSON.stringify(demoData)
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ ok: false, error: text }, { status: 500 });
    }
    const json = await res.json();
    return NextResponse.json({ ok: true, inserted: json });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
