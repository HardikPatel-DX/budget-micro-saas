// app/api/import/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type IncomingBody = {
  filename?: string;
  content?: string;
  importApiKey?: string;
  apiKey?: string;
};

function norm(s: string) {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function detectDelimiter(line: string) {
  if (line.includes("\t")) return "\t";
  if (line.includes(",")) return ",";
  return "\t";
}

function parseDelimitedLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && ch === delim) {
      out.push(cur.trim());
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur.trim());
  return out;
}

function findHeader(lines: string[]) {
  const required = ["transaction type", "date posted", "transaction amount", "description"];

  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] || "").trim();
    if (!raw) continue;

    const delim = detectDelimiter(raw);
    const cols = parseDelimitedLine(raw, delim).map(norm);

    if (required.every((r) => cols.includes(r))) {
      return { headerIndex: i, delim, cols };
    }
  }

  return null;
}

function pickIndex(cols: string[], name: string) {
  return cols.findIndex((c) => c === norm(name));
}

function parseBmoDateToISO(dateRaw: string): string | null {
  const s = (dateRaw || "").trim();
  if (!s) return null;

  if (/^\d{8}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    return `${y}-${m}-${d}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [mm, dd, yyyy] = s.split("/");
    const m = mm.padStart(2, "0");
    const d = dd.padStart(2, "0");
    return `${yyyy}-${m}-${d}`;
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function parseAmount(amountRaw: string): number | null {
  const s = (amountRaw || "").toString().trim();
  if (!s) return null;

  const cleaned = s.replace(/[$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cleanPayee(description: string): string {
  const s = (description || "").trim();
  if (!s) return "Unknown";
  return s.replace(/\s+/g, " ").replace(/^\[.*?\]\s*/g, "").trim().slice(0, 180);
}

function normPayee(payee: string): string {
  return (payee || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export async function POST(req: Request) {
  try {
    const IMPORT_API_KEY = process.env.IMPORT_API_KEY || "";
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return NextResponse.json({ ok: false, error: "Missing Supabase server env vars" }, { status: 500 });
    }

    const headerKey =
      req.headers.get("x-api-key") ||
      req.headers.get("x-import-api-key") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";

    const body = (await req.json().catch(() => ({}))) as IncomingBody;
    const bodyKey = (body.importApiKey || body.apiKey || "").trim();
    const providedKey = (headerKey || bodyKey).trim();

    if (!IMPORT_API_KEY || providedKey !== IMPORT_API_KEY) {
      return NextResponse.json({ ok: false, error: "Unauthorized (bad IMPORT_API_KEY)" }, { status: 401 });
    }

    const content = (body.content || "").toString();
    if (!content.trim()) {
      return NextResponse.json({ ok: false, error: "Missing file content" }, { status: 400 });
    }

    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    const header = findHeader(lines);
    if (!header) {
      return NextResponse.json(
        {
          ok: false,
          error: "Could not find header row. Expected columns: Transaction Type, Date Posted, Transaction Amount, Description",
        },
        { status: 400 }
      );
    }

    const { headerIndex, delim, cols } = header;

    const idxType = pickIndex(cols, "Transaction Type");
    const idxDate = pickIndex(cols, "Date Posted");
    const idxAmt = pickIndex(cols, "Transaction Amount");
    const idxDesc = pickIndex(cols, "Description");

    if (idxType < 0 || idxDate < 0 || idxAmt < 0 || idxDesc < 0) {
      return NextResponse.json({ ok: false, error: "Header detected but required columns missing" }, { status: 400 });
    }

    const rowsToInsert: Array<{
      date_raw: string;
      transaction_type: string;
      amount_raw: string;
      description: string;
      processed: boolean;
    }> = [];

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const raw = (lines[i] || "").trim();
      if (!raw) continue;

      const fields = parseDelimitedLine(raw, delim);

      const tType = (fields[idxType] || "").trim();
      const dPosted = (fields[idxDate] || "").trim();
      const amt = (fields[idxAmt] || "").trim();

      let desc = (fields[idxDesc] || "").trim();
      if (fields.length > idxDesc + 1) {
        const tail = fields.slice(idxDesc + 1).join(" ").trim();
        if (tail) desc = `${desc} ${tail}`.trim();
      }

      if (!tType || !dPosted || !amt) continue;

      rowsToInsert.push({
        date_raw: dPosted,
        transaction_type: tType.toUpperCase(),
        amount_raw: amt,
        description: desc || "Unknown",
        processed: false,
      });
    }

    if (rowsToInsert.length === 0) {
      return NextResponse.json({ ok: false, error: "No data rows found after header", headerIndex }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // 1) Insert staging rows and capture IDs
    const BATCH = 500;
    let insertedCount = 0;
    const insertedStage: any[] = [];

    for (let i = 0; i < rowsToInsert.length; i += BATCH) {
      const batch = rowsToInsert.slice(i, i + BATCH);

      const { data, error } = await supabase
        .from("staging_import")
        .insert(batch)
        .select("id,date_raw,transaction_type,amount_raw,description,processed");

      if (error) {
        return NextResponse.json({ ok: false, error: error.message, inserted_count: insertedCount }, { status: 500 });
      }

      insertedCount += batch.length;
      if (data && data.length) insertedStage.push(...data);
    }

    // 2) Build candidate transactions
    const candidates = insertedStage
      .map((r: any) => {
        const iso = parseBmoDateToISO(r.date_raw);
        const amtNum = parseAmount(r.amount_raw);
        if (!iso || amtNum === null) return null;

        const payeeClean = cleanPayee(r.description || "");
        const payeeN = normPayee(payeeClean);

        return {
          date: iso,
          transaction_type: String(r.transaction_type || ""),
          amount: amtNum,
          description: String(r.description || ""),
          payee_clean: payeeClean,
          payee_norm: payeeN,
          category: "Uncategorized",
          is_transfer: false,
          is_savings: false,
          likely_loc: false,
          notes: null,
          source_staging_id: r.id,
          date_parsed: iso,
          amount_num: amtNum,
          processed: true,
        };
      })
      .filter(Boolean) as any[];

    if (candidates.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Inserted staging rows but none could be parsed into transactions.", inserted_count: insertedCount },
        { status: 400 }
      );
    }

    // 3) Dedupe without relying on DB constraints: only insert missing source_staging_id
    const stageIds = insertedStage.map((r: any) => r.id).filter(Boolean);

    const existing = await supabase
      .from("transactions")
      .select("source_staging_id")
      .in("source_staging_id", stageIds);

    if (existing.error) {
      return NextResponse.json(
        { ok: false, error: existing.error.message, inserted_count: insertedCount, processed_count: 0 },
        { status: 500 }
      );
    }

    const existingSet = new Set((existing.data || []).map((x: any) => x.source_staging_id));
    const toInsert = candidates.filter((t: any) => !existingSet.has(t.source_staging_id));

    let processedCount = 0;
    const sample: any[] = [];

    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH);

      const { data, error } = await supabase
        .from("transactions")
        .insert(batch)
        .select("id,source_staging_id")
        .limit(20);

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message, inserted_count: insertedCount, processed_count: processedCount },
          { status: 500 }
        );
      }

      processedCount += batch.length;
      if (data && data.length && sample.length < 20) {
        sample.push(...data.slice(0, 20 - sample.length));
      }
    }

    // 4) Mark all inserted staging rows processed (even if tx already existed)
    const { error: updErr } = await supabase.from("staging_import").update({ processed: true }).in("id", stageIds);

    if (updErr) {
      return NextResponse.json(
        { ok: false, error: updErr.message, inserted_count: insertedCount, processed_count: processedCount },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      filename: body.filename || null,
      detected: { delimiter: delim === "\t" ? "TAB" : "COMMA", headerIndex, headerColumns: cols },
      inserted_count: insertedCount,
      processed_count: processedCount,
      skipped_existing_count: candidates.length - toInsert.length,
      sample_transactions: sample,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
