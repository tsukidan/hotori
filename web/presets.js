"use strict";
// Preset records live in native app storage. Preview thumbnails never replace source wallpapers.
(() => {
  let host, api, items=[], selected='', pending=false, generation=0, observer;
  let menu, menuAnchor, menuAnimations=[];
  const slotAnimations=new WeakMap();
  const thumbs=new Map(), thumbnailJobs=new Map();
  let thumbnailQueue=Promise.resolve();
  function loadThumbnail(uri){
    if(thumbs.has(uri))return Promise.resolve(thumbs.get(uri));
    if(thumbnailJobs.has(uri))return thumbnailJobs.get(uri);
    const job=thumbnailQueue.then(async()=>{
      const data=await api.invoke('app_wallpaper',{uri});const image=new Image();image.src=data;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=480;canvas.height=270;const ctx=canvas.getContext('2d');const scale=Math.max(480/image.naturalWidth,270/image.naturalHeight);
      ctx.drawImage(image,(480-image.naturalWidth*scale)/2,(270-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale);
      const src=canvas.toDataURL('image/png');if(thumbs.size>=100)thumbs.delete(thumbs.keys().next().value);thumbs.set(uri,src);return src;
    }).finally(()=>thumbnailJobs.delete(uri));
    thumbnailJobs.set(uri,job);thumbnailQueue=job.catch(()=>{});return job;
  }
  const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const plain=v=>(v||'').replace(/\s*!important\s*$/,'').trim();
  const imageURI=p=>plain(p.values['--main-bg']).replace(/^url\(\s*['"]?|['"]?\s*\)$/g,'');
  function message(text,error=false){const n=host?.querySelector('.preset-status');if(n){n.textContent=text;n.classList.toggle('error',error);}}
  function buttons(){if(!host)return;host.querySelectorAll('button').forEach(b=>b.disabled=pending||api.busy());host.querySelector('.preset-apply').disabled=pending||api.busy()||!items.some(p=>p.id===selected);}
  function choose(id){selected=id;for(const card of host.querySelectorAll('.preset-card[data-id]')){const active=card.dataset.id===id;card.classList.toggle('is-selected',active);card.querySelector('.preset-select').setAttribute('aria-pressed',String(active));}buttons();}
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function menuOpen(){return !!menu&&!menu.hidden&&menu.classList.contains('is-open');}
  function animateSlot(slot,height,closing=false,startOverride){
    const start=startOverride??slot.getBoundingClientRect().height;slotAnimations.get(slot)?.cancel();slot.style.height=height+'px';
    if(reducedMotion()){if(closing)slot.replaceChildren();return;}
    const animation=slot.animate([{height:start+'px'},{height:height+'px'}],{duration:closing?440:620,easing:closing?'cubic-bezier(.22,1,.36,1)':'cubic-bezier(.22,1.3,.36,1)'});
    slotAnimations.set(slot,animation);animation.finished.then(()=>{if(slotAnimations.get(slot)!==animation)return;slotAnimations.delete(slot);if(closing)slot.replaceChildren();},()=>{});
  }
  function closeMenu(restoreFocus=false){
    if(!menuOpen())return;
    const slot=menu.parentElement;
    if(slot?.classList.contains('preset-menu-slot')){
      const visual=menu.cloneNode(true);visual.removeAttribute('id');visual.setAttribute('aria-hidden','true');visual.inert=true;
      [...visual.children].forEach((row,i)=>{const style=getComputedStyle(menu.children[i]);row.style.opacity=style.opacity;row.style.transform=style.transform;});
      slot.append(visual);document.body.append(menu);
      if(!reducedMotion())visual.animate([{opacity:1},{opacity:0}],{duration:220,easing:'ease-out',fill:'forwards'});
      animateSlot(slot,0,true);
    }
    menuAnimations.forEach(a=>a.cancel());menuAnimations=[];menu.hidden=true;menu.classList.remove('is-open');
    menuAnchor?.setAttribute('aria-expanded','false');
    if(restoreFocus&&menuAnchor?.isConnected)menuAnchor.focus({preventScroll:true});
  }
  function ensureMenu(){
    if(menu)return;
    menu=node('div','preset-menu');menu.id='preset-context-menu';menu.setAttribute('role','menu');menu.hidden=true;menu.dataset.glassExclude='';
    menu.addEventListener('keydown',event=>{
      const rows=[...menu.querySelectorAll('[role="menuitem"]')];const index=rows.indexOf(document.activeElement);
      let next;
      if(event.key==='ArrowDown')next=(index+1)%rows.length;
      else if(event.key==='ArrowUp')next=(index+rows.length-1)%rows.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=rows.length-1;
      else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);return;}
      else if(event.key==='Tab'){closeMenu(true);return;}
      else return;
      event.preventDefault();event.stopPropagation();rows[next]?.focus({preventScroll:true});
    });
    document.addEventListener('click',event=>{if(menuOpen()&&!menu.contains(event.target)&&!menuAnchor?.contains(event.target))closeMenu();});
    window.addEventListener('resize',()=>closeMenu());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)closeMenu();});
    document.body.append(menu);
  }
  function openMenu(p,anchor,event){
    if(pending||api.busy())return;
    const cell=anchor.closest('.preset-cell');
    const same=menuAnchor===anchor&&menuOpen();
    const previousSlot=menuOpen()?menu.parentElement:null;
    const sameRow=previousSlot&&Math.abs(previousSlot.parentElement.getBoundingClientRect().top-cell.getBoundingClientRect().top)<2;
    const previousHeight=sameRow?previousSlot.getBoundingClientRect().height:0;
    closeMenu();choose(p.id);if(same)return;
    ensureMenu();menuAnimations.forEach(a=>a.cancel());menuAnimations=[];menu.replaceChildren();menuAnchor=anchor;
    menu.setAttribute('aria-label',`Actions for ${p.name}`);
    const definitions=[['Rename','pencil',()=>askRename(p)],['Overwrite','replace',askOverwrite],['Delete','trash',()=>askDelete(p)]];
    for(const [index,[label,symbol,action]] of definitions.entries()){
      const row=node('button',`preset-menu-item${label==='Delete'?' is-destructive':''}`);row.type='button';row.setAttribute('role','menuitem');row.tabIndex=-1;row.append(api.icon(symbol),node('span','',label));row.addEventListener('click',()=>{if(pending||api.busy())return;closeMenu();action();});menu.append(row);
    }
    const slot=cell.querySelector('.preset-menu-slot');
    slot.replaceChildren(menu);menu.hidden=false;menu.classList.add('is-open');
    animateSlot(slot,menu.offsetHeight+12,false,previousHeight||undefined);
    anchor.setAttribute('aria-expanded','true');
    if(!reducedMotion()){
      menuAnimations.push(menu.animate([{transform:'translateY(-10px) scale(.94)'},{transform:'translateY(0) scale(1)'}],{duration:600,easing:'cubic-bezier(.22,1.6,.36,1)'}));
      [...menu.children].forEach((row,index)=>menuAnimations.push(row.animate([
        {opacity:0,transform:'translateY(-24px) scale(.94)',offset:0},
        {opacity:1,transform:'translateY(7px) scale(1.02)',offset:.62},
        {opacity:1,transform:'translateY(-3.5px) scale(.994)',offset:.82},
        {opacity:1,transform:'translateY(0) scale(1)',offset:1}
      ],{duration:720,delay:index*110,easing:'cubic-bezier(.22,.75,.3,1)',fill:'backwards'})));
    }
    menu.firstElementChild?.focus({preventScroll:true});
  }
  async function thumbnail(p,card){
    const uri=imageURI(p);if(!uri||uri==='none')return;
    const version=generation;card.classList.add('is-loading');
    try{
      const src=await loadThumbnail(uri);
      if(version!==generation||!card.isConnected)return;
      const img=node('img','preset-wallpaper');img.alt='';img.src=src;card.querySelector('.preset-preview').prepend(img);
    }catch{if(version===generation&&card.isConnected)card.querySelector('.preset-preview').append(node('span','preset-preview-unavailable','Preview unavailable'));}
    finally{card.classList.remove('is-loading');}
  }
  function render(){
    closeMenu();observer?.disconnect();const grid=host.querySelector('.preset-grid');grid.replaceChildren();
    observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const p=items.find(p=>p.id===entry.target.dataset.id);if(p)thumbnail(p,entry.target);}},{root:document.getElementById('settings-form'),rootMargin:'120px'});
    for(const p of items){
      const cell=node('div','preset-cell'),card=node('article','preset-card');card.dataset.id=p.id;
      const select=node('button','preset-select');select.type='button';select.setAttribute('aria-label',`Select ${p.name}`);select.setAttribute('aria-pressed',String(p.id===selected));select.setAttribute('aria-haspopup','menu');select.setAttribute('aria-expanded','false');select.setAttribute('aria-controls','preset-context-menu');select.addEventListener('click',event=>openMenu(p,select,event));select.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();openMenu(p,select);}});
      const preview=node('div','preset-preview');const color=plain(p.values['--main-color']);if(CSS.supports('color',color))preview.style.setProperty('--preset-color',color);
      const samples=node('div','preset-colors');samples.setAttribute('aria-label','Preset colors');
      for(const key of ['--main-color','--secondary-ui-color','--message-bubble-self-tint','--message-bubble-other-tint']){const value=plain(p.values[key]);if(CSS.supports('color',value)){const swatch=node('span','preset-swatch');swatch.style.backgroundColor=value;swatch.title=key.replace(/^--/,'')+': '+value;samples.append(swatch);}}
      preview.append(samples);select.append(preview,node('strong','preset-name',p.name));card.append(select);
      const slot=node('div','preset-menu-slot');cell.append(card,slot);grid.append(cell);card.classList.toggle('is-selected',p.id===selected);observer.observe(card);
    }
    const add=node('button','preset-card preset-add');add.type='button';add.setAttribute('aria-label','Save current preset');const plus=node('span','preset-plus','+');plus.setAttribute('aria-hidden','true');add.append(plus,node('strong','preset-name','Save current preset'));add.addEventListener('click',askName);const addCell=node('div','preset-cell');addCell.append(add);grid.append(addCell);buttons();
  }
  function prompt(title){
    const dialog=node('dialog','glass vencord-dialog preset-dialog');const heading=node('h2','',title);heading.id='preset-dialog-title';dialog.setAttribute('aria-labelledby',heading.id);dialog.append(heading);
    const error=node('p','preset-dialog-error');error.setAttribute('role','alert');
    const actions=node('div','preset-dialog-actions');const cancel=node('button','button','Cancel');cancel.type='button';cancel.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('cancel',e=>{if(pending)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});actions.append(cancel);
    document.body.append(dialog);return{dialog,error,actions,cancel};
  }
  function askName(){
    if(pending||api.busy())return;const {dialog,error,actions,cancel}=prompt('Save preset');dialog.id='preset-name-dialog';
    const form=node('form','preset-name-form'),label=node('label','','Preset name'),input=node('input','input acrylic-select');input.id='preset-name-input';input.name='name';input.type='text';input.required=true;input.maxLength=80;input.autocomplete='off';label.htmlFor=input.id;
    const save=node('button','button primary','Save preset');save.type='submit';actions.append(save);form.append(label,input,error,actions);dialog.append(form);
    form.addEventListener('submit',async e=>{e.preventDefault();if(pending)return;const name=input.value.trim();if(!name){error.textContent='Enter a preset name.';return;}pending=true;generation++;api.setBusy(true);buttons();save.disabled=cancel.disabled=input.disabled=true;
      try{items=await api.invoke('save_preset',{name,edits:api.fields().map(f=>({name:f.name,value:f.value})),companion:window.HotoriTrueGlass?.preset?.()||null});selected=items.at(-1)?.id||'';render();dialog.close();message('Preset saved.');}
      catch(e){error.textContent=String(e);}finally{pending=false;api.setBusy(false);if(dialog.isConnected)save.disabled=cancel.disabled=input.disabled=false;buttons();}});
    dialog.showModal();input.focus();
  }
  function askOverwrite(){
    const p=items.find(p=>p.id===selected);if(!p||pending||api.busy())return;
    const {dialog,error,actions,cancel}=prompt('Overwrite preset?');dialog.id='preset-overwrite-dialog';
    dialog.append(node('p','',`Replace the saved settings in “${p.name}” with your current theme controls, including unsaved edits? Its name stays the same. This cannot be undone. Your installed theme will not change until you choose Apply.`),error);
    const overwrite=node('button','button primary','Overwrite');overwrite.type='button';actions.append(overwrite);dialog.append(actions);
    overwrite.addEventListener('click',async()=>{if(pending)return;pending=true;generation++;api.setBusy(true);buttons();overwrite.disabled=cancel.disabled=true;
      try{items=await api.invoke('overwrite_preset',{id:p.id,edits:api.fields().map(f=>({name:f.name,value:f.value})),companion:window.HotoriTrueGlass?.preset?.()||null});render();dialog.close();message(`“${p.name}” overwritten. Choose Apply to use it.`);}
      catch(e){error.textContent=String(e);}finally{pending=false;api.setBusy(false);if(dialog.isConnected)overwrite.disabled=cancel.disabled=false;buttons();}});
    dialog.showModal();cancel.focus();
  }
  function askRename(p){
    if(pending||api.busy())return;const {dialog,error,actions,cancel}=prompt('Rename preset');dialog.id='preset-rename-dialog';
    const form=node('form','preset-name-form'),label=node('label','','Preset name'),input=node('input','input acrylic-select');input.id='preset-rename-input';input.name='name';input.type='text';input.required=true;input.maxLength=80;input.autocomplete='off';input.value=p.name;label.htmlFor=input.id;
    const save=node('button','button primary','Rename');save.type='submit';actions.append(save);form.append(label,input,error,actions);dialog.append(form);
    form.addEventListener('submit',async e=>{e.preventDefault();if(pending)return;const name=input.value.trim();if(!name){error.textContent='Enter a preset name.';return;}pending=true;generation++;api.setBusy(true);buttons();save.disabled=cancel.disabled=input.disabled=true;
      try{items=await api.invoke('rename_preset',{id:p.id,name});render();dialog.close();message('Preset renamed.');}
      catch(e){error.textContent=String(e);}finally{pending=false;api.setBusy(false);if(dialog.isConnected)save.disabled=cancel.disabled=input.disabled=false;buttons();}});
    dialog.showModal();input.focus();input.select();
  }
  function askDelete(p){
    if(pending||api.busy())return;const {dialog,error,actions,cancel}=prompt('Delete preset?');dialog.id='preset-delete-dialog';dialog.append(node('p','',`Delete “${p.name}”? This cannot be undone. Your installed theme will stay as it is.`),error);
    const remove=node('button','button destructive','Delete preset');remove.type='button';actions.append(remove);dialog.append(actions);
    remove.addEventListener('click',async()=>{if(pending)return;pending=true;generation++;api.setBusy(true);buttons();remove.disabled=cancel.disabled=true;
      try{items=await api.invoke('delete_preset',{id:p.id});if(selected===p.id)selected='';render();dialog.close();message('Preset deleted.');}
      catch(e){error.textContent=String(e);}finally{pending=false;api.setBusy(false);if(dialog.isConnected)remove.disabled=cancel.disabled=false;buttons();}});
    dialog.showModal();cancel.focus();
  }
  async function apply(){
    const p=items.find(p=>p.id===selected);if(!p||pending||api.busy())return;
    pending=true;generation++;api.setBusy(true);buttons();message('Applying preset…');let themeApplied=false, companionApplied=false;
    try{const fields=await api.invoke('apply_preset',{id:p.id});themeApplied=true;api.applied(fields);if(p.companion)await window.HotoriTrueGlass.applyPreset(p.companion);companionApplied=true;await api.refresh();api.render();message(`“${p.name}” applied.`);}
    catch(e){if(themeApplied){api.render();message(companionApplied ? `Preset applied, but the launcher preview could not refresh: ${e}` : `Theme settings applied, but the True Liquid Glass request could not be saved: ${e}`,true);}else message(String(e),true);}
    finally{pending=false;api.setBusy(false);buttons();}
  }
  function mount(container,bridge){generation++;observer?.disconnect();host=container;api=bridge;host.classList.add('presets-page');ensureMenu();host.innerHTML='<div class="preset-grid" aria-label="Saved theme presets"></div><div class="preset-actions"><p class="preset-status status" role="status"></p><button class="button primary preset-apply" type="button" disabled>Apply</button></div>';host.querySelector('.preset-apply').addEventListener('click',apply);render();}
  async function visit(category){if(category!=='Presets'){closeMenu();return;}if(!host||pending)return;const version=++generation;message('Loading presets…');try{const loaded=await api.invoke('list_presets');if(version!==generation)return;items=loaded;if(!items.some(p=>p.id===selected))selected='';render();message('');}catch(e){if(version===generation)message(String(e),true);}}
  window.HotoriPresets={mount,visit};
})();
