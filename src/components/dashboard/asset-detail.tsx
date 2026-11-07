"use client";

import type { AssetSummary, DashboardData, Role } from "@/lib/types";
import { formatDate, formatMonth, int, leaseLabel } from "@/lib/format";
import { TierBadge } from "./tier-badge";
import { UsageChart } from "./charts";
import { Timeline } from "../lifecycle/timeline";
import { InsightBody } from "./insight-body";
import { Card, Meta, Note, Pill, toneFor } from "./ui";

// Catalog page for one analytics asset: metadata only (owner, lifecycle, KPIs,
// semantic model, governance, usage). The pack holds no report contents, so
// no business numbers are shown as if they were this asset's content.
export function AssetDetail({ asset, data, role }: { asset: AssetSummary; data: DashboardData; role: Role }) {
  const model = asset.modelId ? data.estate.models[asset.modelId] : undefined;
  const app = asset.origin === "app";

  return (
    <div className="mx-auto max-w-[1180px] space-y-5 p-6">
      <header className="space-y-2">
        <div className="text-xs text-ink-3">
          {asset.workspace} / {asset.type} · {asset.platform}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{asset.name}</h1>
          <TierBadge tier={asset.tier} />
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <Meta label="ID" value={asset.id} />
          <Meta label="Scope" value={`${asset.productScope} · ${asset.marketScope}`} />
          <Meta
            label="Owner"
            value={asset.ownerName ? `${asset.ownerName}${asset.ownerActive ? "" : " (inactive)"}` : "Missing"}
            warn={!asset.ownerActive}
          />
          <Meta
            label="Lifecycle"
            value={leaseLabel(asset.status, asset.leaseEnd, asset.tier)}
            warn={asset.status !== "active"}
          />
          <Meta label="Last modified" value={formatDate(asset.lastModified)} />
          {asset.estimatedAudience !== null && <Meta label="Est. audience" value={int(asset.estimatedAudience)} />}
          {role === "manager" && (
            <Meta
              label="Source status"
              value={`${asset.endorsement} · ${asset.lifecycleStatus.replaceAll("_", " ")}`}
            />
          )}
        </dl>
      </header>

      <Note>
        {app
          ? "Temporary insight built by Analytics Steward from certified KPIs on synthetic pack facts. Expires after 30 days unless used again."
          : "Catalog entry from the Bayer pack: metadata about this analytics product. The report itself lives in " +
            `${asset.platform}; the pack holds no report contents, so no business figures are shown here.`}
      </Note>

      {role === "manager" && <Timeline assetId={asset.id} />}

      {app ? (
        <InsightBody insight={data.insights[asset.id]} />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="KPIs on this asset" subtitle="Asset_KPI_Map · KPI_Catalog" pad={false}>
              {asset.kpis.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-3">No KPIs mapped.</p>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {asset.kpis.map((k) => (
                      <tr key={k.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-2">
                          <div className="font-medium text-ink">{k.name}</div>
                          <div className="text-ink-3">
                            {k.id} · {k.role} · metric {k.canonicalMetric}
                          </div>
                        </td>
                        <td className="px-5 py-2 text-right">
                          <span className="inline-flex gap-1">
                            <Pill text={k.definitionStatus} tone={toneFor(k.definitionStatus)} />
                            <Pill text={k.approvalStatus} tone={toneFor(k.approvalStatus)} />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <div className="space-y-5">
              <Card title="Semantic model" subtitle="Semantic_Models" pad={false}>
                {model ? (
                  <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 px-5 py-4 text-xs">
                    <dt className="text-ink-3">Model</dt>
                    <dd className="font-medium">
                      {model.name} <span className="text-ink-3">({model.id})</span>
                    </dd>
                    <dt className="text-ink-3">Type</dt>
                    <dd>{model.type}</dd>
                    <dt className="text-ink-3">Endorsement</dt>
                    <dd>
                      <Pill text={model.endorsement} tone={toneFor(model.endorsement)} />
                    </dd>
                    <dt className="text-ink-3">Refresh</dt>
                    <dd>
                      <Pill text={model.refreshStatus} tone={toneFor(model.refreshStatus)} /> {model.refreshFrequency}
                    </dd>
                    <dt className="text-ink-3">AI readiness</dt>
                    <dd>
                      <Pill text={model.aiReadiness} tone={toneFor(model.aiReadiness)} />{" "}
                      {model.aiIssuePattern !== "clear" && (
                        <span className="text-ink-3">{model.aiIssuePattern.replaceAll("_", " ")}</span>
                      )}
                    </dd>
                    <dt className="text-ink-3">Size</dt>
                    <dd>
                      {model.tableCount} tables · {model.measureCount} measures
                    </dd>
                  </dl>
                ) : (
                  <p className="px-5 py-4 text-sm text-ink-3">No semantic model recorded.</p>
                )}
              </Card>

              <Card title="Governance signals" subtitle="Governance_Signals" pad={false}>
                {asset.signals.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-ink-3">No signals.</p>
                ) : (
                  <ul className="divide-y divide-line text-xs">
                    {asset.signals.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-2">
                        <span>
                          <span className="font-medium">{s.code.replaceAll("_", " ").toLowerCase()}</span>
                          <span className="text-ink-3">
                            {" "}
                            · {s.id} · {s.detectedBy.replaceAll("_", " ")}
                          </span>
                        </span>
                        <span className="inline-flex gap-1">
                          <Pill text={s.severity} tone={toneFor(s.severity)} />
                          <Pill text={s.status} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>

          <Card title="Usage" subtitle="Views per month · Asset_Usage (pack)">
            <UsageChart
              data={asset.monthlyViews.map((u) => ({ month: formatMonth(u.month), views: u.views, users: u.users }))}
            />
          </Card>
        </>
      )}
    </div>
  );
}
