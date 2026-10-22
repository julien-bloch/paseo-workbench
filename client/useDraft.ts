import { useEffect, useState } from "react";
import { sameValue } from "../shared/settings";

/**
 * A local edit of one stored settings field. Remote changes are adopted only while the draft is
 * clean, so another device's save never erases typing. `base` is what the edit started from;
 * callers save only if the stored value still equals it (see sameValue), else report a conflict.
 */
export function useDraft<T>(stored:T, identity:string){
  const [state,setState]=useState({identity,base:stored,draft:stored});
  const storedKey=JSON.stringify(stored);
  useEffect(()=>{
    setState(s=>s.identity!==identity||sameValue(s.draft,s.base)||sameValue(s.draft,stored)?{identity,base:stored,draft:stored}:s);
  },[identity,storedKey]);
  const current=state.identity===identity?state:{identity,base:stored,draft:stored};
  return {
    draft:current.draft,
    base:current.base,
    setDraft:(draft:T)=>setState({...current,draft}),
    changedElsewhere:!sameValue(current.base,stored),
    discard:()=>setState({identity,base:stored,draft:stored}),
  };
}
