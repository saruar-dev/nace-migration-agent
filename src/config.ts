/** USD per NDI credit: the tool argument wins, then NACE_NDI_USD_PER_CREDIT. Anything that is not a positive number counts as unset. */
export function resolveNdiPrice(arg?: number | null, env: string | undefined = process.env.NACE_NDI_USD_PER_CREDIT): number | null {
  if (typeof arg === "number" && Number.isFinite(arg) && arg > 0) return arg;
  if (env === undefined || env.trim() === "") return null;
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : null;
}
