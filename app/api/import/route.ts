// app/api/import/route.ts
import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IMPORT_API_KEY = process.env.IMPORT_API_KEY || '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn('Missing SUPABASE env vars in server environment.');
}
if (!IMPORT_API_KEY) {
  console.warn('IMPORT_API_KEY is not set. /api/import will be unprotected.');
}

export async function POST(req: Request) {
  try {
    // ---- API key guard ----
    const reqApiKey = req.headers.get('x-api-key') || '';
    if (!IMPORT_API_KEY || reqApiKey !== IMPORT_API_KEY) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // ---- existing logic (unchanged, just inside the guard) ----
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

    // Ensure headers are strictly string->string so TS accepts them as HeadersInit
    const key = SERVICE_ROLE_KEY ?? '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // For Supabase REST, include apikey + Authorization with service role
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation'
    };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    if (!res.ok) {
      console.error('Supabase REST error', res.status, res.statusText, data);
      return NextResponse.json({
        ok: false,
        status: res.status,
        statusText: res.statusText,
        body: data
      }, { status: 500 });
    }

    // Inserted rows returned (representation). The staging trigger should then run.
    return NextResponse.json({ ok: true, inserted: data }, { status: 200 });
  } catch (err) {
    console.error('Import handler error', err);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
