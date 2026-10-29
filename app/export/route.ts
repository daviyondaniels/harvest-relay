import { current } from "../lib/hub.ts";
import { dayRecord, recordFilename } from "../lib/record.ts";

export const dynamic = "force-dynamic";

// The day record as one JSON file (see app/lib/record.ts). Synthetic demo data only.
export async function GET() {
  const { state: w, version } = await current();
  return new Response(JSON.stringify(dayRecord(w, version, new Date().toISOString()), null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${recordFilename(w)}"`, "cache-control": "no-store" }
  });
}
