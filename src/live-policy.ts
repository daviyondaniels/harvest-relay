// Paid inference is an explicit private-workspace capability, never a public-demo feature.
export function remainingLiveCalls(env: Readonly<Record<string, string | undefined>>, used: number): number {
  if (env.HARVEST_PUBLIC_DEMO === "1") return 0;
  const cap = Number(env.HARVEST_LIVE_CALLS ?? 0);
  return env.MODEL_API_KEY && Number.isSafeInteger(cap) && cap > 0 && Number.isSafeInteger(used) && used >= 0 ? Math.max(0, cap - used) : 0;
}
