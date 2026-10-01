function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }

  const object = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + stableStringify(object[key]))
      .join(",") +
    "}"
  );
}

export async function makeChoiceCommitment(
  lokiId: string,
  player: string,
  choice: string,
  nonce: string,
): Promise<string> {
  const payload = {
    version: "loki-v1",
    loki_id: lokiId,
    player: player.toLowerCase(),
    choice,
    nonce,
  };

  const encoded = new TextEncoder().encode(stableStringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
