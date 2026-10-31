import type { getPaseoClient } from "@getpaseo/plugin/client";
import type { Specialist, Preferences } from "../shared/settings";
import type { ProjectGroup, WorkbenchWorkspace } from "../shared/model";
import { COORDINATOR_ID_LABEL, COORDINATOR_LABEL, COORDINATOR_VALUE, SPECIALIST_LABEL, PARENT_AGENT_ID_LABEL, SECOND_OPINION_FOR_LABEL } from "../shared/settings";
import { specialistPrompt, type PrWatch, type SpecialistScope } from "../shared/prompts";
import { transcriptRows, transcriptText } from "../shared/transcript";
import { planLaunchMode, providerOf, secondReviewerModeId, type LaunchMode } from "../shared/permissions";

type PaseoApi = ReturnType<typeof getPaseoClient>;

/** Explicit choice only: a profile override, else the saved default. Workbench never guesses a model. */
export function resolveModel(saved:string, override:string):string {
  return override.trim()||saved.trim();
}

export type ReviewMode = "single"|"second-opinion"|"committee";

export interface SpecialistLaunch {
  agentId:string; mode:LaunchMode; workspaceId:string;
  secondOpinion?:{agentId:string;mode:LaunchMode;model:string};
  /** Set when the second opinion could not be started; the primary then runs without one. */
  secondOpinionError?:string;
}

type Planned = {model:string;mode:LaunchMode};

async function checkChosenMode(paseo:PaseoApi,{model,mode}:Planned){
  if(mode.kind!=="chosen")return;
  const catalog=await paseo.providers.listModes(providerOf(model));
  if(catalog.error)throw new Error(`Cannot verify mode "${mode.modeId}": ${catalog.error}`);
  const modes=catalog.modes??[];
  if(!modes.some(m=>m.id===mode.modeId))throw new Error(`Mode "${mode.modeId}" is not offered by ${providerOf(model)}. Available: ${modes.map(m=>m.id).join(", ")||"none reported"}.`);
}

/** Create an agent without a prompt and verify the mode Paseo applied, so no work starts in the wrong mode. */
async function createVerified(paseo:PaseoApi,workspaceId:string,{model,mode}:Planned,systemPrompt:string,title:string,labels:Record<string,string>,denied?:{disallowedTools:string[]}){
  const options={...(mode.kind==="sandbox"?mode.options:{}),...denied};
  const agent=await paseo.workspaces.ref(workspaceId).agents.create({
    config:{
      provider:model,systemPrompt,
      ...(mode.kind==="read-only"||mode.kind==="chosen"?{modeId:mode.modeId}:{}),
      ...(Object.keys(options).length?{options}:{}),
    },
    // Paseo shows a sandboxed Codex agent as "Default Permissions", so say it in the title it does show.
    title:mode.kind==="sandbox"?`${title} · read-only sandbox`:title,
    labels,
  });
  if(mode.kind==="read-only"||mode.kind==="chosen"){
    const applied=(await agent.refresh())?.agent.currentModeId??null;
    if(applied!==mode.modeId){
      await agent.archive().catch(()=>undefined);
      throw new Error(`Paseo applied mode "${applied??"unknown"}" instead of "${mode.modeId}". The agent was archived before receiving its task.`);
    }
  }
  return agent;
}

async function sendTask(agent:{id:string;send(text:string):Promise<void>},name:string,prompt:string){
  try{await agent.send(prompt)}
  catch(error){
    // The task may have started even though the acknowledgement failed: name the agent so a retry does not duplicate it.
    throw new Error(`${name} was created (${agent.id}) but sending its task reported: ${error instanceof Error?error.message:String(error)}. Open that agent to check before launching again.`);
  }
}

/**
 * A worktree workspace checked out at a GitHub pull request, so the review never touches the user's checkout. One
 * Workbench already opened for this pull request in this project is reused instead of adding another worktree.
 */
export async function createPullRequestWorkspace(paseo:PaseoApi,source:WorkbenchWorkspace,prNumber:number):Promise<{workspaceId:string}> {
  const sourceDirectory=source.directory;
  const title=`PR #${prNumber} review`;
  // shortcut: looks at the first 200 workspaces; past that a duplicate worktree can be created.
  const existing=(await paseo.workspaces.list({page:{limit:200}})).entries.find(w=>w.workspaceKind==="worktree"&&w.projectId===source.projectId&&w.title===title&&!w.archivingAt);
  if(existing)return {workspaceId:existing.id};
  const workspace=await paseo.workspaces.create({
    title,
    source:{kind:"worktree",cwd:sourceDirectory,action:"checkout",checkoutSource:{kind:"change_request",forge:"github",number:prNumber}},
  });
  return {workspaceId:workspace.id};
}

