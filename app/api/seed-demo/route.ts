// app/api/seed-demo/route.ts
import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: Request) {
  try {
    // You may want to verify session / user here via cookies or Authorization if needed.
    // This demo data is intentionally simple — adjust or extend as needed.
    const demoData = [
      { date_raw: '2025-09-01', transaction_type: 'Card', amount_raw: '-25.00', description: 'Coffee' },
      { date_raw: '2025-09-02', transaction_type: 'Card', amount_raw: '-120.00', description: 'Groceries' },
      { date_raw: '2025-09-03', transaction_type: 'Card', amount_raw: '-60.00', description: 'Gas' },
      { date_raw: '2025-09-04', transaction_type: 'Card', amount_raw: '-15.00', description: 'Snacks' },
      { date_raw: '2025-09-05', transaction_type: 'Card', amount_raw: '-200.00', description: 'Rent' },
      { date_raw: '2025-09-06', transaction_type: 'Card', amount_raw: '-50.00', description: 'Utilities' },
      { date_raw: '2025-09-07', transaction_type: 'Card', amount_raw: '-12.00', description: 'Lunch' },
      { date_raw: '2025-09-08', transaction_type: 'Card', amount_raw: '-30.00', description: 'Transport' },
      { date_raw: '2025-09-09', transaction_type: 'Card', amount_raw: '-9.99', description: 'Subscription' },
      { date_raw: '2025-09-10', transaction_type: 'Card', amount_raw: '-40.00', description: 'Shopping' }
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
      console.error('Supabase staging_import failed:', res.status, res.statusText, text);
      return NextResponse.json({ ok: false, error: text }, { status: 500 });
    }

    const json = await res.json();
    return NextResponse.json({ ok: true, inserted: json });
  } catch (err) {
    console.error('seed-demo handler error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
