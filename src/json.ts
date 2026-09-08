function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** SDK objects → JSON-safe values (bigints, keys, circular refs). */
export function toJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return value;
  }
  if (valueType === "bigint") {
    return value.toString();
  }
  if (valueType === "function") {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    return value.map((item) => toJsonSafe(item, seen));
  }
  if (!isRecord(value)) {
    return String(value);
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  const withKey = value as { toBase58?: () => string };
  if (typeof withKey.toBase58 === "function") {
    return withKey.toBase58();
  }
  const named = value.constructor?.name;
  if (named === "BN" || named === "BigNumber") {
    return String(value);
  }
  seen.add(value);
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const converted = toJsonSafe(nested, seen);
    if (converted !== undefined) {
      out[key] = converted;
    }
  }
  return out;
}
