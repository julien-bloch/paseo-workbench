import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { getPaseoClient, useSettings } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { preferences, isCoordinatorHome, type Preferences } from "../shared/settings";
import { attentionGroups, attentionHeadline, finishedSpecialists, groupProjects, withTeam } from "../shared/model";
import { useCoordinators } from "./Coordinators";
import { LaunchTab } from "./LaunchTab";
import { AttentionList } from "./AttentionList";
import { createSpecialist } from "./actions";
import { Command } from "./Command";
import { AgentTree } from "./AgentTree";
import { useDirectory } from "./data";
import { Button, Choice, Field, Notice, Section, Wrap } from "./ui";
import { SettingsEditor } from "./SettingsEditor";
import { useFolderSpecialists } from "./folder";
import { importSpecialists, mergeSpecialists } from "../shared/specialistFiles";

type Tab="command"|"launch"|"overview"|"settings";

export function WorkbenchScreen(props:PluginScreenProps) {
  const {theme}=props;
  const settings=useSettings(preferences);
  const directory=useDirectory(props.host);
  if(settings.status!=="ready")return <View style={{flex:1,backgroundColor:theme.colors.surface0,padding:22}}>
    <Notice theme={theme} text={settings.status==="loading"?"Loading Workbench settings…":`Workbench settings ${settings.status}: ${"error" in settings?settings.error:"Unknown error"}`} kind={settings.status==="loading"?"info":"error"}/>
  </View>;
  // values and revision come from the same render, so a save made from them is a true compare-and-set.
  return <ReadyWorkbench {...props} directory={directory} values={settings.values} onSave={next=>settings.save(next,settings.revision)}/>;
}

