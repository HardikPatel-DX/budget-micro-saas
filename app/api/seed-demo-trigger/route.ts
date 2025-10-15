import { NextResponse } from 'next/server';

const SEED_DEMO_KEY = process.env.SEED_DEMO_KEY || '';

export async function POST(req: Request) {
  try {
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