/** Everything a specialist's task prompt is built from; shared by the launch and the launcher's prompt preview. */
export function promptInput(input:{helper:Specialist;settings:Preferences;project:ProjectGroup;scope:SpecialistScope;task:string;prNumber?:number;prWatch?:PrWatch[];session?:{agentId:string;title:string;transcript:string}}){
  const {helper,project,scope,task,prNumber,prWatch,session}=input;
  return {name:helper.name,instructions:helper.instructions,...(helper.skills?.length?{skills:helper.skills}:{}),task,scope,...(prNumber?{prNumber}:{}),...(scope==="pull-requests"&&prWatch?{prWatch}:{}),...(session?{session}:{}),projectName:project.name};
}

/** An agent's conversation as plain text, read from Paseo (never written to the user's repository). */
export async function sessionTranscript(paseo:PaseoApi,agentId:string):Promise<{agentId:string;title:string;transcript:string}> {
  const page=await paseo.agents.ref(agentId).timeline.refetch({direction:"tail",limit:1000});
  const items=page.entries.map(e=>((e as {item?:{type:string}}).item??e) as {type:string});
  const older=page.hasOlder?"(earlier part omitted: only the latest 1000 timeline entries were read)\n":"";
  return {agentId,title:page.agent?.title||agentId,transcript:older+transcriptText(transcriptRows(items))};
}

