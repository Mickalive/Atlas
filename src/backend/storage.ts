/**
 * Tenant-scoped typed storage over Forge KVS.
 *
 * TEN-2: every key is namespaced with the installation id derived
 * server-side; raw unscoped accessors are not exported.
 * ADV-2: key components are validated against a strict charset so path-style
 * injection attempts are rejected at construction, not discovered in prod.
 *
 * The KVS SDK is imported lazily: unit tests exercise the validation and the
 * namespacing logic without a Forge runtime.
 */

export type AtlasStorageKeyComponent = string;

const KEY_COMPONENT_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/i;
const INSTALLATION_ID_RE = /^[a-zA-Z0-9._:/-]{1,160}$/;

export class InvalidStorageKeyError extends Error {}

export function validateKeyComponent(component: string, label: string): AtlasStorageKeyComponent {
  if (!KEY_COMPONENT_RE.test(component)) {
    throw new InvalidStorageKeyError(`invalid ${label}: rejected by key validator`);
  }
  if (component.includes('..') || component.includes('/') || component.includes('\\')) {
    throw new InvalidStorageKeyError(`invalid ${label}: traversal pattern`);
  }
  return component;
}

export function validateInstallationId(installationId: string): string {
  if (!INSTALLATION_ID_RE.test(installationId) || installationId.includes('..')) {
    throw new InvalidStorageKeyError('invalid installation id for storage namespace');
  }
  return installationId;
}

/** Full key shape: atlas:v1:<installationId>:<entity>[:<id>] */
export function storageKey(installationId: string, entity: string, id?: string): string {
  validateInstallationId(installationId);
  const parts = ['atlas:v1', installationId, validateKeyComponent(entity, 'entity')];
  if (id !== undefined) parts.push(validateKeyComponent(id, 'record id'));
  return parts.join(':');
}

interface MinimalKvs {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

async function kvs(): Promise<MinimalKvs> {
  const mod = (await import('@forge/kvs')) as unknown as { kvs: MinimalKvs };
  return mod.kvs;
}

/**
 * Storage bound to one server-derived installation. All product code receives
 * this object only; there is no way to reach another tenant's namespace
 * through it because the installation id is captured from Forge context.
 */
export interface AtlasStorage {
  getJSON<T>(entity: string, id?: string): Promise<T | null>;
  putJSON(entity: string, value: unknown, id?: string): Promise<void>;
  deleteKey(entity: string, id?: string): Promise<boolean>;
}

export function tenantScopedStorage(installationId: string, impl: MinimalKvs | null = null): AtlasStorage {
  const ns = validateInstallationId(installationId);
  const backend: () => Promise<MinimalKvs> = impl ? async () => impl : kvs;
  return {
    async getJSON<T>(entity: string, id?: string): Promise<T | null> {
      const v = await (await backend()).get(storageKey(ns, entity, id));
      return (v ?? null) as T | null;
    },
    async putJSON(entity: string, value: unknown, id?: string): Promise<void> {
      await (await backend()).set(storageKey(ns, entity, id), value);
    },
    async deleteKey(entity: string, id?: string): Promise<boolean> {
      try {
        await (await backend()).delete(storageKey(ns, entity, id));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** In-memory storage for unit tests and the dev harness (never used in production paths). */
export function memoryStorage(): AtlasStorage & { dump(): Map<string, unknown> } {
  const map = new Map<string, unknown>();
  const impl: MinimalKvs = {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
  return {
    getJSON: (e, id) => tenantScopedStorage('test', impl).getJSON(e, id),
    putJSON: (e, v, id) => tenantScopedStorage('test', impl).putJSON(e, v, id),
    deleteKey: (e, id) => tenantScopedStorage('test', impl).deleteKey(e, id),
    dump: () => map,
  };
}
