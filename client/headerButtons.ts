import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { headerButtonSetting } from "../shared/rpc";

// Refreshers of every running client entry (one per host). Settings calls them after a save; Paseo evaluates screen
// modules again when they remount, so a module variable would not reach the entry's buttons (see WorkbenchScreen).
const refreshers=((globalThis as {__workbenchHeaderButtonRefresh?:Set<()=>void>}).__workbenchHeaderButtonRefresh??=new Set<()=>void>());
export function refreshHeaderButtons(){for(const refresh of refreshers)refresh();}

/**
 * An icon-only "Open Workbench" button in every workspace header of this host, shown when its Workbench setting is on.
 * Other devices pick up a change when the plugin loads there (the setting is read over RPC, not watched).
 */
export function contributeHeaderButtons(client:PluginClientContext){
  const buttons=new Map<string,PluginButtonRegistration>();
  let visible=false,stopped=false;
  let subscription:{release:()=>Promise<void>}|undefined;
  const add=(workspaceId:string)=>{
    if(stopped||buttons.has(workspaceId))return;
    buttons.set(workspaceId,client.addHeaderButton({id:"open-workbench",workspaceId,button:{title:"Open Workbench",icon:"LayoutDashboard",visible,
      behavior:{kind:"action",onPress(){client.openScreen({screenId:"workbench"})}}}}));
  };
  const drop=(workspaceId:string)=>{buttons.get(workspaceId)?.remove();buttons.delete(workspaceId);};
  const refresh=()=>void client.rpc(headerButtonSetting,{}).then(({enabled})=>{
    if(stopped||enabled===visible)return;
    visible=enabled;
    for(const button of buttons.values())button.update({visible});
  }).catch(()=>undefined); // unreadable: keep the current state
  refreshers.add(refresh);
  refresh();
  // shortcut: the first 200 workspaces get a button up front; later ones get it when they next change. Page if that bites.
  client.paseo.workspaces.list({subscribe:{},page:{limit:200}}).then(r=>{
    if(stopped){void r.subscription.release().catch(()=>undefined);return;}
    subscription=r.subscription;
    r.subscription.subscribe({
      snapshot:({entries})=>{for(const id of [...buttons.keys()])drop(id);for(const w of entries)add(w.id);},
      update:(message)=>{
        if(message.type!=="workspace_update")return;
        if(message.payload.kind==="upsert")add(message.payload.workspace.id);else drop(message.payload.id);
      },
    });
  }).catch(()=>undefined); // no button, nothing else depends on it
  return ()=>{stopped=true;refreshers.delete(refresh);void subscription?.release().catch(()=>undefined);for(const id of [...buttons.keys()])drop(id);};
}
