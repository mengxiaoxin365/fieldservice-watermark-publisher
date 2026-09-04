import assert from "node:assert/strict";
import { publishPhoto } from "./publish_service.js";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  assert.equal(body.image, "img-original");
  assert.deepEqual(body.ops, [{ type: "watermark", text: "WO-42 / inspected by Mei", position: "bottom-right", opacity: 0.75 }]);
  assert.equal(body.idempotency_key, "WO-42");
  return new Response(JSON.stringify({ ok: true, data: { id: "img-processed" }, metadata: {} }), { status: 200 });
};
process.env.INFRAI_API_KEY = "test-key";
const result = await publishPhoto({ workOrderId: "WO-42", technician: "Mei", photo: "img-original", watermark: "WO-42 / inspected by Mei" });
assert.equal(result.status, "published");
assert.equal((result.image as { id: string }).id, "img-processed");
globalThis.fetch = originalFetch;
console.log("publish decision test passed");
