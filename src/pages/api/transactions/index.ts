import type { APIRoute } from "astro";
import {
  createTransaction,
  getActiveTransactions,
  getEntities,
  getTransactionPaymentsForRegistry,
  getTransactionsByIds,
  getUsers,
} from "@/lib/store";
import { getCachedTransactions, getStamp, invalidateRegistry } from "@/lib/server-cache";
import { sendPushToRegistry } from "@/lib/push";
import { countActiveTemplates, getRegistryPlan, upgradeRequired } from "@/lib/entitlements";
import { parseTransactionForm } from "@/lib/transaction-validation";
import { formatMoney } from "@/lib/format";
import { generateETag } from "@/lib/etag";

export const GET: APIRoute = async (ctx) => {
  const registryId = ctx.locals.activeRegistry?.id;
  if (!registryId) {
    return Response.json({ transactions: [] });
  }

  const { transactions } = await getCachedTransactions(registryId, () =>
    getActiveTransactions(registryId),
  );
  const transactionPayments = await getTransactionPaymentsForRegistry(registryId);
  const participantMap = new Map(ctx.locals.participants.map((p) => [p.id, p]));
  const enriched = transactions.map((tx) => ({
    ...tx,
    paidByUser: participantMap.get(tx.userPaid) ?? null,
  }));

  const etag = generateETag({ enriched, transactionPayments });
  const ifNoneMatch = ctx.request.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return Response.json(
    { transactions: enriched, transactionPayments },
    {
      headers: { ETag: etag, "Cache-Control": "no-cache" },
    },
  );
};

export const POST: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const form = await ctx.request.formData();
  const parsed = parseTransactionForm(form);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const data = parsed.data;
  const registryId = form.get("registryId") as string;
  if (!registryId) {
    return Response.json({ error: "Registro requerido" }, { status: 400 });
  }

  // Cross-reference validation (S7): the payer and every split recipient
  // must be participants (users or entities) of the TARGET registry, and
  // every referenced transaction must live in that same registry.
  const participantIds =
    registryId === ctx.locals.activeRegistry?.id
      ? ctx.locals.participants.map((p) => p.id)
      : [
          ...(await getUsers(registryId)).map((u) => u.id),
          ...(await getEntities(registryId, userId)).map((e) => e.id),
        ];
  if (!participantIds.includes(data.userPaid)) {
    return Response.json(
      { error: "Usuario pagador inválido" },
      {
        status: 400,
      },
    );
  }
  const splitUserIds = data.splitJson.splits.map((s) => s.userId);
  if (splitUserIds.some((id) => !participantIds.includes(id))) {
    return Response.json(
      { error: "Participante inválido en el split" },
      {
        status: 400,
      },
    );
  }

  const refIds = [
    ...(data.relatedTransactionId ? [data.relatedTransactionId] : []),
    ...(data.transactionPaymentEntries ?? []).map((e) => e.expenseId),
  ];
  if (refIds.length > 0) {
    const refs = await getTransactionsByIds(refIds);
    const refRegistryById = new Map(refs.map((t) => [t.id, t.registry_id]));
    if (refIds.some((refId) => refRegistryById.get(refId) !== registryId)) {
      return Response.json(
        { error: "Referencia inválida" },
        {
          status: 400,
        },
      );
    }
  }

  // Free plan: cap on active recurring/installment TEMPLATES.
  //
  // A "template" is a distinct recurring_group_id (countActiveTemplates
  // counts groups, not transactions). This deliberately means:
  //   - Creating the 4th distinct recurring/parcialidad group → 402.
  //   - Cloning via carry-forward (same group id) → allowed: the user
  //     already "owns" that template; re-cutting a period must never lock
  //     them out of an existing commitment.
  //   - Plain unico/pago transactions → never counted or blocked.
  // One-time (unico) transactions and payments are never limited — the
  // free tier must remain genuinely usable for its core job.
  //
  // TOCTOU note: two racing creates could both pass the count check and
  // land N+1 templates. Accepted risk — the cap is a product limit, not a
  // security boundary; the worst case is one extra template on free.
  if (data.type === "parcialidad" || data.type === "recurrente") {
    const planInfo = await getRegistryPlan(registryId);
    if (planInfo && !planInfo.isPro) {
      const activeTemplates = await countActiveTemplates(registryId);
      if (activeTemplates >= planInfo.limits.maxActiveTemplates) {
        return upgradeRequired("templates");
      }
    }
  }

  const tx = await createTransaction(
    {
      registry_id: registryId,
      description: data.description,
      amount: data.amount,
      originalAmount: data.originalAmount,
      type: data.type,
      exerciseId: null,
      installmentCurrent: data.installmentCurrent,
      installmentTotal: data.installmentTotal,
      recurringDisabled: false,
      recurringGroupId: crypto.randomUUID(),
      notes: data.notes,
      splitJson: data.splitJson,
      creatorId: userId,
      userPaid: data.userPaid,
      relatedTransactionId: data.relatedTransactionId,
    },
    userId,
    data.transactionPaymentEntries,
  );

  if (!tx) {
    return new Response("Forbidden", { status: 403 });
  }

  invalidateRegistry(registryId);

  sendPushToRegistry(
    registryId,
    {
      title: "Nueva transacción",
      body: `${data.description} — $${formatMoney(data.originalAmount)}`,
      registryId,
      url: "/dashboard",
    },
    userId,
  ).catch((err) => console.error("[push] sendPushToRegistry failed:", err));

  // The fresh stamp lets the creating client label its snapshot with the
  // version its own write produced (otherwise it stores the pre-mutation
  // stamp and forces a redundant refetch on the next sync).
  const lastModified = await getStamp(registryId);
  return Response.json({ ...tx, lastModified });
};
