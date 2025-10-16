import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SEED_DEMO_KEY = process.env.SEED_DEMO_KEY || '';

export async function POST(req: Request) {
  try {
    // Expect Authorization: Bearer <access_token>
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ ok: false, error: 'Missing authorization' }, { status: 401 });
    }

    // Verify the token with Supabase auth/v1/user
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

    // token is valid; call the protected internal seed endpoint using server key
    const url = `${process.env.NEXT_PUBLIC_SITE_ORIGIN || 'https://budget-micro-saas.vercel.app'}/api/seed-demo`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-seed-key': SEED_DEMO_KEY,
      },
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, body: data }, { status: 500 });
    }
    return NextResponse.json({ ok: true, inserted: data }, { status: 200 });
  } catch (err) {
    console.error('seed-demo-trigger error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
