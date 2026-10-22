import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Text, View } from "react-native";
import { sameValue, type Specialist, type Preferences } from "../shared/settings";
import { planLaunchMode, providerOf } from "../shared/permissions";
import { resolveModel } from "./actions";
import { describeMode } from "./SpecialistLaunch";
import { useDraft } from "./useDraft";
import type { FolderState } from "./folder";
import { ModelPicker, useCatalog } from "./catalog";
import { Button, Choice, Field, Notice, Section, Wrap } from "./ui";

const EXAMPLE=`reviewer.md  (named like a built-in: replaces it)

---
name: Reviewer
description: Independent correctness review
skills: review-style
review: committee
second-model: codex/gpt-6.1-sol
---
You are an independent code reviewer. ...

Header keys (all optional): name, description, skills (comma-separated),
model, read-only (true/false, default true), mode (with read-only: false),
review (single / second-opinion / committee), second-model, coordinator-only.
The rest of the file is the instructions.`;

export function SettingsEditor({theme,values,onSave,folder}:{theme:PluginTheme;values:Preferences;onSave:(next:Preferences)=>Promise<boolean>;folder:FolderState}){
  const catalog=useCatalog();
  const provider=useDraft({defaultModel:values.defaultModel},"provider");
  const folderPath=useDraft({specialistsFolder:values.specialistsFolder},"folder");
  const [specialistId,setSpecialistId]=useState(values.helpers[0]?.id||"");
  const storedSpecialist=values.helpers.find(h=>h.id===specialistId)||null;
  const helper=useDraft<Specialist|null>(storedSpecialist,specialistId);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<{kind:"error"|"success";text:string}|null>(null);
  const [customName,setCustomName]=useState("");
  const [confirmDelete,setConfirmDelete]=useState("");
  const [showExample,setShowExample]=useState(false);
  const [creating,setCreating]=useState(false);
  async function deleteSpecialist(id:string){
    if(confirmDelete!==id){setConfirmDelete(id);return;}
    setConfirmDelete("");
    const rest=values.helpers.filter(h=>h.id!==id);
    if(await save({...values,helpers:rest},false))setSpecialistId(rest[0]?.id||"");
  }

  async function save(next:Preferences,conflict:boolean){
    if(conflict){setNotice({kind:"error",text:"This was changed on another device since you started editing. Your edits are kept; use Undo changes to load the saved version."});return false;}
    setBusy(true);setNotice(null);
    try {
      const ok=await onSave(next);
      setNotice(ok?{kind:"success",text:"Saved to the Paseo host. New agents will use these settings."}:{kind:"error",text:"Settings changed on another device. Your edits are kept; save again, or use Undo changes."});
      return ok;
    } finally {setBusy(false)}
  }
  function updateSpecialist(change:Partial<Specialist>){if(helper.draft)helper.setDraft({...helper.draft,...change});}
  async function addSpecialist(){
    if(!customName.trim())return;
    const id=`custom-${Date.now().toString(36)}`;
    const created:Specialist={id,name:customName.trim().slice(0,80),description:"Custom specialist",instructions:`You are a ${customName.trim()} specialist. Follow the user's task and project context. Explain findings, evidence, and limitations. Do not commit or push without explicit authorization.`,model:"",modeId:"",requireReadOnly:true,secondOpinionModel:"",defaultReview:"single",coordinatorOnly:false,skills:[]};
    if(await save({...values,helpers:[...values.helpers,created]},false)){setSpecialistId(id);setCustomName("");setCreating(false);}
  }

  const draft=helper.draft;
  // Typed as one comma-separated field; empty entries are dropped on save.
  const skills=draft?draft.skills.filter(Boolean):[];
  const badSkills=skills.filter(s=>!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(s));
  const specialistModel=draft?resolveModel(provider.draft.defaultModel,draft.model):"";
  const specialistModes=specialistModel?catalog.modes[providerOf(specialistModel)]??[]:[];
  let modeSummary:{text:string;readOnly:boolean}|null=null;
  if(draft&&specialistModel){
    try{const mode=planLaunchMode({name:draft.name,providerModel:specialistModel,modeId:draft.modeId,requireReadOnly:draft.requireReadOnly});modeSummary={text:describeMode(mode),readOnly:mode.kind==="read-only"||mode.kind==="sandbox"}}
    catch(e){modeSummary={text:e instanceof Error?e.message:String(e),readOnly:false}}
  }
  let secondSummary:{text:string;readOnly:boolean}|null=null;
  if(draft?.secondOpinionModel){
    try{const mode=planLaunchMode({name:`${draft.name} second reviewer`,providerModel:draft.secondOpinionModel,modeId:"",requireReadOnly:draft.requireReadOnly});secondSummary={text:describeMode(mode),readOnly:mode.kind==="read-only"||mode.kind==="sandbox"}}
    catch(e){secondSummary={text:e instanceof Error?e.message:String(e),readOnly:false}}
  }

  return <View style={{gap:20}}>
    <Section theme={theme} title="Default model" subtitle="Used by every specialist without its own model. Stored by Paseo on this host, not in your repositories. Coordinators are edited in Command.">
      <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>Default provider/model</Text>
      <ModelPicker theme={theme} catalog={catalog} value={provider.draft.defaultModel} onChange={defaultModel=>provider.setDraft({...provider.draft,defaultModel})}/>
      {!provider.draft.defaultModel?<Notice theme={theme} kind="error" text="No default model. Workbench does not guess one: pick a model before creating Coordinators or launching specialists."/>:null}
      {provider.changedElsewhere?<Notice theme={theme} kind="error" text="Changed on another device since you started editing."/>:null}
      <Wrap>
        <Button theme={theme} label={busy?"Saving…":"Save default model"} disabled={busy} onPress={()=>void save({...values,...provider.draft},!sameValue({defaultModel:values.defaultModel},provider.base))}/>
        <Button theme={theme} label="Undo changes" subtle disabled={busy} onPress={provider.discard}/>
      </Wrap>
    </Section>
    <Section theme={theme} title="Your specialists folder" subtitle="Optional. A folder on this host with one Markdown file per specialist, for example in your own dotfiles repository. A file named like a built-in (reviewer.md) replaces it; any other file adds a specialist. Read live: edit the files, not here.">
      <Field theme={theme} label="Folder path on this host" value={folderPath.draft.specialistsFolder} onChangeText={specialistsFolder=>folderPath.setDraft({specialistsFolder})} placeholder="~/dotfiles/workbench-specialists"/>
      <Wrap>
        <Button theme={theme} label={busy?"Saving…":"Save folder"} disabled={busy} onPress={()=>void save({...values,...folderPath.draft,specialistsFolder:folderPath.draft.specialistsFolder.trim()},!sameValue({specialistsFolder:values.specialistsFolder},folderPath.base))}/>
        {values.specialistsFolder?<Button theme={theme} label="Reload now" subtle onPress={folder.reload}/>:null}
      </Wrap>
      {values.specialistsFolder&&folder.specialists.length?<Notice theme={theme} kind="success" text={`Loaded from ${folder.folder}: ${folder.specialists.map(s=>`${s.name} (${folder.files[s.id]}${values.helpers.some(h=>h.id===s.id)?", replaces the built-in":""})`).join("; ")}.`}/>:null}
      {folder.error?<Notice theme={theme} kind="error" text={folder.error}/>:null}
      {folder.problems.map(p=><Notice key={p} theme={theme} kind="error" text={`Skipped ${p}`}/>)}
      <Button theme={theme} subtle label={showExample?"Hide file format":"Show file format"} onPress={()=>setShowExample(!showExample)}/>
      {showExample?<Text selectable style={{color:theme.colors.foreground,fontSize:11,backgroundColor:theme.colors.surface2,padding:10,borderRadius:8}}>{EXAMPLE}</Text>:null}
    </Section>
    <Section theme={theme} title="Specialists" subtitle="Saved changes apply to the next launches; running agents keep what they started with.">
      <Button theme={theme} label="+ New specialist" disabled={busy||creating||values.helpers.length>=20} onPress={()=>{setCreating(true);setConfirmDelete("")}}/>
      {creating?<View style={{gap:8,padding:12,borderWidth:1,borderColor:theme.colors.accent,borderRadius:10}}>
        <Text style={{color:theme.colors.foreground,fontSize:14,fontWeight:"700"}}>New specialist</Text>
        <Text style={{color:theme.colors.foregroundMuted,fontSize:11}}>Starts blank: generic instructions, read-only, the default model. After you create it, it opens below so you can write its instructions.</Text>
        <Field theme={theme} label="Name" value={customName} onChangeText={setCustomName} placeholder="e.g. Performance auditor"/>
        <Wrap>
          <Button theme={theme} label="Create" disabled={busy||!customName.trim()} onPress={()=>void addSpecialist()}/>
          <Button theme={theme} label="Cancel" subtle onPress={()=>{setCreating(false);setCustomName("")}}/>
        </Wrap>
      </View>:null}
      {!creating?<>
      <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>Edit a specialist</Text>
      <Wrap>{values.helpers.map(h=><Choice key={h.id} theme={theme} label={h.name} selected={specialistId===h.id} onPress={()=>{setSpecialistId(h.id);setConfirmDelete("")}}/>)}</Wrap>
      {draft?<>
        {folder.files[draft.id]?<Notice theme={theme} kind="error" text={`${folder.files[draft.id]} in your folder replaces this one at launch. Edit that file instead.`}/>:null}
        <Field theme={theme} label="Name" value={draft.name} onChangeText={name=>updateSpecialist({name})}/>
        <Field theme={theme} label="Description" value={draft.description} onChangeText={description=>updateSpecialist({description})}/>
        <Field theme={theme} label="Instructions" value={draft.instructions} onChangeText={instructions=>updateSpecialist({instructions})} multiline helper="Instructions are not a permission boundary. Use the read-only requirement below for that."/>
        <Field theme={theme} label="Skills to use (optional)" value={draft.skills.join(", ")} onChangeText={text=>updateSpecialist({skills:text.split(",").map(x=>x.trim())})} placeholder="e.g. review-style, experiment-checks"
          helper="Names of Claude Code or Codex skills installed where the agent runs. The agent is told to load them first; one it does not have is skipped."/>
        {badSkills.length?<Notice theme={theme} kind="error" text={`Not a skill name: ${badSkills.join(", ")}. Use letters, digits, dots, dashes, underscores or colons.`}/>:null}
        <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>Model override</Text>
        <ModelPicker theme={theme} catalog={catalog} value={draft.model} onChange={model=>updateSpecialist({model})} allowEmpty="Use default model"/>
        {draft.coordinatorOnly?<Notice theme={theme} text="Coordinator-only profile: launched from Launch > Across projects. It runs in its provider's default mode and gets the coordinator's autonomy; the review settings below do not apply."/>:<>
        <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>Permission boundary</Text>
        <Wrap>
          <Choice theme={theme} label="Require enforced read-only" selected={draft.requireReadOnly} onPress={()=>updateSpecialist({requireReadOnly:true,modeId:""})}/>
          <Choice theme={theme} label="Allow edits (choose mode)" selected={!draft.requireReadOnly} onPress={()=>updateSpecialist({requireReadOnly:false})}/>
        </Wrap>
        {!draft.requireReadOnly?<Wrap>
          <Choice theme={theme} label="Provider default" selected={!draft.modeId} onPress={()=>updateSpecialist({modeId:""})}/>
          {specialistModes.map(m=><Choice key={m.id} theme={theme} label={m.label} selected={draft.modeId===m.id} onPress={()=>updateSpecialist({modeId:m.id})}/>)}
        </Wrap>:null}
        {modeSummary?<Notice theme={theme} kind={modeSummary.readOnly?"success":"error"} text={modeSummary.text}/>:null}
        <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>Second reviewer model (optional)</Text>
        <Text style={{color:theme.colors.foregroundMuted,fontSize:11}}>Used for a second opinion (the main reviewer verifies its findings) or a committee (both cross-check, then the main reviewer writes the consensus). A contrasting provider gives the most independent view. Adds that model's time and tokens.</Text>
        <ModelPicker theme={theme} catalog={catalog} value={draft.secondOpinionModel} onChange={secondOpinionModel=>updateSpecialist({secondOpinionModel})} allowEmpty="None"/>
        {secondSummary?<Notice theme={theme} kind={secondSummary.readOnly?"success":"error"} text={`Second reviewer: ${secondSummary.text}`}/>:null}
        <Text style={{color:theme.colors.foreground,fontSize:12,fontWeight:"600"}}>Default review</Text>
        <Wrap>{([["single","Single"],["second-opinion","Second opinion"],["committee","Committee"]] as const).map(([id,label])=><Choice key={id} theme={theme} label={label} selected={draft.defaultReview===id} onPress={()=>updateSpecialist({defaultReview:id})}/>)}</Wrap>
        {draft.defaultReview!=="single"&&!draft.secondOpinionModel?<Notice theme={theme} kind="error" text="This default needs a second reviewer model; without one, launches run single."/>:null}
        </>}
        {helper.changedElsewhere?<Notice theme={theme} kind="error" text="This profile was changed on another device since you started editing."/>:null}
        <Wrap>
          <Button theme={theme} label={busy?"Saving…":`Save ${draft.name}`} disabled={busy||badSkills.length>0} onPress={()=>void save({...values,helpers:values.helpers.map(h=>h.id===draft.id?{...draft,skills}:h)},!sameValue(storedSpecialist,helper.base))}/>
          <Button theme={theme} label="Undo changes" subtle disabled={busy} onPress={helper.discard}/>
          <Button theme={theme} label={confirmDelete===draft.id?`Confirm: delete ${draft.name}`:`Delete ${draft.name}`} subtle disabled={busy} onPress={()=>void deleteSpecialist(draft.id)}/>
        </Wrap>
      </>:null}
      </>:null}
    </Section>
    {notice?<Notice theme={theme} {...notice}/>:null}
    <Text style={{color:theme.colors.foregroundMuted,fontSize:11,lineHeight:17}}>Workbench starts agents only when you press Launch or on schedules you create; coordinators then act on their own as the Launch tab describes. It never bypasses Paseo permissions. The provider enforces the execution mode.</Text>
  </View>;
}
