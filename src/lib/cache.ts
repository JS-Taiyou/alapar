const DB_NAME = "alapar-cache";
const DB_VERSION = 1;

const STORES = {
  registries: "registries",
  registryData: "registry-data",
  transactions: "transactions",
  balance: "balance",
  exercises: "exercises",
  meta: "meta",
} as const;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.registries)) {
        db.createObjectStore(STORES.registries, { keyPath: "userId" });
      }
      if (!db.objectStoreNames.contains(STORES.registryData)) {
        db.createObjectStore(STORES.registryData, { keyPath: "registryId" });
      }
      if (!db.objectStoreNames.contains(STORES.transactions)) {
        const txStore = db.createObjectStore(STORES.transactions, {
          keyPath: "key",
        });
        txStore.createIndex("registryId", "registryId");
      }
      if (!db.objectStoreNames.contains(STORES.balance)) {
        db.createObjectStore(STORES.balance, { keyPath: "registryId" });
      }
      if (!db.objectStoreNames.contains(STORES.exercises)) {
        db.createObjectStore(STORES.exercises, { keyPath: "registryId" });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
    };
  });
}

async function get<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T | undefined);
  });
}

async function put(storeName: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function deleteEntry(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function getAllKeys(storeName: string): Promise<IDBValidKey[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAllKeys();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function getAllByIndex(
  storeName: string,
  indexName: string,
  key: string,
): Promise<unknown[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export interface CachedTransactionEntry {
  key: string;
  registryId: string;
  exerciseId: string | null;
  data: unknown[];
  cachedAt: number;
  etag?: string;
}

export interface CachedRegistryData {
  registryId: string;
  transactions: unknown[];
  transactionPayments: unknown[];
  balance: number;
  balanceEntries: unknown[];
  users: unknown[];
  currentUserId: string;
  defaultSplit: unknown;
  spawnCandidates: unknown[];
  entityIds: string[];
  entities: { id: string; name: string; color: string }[];
  lastModified: string | null;
  cachedAt: number;
}

export interface CachedRegistries {
  userId: string;
  registries: unknown[];
  cachedAt: number;
}

export interface CachedMeta {
  key: string;
  value: unknown;
}

export const cache = {
  getTransactions(
    registryId: string,
    exerciseId: string | null,
  ): Promise<CachedTransactionEntry | undefined> {
    const key = `${registryId}:${exerciseId ?? "active"}`;
    return get<CachedTransactionEntry>(STORES.transactions, key);
  },

  async setTransactions(
    registryId: string,
    exerciseId: string | null,
    data: unknown[],
    etag?: string,
  ): Promise<void> {
    const key = `${registryId}:${exerciseId ?? "active"}`;
    await put(
      STORES.transactions,
      {
        key,
        registryId,
        exerciseId,
        data,
        cachedAt: Date.now(),
        etag,
      } satisfies CachedTransactionEntry,
    );
  },

  getRegistryData(
    registryId: string,
  ): Promise<CachedRegistryData | undefined> {
    return get<CachedRegistryData>(STORES.registryData, registryId);
  },

  async setRegistryData(
    registryId: string,
    data: Omit<CachedRegistryData, "registryId" | "cachedAt">,
  ): Promise<void> {
    await put(
      STORES.registryData,
      {
        registryId,
        ...data,
        cachedAt: Date.now(),
      } satisfies CachedRegistryData,
    );
  },

  getRegistrySnapshot(
    registryId: string,
  ): Promise<CachedRegistryData | undefined> {
    return get<CachedRegistryData>(STORES.registryData, registryId);
  },

  async setRegistrySnapshot(
    snapshot: Omit<CachedRegistryData, "cachedAt">,
  ): Promise<void> {
    await put(
      STORES.registryData,
      {
        ...snapshot,
        cachedAt: Date.now(),
      } satisfies CachedRegistryData,
    );
  },

  getRegistries(userId: string): Promise<CachedRegistries | undefined> {
    return get<CachedRegistries>(STORES.registries, userId);
  },

  async setRegistries(userId: string, registries: unknown[]): Promise<void> {
    await put(
      STORES.registries,
      {
        userId,
        registries,
        cachedAt: Date.now(),
      } satisfies CachedRegistries,
    );
  },

  getExercises(
    registryId: string,
  ): Promise<{ exercises: unknown[]; cachedAt: number } | undefined> {
    return get(STORES.exercises, registryId);
  },

  async setExercises(registryId: string, exercises: unknown[]): Promise<void> {
    await put(STORES.exercises, {
      registryId,
      exercises,
      cachedAt: Date.now(),
    });
  },

  async getMeta(key: string): Promise<unknown> {
    const entry = await get<CachedMeta>(STORES.meta, key);
    return entry?.value;
  },

  async setMeta(key: string, value: unknown): Promise<void> {
    await put(STORES.meta, { key, value } satisfies CachedMeta);
  },

  async invalidateRegistry(registryId: string): Promise<void> {
    const entries = await getAllByIndex(
      STORES.transactions,
      "registryId",
      registryId,
    ) as CachedTransactionEntry[];
    await Promise.all([
      deleteEntry(STORES.registryData, registryId),
      deleteEntry(STORES.balance, registryId),
      deleteEntry(STORES.exercises, registryId),
      ...entries.map((e) => deleteEntry(STORES.transactions, e.key)),
    ]);
  },

  async getLastActiveRegistry(): Promise<string | null> {
    const entry = await get<{ key: string; value: string }>(
      STORES.meta,
      "lastActiveRegistry",
    );
    return entry?.value ?? null;
  },

  async setLastActiveRegistry(registryId: string): Promise<void> {
    await put(STORES.meta, { key: "lastActiveRegistry", value: registryId });
  },

  async clearAll(): Promise<void> {
    const db = await openDB();
    const storeNames = Array.from(db.objectStoreNames);
    for (const name of storeNames) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(name, "readwrite");
        const store = tx.objectStore(name);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    }
  },

  async cleanOrphanedEntries(validRegistryIds: string[]): Promise<void> {
    const validSet = new Set(validRegistryIds);

    const registryDataKeys = await getAllKeys(STORES.registryData);
    const balanceKeys = await getAllKeys(STORES.balance);
    const exerciseKeys = await getAllKeys(STORES.exercises);

    const orphanedIds = new Set<string>();
    for (const key of [...registryDataKeys, ...balanceKeys, ...exerciseKeys]) {
      if (!validSet.has(key as string)) {
        orphanedIds.add(key as string);
      }
    }

    for (const id of orphanedIds) {
      await this.invalidateRegistry(id);
    }
  },
};
