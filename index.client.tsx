import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WorkbenchScreen } from "./client/WorkbenchScreen";
import { SidebarItem } from "./client/SidebarItem";
import { contributeHeaderButtons } from "./client/headerButtons";
import { WorkspaceSpecialistsPanel, AgentReviewPanel } from "./client/SpecialistsPanel";

export default function contribute(client:PluginClientContext) {
  client.addScreen({id:"workbench",title:"Workbench",Component:WorkbenchScreen});
  client.addSidebarHeaderItem({id:"workbench",title:"Workbench",Component:SidebarItem});
  // Panel and command ids keep their pre-alpha.8 names, so panels users already opened stay valid.
  client.addWorkspacePanel({id:"helpers",title:"Workbench specialists",icon:"ShieldCheck",context:"workspace",locations:["workspace","explorer"],Component:WorkspaceSpecialistsPanel});
  client.addWorkspacePanel({id:"agent-review",title:"Independent review",icon:"Scan",context:"agent",locations:["workspace","explorer"],Component:AgentReviewPanel});
  client.addCommandCenterItem({id:"open-workbench-helpers",title:"Open Workbench specialists",icon:"ShieldCheck",context:"workspace",onSelect({openPanel}){openPanel("helpers")}});
  client.addCommandCenterItem({id:"review-agent",title:"Review agent work independently",icon:"Scan",context:"agent",onSelect({openPanel}){openPanel("agent-review")}});
  return contributeHeaderButtons(client);
}
