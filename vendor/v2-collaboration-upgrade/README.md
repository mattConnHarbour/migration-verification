# `@superdoc/v2-collaboration-upgrade`

Node-only tooling for moving a collaboration document from SuperDoc v1 to a separate v2 room with a durable retry path.

```ts
import { upgradeCollaboration, type CollaborationUpgradeCheckpointStore } from '@superdoc/v2-collaboration-upgrade';
import { createBinaryStoreUpgradeAdapter } from '@superdoc/v2-collaboration-upgrade/binary-store';

const provider = createBinaryStoreUpgradeAdapter({
  read: async (roomId) => storage.read(roomId),
  create: async (roomId, update) => storage.createIfAbsent(roomId, update),
});

const checkpoint: CollaborationUpgradeCheckpointStore = {
  read: (key) => database.upgradePreparations.read(key.documentId, key.attemptId),
  createIfAbsent: ({ key, checkpoint }) =>
    database.upgradePreparations.insertIfAbsent(key.documentId, key.attemptId, checkpoint),
};

await upgradeCollaboration({
  documentId: 'invoice-123',
  sourceRoomId: 'invoice-123-v1',
  provider,
  checkpoint,
  readActive: (documentId) => database.routing.readActive(documentId),
  activate: (candidate) => database.routing.activateOnce(candidate),
});
```

The `database` methods above are application-owned, not supplied by this package. Persist the **entire** `CollaborationUpgradePreparationCheckpoint` (including both binary payloads), keyed by document ID **and attempt ID**, with a durable atomic insert-if-absent that returns the stored winner for that key. A retry with the same source, fence, and preparation options selects the same attempt and reuses its bytes. If one of those changes before routing commits, the package starts a separate attempt with a separate default v2 target; retain the earlier checkpoint and target for recovery and audit. Do not evict an unfinished attempt to make a retry work. `readActive` must read authoritative routing, not a cache, both before preparation and immediately after activation. Only return `null` for a document not yet routed to v2.

`activateOnce` receives the prepared `sourceIdentity` and, when supplied by the provider, `fencingGeneration`. Its transaction must compare the authoritative current v1 source/fence and routing state before committing the v2 route. The stored v2 routing record must include the supplied validation, target identity, evidence, and activation receipt, and the callback must return `{ disposition: 'activated' | 'already-active', routingVersion: string }`. The persisted record must have the full `UpgradeCollaborationResult` shape returned by `readActive`: set `state` to `'activated'`; copy the candidate's source room IDs, target identity, hashes, validation, `evidenceTier`, `providerEvidence`, and `targetDisposition`; and copy its `protocolVersion`, `idempotencyKey`, migration ID, document ID, target room ID, and provider room name into `activation`. On the first commit, persist `activation.disposition` as `'activated'` and `activation.routingVersion` as the committed version. Store the receipt and route in the same transaction. On a repeated key, return `'already-active'` and the original routing version without changing the persisted record. Never route an unvalidated target.

Pause edits for the document before calling the API and keep v1 writers fenced throughout the routing transaction. Resume v2 edits only after activation commits. The source room is read but never written. A new v2 room is created and freshly read back through the provider. SuperDoc re-reads the complete v1 source before `activate` and rejects changes to its bytes, storage identity, or fencing generation.

The final source check is defense in depth, not a replacement for pausing writers: a provider read and your routing transaction cannot be made atomic by a provider-neutral library.

On a retry after routing commits, the API returns the persisted result without re-reading or overwriting a v2 room that users may already have edited. Before routing commits, an unchanged attempt reuses the stored preparation instead of exporting v1 again. If a response is lost after the routing transaction, retry the same document and source IDs: `readActive` recovers the committed result. If you set `targetRoomId` yourself, use a fresh ID when starting a new attempt after source, fence, or option changes; an occupied room with different prepared bytes is rejected before activation.

The isolated frozen-v1 reader normalizes the comment paragraph and durable IDs it generates in the exported DOCX, including links in `commentsExtended.xml`, `commentsIds.xml`, and `commentsExtensible.xml`. It also fixes ZIP entry timestamps, which otherwise vary between identical exports. It does not modify the source Yjs updates or unrelated document paragraph IDs. This keeps independent preparations of the same unchanged comments consistent; the durable checkpoint additionally covers nondeterministic export data outside those IDs and timestamps.

Persist `targetRoomId` as the v2 collaboration document ID. `providerRoomName` is the encoded physical provider key exposed only for diagnostics and custom storage adapters.

Provider adapters are separate imports so the root package does not load y-websocket, Hocuspocus, or Liveblocks clients. `superdoc` is a peer dependency: the package loads its narrow Node upgrade engine instead of bundling the interactive editor or renderer.

Install `yjs@^13.6.31` in the consuming project. It is a peer dependency so the upgrade reader and the frozen final-v1 runtime use the same Yjs instance.

This is the only upgrade package customers install. It includes a frozen
`superdoc@1.44.1` reader that runs in an isolated child process. The v1 runtime
never shares an editor process with v2 and never receives a writable provider.
