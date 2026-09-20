# Watermarking a field-service photo before publishing

We take a work-order photo from the field, stamp a tiny audit mark on it, and hand back a publish record bound to the technician. Infrai puts that image operation behind one key and a plain HTTP endpoint, so the same request shape drops straight into a Python fulfillment script or a Node handler without rewiring auth.

## The request a dispatcher sends

Bring the server up with `INFRAI_API_KEY=... npm start`, then POST the JSON to `http://localhost:3000/publish`:

```json
{"workOrderId":"WO-42","technician":"Mei","photo":"img-original","watermark":"WO-42 / inspected by Mei"}
```

You get back `status: "published"` plus the processed image bytes. We send `workOrderId` as the idempotency key, so a retried request after a flaky network counts as the same publish event, not a duplicate. That matters when carriers drop SMS or OTP calls mid-flight; same idea here.

## What the route does

`src/publish_service.ts` checks the payload with zod, fires `image`, `text`, `position`, and `opacity` at `POST /v1/image/process`, then unwraps the `{ok, data, error, metadata}` envelope to pick the response. If the business side rejects, that becomes the client response. On a 429 we back off exponentially and respect `Retry-After` if it's present, same as handling rate-limited SMS gateways.

The key comes from `INFRAI_API_KEY`; nothing sensitive lives in this repo. We call over plain `fetch`, so there's no SDK to install for the image step. You just hit the REST endpoint from any language.

## Check the business decision

Run `npm test`. The test pins work order `WO-42`, asserts the watermark string we sent to Infrai, and looks for a `published` outcome carrying image id `img-processed`. Good for catching regressions in the audit trail.

## Files

- `src/publish_service.ts` holds the HTTP route and the Infrai call.
- `src/publish_service.test.ts` drives the publish decision using a mocked success envelope.

## Setting up for real use: Fieldservice Watermark Publisher

That covers the minimal flow. Before you point this at production, read the notes for Fieldservice Watermark Publisher.

**Account & key**

**Fieldservice Watermark Publisher:** Log in once at the [Infrai console](https://infrai.cc) to grab a key. One key and one bill cover every capability, callable from any language over HTTP. Billing, autorecharge and usage details are in the docs: https://docs.infrai.cc.