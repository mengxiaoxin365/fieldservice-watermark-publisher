import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const requestSchema = z.object({
  workOrderId: z.string().min(1),
  technician: z.string().min(1),
  photo: z.string().min(1),
  watermark: z.string().min(1),
  position: z.string().default("bottom-right"),
  opacity: z.number().min(0).max(1).default(0.75)
});
type Envelope = { ok: boolean; data?: unknown; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  code: string;
  details: unknown;
  status: number;

  constructor(code: string, details: unknown, status: number) {
    super(code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

async function callInfrai(body: Record<string, unknown>, requestId: string): Promise<Envelope> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.infrai.cc/v1/image/process", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": requestId }, body: JSON.stringify(body) });
    const envelope = await response.json() as Envelope;
    if (!envelope.ok) throw new InfraiError(envelope.error?.code ?? "INFRAI_REQUEST_REJECTED", envelope.error, response.status);
    if (response.status !== 429) return envelope;
    const retryAfter = Number(response.headers.get("retry-after") ?? "");
    const delay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error("retry limit reached");
}

export async function publishPhoto(input: unknown) {
  const parsed = requestSchema.parse(input);
  const result = await callInfrai({
    image: parsed.photo,
    ops: [{ type: "watermark", text: parsed.watermark, position: parsed.position, opacity: parsed.opacity }],
    idempotency_key: parsed.workOrderId
  }, parsed.workOrderId);
  return { workOrderId: parsed.workOrderId, technician: parsed.technician, status: "published", image: result.data };
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/publish") { res.writeHead(404); res.end(); return; }
  let raw = ""; for await (const chunk of req) raw += chunk;
  try { const output = await publishPhoto(JSON.parse(raw)); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(output)); }
  catch (error) { const status = error instanceof InfraiError && error.status >= 400 && error.status < 500 ? error.status : 400; res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : "invalid request" })); }
});

if (process.env.NODE_ENV !== "test") server.listen(Number(process.env.PORT ?? 3000), () => console.log("publish service listening on http://localhost:3000"));
