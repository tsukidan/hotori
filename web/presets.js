"use strict";
// Preset records live in native app storage. Preview thumbnails never replace source wallpapers.
(() => {
  let host, api, items=[], selected='', pending=false, generation=0, observer;
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
    observer?.disconnect();const grid=host.querySelector('.preset-grid');grid.replaceChildren();
    observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const p=items.find(p=>p.id===entry.target.dataset.id);if(p)thumbnail(p,entry.target);}},{root:document.getElementById('settings-form'),rootMargin:'120px'});
    for(const p of items){
      const card=node('article','preset-card');card.dataset.id=p.id;
      const select=node('button','preset-select');select.type='button';select.setAttribute('aria-label',`Select ${p.name}`);select.setAttribute('aria-pressed',String(p.id===selected));select.addEventListener('click',()=>choose(p.id));
      const preview=node('div','preset-preview');const color=plain(p.values['--main-color']);if(CSS.supports('color',color))preview.style.setProperty('--preset-color',color);
      const samples=node('div','preset-colors');samples.setAttribute('aria-label','Preset colors');
      for(const key of ['--main-color','--secondary-ui-color','--message-bubble-self-tint','--message-bubble-other-tint']){const value=plain(p.values[key]);if(CSS.supports('color',value)){const swatch=node('span','preset-swatch');swatch.style.backgroundColor=value;swatch.title=key.replace(/^--/,'')+': '+value;samples.append(swatch);}}
      preview.append(samples);select.append(preview,node('strong','preset-name',p.name));card.append(select);
      const remove=node('button','preset-delete');remove.type='button';remove.setAttribute('aria-label',`Delete ${p.name}`);remove.title='Delete preset';remove.append(api.icon('trash'));remove.addEventListener('click',()=>askDelete(p));card.append(remove);const rename=node('button','preset-rename');rename.type='button';rename.setAttribute('aria-label',`Rename ${p.name}`);rename.title='Rename preset';rename.append(api.icon('pencil'));rename.addEventListener('click',()=>askRename(p));card.append(rename);grid.append(card);card.classList.toggle('is-selected',p.id===selected);observer.observe(card);
    }
    const add=node('button','preset-card preset-add');add.type='button';add.setAttribute('aria-label','Save current preset');const plus=node('span','preset-plus','+');plus.setAttribute('aria-hidden','true');add.append(plus,node('strong','preset-name','Save current preset'));add.addEventListener('click',askName);grid.append(add);buttons();
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
  function mount(container,bridge){generation++;observer?.disconnect();host=container;api=bridge;host.classList.add('presets-page');host.innerHTML='<div class="preset-grid" aria-label="Saved theme presets"></div><div class="preset-actions"><p class="preset-status status" role="status"></p><button class="button primary preset-apply" type="button" disabled>Apply</button></div>';host.querySelector('.preset-apply').addEventListener('click',apply);render();}
  async function visit(category){if(category!=='Presets'||!host||pending)return;const version=++generation;message('Loading presets…');try{const loaded=await api.invoke('list_presets');if(version!==generation)return;items=loaded;if(!items.some(p=>p.id===selected))selected='';render();message('');}catch(e){if(version===generation)message(String(e),true);}}
  window.HotoriPresets={mount,visit};
})();
