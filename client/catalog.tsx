import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Choice, Notice, Wrap } from "./ui";

export interface Catalog { models:{value:string;label:string;provider:string;name:string}[]; modes:Record<string,{id:string;label:string}[]>; error:string|null; loading:boolean; }

/** Models and modes this host's providers actually report; nothing is hardcoded. */
export function useCatalog():Catalog {
  const paseo=usePaseo();
  const [catalog,setCatalog]=useState<Catalog>({models:[],modes:{},error:null,loading:true});
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try{
        const available=(await paseo.providers.listAvailable()).providers.filter(p=>p.available).map(p=>p.provider);
        const results=await Promise.all(available.map(async provider=>{
          const [models,modes]=await Promise.all([paseo.providers.listModels(provider),paseo.providers.listModes(provider)]);
          return {provider,models:models.models??[],modes:modes.modes??[]};
        }));
        if(!alive)return;
        setCatalog({
          models:results.flatMap(r=>r.models.filter(m=>m.isSelectable!==false).map(m=>({value:`${r.provider}/${m.id}`,label:`${r.provider} · ${m.label}`,provider:r.provider,name:m.label}))),
          modes:Object.fromEntries(results.map(r=>[r.provider,r.modes.map(m=>({id:m.id,label:m.label}))])),
          error:null,loading:false,
        });
      }catch(e){if(alive)setCatalog({models:[],modes:{},error:e instanceof Error?e.message:String(e),loading:false})}
    })();
    return()=>{alive=false};
  },[paseo]);
  return catalog;
}

/** Providers first, then the open provider's models: a host can report dozens of models across several providers. */
export function ModelPicker({theme,catalog,value,onChange,allowEmpty}:{theme:PluginTheme;catalog:Catalog;value:string;onChange:(v:string)=>void;allowEmpty?:string}){
  const current=catalog.models.find(m=>m.value===value);
  const known=!value||Boolean(current);
  // A tapped provider ("" = collapsed) holds only while the value it was tapped at stands (Undo or a reset reopens the value's).
  const [tapped,setTapped]=useState<{provider:string;at:string}|null>(null);
  const providers=[...new Set(catalog.models.map(m=>m.provider))];
  const open=tapped&&tapped.at===value&&(!tapped.provider||providers.includes(tapped.provider))?tapped.provider:null;
  const setOpen=(provider:string|null)=>setTapped(provider===null?null:{provider,at:value});
  const shown=open??current?.provider??(value||allowEmpty?null:providers[0]??null);
  return <View style={{gap:7}}>
    <Wrap>
      {allowEmpty?<Choice theme={theme} label={allowEmpty} selected={!value} onPress={()=>{setOpen(null);onChange("")}}/>:null}
      {providers.map(p=><Choice key={p} theme={theme} selected={current?.provider===p}
        label={`${p}${current?.provider===p?` · ${current.name}`:""} ${shown===p?"▾":"▸"}`} onPress={()=>setOpen(shown===p?"":p)}/>)}
    </Wrap>
    {shown?<View style={{paddingLeft:12,borderLeftWidth:2,borderColor:theme.colors.border}}><Wrap>
      {catalog.models.filter(m=>m.provider===shown).map(m=><Choice key={m.value} theme={theme} label={m.name} selected={value===m.value} onPress={()=>onChange(m.value)}/>)}
    </Wrap></View>:null}
    {catalog.loading?<Notice theme={theme} text="Loading this host's provider catalog…"/>:null}
    {catalog.error?<Notice theme={theme} kind="error" text={`Provider catalog unavailable: ${catalog.error}`}/>:null}
    {!catalog.loading&&!known?<Notice theme={theme} kind="error" text={`"${value}" is not in this host's provider catalog. Launches with it will fail.`}/>:null}
  </View>;
}

