import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(req: Request) {
  try {
    // Expect Authorization: Bearer <access_token> from the client
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ ok: false, error: 'Missing authorization' }, { status: 401 });
    }

    // Verify the token with Supabase auth endpoint and get the user id
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': authHeader,
        'apikey': SERVICE_ROLE
      }
    });

    if (!userRes.ok) {
      const txt = await userRes.text();
      console.error('Invalid session or token:', userRes.status, txt);
      return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 });
    }

    const userJson = await userRes.json();
    // Supabase /auth/v1/user returns the user object; id is the uid
    const uid = userJson?.id;
    if (!uid) {
      console.error('Could not determine user id from auth response', userJson);
      return NextResponse.json({ ok: false, error: 'Invalid session payload' }, { status: 401 });
    }

    // Build demo transactions with owner set to this user's uid
    const demoData = [
      { date: '2025-09-01', transaction_type: 'Card', amount: '-25.00', description: 'Coffee', owner: uid },
      { date: '2025-09-02', transaction_type: 'Card', amount: '-120.00', description: 'Groceries', owner: uid },
      { date: '2025-09-03', transaction_type: 'Card', amount: '-60.00', description: 'Gas', owner: uid },
      { date: '2025-09-04', transaction_type: 'Card', amount: '-15.00', description: 'Snacks', owner: uid },
      { date: '2025-09-05', transaction_type: 'Card', amount: '-200.00', description: 'Rent', owner: uid },
      { date: '2025-09-06', transaction_type: 'Card', amount: '-50.00', description: 'Utilities', owner: uid },
      { date: '2025-09-07', transaction_type: 'Card', amount: '-12.00', description: 'Lunch', owner: uid },
      { date: '2025-09-08', transaction_type: 'Card', amount: '-30.00', description: 'Transport', owner: uid },
      { date: '2025-09-09', transaction_type: 'Card', amount: '-9.99', description: 'Subscription', owner: uid },
      { date: '2025-09-10', transaction_type: 'Card', amount: '-40.00', description: 'Shopping', owner: uid }
    ];

    // Insert directly into transactions with the service role key (bypasses RLS)
    const url = `${SUPABASE_URL}/rest/v1/transactions`;
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

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    if (!res.ok) {
      console.error('Supabase transactions insert failed:', res.status, res.statusText, text);
      return NextResponse.json({ ok: false, error: text }, { status: 502 });
    }

    return NextResponse.json({ ok: true, inserted: data }, { status: 200 });
  } catch (err) {
    console.error('seed-demo-trigger per-user error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
