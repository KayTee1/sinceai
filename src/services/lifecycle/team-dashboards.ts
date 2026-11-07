// Team dashboards: the simple, glanceable boards employees use (D20). They are
// our views on the pack's business facts, registered as app assets so their
// in-app views drive the lifecycle like any other dashboard.

export type TeamBoardId = "DSH-COMMERCIAL" | "DSH-ACCESS" | "DSH-SUPPLY" | "DSH-LAUNCH";

export const TEAM_DASHBOARDS: { id: TeamBoardId; team: string; title: string; ownerRole: string; source: string }[] = [
  {
    id: "DSH-COMMERCIAL",
    team: "Commercial",
    title: "Commercial overview",
    ownerRole: "Commercial Analytics Lead",
    source: "Product_Market_Monthly",
  },
  {
    id: "DSH-ACCESS",
    team: "Market Access",
    title: "Market access overview",
    ownerRole: "Market Access Analytics Lead",
    source: "Market_Access",
  },
  {
    id: "DSH-SUPPLY",
    team: "Supply Chain",
    title: "Supply chain overview",
    ownerRole: "Supply Analytics Lead",
    source: "Supply_Operations",
  },
  {
    id: "DSH-LAUNCH",
    team: "Launch Excellence",
    title: "Launch overview",
    ownerRole: "Launch Excellence Lead",
    source: "Launch_Milestones",
  },
];