export async function createSpecialist(input:{
  paseo:PaseoApi; helper:Specialist; settings:Preferences; project:ProjectGroup;
  workspace:WorkbenchWorkspace; scope:SpecialistScope; task:string; prNumber?:number; prWatch?:PrWatch[]; parentAgentId?:string;
  /** Required for scope "session": the agent whose conversation is summarized. */
  sessionAgentId?:string;
  /** "second-opinion": one-way, the primary verifies the second's findings. "committee": two-way cross-check, then the primary (chair) writes the consensus. */
  review?:ReviewMode;
  /** Registers the pair with the plugin server, which relays reports between them (or `failure`). */
  registerPair?:(primaryId:string,secondId:string,mode:"second-opinion"|"committee",failure?:string)=>Promise<{registered:boolean;reason?:string|undefined}>;
}):Promise<SpecialistLaunch> {
  const {paseo,helper,settings,project,workspace,scope,task,prNumber,parentAgentId}=input;
  // Every check runs before anything is created.
  const model=resolveModel(settings.defaultModel,helper.model);
  if(!model)throw new Error("Choose a provider/model in Workbench > Settings before launching a specialist.");
  if(scope==="task"&&!task.trim())throw new Error("Describe the task before launching a task-scoped specialist.");
  if(scope==="pull-request"&&!(prNumber&&Number.isInteger(prNumber)&&prNumber>0))throw new Error("Enter the pull request number to review.");
  if(scope==="session"&&!input.sessionAgentId)throw new Error("Choose the agent whose session to summarize.");
  const primary:Planned={model,mode:planLaunchMode({name:helper.name,providerModel:model,modeId:helper.modeId,requireReadOnly:helper.requireReadOnly})};
  const review=input.review??"single";
  const teamName=review==="committee"?"committee member":"second opinion";
  let second:Planned|null=null;
  if(review!=="single"){
    const secondModel=helper.secondOpinionModel.trim();
    if(!secondModel)throw new Error(`Choose a second reviewer model for ${helper.name} in Workbench > Settings to run a ${review==="committee"?"committee":"second opinion"}.`);
    // The second reviewer gets the same permission requirement as the profile, never a weaker one.
    // Never weaker than the primary: the same permission requirement, and the profile's chosen mode when the provider is the same.
    second={model:secondModel,mode:planLaunchMode({name:`${helper.name} ${teamName}`,providerModel:secondModel,modeId:secondReviewerModeId(model,secondModel,helper.modeId),requireReadOnly:helper.requireReadOnly})};
  }
  await checkChosenMode(paseo,primary);

  const workspaceId=scope==="pull-request"?(await createPullRequestWorkspace(paseo,workspace,prNumber!)).workspaceId:workspace.workspaceId;
  const session=scope==="session"&&input.sessionAgentId?await sessionTranscript(paseo,input.sessionAgentId):undefined;
  const base=promptInput({helper,settings,project,scope,task,...(prNumber?{prNumber}:{}),...(input.prWatch?{prWatch:input.prWatch}:{}),...(session?{session}:{})});
  const target=scope==="pull-request"?`PR #${prNumber}`:session?`session "${session.title}"`:project.name;
  // New sessions, no inherited conversation. Parentage is metadata only: Paseo's own parent label, written directly,
  // because the SDK `parent` option (Paseo 0.12) adds nothing else here but fails once the parent is closed.
  const primaryAgent=await createVerified(paseo,workspaceId,primary,helper.instructions,`${helper.name}: ${target}`,
    {"workbench.role":"helper",[SPECIALIST_LABEL]:helper.id,...(parentAgentId?{[PARENT_AGENT_ID_LABEL]:parentAgentId}:{})},
    helper.id==="pr-manager"?prManagerDenied(model):undefined);
  let secondAgent:Awaited<ReturnType<typeof createVerified>>|null=null;
  let secondOpinionError:string|undefined;
  if(second){
    try{
      secondAgent=await createVerified(paseo,workspaceId,second,helper.instructions,`${helper.name} ${teamName} (${second.model}): ${target}`,
        {"workbench.role":"helper",[SPECIALIST_LABEL]:helper.id,[SECOND_OPINION_FOR_LABEL]:primaryAgent.id,[PARENT_AGENT_ID_LABEL]:primaryAgent.id});
    }catch(error){
      // The requested team could not form. No task has been sent yet, so stop instead of quietly running alone.
      await primaryAgent.archive().catch(()=>undefined);
      throw new Error(`The ${teamName} could not start (${error instanceof Error?error.message:String(error)}); ${helper.name} was archived before receiving its task. Launch again, or choose Single review.`);
    }
  }
  // Both agents exist before either gets its task, so the primary is told about a second opinion only if one is really coming.
  const primaryRole=review==="committee"?"chair" as const:"primary" as const;
  try{await sendTask(primaryAgent,helper.name,specialistPrompt({...base,...(secondAgent&&second?{secondOpinion:{role:primaryRole,model:second.model}}:{})}))}
  catch(error){await secondAgent?.archive().catch(()=>undefined);throw error} // the second never got its task
  if(secondAgent&&second){
    let failure:string|undefined;
    const secondRole=review==="committee"?{role:"member" as const,model}:{role:"second" as const};
    try{await sendTask(secondAgent,`${helper.name} ${teamName}`,specialistPrompt({...base,secondOpinion:secondRole}))}
    catch(error){failure=error instanceof Error?error.message:String(error)}
    // The primary was told a second opinion is coming: register the pair even on failure, so the primary is told why none arrives.
    const registered=input.registerPair?await input.registerPair(primaryAgent.id,secondAgent.id,review==="committee"?"committee":"second-opinion",failure).catch((error:unknown)=>({registered:false,reason:error instanceof Error?error.message:String(error)})):{registered:false,reason:"no relay"};
    if(failure)secondOpinionError=`${failure} ${helper.name} (${primaryAgent.id}) is running and will be told the ${teamName} failed.`;
    else if(!registered.registered)secondOpinionError=`Reports will not be forwarded automatically (${registered.reason}); open the ${teamName} (${secondAgent.id}) and relay them yourself.`;
  }
  return {
    agentId:primaryAgent.id,mode:primary.mode,workspaceId,
    ...(secondAgent&&second?{secondOpinion:{agentId:secondAgent.id,mode:second.mode,model:second.model}}:{}),
    ...(secondOpinionError?{secondOpinionError}:{}),
  };
}

export function coordinatorFirstPrompt(name:string,contextFile:string):string {
  return `You are the Workbench Coordinator "${name}". Your context file is ${contextFile}. Read it, summarize the workspaces and agents you coordinate, and ask me what to focus on first.`;
}

/** Coordinator entry an agent belongs to; agents from before multiple Coordinators belong to "default". */
export function coordinatorIdOf(labels:Readonly<Record<string,string>>):string|null {
  return labels[COORDINATOR_LABEL]===COORDINATOR_VALUE?labels[COORDINATOR_ID_LABEL]??"default":null;
}

