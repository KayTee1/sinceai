# Challenge source register and workbook inspection

Inspected locally on 2026-11-06. Source files remain outside Git; this document
records summarized facts, schema and observations, not a copy of the workbook.
No web claims or linked public references were independently verified.

## Sources and precedence

- B1: `Since_AI_Bayer_Challenge_Brief_FINAL.docx`, sections 01–08.
- B2: `Since_AI_Bayer_Challenge_Brief_FINAL.pdf`, 3 pages. PDFKit text extraction
  agrees with B1 on substantive challenge content; layout/footer differ.
- W1: `Bayer_Pharmaceuticals_SinceAI_2026_FINAL_Builder_Data_Pack.xlsx`.
  `Change_Log!A2:D2`: version 2.0, Since AI ry, Excel date 46303 (2026-10-08).
- User supplied all three from `~/Downloads/Bayer_SinceAI2026/`.

B1/B2 define the challenge; W1 supplies dataset-specific scope and semantics.
These supersede the earlier pasted summary and conflicting draft assumptions.
Our application design and test expectations are not organizer facts.
Neither brief nor workbook explicitly settles IP, redistribution or external AI
processing terms. No NDA notice was found in extracted text. Synthetic content
and simulated `confidential` labels do not establish a redistribution licence.
Keep originals local pending clarification.

| File | SHA-256 |
| --- | --- |
| `Since_AI_Bayer_Challenge_Brief_FINAL.docx` | `d07a0fb54ad9d38dd6f3a97ebbde36714d8f1349a5e72c5588dc3982aecfb205` |
| `Since_AI_Bayer_Challenge_Brief_FINAL.pdf` | `9f0eb9265c3f10091c16b9ef44eca00d19573417a81989c04c819c6394f9e089` |
| `Bayer_Pharmaceuticals_SinceAI_2026_FINAL_Builder_Data_Pack.xlsx` | `7d01877096c640d7705c0507cfc32840dd88a99fe546d975a715f73b40f101ab` |

## Workbook inventory

All sheets were parsed directly from OOXML with Python standard-library
`zipfile` and `xml.etree.ElementTree`. Counts below exclude one header row for
rectangular tables. START_HERE and Package_Overview are presentation sheets.

| Sheet | Data rows | Columns |
| --- | --- | --- |
| `Public_References` | 6 | `record_type`, `topic`, `public_fact`, `year`, `source_url`, `safe_use_note` |
| `Products` | 7 | `product_id`, `product_name`, `therapeutic_area`, `product_type`, `portfolio_stage`, `commercial_scope`, `public_context_only` |
| `Markets` | 14 | `market_id`, `market_name`, `region`, `currency`, `market_maturity`, `regulatory_complexity`, `synthetic_record` |
| `Owners` | 60 | `owner_id`, `owner_name`, `role`, `scope`, `status`, `email`, `synthetic_record` |
| `KPI_Catalog` | 56 | `kpi_id`, `kpi_name`, `canonical_metric`, `domain`, `unit`, `definition_status`, `approval_status`, `default_frequency`, `business_criticality`, `owner_id`, `description`, `synthetic_record` |
| `Workspaces` | 16 | `workspace_id`, `workspace_name`, `scope`, `environment`, `platform`, `governance_mode`, `classification`, `synthetic_record` |
| `Semantic_Models` | 75 | `model_id`, `model_name`, `workspace_id`, `product_scope`, `region_scope`, `model_type`, `endorsement`, `refresh_frequency`, `refresh_status`, `owner_id`, `table_count`, `measure_count`, `ai_readiness`, `ai_issue_pattern`, `synthetic_record` |
| `Analytics_Assets` | 360 | `asset_id`, `asset_name`, `asset_type`, `platform`, `workspace_id`, `model_id`, `product_scope`, `market_scope`, `owner_id`, `created_date`, `last_modified`, `lifecycle_status`, `endorsement`, `estimated_audience`, `classification`, `delivery_model`, `synthetic_record` |
| `Asset_KPI_Map` | 1454 | `asset_id`, `kpi_id`, `usage_role`, `synthetic_record` |
| `Asset_Usage` | 3600 | `asset_id`, `month`, `views`, `unique_users`, `exports`, `subscriptions`, `avg_load_ms`, `query_errors`, `synthetic_record` |
| `Lineage_Edges` | 438 | `source_id`, `target_id`, `edge_type`, `relationship`, `synthetic_record` |
| `Product_Market_Monthly` | 980 | `product_id`, `market_id`, `month`, `net_sales_m_eur_syn`, `forecast_m_eur_syn`, `units_shipped_syn`, `forecast_variance_pct`, `market_access_coverage_pct_syn`, `otif_pct_syn`, `inventory_weeks_syn`, `value_type`, `synthetic_record` |
| `Launch_Milestones` | 35 | `milestone_id`, `product_id`, `market_id`, `milestone_type`, `milestone_date`, `status`, `business_impact`, `synthetic_record` |
| `Market_Access` | 98 | `product_id`, `market_id`, `reimbursement_status`, `coverage_model`, `coverage_pct_syn`, `trend_status`, `analytics_priority`, `synthetic_record` |
| `Supply_Operations` | 98 | `product_id`, `market_id`, `supply_source`, `primary_mode`, `otif_pct_syn`, `inventory_weeks_syn`, `forecast_accuracy_pct_syn`, `risk_status`, `synthetic_record` |
| `Data_Quality` | 147 | `issue_id`, `sheet`, `record_id`, `field`, `issue_value`, `severity`, `impact`, `synthetic_record` |
| `Governance_Signals` | 410 | `signal_id`, `asset_id`, `signal_code`, `severity`, `status`, `detected_by`, `synthetic_record` |
| `Migration_Backlog` | 94 | `source_asset_id`, `product_scope`, `market_scope`, `recommended_path_candidate`, `candidate_target_model_id`, `complexity`, `status`, `synthetic_reason`, `synthetic_record` |
| `Business_Requests` | 150 | `request_id`, `request_date`, `product_context`, `market_context`, `request_text`, `urgency`, `status`, `synthetic_record` |
| `Governance_Rules` | 8 | `rule_id`, `rule_name`, `rule_description`, `priority` |
| `Data_Dictionary` | 13 | `sheet`, `field`, `definition`, `unit`, `builder_guidance` |
| `Change_Log` | 1 | `version`, `date`, `owner`, `change` |

