# Publication model

## Layout (publication root)

```
manifest.json                      the only mutable file (manifest-v1)
snapshots/<snapshotId>/            immutable: group.json, players.json, analytics.json (public-snapshot-v1)
.staging/                          temporary; never referenced by a manifest
```

## Snapshot identity

- `snapshotId = ps1-` plus the first 16 hex digits of SHA-256 over the schema version and every file's name and
  SHA-256.
- The id is content-derived and deterministic: the same evidence gives the same id on PGlite and on PostgreSQL 18
  (tested).
- Wall-clock time is metadata only (`manifest.active.activatedAt`). The data time shown on the site is data-derived
  (`group.dataAsOf`).

## Atomic publication (`LocalFilesystemPublisher`)

1. Validate every file: hash, byte length, name ↔ kind, secret patterns, then the full public-document validation.
2. Recompute the content-derived id, and refuse the snapshot if it differs.
3. Write the files into `.staging/<id>.<pid>.<n>/`.
4. Move the staging directory into `snapshots/<id>` with one rename (bounded Windows retry, ported).
   - If `snapshots/<id>` already exists, its files are re-verified and reused; it is never rewritten.
5. Write `manifest.json.<pid>.<n>.tmp`.
6. Atomically replace `manifest.json` by rename.

**Guarantees:**
- A reader never observes a half-written snapshot or a manifest that points to missing files.
- An injected crash at step 4 or 6 leaves the previous manifest fully readable (tested).
- A corrupt existing manifest does not block recovery: the next valid publish repairs it and reports
  `replacedInvalidManifest: true`.

## Rollback

- `rollback(snapshotId)` re-validates an already published immutable snapshot: every file, its content-derived id, and
  no unexpected files.
- It then atomically points the manifest at it.
- `history` lists previously active ids, most recent first (≤ 50).
- No snapshot is deleted by publish or rollback.

## Validation on read

The web loader:
1. Checks versions first, so an unsupported version gets an explicit state.
2. Validates the manifest strictly. Paths are fixed patterns, so traversal is not expressible.
3. Verifies each file's SHA-256 when Web Crypto is available (https or localhost).
4. Re-validates every document with `@vsa/privacy`.

Each failure has its own visible state: `empty`, `invalid-manifest`, `unsupported-version`, `missing-snapshot` or
`privacy-failure`.

## Publisher abstraction

| Publisher | Status |
|---|---|
| `SnapshotPublisher` | Interface: `publish`, `rollback`, `readActiveManifest` |
| `LocalFilesystemPublisher` | Implemented |
| `GitHubRepositoryPublisher` | Placeholder only (future separate public data repository) |
| `ObjectStoragePublisher` | Placeholder only |

The placeholders have no remote code and no credentials.

## Privacy gates

- **`npm run check:privacy`**
  - Regenerates the demo snapshot and builds the web app.
  - Re-validates every public file.
  - Scans the public data and every bundle file for fixture private markers, internal ids, raw fixture coordinates,
    secret patterns and database strings.
- **Scanner tests.** Negative tests prove the scanners detect each planted leak class.
