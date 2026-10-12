import type { APIRoute } from "astro";
import { env } from "@/lib/env";

export const GET: APIRoute = () => {
  const publicKey = env("VAPID_PUBLIC_KEY") ?? "";
  return Response.json({ publicKey });
};
