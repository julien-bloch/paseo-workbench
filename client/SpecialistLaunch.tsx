import type { PluginTheme } from "@getpaseo/plugin";
import type { PaseoApi } from "@getpaseo/client";
import { useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { createSchedule, registerSecondOpinion } from "../shared/rpc";
import { Text, View } from "react-native";
import type { Preferences } from "../shared/settings";
import type { ProjectGroup, WorkbenchWorkspace } from "../shared/model";
import { planLaunchMode, type LaunchMode } from "../shared/permissions";
import { createSpecialist, promptInput, resolveModel, type ReviewMode } from "./actions";
import { specialistPrompt } from "../shared/prompts";
import type { PrWatch, SpecialistScope } from "../shared/prompts";
import { Button, Choice, Field, Notice, Section, Wrap } from "./ui";

export interface SpecialistLaunchProps {
  theme:PluginTheme;
  /** When the page already chose the profile (Launch tab), it is used and the launcher shows no profile chips. */
  specialistId?:string;
  paseo:PaseoApi;
  settings:Preferences;
  project:ProjectGroup;
  workspace:WorkbenchWorkspace;
  parentAgentId?:string;
  onCreated?:(agentId:string)=>void;
  /** Part of the Launch tab's form: no section of its own. */
  embedded?:boolean;
  /** Create a Paseo schedule (a new agent each run) instead of launching now. */
  schedule?:{cron:string;timezone:string;label:string}|null;
  onScheduled?:()=>void;
}

export function describeMode(mode:LaunchMode):string {
  if(mode.kind==="read-only")return `Enforced read-only (${mode.modeId}). ${mode.boundary}`;
  if(mode.kind==="sandbox")return `Read-only sandbox requested, not verifiable per launch. ${mode.boundary}`;
  const which=mode.kind==="chosen"?`Mode "${mode.modeId}"`:"Provider default mode";
  return `${which}: NOT read-only. Only the written instructions discourage edits.`;
}

export function SpecialistLaunch({theme,specialistId,paseo,settings,project,workspace,parentAgentId,onCreated,embedded=false,schedule=null,onScheduled}:SpecialistLaunchProps){
  const [selectedId,setSelectedId]=useState("reviewer");
  // Conversations that can be summarized here: the agent this panel belongs to, or any agent in this workspace.
  const conversations=parentAgentId?[]:project.agents.filter(a=>a.workspaceId===workspace.workspaceId&&!a.archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const [sessionId,setSessionId]=useState(parentAgentId??conversations[0]?.agentId??"");
  const sessionTitle=parentAgentId?"this agent":conversations.find(a=>a.agentId===sessionId)?.title??"";
  const firstScope=(id:string):SpecialistScope=>id==="reviewer"?"working-tree":id==="session-summarizer"&&(parentAgentId||conversations.length)?"session":"task";
  const [chosenScope,setScope]=useState<SpecialistScope>(()=>firstScope(specialistId??"reviewer"));
  const [prWatch,setPrWatch]=useState<PrWatch[]>(["mine"]);
  const [task,setTask]=useState("");
  const [prNumber,setPrNumber]=useState("");
  // null: the profile's default review (when its second reviewer model is set).
  const [chosenReview,setChosenReview]=useState<ReviewMode|null>(null);
  const [showPrompt,setShowPrompt]=useState(false);
  const register=useRpc(registerSecondOpinion);
  const scheduleCreate=useRpc(createSchedule);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{text:string;kind:"error"|"success"|"info"}|null>(null);
  // Coordinator-only profiles run across projects (Launch tab), never in one workspace.
  const profiles=settings.helpers.filter(h=>!h.coordinatorOnly);
  const helper=(specialistId?profiles.find(h=>h.id===specialistId):undefined)??profiles.find(h=>h.id===selectedId)??profiles[0];
  // The PR manager has one scope here: this repository's pull requests.
  const isPr=helper?.id==="pr-manager";
  const scope:SpecialistScope=isPr?"pull-requests":chosenScope;
  const model=helper?resolveModel(settings.defaultModel,helper.model):"";
  let mode:LaunchMode|null=null;
  let blocked="";
  if(helper&&model){
    try{mode=planLaunchMode({name:helper.name,providerModel:model,modeId:helper.modeId,requireReadOnly:helper.requireReadOnly})}
    catch(e){blocked=e instanceof Error?e.message:String(e)}
  }
  const secondModel=helper?.secondOpinionModel.trim()||"";
  let secondMode:LaunchMode|null=null;
  let secondBlocked="";
  if(helper&&secondModel){
    try{secondMode=planLaunchMode({name:`${helper.name} second reviewer`,providerModel:secondModel,modeId:"",requireReadOnly:helper.requireReadOnly})}
    catch(e){secondBlocked=e instanceof Error?e.message:String(e)}
  }
  // Scheduled runs are single reviews: a second opinion or committee is set up by Workbench at launch.
  const review:ReviewMode=schedule?"single":secondModel?chosenReview??helper?.defaultReview??"single":"single";
  // The CLI cannot pass Codex's sandbox option, so a read-only Codex profile cannot be scheduled.
  if(schedule&&mode?.kind==="sandbox"){blocked=`${helper?.name} needs Codex's read-only sandbox, which a scheduled run cannot request. Use a Claude model for this profile, or turn off "require read-only" in Settings.`;mode=null}
  const team=review!=="single";
  const teamLabel=review==="committee"?"Committee member":"Second opinion";
  const pr=Number(prNumber);
  async function launch(){
    if(!helper)return;
    setNotice(null);setBusy(true);
    if(schedule&&mode){
      try{
        const row=await scheduleCreate({name:`${helper.name} · ${workspace.name}`,prompt:specialistPrompt(promptInput({helper,settings,project,scope,task,prWatch})),cron:schedule.cron,timezone:schedule.timezone,
          target:{kind:"workspace",workspaceId:workspace.workspaceId,providerModel:model,modeId:mode.kind==="read-only"||mode.kind==="chosen"?mode.modeId:""}});
        setNotice({kind:"success",text:`Scheduled ${helper.name} in ${workspace.name}, ${schedule.label.toLowerCase()} (${row.cadence}). Each run starts a new agent. ${describeMode(mode)}${row.nextRunAt?` Next run ${new Date(row.nextRunAt).toLocaleString()}.`:""} Manage it under Schedules below.`});
        onScheduled?.();
      }catch(e){setNotice({kind:"error",text:e instanceof Error?e.message:String(e)})}
      finally{setBusy(false)}
      return;
    }
    try{
      const result=await createSpecialist({paseo,helper,settings,project,workspace,scope,task,prWatch,...(scope==="pull-request"?{prNumber:pr}:{}),...(scope==="session"&&sessionId?{sessionAgentId:sessionId}:{}),...(parentAgentId&&scope!=="session"?{parentAgentId}:{}),review,registerPair:(primaryId,secondId,mode,failure)=>register({primaryId,secondId,mode,...(failure?{failure}:{})})});
      const second=!result.secondOpinion?"":review==="committee"
        ?` Committee member: ${result.secondOpinion.model} (${result.secondOpinion.agentId}). Workbench exchanges their reviews when both are idle, then ${helper.name} writes the consensus.`
        :` Second opinion: ${result.secondOpinion.model} (${result.secondOpinion.agentId}); its findings go to ${helper.name} automatically when both are idle.`;
      setNotice({kind:result.secondOpinionError?"error":"success",text:`Created ${helper.name} (${result.agentId}). ${describeMode(result.mode)}${second}${result.secondOpinionError?` ${teamLabel} problem: ${result.secondOpinionError}`:""}`});
      onCreated?.(result.agentId);
    }catch(e){setNotice({kind:"error",text:e instanceof Error?e.message:String(e)})}
    finally{setBusy(false)}
  }
  const scopes=[
    {id:"working-tree",name:"Uncommitted changes",about:"Edits in this workspace that are not committed yet."},
    {id:"branch",name:"This branch",about:"Everything on this workspace's branch, compared with the branch it came from."},
    ...(schedule?[]:[{id:"pull-request",name:"A pull request",about:"A GitHub pull request by number, checked out in a new worktree; your files are not touched."}] as const),
    {id:"task",name:"Something else",about:"Only what you describe below."},
    ...(parentAgentId&&!schedule?[{id:"session",name:"This agent's session",about:"This agent's conversation, read from Paseo."}] as const
      :conversations.length&&!schedule?[{id:"session",name:"An agent's conversation",about:"The conversation of an agent in this workspace, read from Paseo. Pick it below."}] as const:[]),
  ] as const;
  const togglePr=(w:PrWatch)=>setPrWatch(w==="all"?(prWatch.includes("all")?[]:["all"]):prWatch.includes(w)?prWatch.filter(x=>x!==w):[...prWatch.filter(x=>x!=="all"),w]);
  const body=<>
    {specialistId===undefined?<Wrap>{profiles.map(h=><Choice key={h.id} theme={theme} label={h.name} selected={h.id===helper?.id} onPress={()=>{setSelectedId(h.id);setScope(firstScope(h.id));setChosenReview(null)}}/>)}</Wrap>:null}
    {/* In the Launch form the description is already shown above; only its skills are new here. */}
    {helper?(embedded?(helper.skills.length?<Text style={{color:theme.colors.foregroundMuted,fontSize:12}}>Skills: {helper.skills.join(", ")}</Text>:null)
      :<Text style={{color:theme.colors.foregroundMuted,fontSize:12}}>{helper.description}{helper.skills.length?` · Skills: ${helper.skills.join(", ")}`:""}</Text>):<Notice theme={theme} text="Add a specialist in Workbench settings."/>}
    <Text style={{color:theme.colors.foregroundMuted,fontSize:11}}>Model: {model||"Not configured: choose one in Workbench > Settings."}</Text>
    {mode?<Notice theme={theme} kind={mode.kind==="read-only"?"success":mode.kind==="sandbox"?"info":"error"} text={describeMode(mode)}/>:null}
    {blocked?<Notice theme={theme} kind="error" text={blocked}/>:null}
    {isPr?<>
      <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>Pull requests to check</Text>
      <Wrap>{([["mine","My PRs"],["review-requested","Asking for my review"],["all","All open PRs"]] as const).map(([id,text])=><Choice key={id} theme={theme} label={`${prWatch.includes(id)?"✓ ":""}${text}`} selected={prWatch.includes(id)} onPress={()=>togglePr(id)}/>)}</Wrap>
      <Text style={{color:theme.colors.foregroundMuted,fontSize:11}}>Checks this workspace's repository once and reports what each pull request needs. Starting a fixer asks you first.</Text>
    </>:<>
      <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>What should it look at?</Text>
      <Wrap>{scopes.map(s=><Choice key={s.id} theme={theme} label={s.name} selected={scope===s.id} onPress={()=>setScope(s.id)}/>)}</Wrap>
      <Text style={{color:theme.colors.foregroundMuted,fontSize:11}}>{scopes.find(s=>s.id===scope)?.about}</Text>
      {scope==="session"&&!parentAgentId?<Wrap>{conversations.slice(0,20).map(a=><Choice key={a.agentId} theme={theme} label={a.title} selected={sessionId===a.agentId} onPress={()=>setSessionId(a.agentId)}/>)}</Wrap>:null}
    </>}
    {scope==="pull-request"?<Field theme={theme} label="Pull request number" value={prNumber} onChangeText={setPrNumber} placeholder="e.g. 42" helper="Fetched with git (refs/pull/N/head from this repository's GitHub remote) into a new worktree workspace. Your current checkout is not touched."/>:null}
    {helper&&!schedule&&!isPr?<>
      <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>Review</Text>
      <Wrap>
        <Choice theme={theme} label="Single" selected={review==="single"} onPress={()=>setChosenReview("single")}/>
        {secondModel?<>
          <Choice theme={theme} label={`Second opinion (${secondModel})`} selected={review==="second-opinion"} onPress={()=>setChosenReview("second-opinion")}/>
          <Choice theme={theme} label={`Committee with ${secondModel}`} selected={review==="committee"} onPress={()=>setChosenReview("committee")}/>
        </>:null}
      </Wrap>
      {!secondModel?<Notice theme={theme} kind={helper.defaultReview!=="single"?"error":"info"} text={`${helper.defaultReview!=="single"?`${helper.name} defaults to a ${helper.defaultReview==="committee"?"committee":"second opinion"}, which needs`:"Second opinion and committee need"} a second reviewer model: set one in Settings > Specialists.`}/>:null}
      {team?<Text style={{color:theme.colors.foregroundMuted,fontSize:11}}>{review==="committee"?`Both review independently; Workbench then gives each the other's review to check, and ${helper.name} writes the consensus with where they diverged. Adds the second model's time and tokens.`:`The second reviewer's findings go to ${helper.name}, which verifies each one. Adds the second model's time and tokens.`}</Text>:null}
      {team&&secondMode?<Notice theme={theme} kind={secondMode.kind==="read-only"?"success":secondMode.kind==="sandbox"?"info":"error"} text={`${teamLabel}: ${describeMode(secondMode)}`}/>:null}
      {team&&secondBlocked?<Notice theme={theme} kind="error" text={secondBlocked}/>:null}
    </>:null}
    <Field theme={theme} label={scope==="task"?"What should it do?":"Anything else it should know? (optional)"} value={task} multiline onChangeText={setTask} placeholder={scope==="task"?"Required: describe the task":"e.g. focus on the data loading"}/>
    {helper?<Button theme={theme} subtle label={showPrompt?"Hide prompt":"Show prompt"} onPress={()=>setShowPrompt(!showPrompt)}/>:null}
    {helper&&showPrompt?(()=>{
      const base=promptInput({helper,settings,project,scope,task,prWatch,...(scope==="pull-request"&&pr>0?{prNumber:pr}:{}),...(scope==="session"&&sessionId?{session:{agentId:sessionId,title:sessionTitle,transcript:"(the agent's conversation is read from Paseo and inserted here at launch)"}}:{})});
      const withSecond=team&&secondMode;
      const block=(title:string,text:string)=><>
        <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>{title}</Text>
        <Text selectable style={{color:theme.colors.foreground,fontSize:11,backgroundColor:theme.colors.surface2,padding:10,borderRadius:8}}>{text}</Text>
      </>;
      return <>
        <Text style={{color:theme.colors.foregroundMuted,fontSize:11}}>Exactly what Launch sends, updated as you change the scope and task. The profile's instructions are also its system prompt. Edit them in Settings &gt; Specialists.</Text>
        {block(`${helper.name} prompt`,specialistPrompt({...base,...(withSecond?{secondOpinion:{role:review==="committee"?"chair" as const:"primary" as const,model:secondModel}}:{})}))}
        {withSecond?block(`${teamLabel} prompt (${secondModel})`,specialistPrompt({...base,secondOpinion:review==="committee"?{role:"member" as const,model}:{role:"second" as const}})):null}
      </>;
    })():null}
    <Button theme={theme} label={busy?"Launching…":schedule?`Schedule ${helper?.name||"specialist"}`:`Launch ${helper?.name||"specialist"}`} onPress={()=>void launch()} disabled={busy||!helper||!model||!mode||(scope==="session"&&!sessionId)||(scope==="pull-requests"&&!prWatch.length)||(scope==="task"&&!task.trim())||(scope==="pull-request"&&!(Number.isInteger(pr)&&pr>0))||(!!schedule&&(!schedule.cron||scope==="pull-request"||scope==="session"||(scope==="task"&&!task.trim())))||(team&&!secondMode)}/>
    {notice?<Notice theme={theme} {...notice}/>:null}
  </>;
  // Not a component defined here: that would remount the fields (and drop focus) on every keystroke.
  return embedded?<View style={{gap:12}}>{body}</View>
    :<Section theme={theme} title="Launch a specialist" subtitle={`Fresh independent context in ${workspace.name}.${parentAgentId?" Shown as a child of this agent in the hierarchy; it does not inherit its conversation.":""} Nothing starts until you press Launch.`}>{body}</Section>;
}
