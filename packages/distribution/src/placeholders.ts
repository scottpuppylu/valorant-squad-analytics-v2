import type { BuiltSnapshot, SnapshotManifest } from '@vsa/contracts/public';
import type { PublishResult, SnapshotPublisher } from './publisher.ts';

/** Future distribution adapters. NOT implemented in the bootstrap: no remote writes, no credentials, no network. */
abstract class NotImplementedPublisher implements SnapshotPublisher {
  abstract readonly publisherId: string;
  async publish(_snapshot: BuiltSnapshot): Promise<PublishResult> { throw new Error(`${this.publisherId} is a placeholder (not implemented in the bootstrap)`); }
  async rollback(_snapshotId: string): Promise<PublishResult> { throw new Error(`${this.publisherId} is a placeholder (not implemented in the bootstrap)`); }
  async readActiveManifest(): Promise<SnapshotManifest | null> { throw new Error(`${this.publisherId} is a placeholder (not implemented in the bootstrap)`); }
}

/** Future: publish snapshots to a separate public DATA repository (never the source repository). */
export class GitHubRepositoryPublisher extends NotImplementedPublisher { readonly publisherId = 'github-data-repository'; }

/** Future: publish to object storage behind a CDN. */
export class ObjectStoragePublisher extends NotImplementedPublisher { readonly publisherId = 'object-storage'; }
