"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type Person = { name: string; role: string; region: string; active: boolean };

export type PendingProposal = {
  id: string;
  type: "renew" | "retire";
  assetIds: string[];
  assetNames: string[];
  rationale: string;
  evidence: {
    avgMonthlyUsers: number | null;
    usageMonths: string[];
    appOpens90d: number;
    ownerStatus: "active" | "inactive" | "missing";
    downstreamAssets: string[];
  };
  requiredApprovers: string[];
  status: "open" | "escalated";
  createdOn: string;
  dueOn: string | null;
};

export type LifecycleSnapshot = {
  clock: { date: string; running: boolean };
  nextDue: string | null;
  counts: Record<string, number>;
  leaseDue: number;
  pending: PendingProposal[];
  people: Record<string, Person>;
};

type Ctx = {
  data: LifecycleSnapshot | null;
  error: string | null;
  busy: boolean;
  /** POSTs to a lifecycle route, then refreshes the snapshot and the server-rendered dashboard. */
  post: (url: string, body?: object) => Promise<boolean>;
};

const LifecycleContext = createContext<Ctx | null>(null);

export function useLifecycle(): Ctx {
  const ctx = useContext(LifecycleContext);
  if (!ctx) throw new Error("useLifecycle must be used inside LifecycleProvider");
  return ctx;
}

export function LifecycleProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState<LifecycleSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastDate = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/lifecycle", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not load lifecycle");
    setData(json);
    // Re-render the dashboard list when the simulated date moves.
    if (lastDate.current && lastDate.current !== json.clock.date) router.refresh();
    lastDate.current = json.clock.date;
  }, [router]);

  useEffect(() => {
    // Deferred so no state is set synchronously inside the effect.
    Promise.resolve()
      .then(load)
      .catch((e) => setError(e.message));
  }, [load]);

  // While the clock runs (1 day per second), poll once a second.
  const running = data?.clock.running ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => load().catch((e) => setError(e.message)), 1000);
    return () => clearInterval(t);
  }, [running, load]);

  const post = useCallback(
    async (url: string, body: object = {}) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
        await load();
        router.refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load, router],
  );

  const value = useMemo(() => ({ data, error, busy, post }), [data, error, busy, post]);
  return <LifecycleContext.Provider value={value}>{children}</LifecycleContext.Provider>;
}
