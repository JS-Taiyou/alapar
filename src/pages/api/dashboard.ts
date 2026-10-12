import type { APIRoute } from "astro";
import {
  calculateBalance,
  calculatePairwiseBreakdown,
  getActiveTransactions,
  getBalanceFromDeltas,
  getEntities,
  getSpawnCandidates,
  getTransactionPaymentsForRegistry,
  getUsers,
} from "@/lib/store";
import {
  getCachedSpawnCandidates,
  getCachedTransactions,
  getStamp,
} from "@/lib/server-cache";
import { generateETag } from "@/lib/etag";

export const GET: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json(
      {
        transactions: [],
        transactionPayments: [],
        users: [],
        balance: 0,
        balanceEntries: [],
        spawnCandidates: [],
        defaultSplit: null,
        entityIds: [],
        entities: [],
        currentUserId: null,
        lastModified: null,
      },
      { status: 200 },
    );
  }

  const requestedId = ctx.url.searchParams.get("registryId");
  const registryId = requestedId && ctx.locals.registries.some((r) =>
      r.id === requestedId
    )
    ? requestedId
    : ctx.locals.activeRegistry?.id;

  if (!registryId) {
    return Response.json(
      {
        transactions: [],
        transactionPayments: [],
        users: [],
        balance: 0,
        balanceEntries: [],
        spawnCandidates: [],
        defaultSplit: null,
        entityIds: [],
        entities: [],
        currentUserId: null,
        lastModified: null,
      },
      { status: 200 },
    );
  }

  const isActiveRegistry = registryId === ctx.locals.activeRegistry?.id;

  // Fetch the registry stamp once and share it between both cache lookups
  // (avoids a redundant SELECT last_modified query).
  const stamp = await getStamp(registryId);

  const { transactions } = await getCachedTransactions(
    registryId,
    () => getActiveTransactions(registryId),
    stamp,
  );
  const transactionPayments = await getTransactionPaymentsForRegistry(
    registryId,
  );
  // Use persisted deltas for the authoritative balance (exact NUMERIC sum,
  // no floating-point residue). Falls back to the in-memory calculation if
  // the deltas table doesn't exist yet (pre-migration).
  let balance: number;
  try {
    balance = await getBalanceFromDeltas(userId, registryId);
  } catch {
    balance = await calculateBalance(userId, registryId, transactions);
  }
  const candidates = await getCachedSpawnCandidates(
    registryId,
    () => getSpawnCandidates(registryId),
    stamp,
  );

  let participants: { id: string; name: string; color: string }[];
  let entities: { id: string; name: string; color: string }[];
  let defaultSplit: unknown;

  if (isActiveRegistry) {
    participants = ctx.locals.participants;
    entities = ctx.locals.entities;
    defaultSplit = ctx.locals.activeRegistry?.defaultSplit ?? null;
  } else {
    const [users, ents] = await Promise.all([
      getUsers(registryId),
      getEntities(registryId, userId),
    ]);
    participants = [
      ...users.map((u) => ({ id: u.id, name: u.name, color: u.color })),
      ...ents.map((e) => ({ id: e.id, name: e.name, color: e.color })),
    ];
    entities = ents;
    const reg = ctx.locals.registries.find((r) => r.id === registryId);
    defaultSplit = reg?.defaultSplit ?? null;
  }

  const participantMap = new Map(participants.map((p) => [p.id, p]));
  const enriched = transactions.map((tx) => ({
    ...tx,
    paidByUser: participantMap.get(tx.userPaid) ?? null,
  }));

  const spawnCandidates = candidates.map((c) => ({
    id: c.id,
    description: c.description,
    type: c.type as "parcialidad" | "recurrente",
    originalAmount: c.originalAmount,
    installmentCurrent: c.installmentCurrent,
    installmentTotal: c.installmentTotal,
  }));

  const balanceBreakdown = calculatePairwiseBreakdown(
    transactions,
    userId,
    participants,
  );

  const entityIds = entities.map((e) => e.id);

  const data = {
    transactions: enriched,
    transactionPayments,
    users: participants,
    balance,
    balanceEntries: balanceBreakdown,
    spawnCandidates,
    defaultSplit,
    entityIds,
    entities: isActiveRegistry
      ? ctx.locals.entities
      : entities.map((e) => ({ id: e.id, name: e.name, color: e.color })),
    currentUserId: userId,
    lastModified: ctx.locals.registries.find((r) => r.id === registryId)
      ?.lastModified?.toISOString() ?? null,
  };

  const etag = generateETag(data);

  const ifNoneMatch = ctx.request.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return Response.json(data, {
    headers: { ETag: etag, "Cache-Control": "no-cache" },
  });
};
