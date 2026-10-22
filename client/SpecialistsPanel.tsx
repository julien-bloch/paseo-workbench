import type { PluginAgentPanelProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings, useWorkspace } from "@getpaseo/plugin/client";
import { ScrollView } from "react-native";
import { preferences } from "../shared/settings";
import type { ProjectGroup, WorkbenchWorkspace } from "../shared/model";
import { projectKey } from "../shared/model";
import { SpecialistLaunch } from "./SpecialistLaunch";
import { useFolderSpecialists } from "./folder";
import { mergeSpecialists } from "../shared/specialistFiles";
import { Notice } from "./ui";

function WorkspaceForm(props:PluginWorkspacePanelProps|PluginAgentPanelProps){
  const {host,layout,theme,workspaceId,navigation}=props;
  const parentAgentId=props.context==="agent"?props.agentId:undefined;
  const paseo=usePaseo();
  const settings=useSettings(preferences);
  const folder=useFolderSpecialists(settings.status==="ready"?settings.values.specialistsFolder:"");
  const ws=useWorkspace(workspaceId,workspace=>({id:workspace.id,projectId:workspace.projectId,projectDisplayName:workspace.projectDisplayName,name:workspace.name,title:workspace.title,directory:workspace.directory,status:workspace.status}));
  if(!ws)return <Notice theme={theme} text="Workspace not available." kind="error"/>;
  if(settings.status!=="ready")return <Notice theme={theme} text={settings.status==="loading"?"Loading Workbench settings…":"Cannot load Workbench settings."} kind={settings.status==="loading"?"info":"error"}/>;
  const workspace:WorkbenchWorkspace={serverId:host.id,workspaceId:ws.id,projectId:ws.projectId,projectName:ws.projectDisplayName||ws.name,name:ws.title||ws.name,directory:ws.directory,status:ws.status};
  const project:ProjectGroup={key:projectKey(host.id,ws.projectId),serverId:host.id,projectId:ws.projectId,name:ws.projectDisplayName||ws.name,workspaces:[workspace],agents:[],attention:0,running:0};
  return <ScrollView style={{flex:1,backgroundColor:theme.colors.surface0}} contentContainerStyle={{padding:layout.compact?12:24,gap:12}}>
    <SpecialistLaunch theme={theme} paseo={paseo} settings={{...settings.values,helpers:mergeSpecialists(settings.values.helpers,folder.specialists)}} project={project} workspace={workspace}
      {...(parentAgentId?{parentAgentId}:{})} onCreated={agentId=>navigation?.openAgent({agentId,serverId:host.id})}/>
  </ScrollView>;
}

export function WorkspaceSpecialistsPanel(props:PluginWorkspacePanelProps){return <WorkspaceForm {...props}/>;}
export function AgentReviewPanel(props:PluginAgentPanelProps){return <WorkspaceForm {...props}/>;}
