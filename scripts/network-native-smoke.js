(async () => {
  const checks = [], errors = [], config = window.REESTR_SMOKE;
  const invoke = window.__TAURI__.core.invoke;
  window.addEventListener('error', e => errors.push(e.message));
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const wait = async (fn, message, timeout = 25000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (fn()) return fn(); await pause(100); }
    throw new Error(message);
  };
  const button = text => [...document.querySelectorAll('button')].find(e => e.textContent.trim() === text || [...e.querySelectorAll('span')].some(s => s.textContent.trim() === text));
  const denied = async (name, args, code = 'FORBIDDEN') => {
    try { await invoke(name, args); } catch (e) { assert(e.code === code, `${name}: ${JSON.stringify(e)}`); return; }
    throw new Error(`${name} unexpectedly allowed`);
  };
  const password = 'Synthetic-network-test-47';
  const signInUI = async setup => {
    (await wait(() => button(setup ? 'Настроить администратора' : 'Вход администратора'), 'No login button')).click();
    const form = await wait(() => document.querySelector('.access__dialog'), 'No password dialog');
    for (const input of form.querySelectorAll('input')) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, password);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await pause(100);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await wait(() => button('Импорт выгрузки из 1С'), 'Admin UI did not unlock');
    assert((await invoke('get_access')).role === 'admin', 'Backend did not authenticate');
  };
  try {
    await wait(() => document.querySelector('.access__status'), 'Frontend did not mount');
    await pause(500);
    const access = await invoke('get_access');
    assert(access.network && access.role === 'viewer', 'Must start as network viewer');
    assert(!button('Импорт выгрузки из 1С'), 'Viewer has import control');
    const ref = { kind: 'outgoing', regNumber: 'A1' };
    for (const [name, args] of [
      ['import_preview',{path:config.outgoing,kind:'outgoing'}], ['import_apply',{path:config.outgoing,kind:'outgoing'}],
      ['attach_letter',{taskReg:'A1',letterReg:'A2',letterKind:'outgoing'}], ['detach_letter',{taskReg:'A1',letterReg:'A2',letterKind:'outgoing'}],
      ['set_deadline',{regNumber:'A1',endDate:'2026-12-01'}], ['clear_deadline',{regNumber:'A1'}],
      ['set_field_override',{regNumber:'A1',field:'signer',value:'test'}], ['clear_field_override',{regNumber:'A1',field:'signer'}],
      ['assign_theme',{...ref,themeName:'test'}], ['bulk_assign_themes',{items:[ref],themeName:'test'}], ['bulk_clear_themes',{items:[ref]}],
      ['create_theme',{name:'test'}], ['delete_theme',{name:'test'}]
    ]) await denied(name,args);
    checks.push('viewer: all 13 import/mutation IPC commands denied; import UI hidden');
    if (!access.initialized) {
      assert(config.phase === 'unc-first-run', 'Only the isolated first-run test may initialize a registry');
      await signInUI(true);
      for (const kind of ['outgoing','incoming']) {
        await invoke('import_preview',{path:config[kind],kind});
        await invoke('import_apply',{path:config[kind],kind});
      }
      const items=[];
      for(const prefix of ['A','B','C']) {
        await invoke('attach_letter',{taskReg:prefix+'1',letterReg:prefix+'2',letterKind:'outgoing'});
        await invoke('attach_letter',{taskReg:prefix+'2',letterReg:prefix+'3',letterKind:'incoming'});
        for(const [n,kind] of [[1,'outgoing'],[2,'outgoing'],[3,'incoming']]) items.push({kind,regNumber:prefix+n});
      }
      await invoke('bulk_assign_themes',{items,themeName:'Три независимые цепочки'});
      checks.push('administrator setup, native import preview/apply, links and theme publication');
    } else {
      await denied('login_admin',{password:'wrong-password'},'INVALID_PASSWORD');
      await signInUI(false);
      checks.push('persisted password and registry after restart; invalid password denied');
    }
    if(config.phase==='readonly') {
      await denied('create_theme',{name:'must-not-be-published'});
      checks.push('SMB ReadAccess forbids publication even with correct admin password');
    }
    const registry=await invoke('get_registry');
    assert(registry.groups.flatMap(g=>g.documents).length===9,'Expected 9 persisted synthetic letters');
    button('Обновить').click();
    (await wait(()=>button('Хронология'),'No timeline tab')).click();
    await wait(()=>button('Кварталы'),'Timeline controls did not appear');
    const hide=button('Скрыть завершённые');if(hide?.classList.contains('pill_active')) hide.click();
    button('Кварталы').click();
    const deck=await wait(()=>document.querySelector('.timeline__lane_screen .timeline__deck'),'No overlapping deck');
    deck.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    await wait(()=>document.querySelectorAll('.timeline__unfold-chain').length===3,'Expected three independent chain rows');
    const rows=[...document.querySelectorAll('.timeline__unfold-row')];
    const geometry=rows.map((row,index)=>{
      const cards=[...row.querySelectorAll('.timeline__unfold-item')];
      assert(cards.length===3,`Chain ${index+1} must contain three letters`);
      const rects=cards.map(e=>e.getBoundingClientRect());
      assert(rects.every(r=>Math.abs(r.top-rects[0].top)<1),'Letters of one chain must share a row');
      for(let i=1;i<rects.length;i++)assert(rects[i].left>=rects[i-1].right,'Cards overlap after expansion');
      assert(row.textContent.includes(['A1','B1','C1'][index]),'Mixed chain membership');
      return {top:rects[0].top,bottom:rects[0].bottom,letters:cards.map(e=>e.textContent.trim())};
    });
    for(let i=1;i<geometry.length;i++)assert(geometry[i].top>=geometry[i-1].bottom,'Independent chain rows overlap');
    checks.push('native WebView hover: 3 separate rows, 3 letters each, no overlapping cards');
    document.querySelector('.timeline__unfold-item button').click();
    await wait(()=>document.querySelector('.drawer'),'Expanded letter did not open');
    button('Выйти').click();
    await wait(()=>!button('Импорт выгрузки из 1С'),'Logout did not remove import control');
    assert((await invoke('get_access')).role==='viewer','Logout did not revoke backend access');
    await denied('import_apply',{path:config.outgoing,kind:'outgoing'});
    assert(!document.querySelector('.transition'),'Viewer retains mutation controls');
    assert(errors.length===0,`Frontend errors: ${errors.join('; ')}`);
    checks.push('expanded letter clickable; logout revokes backend and UI editing');
    await invoke('finish_smoke',{report:{ok:true,phase:config.phase,checks,geometry}});
  } catch(e) {
    await invoke('finish_smoke',{report:{ok:false,phase:config.phase,checks,error:String(e),stack:e?.stack,buttons:[...document.querySelectorAll('button')].map(b=>b.textContent.trim()),errors}});
  }
})();
