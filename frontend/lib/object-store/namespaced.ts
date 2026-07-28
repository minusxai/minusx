/**
 * Namespace prefixing for object storage.
 *
 * This is applied at the FACTORY, not at a module callers may or may not use. An
 * earlier attempt put it behind an injectable store module — which no call site ever
 * asked for, so the prefixing silently never happened and uploads from every workspace
 * shared one key space. Wrapping what everyone already calls is what makes it
 * unbypassable.
 *
 * The prefix is the ISOLATION level, deliberately not the mode level: `mode` is already
 * part of the logical key for the things that need it, and an object has to stay
 * readable across modes within one workspace.
 */

import type { Readable } from 'stream';
import { namespaced } from '@/lib/namespace/types';
import type { ObjectStore, UploadUrlResult } from './index';

export class NamespacedObjectStore implements ObjectStore {
  constructor(
    private readonly inner: ObjectStore,
    private readonly isolation: () => Promise<string>,
  ) {}

  private async key(k: string): Promise<string> {
    return namespaced(await this.isolation(), k);
  }

  async getUploadUrl(params: { key: string; contentType: string }): Promise<UploadUrlResult> {
    return this.inner.getUploadUrl({ ...params, key: await this.key(params.key) });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    return this.inner.put(await this.key(key), body, contentType);
  }

  async putStream(key: string, body: Readable, contentType?: string): Promise<void> {
    return this.inner.putStream(await this.key(key), body, contentType);
  }

  async getStream(key: string): Promise<Readable | null> {
    return this.inner.getStream(await this.key(key));
  }

  async delete(key: string): Promise<void> {
    return this.inner.delete(await this.key(key));
  }

  /** BOTH keys are prefixed — a copy must never cross the isolation boundary. */
  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    return this.inner.copyObject(await this.key(sourceKey), await this.key(destKey));
  }

  async exists(key: string): Promise<boolean> {
    return this.inner.exists(await this.key(key));
  }

  async get(key: string): Promise<Buffer | null> {
    return this.inner.get(await this.key(key));
  }

  /**
   * Sync, so it cannot resolve the prefix. Nothing outside this module calls it — the
   * adapters use it internally on keys that are already prefixed, which is why it
   * delegates unchanged rather than throwing.
   */
  publicUrl(key: string): string {
    return this.inner.publicUrl(key);
  }
}
