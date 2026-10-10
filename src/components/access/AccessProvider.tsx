import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { AccessStatus } from '../../api/types';
import { getAccess, frontendReady } from '../../api/commands';
import { toApiError } from '../../api/errors';
interface AccessContextValue { access: AccessStatus | null; canEdit: boolean; error: string; update: (value: AccessStatus) => void; refresh: () => void }
const Context = createContext<AccessContextValue>({access:null,canEdit:false,error:'',update:()=>{},refresh:()=>{}});
export const useAccess = () => useContext(Context);
export default function AccessProvider({children}: {children: ReactNode}) {
  const [access,setAccess]=useState<AccessStatus|null>(null);
  const [error,setError]=useState('');
  const update=useCallback((value:AccessStatus)=>{setAccess(value);setError('');},[]);
  const refresh=useCallback(()=>{void getAccess().then(update).catch(e=>setError(toApiError(e).message));},[update]);
  useEffect(()=>{refresh();const timer=window.setInterval(refresh,15000);return()=>window.clearInterval(timer);},[refresh]);
  useEffect(()=>{void frontendReady().catch(e=>setError(toApiError(e).message));},[]);
  return <Context.Provider value={{access,canEdit:access?.role==='admin'&&!error,error,update,refresh}}>{children}</Context.Provider>;
}
