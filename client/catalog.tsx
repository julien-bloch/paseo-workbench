import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Choice, Notice, Wrap } from "./ui";

export interface Catalog { models:{value:string;label:string}[]; modes:Record<string,{id:string;label:string}[]>; error:string|null; loading:boolean; }

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
          models:results.flatMap(r=>r.models.filter(m=>m.isSelectable!==false).map(m=>({value:`${r.provider}/${m.id}`,label:`${r.provider} · ${m.label}`}))),
          modes:Object.fromEntries(results.map(r=>[r.provider,r.modes.map(m=>({id:m.id,label:m.label}))])),
          error:null,loading:false,
        });
      }catch(e){if(alive)setCatalog({models:[],modes:{},error:e instanceof Error?e.message:String(e),loading:false})}
    })();
    return()=>{alive=false};
  },[paseo]);
  return catalog;
}

export function ModelPicker({theme,catalog,value,onChange,allowEmpty}:{theme:PluginTheme;catalog:Catalog;value:string;onChange:(v:string)=>void;allowEmpty?:string}){
  const known=!value||catalog.models.some(m=>m.value===value);
  return <View style={{gap:7}}>
    <Wrap>
      {allowEmpty?<Choice theme={theme} label={allowEmpty} selected={!value} onPress={()=>onChange("")}/>:null}
      {catalog.models.map(m=><Choice key={m.value} theme={theme} label={m.label} selected={value===m.value} onPress={()=>onChange(m.value)}/>)}
    </Wrap>
    {catalog.loading?<Notice theme={theme} text="Loading this host's provider catalog…"/>:null}
    {catalog.error?<Notice theme={theme} kind="error" text={`Provider catalog unavailable: ${catalog.error}`}/>:null}
    {!catalog.loading&&!known?<Notice theme={theme} kind="error" text={`"${value}" is not in this host's provider catalog. Launches with it will fail.`}/>:null}
  </View>;
}

