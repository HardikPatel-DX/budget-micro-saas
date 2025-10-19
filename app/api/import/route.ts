// app/api/import/route.ts
import { NextResponse } from 'next/server';

/**
 * Protected import route (app router)
 * - Requires header: x-api-key === IMPORT_API_KEY (set in Vercel)
 * - Inserts into staging_import via Supabase REST using service role key (server-only env)
 * - Returns inserted rows (representation) or an error
 *
 * Env required (server):
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * - IMPORT_API_KEY
 *
 * NOTE: Never expose the service role key to the browser.
 */

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

    // ---- parse body ----
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

    if (!SUPABASE_URL) {
      return NextResponse.json({ ok: false, error: 'Supabase URL not configured' }, { status: 500 });
    }

    const url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/staging_import`;

    // Ensure header values are strings for TS; use Headers
    const key = SERVICE_ROLE_KEY ?? '';
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('apikey', key);
    headers.set('Authorization', `Bearer ${key}`);
    headers.set('Prefer', 'return=representation');

    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    let data: any;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    if (!r.ok) {
      console.error('Supabase REST error', r.status, r.statusText, data);
      return NextResponse.json({
        ok: false,
        status: r.status,
        statusText: r.statusText,
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