function ReadyWorkbench({host,theme,layout,navigation,directory,values,onSave}:PluginScreenProps & {directory:ReturnType<typeof useDirectory>;values:Preferences;onSave:(next:Preferences)=>Promise<boolean>}){
  const [tab,setTab]=useState<Tab>("command");
  const [overviewFilter,setOverviewFilter]=useState("");
  const [commandSelection,setCommandSelection]=useState("");
  const [importText,setImportText]=useState("");
  const [confirmBulk,setConfirmBulk]=useState(false);
  const [message,setMessage]=useState<{kind:"info"|"error"|"success";text:string}|null>(null);
  // Coordinator homes are Workbench plumbing, not user projects.
  const projects=useMemo(()=>groupProjects(directory.workspaces.filter(w=>!isCoordinatorHome(w.directory)),directory.agents),[directory.workspaces,directory.agents]);
  const attentionByProject=useMemo(()=>attentionGroups(directory.agents,projects),[directory.agents,projects]);
  const attention=attentionByProject.flatMap(g=>g.items);
  const attentionIndex=useMemo(()=>new Map(attention.map(i=>[`${i.serverId}:${i.agentId}`,i])),[attentionByProject]);
  const running=directory.agents.filter(a=>a.status==="running"||a.status==="initializing");
  const unobserved=Object.keys(directory.errors).length;
  const headline=attentionHeadline(attention.length,unobserved,directory.updatedAt!==null);
  // Labels are display-only and can collide (two daemons on one machine); add the server id when they do.
  const hostLabel=(serverId:string)=>{
    const label=directory.hosts.find(h=>h.serverId===serverId)?.label||serverId;
    return directory.hosts.some(h=>h.serverId!==serverId&&h.label===label)?`${label} · ${serverId}`:label;
  };
  function openAgent(id:string,serverId:string){
    if(!navigation){setMessage({kind:"info",text:`Agent ${id} is ready. Open it from Paseo's normal agent list.`});return;}
    navigation.openAgent({agentId:id,serverId});
  }
  const coordinators=useCoordinators({host,values,onSave,directory,hostLabel,openAgent});
  // Launch-side view: stored specialists with the folder's on top. Saves always use the stored `values`.
  const folder=useFolderSpecialists(values.specialistsFolder);
  const launchValues=useMemo(()=>({...values,helpers:mergeSpecialists(values.helpers,folder.specialists)}),[values,folder.specialists]);

  /** Launch the Session summarizer, read-only, in the agent's own workspace (a Coordinator's home included). */
  async function summarize(agentId:string,serverId:string){
    const helper=launchValues.helpers.find(h=>h.id==="session-summarizer");
    if(!helper){setMessage({kind:"error",text:"The Session summarizer profile was deleted. Add a profile with id session-summarizer, or reset Workbench settings."});return;}
    const agent=directory.agents.find(a=>a.serverId===serverId&&a.agentId===agentId);
    const workspace=directory.workspaces.find(w=>w.serverId===serverId&&w.workspaceId===agent?.workspaceId);
    if(!agent||!workspace){setMessage({kind:"error",text:"That agent's workspace is not readable right now."});return;}
    const project=projects.find(p=>p.key===`${serverId}:${workspace.projectId}`)??{key:`${serverId}:${workspace.projectId}`,serverId,projectId:workspace.projectId,name:workspace.projectName,workspaces:[workspace],agents:[],running:0,attention:0};
    setMessage({kind:"info",text:`Starting the Session summarizer for "${agent.title}"…`});
    try{
      const result=await createSpecialist({paseo:getPaseoClient(serverId),helper,settings:launchValues,project,workspace,scope:"session",task:"",sessionAgentId:agentId});
      setMessage({kind:"success",text:`Session summarizer started (${result.agentId}) in ${workspace.name}.`});
      openAgent(result.agentId,serverId);
    }catch(e){setMessage({kind:"error",text:e instanceof Error?e.message:String(e)})}
  }
  const summarizeAction=(id:string,server:string)=>void summarize(id,server);

  /** Archive agents (each with its review team). They stay in Paseo's history; nothing is deleted. */
  async function archive(targets:readonly {agentId:string;serverId:string}[]){
    const ids=targets.flatMap(t=>withTeam(directory.agents,t.serverId,t.agentId).map(agentId=>({agentId,serverId:t.serverId})));
    const failed:string[]=[];
    for(const t of ids){try{await getPaseoClient(t.serverId).agents.ref(t.agentId).archive()}catch(e){failed.push(e instanceof Error?e.message:String(e))}}
    setMessage(failed.length?{kind:"error",text:`Archived ${ids.length-failed.length} of ${ids.length}: ${failed[0]}`}:{kind:"success",text:`Archived ${ids.length} agent${ids.length===1?"":"s"}. They stay in Paseo's history.`});
    await directory.refresh();
  }
  const archiveOne=(agentId:string,serverId:string)=>void archive([{agentId,serverId}]);

  return <ScrollView style={{flex:1,backgroundColor:theme.colors.surface0}} contentContainerStyle={{padding:layout.compact?14:26,gap:20,paddingBottom:54}}>
    <View style={{gap:7}}>
      <Text style={{fontSize:layout.compact?25:30,fontWeight:"700",color:theme.colors.foreground}}>Workbench</Text>
      <Wrap>
        <Text style={{fontSize:12,color:theme.colors.foregroundMuted}}>{projects.length} projects</Text>
        <Text style={{fontSize:12,color:theme.colors.foregroundMuted}}>· {running.length} working</Text>
        <Text style={{fontSize:12,color:attention.length?theme.colors.statusWarning:theme.colors.foregroundMuted}}>· {attention.length} need attention</Text>
        <Text style={{fontSize:12,color:unobserved?theme.colors.statusDanger:theme.colors.foregroundMuted}}>· {directory.hosts.length-unobserved} of {directory.hosts.length} hosts read</Text>
      </Wrap>
    </View>
    <Wrap>{(["command","launch","overview","settings"] as const).map(t=><Choice key={t} theme={theme} label={t.charAt(0).toUpperCase()+t.slice(1)} selected={tab===t} onPress={()=>setTab(t)}/>)}</Wrap>
    {message?<Notice theme={theme} {...message}/>:null}
    {directory.loading?<Notice theme={theme} text="Loading Paseo projects and agents…"/>:null}
    {directory.truncated?<Notice theme={theme} text="The agent/project directory reached its page limit. Some entries may be omitted." kind="error"/>:null}
    {Object.entries(directory.errors).map(([id,error])=><Notice key={id} theme={theme} text={`${hostLabel(id)}: ${error}`} kind="error"/>)}
    {tab==="launch"?<LaunchTab theme={theme} values={launchValues} projects={projects} hostLabel={hostLabel} multiHost={directory.hosts.length>1} coordinators={coordinators} openAgent={openAgent}
      onCoordinatorLaunched={id=>{setCommandSelection(id);setTab("command")}}/>:null}
    {tab==="command"?<Section theme={theme} title="Needs attention">
      {unobserved||!attention.length?<Notice theme={theme} kind={headline.clear?"info":"error"} text={headline.text}/>:null}
      <AttentionList theme={theme} groups={attentionByProject} hostSuffix={id=>id&&directory.hosts.length>1?` (${hostLabel(id)})`:""} openAgent={openAgent} onArchive={archiveOne}/>
    </Section>:null}
    {tab==="command"?<Command host={host} theme={theme} layout={layout} values={values} directory={directory} projects={projects} openAgent={openAgent} onSummarize={summarizeAction} onArchive={archiveOne}
      coordinators={coordinators} selected={commandSelection} onSelect={setCommandSelection}/>:null}
    {tab==="overview"?<>
      <Section theme={theme} title="All agents" subtitle="Who started what. Tap any agent to open it.">
        <Notice theme={theme} text={`Native subagents are live-only: they appear only if they changed after ${directory.nativeSince?new Date(directory.nativeSince).toLocaleTimeString():"this screen opened"}.`}/>
        {Object.entries(directory.nativeErrors).map(([id,error])=><Notice key={id} theme={theme} kind="error" text={`${hostLabel(id)}: native subagent feed unavailable (${error}).`}/>)}
        <Wrap><Choice theme={theme} label="All projects" selected={!overviewFilter} onPress={()=>setOverviewFilter("")}/>
          {projects.map(p=><Choice key={p.key} theme={theme} label={p.name} selected={overviewFilter===p.key} onPress={()=>setOverviewFilter(p.key)}/>)}</Wrap>
        {(()=>{
          const project=projects.find(p=>p.key===overviewFilter);
          const agents=project?project.agents:directory.agents;
          const ids=new Set(agents.map(a=>`${a.serverId}:${a.agentId}`));
          const native=directory.native.filter(s=>ids.has(`${s.serverId}:${s.parentAgentId}`));
          const finished=finishedSpecialists(agents);
          return <>
          {finished.length?<Wrap>
            <Button theme={theme} subtle label={confirmBulk?`Confirm: archive ${finished.length} finished specialist${finished.length===1?"":"s"}`:`Archive finished specialists (${finished.length})`} onPress={()=>{if(!confirmBulk){setConfirmBulk(true);return;}setConfirmBulk(false);void archive(finished)}}/>
            {confirmBulk?<Button theme={theme} subtle label="Cancel" onPress={()=>setConfirmBulk(false)}/>:null}
          </Wrap>:null}
          <AgentTree theme={theme} agents={agents} native={native} attention={attentionIndex} openAgent={openAgent} onSummarize={summarizeAction} onArchive={archiveOne} empty={unobserved?"No agents on reachable hosts with this filter.":"No agents found with this filter."}/></>;
        })()}
      </Section>
    </>:null}
    {tab==="settings"?<>
      <SettingsEditor theme={theme} values={values} onSave={onSave} folder={folder}/>
      <Section theme={theme} title="Import specialists" subtitle="Paste another host's Export (below), or a JSON list of specialists. Same id replaces, new ones are added. Coordinators and the default model are not imported.">
        <Field theme={theme} label="JSON" value={importText} onChangeText={setImportText} multiline placeholder='{"helpers":[...]}'/>
        <Button theme={theme} label="Import" disabled={!importText.trim()} onPress={()=>{
          const result=importSpecialists(values.helpers,importText);
          if("error" in result){setMessage({kind:"error",text:`Import: ${result.error}`});return;}
          void onSave({...values,helpers:result.helpers}).then(ok=>{
            setMessage(ok?{kind:"success",text:`Imported: ${result.added} added, ${result.replaced} replaced.`}:{kind:"error",text:"Settings changed on another device; import again."});
            if(ok)setImportText("");
          });
        }}/>
      </Section>
      <Section theme={theme} title="Export" subtitle="Specialists and coordinators live in this host's Paseo settings and are removed if the plugin's settings are reset. Copy this to keep a backup or to import on another host. Project notes from earlier versions are kept here, unused.">
        <Text selectable style={{color:theme.colors.foreground,fontSize:11,backgroundColor:theme.colors.surface2,padding:10,borderRadius:8}}>{JSON.stringify({helpers:values.helpers,coordinators:values.coordinators,projectNotes:values.projectNotes},null,2)}</Text>
      </Section>
    </>:null}
  </ScrollView>;
}