## Confirmed data semantics

- `START_HERE!A4:B11`: Pharmaceuticals / prescription medicines only; Crop
  Science and Consumer Health excluded. All operational values and identities
  are synthetic; public product names are context, not actual performance.
  No patient-level, HCP-level or personal data is represented.
- Explicit exclusions: clinical decision support, treatment recommendations,
  pharmacovigilance case processing, patient profiling and real Bayer systems.
- `Governance_Rules!A2:D9`: reuse before build; canonical approved KPI first
  unless a documented exception; accountable owner; upstream/downstream lineage;
  review high-reach unendorsed content; rationalise before migration; prefer
  AI-ready semantics; cite evidence for every lifecycle recommendation.
- `Data_Dictionary!A10:E10`: unique_users means monthly unique users. Summing
  monthly counts does not produce distinct users across a quarter.
- `Data_Dictionary!A12:E13`, `Package_Overview`, `Change_Log`: governance signals
  are evidence, migration candidates are scenario inputs, and evaluation answers
  / lifecycle ground truth were removed. No official accuracy labels exist.
- Usage and product-market facts cover 2026-01-01 through 2026-10-01 (10 monthly
  buckets). Requests date from 2026-08-01 through 2026-10-28. Decode Excel dates
  using the workbook's default 1900 date system, not Unix timestamps.
- Product-market facts: net sales and forecasts in million EUR; other measures
  include percentage values and inventory weeks. Preserve `value_type`:
  491 actual-like and 489 forecast-like synthetic records. Do not blend those
  categories without explicitly describing the calculation.

## Inspection results and limits

- 360 assets: 266 Power BI, 94 Tableau. Endorsements: 50 certified, 91 promoted,
  219 none. Lifecycle labels: 201 active, 86 candidate_retire, 73 legacy.
  Candidate labels are not approved actions.
- 56 KPIs: 18 canonical, 13 definition_conflict, 16 duplicate_candidate,
  9 local_variant. Approval labels: 18 approved, 11 unapproved, 19 local, 8 draft.
- 60 owners: 47 active, 13 inactive. 21 assets have blank owner IDs; preserve
  missing ownership rather than inventing an owner.
- 438 lineage edges: 360 model→asset, 56 asset→asset, 22 model→model. Use actual
  edge direction and traverse dependencies before destructive recommendations.
- 410 signals include 94 migration candidates, 86 lifecycle reviews,
  152 high-reach unendorsed, 57 self-service high-reach and 21 missing-owner.
  Counts are input labels, not independently verified model performance.
- Checked asset→workspace/model/owner, asset-KPI→asset/KPI, usage→asset and
  migration candidate→model references. All checked nonblank references resolve;
  the 21 blank asset owners are the only missing values in those checks.
  This is not a complete integrity audit of every field or edge.
- `Business_Requests!C2:E2` disagrees internally: structured context says
  Beyonttra / EMEA, while request text asks for global Nubeqa. Other sampled
  rows also disagree. Preserve both; clarify rather than silently trusting one.
- KPI catalog supplies status, aliases/grouping and descriptions, not executable
  formulas, returns/rebate rules or SQL. Product facts are aggregated monthly;
  there is no `sales_orders` table. Definition-level numeric attribution cannot
  be proven from this pack alone.
- Similarity, lifecycle thresholds, 90-day leases, estimated cost savings and
  four planted net-revenue variants are team ideas, not source facts.

## Proposed use in Bonsai

Use real source IDs to connect requests → KPIs/assets → semantic models,
owners, usage, lineage, quality and governance evidence. Require clarification
for conflicting intent. Treat migration backlog candidates as evidence to
assess, not answers to repeat. Build a small human-reviewed scenario set with
source row references; keep it separate from retrieval inputs and label it as
team-authored evaluation. An optional SQL fixture must be labelled independently
synthetic and must never be attributed to Bayer or the supplied pack.
