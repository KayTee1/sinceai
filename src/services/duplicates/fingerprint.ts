// Dashboard fingerprints (T20). THE SWAP-IN POINT for KayTee's binary
// fingerprints: replace `standInFingerprinter` (or export another
// Fingerprinter as `fingerprinter`). The scan, findings, UI and merge flow
// only use this contract.
//
// Stand-in (ours, provisional): one bit per feature in a shared vocabulary.
// Features are the dashboard's canonical metrics (so KPI variants such as
// "Net Sales Local" count as Net Sales), its product scope and market scope.
// Similarity is Jaccard over the bits: shared bits / bits set in either.

export type FingerprintInput = {
  assetId: string;
  productScope: string;
  marketScope: string;
  canonicalMetrics: string[];
};

export type Fingerprint = {
  assetId: string;
  /** Human-readable features behind the bits, for evidence. */
  features: string[];
  bits: Uint8Array;
  /** Hex of the bits, stable for one scan's vocabulary. */
  hex: string;
  /** Stable across scans: changes only when the features change. */
  key: string;
};

export interface Fingerprinter {
  version: string;
  /** Builds fingerprints for a set of dashboards over one shared vocabulary. */
  build(inputs: FingerprintInput[]): Fingerprint[];
  /** 0 (nothing shared) to 1 (identical). */
  similarity(a: Fingerprint, b: Fingerprint): number;
}

function features(i: FingerprintInput): string[] {
  return [
    ...new Set([
      ...i.canonicalMetrics.map((m) => `metric:${m}`),
      `product:${i.productScope}`,
      `market:${i.marketScope}`,
    ]),
  ].sort();
}

function popcount(b: number): number {
  let n = 0;
  for (let x = b; x; x &= x - 1) n++;
  return n;
}

export const standInFingerprinter: Fingerprinter = {
  version: "standin-v1 (metrics + product + market, Jaccard)",
  build(inputs) {
    const vocab = [...new Set(inputs.flatMap(features))].sort();
    const index = new Map(vocab.map((f, i) => [f, i]));
    return inputs.map((i) => {
      const fs = features(i);
      const bits = new Uint8Array(Math.ceil(vocab.length / 8));
      for (const f of fs) {
        const k = index.get(f)!;
        bits[k >> 3] |= 1 << (k & 7);
      }
      return {
        assetId: i.assetId,
        features: fs,
        bits,
        hex: [...bits].map((b) => b.toString(16).padStart(2, "0")).join(""),
        key: fs.join("|"),
      };
    });
  },
  similarity(a, b) {
    let both = 0;
    let either = 0;
    for (let i = 0; i < Math.max(a.bits.length, b.bits.length); i++) {
      const x = a.bits[i] ?? 0;
      const y = b.bits[i] ?? 0;
      both += popcount(x & y);
      either += popcount(x | y);
    }
    return either ? both / either : 0;
  },
};

/** The fingerprinter the scan uses. Point this at the binary version when it lands. */
export const fingerprinter: Fingerprinter = standInFingerprinter;
