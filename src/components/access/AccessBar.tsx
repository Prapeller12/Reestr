import { useState } from 'react';
import { createPortal } from 'react-dom';
import { loginAdmin, logoutAdmin, setupAdmin } from '../../api/commands';
import { toApiError } from '../../api/errors';
import { useAccess } from './AccessProvider';
export default function AccessBar() {
  const {access,canEdit,error:connectionError,update,refresh}=useAccess();
  const [open,setOpen]=useState(false);
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const setup=access!==null&&!access.initialized;
  const close=()=>{if(!busy){setOpen(false);setPassword('');setConfirm('');setError('');}};
  const submit=async()=>{
    if(busy)return;
    if(setup&&password!==confirm){setError('Пароли не совпадают.');return;}
    setBusy(true);setError('');
    try {update(await (setup?setupAdmin(password):loginAdmin(password)));setPassword('');setConfirm('');setOpen(false);}
    catch(e){setError(toApiError(e).message);refresh();}
    finally{setBusy(false);}
  };
  const logout=async()=>{setBusy(true);try{update(await logoutAdmin());}catch(e){setError(toApiError(e).message);}finally{setBusy(false);}};
  return <div className="access print-hide">
    <span className="access__status">{canEdit?'Администратор':'Только просмотр'}{access?.network?' · Общий реестр':''}</span>
    {connectionError?<span className="access__error" role="alert">{connectionError}</span>:null}
    {canEdit?<button className="btn btn_secondary" type="button" disabled={busy} onClick={()=>void logout()}>Выйти</button>:
      <button className="btn btn_secondary" type="button" disabled={!access} onClick={()=>{setError('');setOpen(true);}}>{setup?'Настроить администратора':'Вход администратора'}</button>}
    {!open&&error?<span role="alert" className="access__error">{error}</span>:null}
    {open?createPortal(<div className="modal__overlay access__overlay" onClick={close}>
      <form className="access__dialog" role="dialog" aria-modal="true" aria-labelledby="access-title" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();void submit();}} onKeyDown={e=>{if(e.key==='Escape')close();}}>
        <h2 id="access-title">{setup?'Первичная настройка администратора':'Вход администратора'}</h2>
        <p>{setup?'Задайте пароль администратора этого реестра. Для первичной настройки требуется право Windows на запись в общую папку.':'После входа доступны импорт писем, изменение связей, сроков и тем.'}</p>
        <label>Пароль<input autoFocus type="password" autoComplete={setup?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={setup?10:undefined} maxLength={128}/></label>
        {setup?<><div className="access__hint">Не менее 10 символов. Сохраните пароль в надёжном месте.</div><label>Повторите пароль<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required maxLength={128}/></label></>:null}
        {error?<div className="access__error" role="alert">{error}</div>:null}
        <div className="access__actions"><button type="button" className="btn btn_secondary" onClick={close} disabled={busy}>Отмена</button><button type="submit" className="btn btn_primary" disabled={busy}>{busy?'Проверка…':setup?'Создать администратора':'Войти'}</button></div>
      </form>
    </div>,document.body):null}
  </div>;
}
