// app/api/import/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type IncomingBody = {
  filename?: string;
  content?: string; // full CSV/TSV text
  importApiKey?: string; // optional (some clients send it here)
  apiKey?: string; // optional
};

function norm(s: string) {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function detectDelimiter(line: string) {
  // BMO export is usually TSV
  if (line.includes("\t")) return "\t";
  if (line.includes(",")) return ",";
  return "\t";
}

function parseDelimitedLine(line: string, delim: string): string[] {
  // Minimal CSV/TSV parser with quote support
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      // handle doubled quotes inside quoted field
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
  // Look for a line that contains all required columns, in any position
  const required = [
    "transaction type",
    "date posted",
    "transaction amount",
    "description",
  ];

  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] || "").trim();
    if (!raw) continue;

    const delim = detectDelimiter(raw);
    const cols = parseDelimitedLine(raw, delim).map(norm);

    const hasAll = required.every((r) => cols.includes(r));
    if (!hasAll) continue;

    return { headerIndex: i, delim, cols };
  }

  return null;
}

function pickIndex(cols: string[], name: string) {
  return cols.findIndex((c) => c === norm(name));
}

export async function POST(req: Request) {
  try {
    const IMPORT_API_KEY = process.env.IMPORT_API_KEY || "";
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return NextResponse.json(
        { ok: false, error: "Missing Supabase server env vars" },
        { status: 500 }
      );
    }

    // Auth: accept API key via header OR body (keeps current /upload working)
    const headerKey =
      req.headers.get("x-import-api-key") ||
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
      "";

    const body = (await req.json().catch(() => ({}))) as IncomingBody;

    const bodyKey = (body.importApiKey || body.apiKey || "").trim();
    const providedKey = (headerKey || bodyKey).trim();

    if (!IMPORT_API_KEY || providedKey !== IMPORT_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized (bad IMPORT_API_KEY)" },
        { status: 401 }
      );
    }

    const content = (body.content || "").toString();
    if (!content.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing file content" },
        { status: 400 }
      );
    }

    // Normalize newlines and split
    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    // Find header anywhere
    const header = findHeader(lines);
    if (!header) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Could not find header row. Expected columns: Transaction Type, Date Posted, Transaction Amount, Description",
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
      return NextResponse.json(
        { ok: false, error: "Header detected but required columns missing" },
        { status: 400 }
      );
    }

    // Parse rows after header
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

      // Guard: some lines may be shorter
      const tType = (fields[idxType] || "").trim();
      const dPosted = (fields[idxDate] || "").trim();
      const amt = (fields[idxAmt] || "").trim();

      // Description sometimes includes extra tokens; join any remaining columns
      let desc = (fields[idxDesc] || "").trim();
      if (fields.length > idxDesc + 1) {
        const tail = fields.slice(idxDesc + 1).join(" ").trim();
        if (tail) desc = `${desc} ${tail}`.trim();
      }

      // Skip obvious non-data lines
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
      return NextResponse.json(
        {
          ok: false,
          error: "No data rows found after header",
          headerIndex,
        },
        { status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Insert in batches
    const BATCH = 500;
    let insertedCount = 0;
    let firstInserted: any = null;

    for (let i = 0; i < rowsToInsert.length; i += BATCH) {
      const batch = rowsToInsert.slice(i, i + BATCH);

      const { data, error } = await supabase
        .from("staging_import")
        .insert(batch)
        .select("id,date_raw,transaction_type,amount_raw,description,created_at,processed");

      if (error) {
        return NextResponse.json(
          { ok: false, error: error.message, insertedCount },
          { status: 500 }
        );
      }

      insertedCount += (data || []).length;
      if (!firstInserted && data && data.length > 0) firstInserted = data[0];
    }

    return NextResponse.json({
      ok: true,
      filename: body.filename || null,
      detected: {
        delimiter: delim === "\t" ? "TAB" : "COMMA",
        headerIndex,
        headerColumns: cols,
      },
      inserted_count: insertedCount,
      sample_inserted_row: firstInserted,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