/** The live (non-archived) agent of one Coordinator entry, asked of Paseo directly rather than from a possibly stale poll. */
export async function findCoordinator(paseo:PaseoApi,coordinatorId:string):Promise<{agentId:string;title:string;status:string}|null> {
  const result=await paseo.agents.list({filter:{labels:{[COORDINATOR_LABEL]:COORDINATOR_VALUE}},page:{limit:100}});
  const agent=result.entries.map(e=>e.agent).find(a=>!a.archivedAt&&coordinatorIdOf(a.labels)===coordinatorId);
  return agent?{agentId:agent.id,title:agent.title||"Coordinator",status:agent.status}:null;
}

/** Whether agents on this host get Paseo's agent tools, without which a Coordinator can plan but not start or message agents. Read only. */
export async function agentToolsEnabled(paseo:PaseoApi):Promise<boolean> {
  const {config}=await paseo.config.get();
  return config.mcp.injectIntoAgents&&config.mcp.enabled!==false;
}

/**
 * Idempotent across clients and restarts: the daemon persists the creation key, so concurrent
 * clicks with identical settings return the same agent. A key reused with different settings is
 * rejected by the daemon ("conflict") instead of creating a second agent for the same Coordinator.
 */
export type CoordinatorResult = {kind:"created";agentId:string;archived:boolean} | {kind:"conflict"};
/**
 * A PR manager never merges or pushes itself (the user chose "fix locally, ask to push"). Claude Code deny rules beat the
 * user's own always-allow rules (e.g. Bash(gh pr:*)), so this holds even where instructions alone would not. `*` matches
 * anywhere (tested on Claude Code 2.1: `git -C <dir> push` and `gh api -X PUT .../merge` denied, reads still run).
 * Only direct gh/git commands: another program (sh -c, a script) is not covered. Other providers get no deny rules.
 */
const PR_MANAGER_DENIED = ["Bash(git push*)", "Bash(git * push*)", "Bash(gh pr merge*)", "Bash(gh * pr merge*)", "Bash(gh api *merge*)", "Bash(gh api *git/*)", "Bash(gh api *contents/*)"];
function prManagerDenied(model:string):{disallowedTools:string[]}|undefined {
  return providerOf(model)==="claude"?{disallowedTools:PR_MANAGER_DENIED}:undefined;
}

/** Coordinators start in the provider's auto mode, by choice. Ids by Paseo version: Codex "auto" on 0.12, "auto-review" on 0.13. */
const COORDINATOR_MODES: Readonly<Record<string, readonly string[]>> = { claude: ["auto"], codex: ["auto-review", "auto"] };

/** The first auto mode the host offers; undefined (the provider's default mode) when it offers none or its catalog is unreadable. */
async function coordinatorMode(paseo:PaseoApi,model:string):Promise<string|undefined> {
  const catalog=await paseo.providers.listModes(providerOf(model)).catch(()=>null);
  const offered=new Set((catalog?.modes??[]).map(m=>m.id));
  return COORDINATOR_MODES[providerOf(model)]?.find(id=>offered.has(id));
}

export async function createCoordinator(input:{paseo:PaseoApi;cwd:string;contextFile:string;model:string;coordinatorId:string;name:string;instructions:string;generation:number;kind?:"general"|"pr-manager"}):Promise<CoordinatorResult> {
  const {paseo,cwd,model,coordinatorId,name,instructions,generation}=input;
  const options=input.kind==="pr-manager"?prManagerDenied(model):undefined;
  const modeId=await coordinatorMode(paseo,model);
  try{
    const agent=await paseo.agents.create({
      // "default" keeps the pre-0.1.0-alpha.3 key, so a Coordinator created then is still found by it.
      idempotencyKey:coordinatorId==="default"?`workbench.coordinator.${generation}`:`workbench.coordinator.${coordinatorId}.${generation}`,
      cwd,title:name,
      config:{provider:model,systemPrompt:instructions,...(modeId?{modeId}:{}),...(options?{options}:{})},
      labels:{[COORDINATOR_LABEL]:COORDINATOR_VALUE,[COORDINATOR_ID_LABEL]:coordinatorId},
      prompt:coordinatorFirstPrompt(name,input.contextFile),
    });
    const snapshot=(await agent.refresh())?.agent;
    return {kind:"created",agentId:agent.id,archived:Boolean(snapshot?.archivedAt)};
  }catch(error){
    if(error instanceof Error&&error.message.includes("request_key_conflict"))return {kind:"conflict"};
    throw error;
  }
}
