import { Suspense } from "react";
import { connection } from "next/server";
import { getDashboardData } from "@/lib/catalog";
import { StewardApp } from "@/components/steward-app";

async function App() {
  // Read at request time: tiers and leases will change as the lifecycle runs.
  await connection();
  const data = await getDashboardData();
  return <StewardApp data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-3">Loading catalog…</div>}>
      <App />
    </Suspense>
  );
}
