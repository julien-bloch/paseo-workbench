import { getPaseoClient, useHosts } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hostGaps, type NativeSubagent, type WorkbenchAgent, type WorkbenchWorkspace } from "../shared/model";
import { applyNativeUpdate, directoryForHost } from "./directory";

export interface HostEntry { serverId:string; label:string; status:"online"|"offline"|"idle"|"connecting"|"error"; }
export interface Directory {
  hosts:HostEntry[];
  workspaces:WorkbenchWorkspace[];
  agents:WorkbenchAgent[];
  native:NativeSubagent[];
  /** Hosts whose data is missing from this snapshot (offline, connecting, or failed). Never treat their absence as "all clear". */
  errors:Record<string,string>;
  updatedAt:string|null;
  truncated:boolean;
  /** When live native-child observation began; earlier children are unknown. */
  nativeSince:string|null;
  nativeErrors:Record<string,string>;
}
interface Snapshot extends Omit<Directory,"hosts"|"errors"> { read:string[]; failures:Record<string,string>; }
const INITIAL:Snapshot = {read:[],failures:{},workspaces:[],agents:[],native:[],updatedAt:null,truncated:false,nativeSince:null,nativeErrors:{}};

export function knownHostList(home:{id:string;label:string}, reported:readonly HostEntry[]):HostEntry[] {
  const entries=new Map(reported.map(h=>[h.serverId,{...h}]));
  if(!entries.has(home.id)) entries.set(home.id,{serverId:home.id,label:home.label,status:"online"});
  return [...entries.values()];
}

/** Polling is an MVP reliability trade-off: no persistent background watchers or hidden model calls. */
export function useDirectory(home:{id:string;label:string}) {
  const hostSnapshots=useHosts();
  const hosts=useMemo(()=>knownHostList(home,hostSnapshots),[home.id,home.label,hostSnapshots]);
  const hostSignature=hosts.map(h=>`${h.serverId}:${h.status}:${h.label}`).join("|");
  const [state,setState]=useState<Snapshot>(INITIAL);
  const [loading,setLoading]=useState(true);
  const refreshSequence=useRef(0);
  // Callers may hold an older `refresh`; it must still read the current host list.
  const hostsRef=useRef(hosts);
  hostsRef.current=hosts;
  const refresh=useCallback(async()=>{
    const thisSequence=++refreshSequence.current;
    const current=hostsRef.current.filter(h=>h.status==="online");
    const responses=await Promise.all(current.map(async host=>{
      try {return {host,data:await directoryForHost(getPaseoClient(host.serverId),host.serverId)};}
      catch(error){return {host,error:error instanceof Error?error.message:String(error)};}
    }));
    const failures:Record<string,string>={};
    const read:string[]=[];
    const workspaces:WorkbenchWorkspace[]=[];
    const agents:WorkbenchAgent[]=[];
    let truncated=false;
    for(const result of responses){
      if("error" in result){failures[result.host.serverId]=result.error||"Unknown host error";continue;}
      workspaces.push(...result.data.workspaces);agents.push(...result.data.agents);
      if(result.data.truncated){truncated=true;failures[result.host.serverId]="More entries than Workbench reads (25 pages of 200); some projects and agents are not shown.";}
      else read.push(result.host.serverId);
    }
    if(thisSequence===refreshSequence.current)
      setState(old=>({...old,read,failures,workspaces,agents,truncated,updatedAt:new Date().toISOString()}));
  },[]);
  useEffect(()=>{
    let alive=true;
    setLoading(true);
    void refresh().finally(()=>{if(alive)setLoading(false)});
    const timer=setInterval(()=>void refresh().catch(()=>undefined),15_000);
    return()=>{alive=false;refreshSequence.current++;clearInterval(timer)};
  },[refresh,hostSignature]);

  // Only events observed after subscription are available. The official SDK has no public list API.
  useEffect(()=>{
    let active=true;
    // On a host lifecycle change previous live-only children are no longer authoritative.
    setState(old=>({...old,native:[],nativeSince:new Date().toISOString(),nativeErrors:{}}));
    const nativeError=(serverId:string,error:unknown)=>{
      if(active)setState(old=>({...old,nativeErrors:{...old.nativeErrors,[serverId]:error instanceof Error?error.message:String(error)}}));
    };
    const observations:Array<{release:()=>Promise<void>}> = [];
    for(const host of hosts.filter(h=>h.status==="online")){
      try{
        const observation=getPaseoClient(host.serverId).observeEvents(["agent.provider_subagents.update"]);
        observation.subscribe({
          snapshot() {},
          update(message) {
            if(!active)return;
            if(message.type!=="agent.provider_subagents.update")return;
            setState(old=>({...old,native:applyNativeUpdate(old.native,host.serverId,message.payload)}));
          },
          error(error){nativeError(host.serverId,error)},
        });
        observation.ready.catch(error=>nativeError(host.serverId,error));
        observations.push(observation);
      }catch(error){nativeError(host.serverId,error)}
    }
    return()=>{active=false;for(const observation of observations)void observation.release().catch(()=>undefined)};
  },[hostSignature]);

  // Coverage and visible rows follow the live host list, never a stale snapshot.
  const visible=useMemo(()=>{
    const online=new Set(hosts.filter(h=>h.status==="online").map(h=>h.serverId));
    return {workspaces:state.workspaces.filter(w=>online.has(w.serverId)),agents:state.agents.filter(a=>online.has(a.serverId))};
  },[state.workspaces,state.agents,hostSignature]);
  return {...state,...visible,hosts,errors:hostGaps(hosts,state.read,state.failures),loading,refresh};
}
