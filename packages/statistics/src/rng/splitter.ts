const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * Derives a deterministic 64-bit seed for a named substream from a root seed.
 */
export function deriveStreamSeed(rootSeed: bigint, streamName: string): bigint {
  let hash = (rootSeed ^ FNV_OFFSET_BASIS_64) & MASK_64;

  const encoder = new TextEncoder();
  const bytes = encoder.encode(streamName);

  for (let i = 0; i < bytes.length; i++) {
    hash = hash ^ BigInt(bytes[i]!);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }

  if (hash === 0n) {
    hash = 0x9e3779b97f4a7c15n;
  }

  return hash;
}
