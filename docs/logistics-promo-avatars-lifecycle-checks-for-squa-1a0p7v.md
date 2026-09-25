# Logistics Promo Avatars: Lifecycle Checks for Square Cropping and Final Resize

Short answer: validate the asset while it is still in its original lifecycle state, crop once to a recorded square window, then resize that square to the delivery dimensions. Keep the original only when a recovery or compliance requirement justifies its storage cost. For a logistics team generating short promo videos from prompts, this ordering keeps cache growth predictable and prevents a bad avatar from being copied into every rendered clip.

The expensive part is usually not the crop operation. It is retention. A 4K source avatar, an intermediate square, a video poster, and several codec variants can sit in object storage long after a campaign has ended. I have watched a cache report blame “thumbnails” while the actual bytes were abandoned intermediate frames. The fix was a lifecycle ledger, not a faster image library.

Keep it boring.

## Start with the storage ledger, not the filter chain

For each asset, record a content hash, byte count, pixel dimensions, color profile, owner, and expiry class before doing any transformation. The byte count gives you a direct cost signal; the metadata gives you a way to explain why a particular copy exists. A useful ledger has rows for `source`, `validated`, `square`, `delivery`, and `poster`, with one retention deadline per row.

In a logistics promo workflow, the source may be a driver's supplied portrait, while the generated clip needs a 512 x 512 avatar and a 1,080 x 1,080 poster. Those are different products. Treating them as the same blob makes cache eviction guesswork. A source that fails dimension or format checks should never enter the render queue, and a delivery derivative should not silently become the new source.

The trade-off is real: deleting the source early saves storage and reduces exposure of personal data, but it removes your ability to re-render after a prompt, soundtrack, or crop policy changes. My default is to retain a quarantined source only through the campaign review window, then retain the validated square for the shorter of its cache TTL and the campaign's retention rule. Your mileage may vary when a contract or local privacy policy requires a longer audit trail.

## How should an avatar lifecycle validate square crop and resize in sequence?

Think of the pipeline as a state machine. `received` can move to `validated`; only `validated` can move to `cropped`; only a `cropped` image can move to `resized`; a failed transition goes to `rejected` with a reason that is safe to show in an operator dashboard. Do not infer state from a filename. Persist it beside the object and make the transition idempotent.

Validation should cover the media type, a decodable image header, pixel bounds, orientation metadata, and a maximum compressed size. Decode enough to confirm the claimed dimensions, but do not trust an extension or a client-provided MIME string. Normalize orientation before calculating the crop window. Otherwise a portrait that carries an EXIF rotation can pass a width check and still produce a sideways face in the video.

The crop is a geometry decision, not a resize shortcut. Choose the square window from the normalized dimensions, store its `(left, top, width, height)`, and apply that same window when regenerating a poster. After the crop, resize once to the requested output. Repeatedly resizing a rectangle and then cropping it again compounds interpolation loss and makes visual diffs hard to investigate.

Here is the core ordering as a small, testable function. It deliberately returns metadata with the bytes; an object without its lifecycle record is an orphan waiting to inflate the cache.

```python
from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class AvatarRecord:
    state: str
    source_hash: str
    crop_box: Tuple[int, int, int, int] | None = None
    size: Tuple[int, int] | None = None


def square_then_resize(image, target: int, source_hash: str):
    if image.width < 1 or image.height < 1:
        raise ValueError("empty image")

    edge = min(image.width, image.height)
    left = (image.width - edge) // 2
    top = (image.height - edge) // 2
    box = (left, top, left + edge, top + edge)
    square = image.crop(box)
    output = square.resize((target, target))
    record = AvatarRecord("resized", source_hash, box, output.size)
    return output, record
```

The centered crop is only a baseline. Driver portraits, warehouse mascots, and generated character art often need a subject-aware focal point. Keep that focal point as data, with a bounded fallback to center, rather than hiding it in a model-specific heuristic. A one-pixel shift is acceptable; an unrecorded shift is not.

## Cache keys, retries, and the failure modes that cost twice

Build cache keys from the source hash, normalized crop box, target dimensions, encoder family, and policy version. A policy version matters because changing the focal-point rule should invalidate old derivatives without deleting the audit record. Avoid keys based only on a user ID: two campaigns can legitimately use different source bytes for the same driver.

The render worker should claim a lifecycle transition with a lease, write the derivative to a temporary key, verify its dimensions and byte count, then publish the final key. A retry can safely repeat that sequence because the source hash and policy version make the result deterministic. If a worker dies after writing bytes but before publishing metadata, a sweeper can remove the unreferenced temporary object.

I learned this after seeing a single 413 response from an upstream upload limit turn into 17 copies of the same portrait. The retry loop treated every failure as transient, and each attempt used a new random object key. The worker also acknowledged the queue message before its metadata transaction committed, so a process restart left the bytes visible but the lifecycle state missing. We reconstructed the chain from object timestamps, hash prefixes, and queue offsets: one source upload had produced five failed validation attempts, three square crops, and nine poster writes, all for a clip that was never published. The useful metric was not “retry count”; it was orphaned bytes per successful asset, split by transition and policy version. After switching to deterministic keys, a lease around the state transition, and a sweeper for unreferenced temporary objects, the report could distinguish a legitimate duplicate from a retry. Alert on that ratio and on derivatives whose metadata is older than their object creation time. The lesson is unglamorous: storage accounting has to follow the state machine closely enough that an operator can explain every byte without opening the image.

Short logs help. Include the lifecycle state, source hash prefix, dimensions, policy version, and a reason code such as `decode_failed`, `bounds_exceeded`, or `orientation_normalized`. Do not log the raw image URL or a full personal identifier. Compliance reviews tend to start with logs, and logs are often retained longer than the media itself.

## What to retain when a logistics campaign ends

Retention should follow the business event, not the last cache hit. Keep the delivery derivative while a published promo can still be viewed. Keep the square while a campaign can be re-rendered. Keep the source only for the documented review or dispute period. Mark every object with an expiry timestamp and run deletion as a separate, observable job.

There is a cost to this discipline: a late request to change the crop may require a new upload. That is preferable to keeping every high-resolution source forever “just in case.” It also makes consent withdrawal tractable because the ledger can identify all derivatives that came from one source hash.

This design is a poor fit for interactive editing where users expect unlimited undo from the original pixels. In that case, use a versioned asset store and charge the workflow for explicit snapshots. It is also unsuitable when a downstream platform demands a proprietary, uninspectable transform; keep the boundary explicit and validate the returned dimensions before accepting the derivative.

## References

- https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats
- https://www.w3.org/TR/exif/
- https://www.rfc-editor.org/rfc/rfc9110
