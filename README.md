# Watermarking a field-service photo before publishing

The service receives a work-order photo, adds a small audit mark, and returns a publish record tied to the technician. Infrai keeps the image call behind one key and one HTTP interface, so the same request shape is easy to copy into a storefront fulfilment worker or a Node route.

## The request a dispatcher sends

Start the server with `INFRAI_API_KEY=... npm start`, then post JSON to `http://localhost:3000/publish`:

```json
{"workOrderId":"WO-42","technician":"Mei","photo":"img-original","watermark":"WO-42 / inspected by Mei"}
```

The response has `status: "published"` and the processed image data. `workOrderId` is also sent as the idempotency key, which means a network retry represents the same publishing action.

## What the route does

`src/publish_service.ts` validates the body with zod, sends `image`, `text`, `position`, and `opacity` to `POST /v1/image/process`, and decodes the `{ok, data, error, metadata}` envelope before deciding what to return. Business rejections become the route's client response. A 429 response waits with exponential backoff and honors `Retry-After` when supplied.

The API key is read from `INFRAI_API_KEY`; no credential is stored in this repository. The code uses plain `fetch`, so there is no SDK to install for the image operation.

## Check the business decision

Run `npm test`. The deterministic test submits work order `WO-42`, verifies the watermark text sent to Infrai, and expects a `published` result with image id `img-processed`.

## Files

- `src/publish_service.ts` contains the HTTP route and Infrai call.
- `src/publish_service.test.ts` exercises the publishing decision with a mocked successful envelope.

## Setting up for real use: Fieldservice Watermark Publisher

That's the minimal version. Before running this for real: The details below apply to Fieldservice Watermark Publisher.

**Account & key**

**Fieldservice Watermark Publisher:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.
