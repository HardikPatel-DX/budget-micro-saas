// app/api/import/route.ts
import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn('Missing SUPABASE env vars in server environment.');
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // Accepts fields: date_raw, transaction_type, amount_raw, description
    const {
      date_raw = new Date().toISOString().split('T')[0],
      transaction_type = 'Import',
      amount_raw = '0',
      description = 'Test import row'
    } = body;

    // Build payload as array (supabase-rest expects array of objects for insert)
    const payload = [{
      date_raw: String(date_raw),
      transaction_type: String(transaction_type),
      amount_raw: String(amount_raw),
      description: String(description)
    }];

    const url = `${SUPABASE_URL}/rest/v1/staging_import`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // For Supabase REST, include apikey + Authorization with service role
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Prefer: 'return=representation'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        status: res.status,
        statusText: res.statusText,
        body: data
      }, { status: 500 });
    }

    // Inserted rows returned (representation). The staging trigger should then run.
    return NextResponse.json({ ok: true, inserted: data }, { status: 200 });

  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 });
  }
}
