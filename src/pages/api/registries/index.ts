import type { APIRoute } from "astro";
import { createRegistry, getRegistriesForUser } from "@/lib/store";
import { countOwnedRegistries, FREE_LIMITS, upgradeRequired } from "@/lib/entitlements";

export const GET: APIRoute = async (ctx) => {
  const userId = ctx.locals.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const registries = await getRegistriesForUser(userId);
  return Response.json({
    registries,
    activeRegistryId: ctx.locals.activeRegistry?.id ?? null,
  });
};

export const POST: APIRoute = async (ctx) => {
  const accept = ctx.request.headers.get("Accept") ?? "";
  const isJson =
    accept.includes("application/json") ||
    ctx.request.headers.get("Content-Type")?.includes("application/json");

  let name: string;
  if (isJson) {
    const body = await ctx.request.json();
    name = body.name;
  } else {
    const form = await ctx.request.formData();
    name = form.get("name") as string;
  }

  const userId = ctx.locals.user?.id;
  if (name && userId) {
    // Free plan: cap on OWNED registries (memberships in others' groups are
    // never limited — a user can join any number of Pro groups for free).
    //
    // Dual response shape: JSON clients (Sidebar island) get the 402 +
    // {code:'upgrade_required'} contract (surfaced as an upgrade toast);
    // the form-post fallback (no-JS / registries/new page) goes straight
    // to the pricing page.
    const owned = await countOwnedRegistries(userId);
    if (owned >= FREE_LIMITS.maxOwnedRegistries) {
      if (isJson) return upgradeRequired("owned_registries");
      return ctx.redirect("/pricing");
    }

    const registry = await createRegistry(name, userId);
    if (isJson) {
      return Response.json({ registry });
    }
  }

  if (isJson) {
    return Response.json({ error: "Missing name" }, { status: 400 });
  }
  return ctx.redirect("/dashboard");
};
