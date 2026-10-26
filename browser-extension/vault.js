/* Owner-only vault management. This file runs exclusively in the extension popup. */
const OpenKeyletVaultUI = (() => {
  const q = id => document.getElementById(id);
  const labels = {login:"登录 / Login",card:"信用卡 / Card",identity:"身份 / Identity",secureNote:"笔记 / Note",ssh:"SSH",api:"API",custom:"其他 / Other"};
  const loginFields = {username:"账号 / Username",password:"密码 / Password",totp:"TOTP 密钥 / TOTP key",secureNote:"备注 / Notes"};
  let snapshot={items:[],trash:[]}, signature="", editing=null, history=null, busy=false, sequence=0, confirmResolver=null;
  const button=(text,handler,kind="")=>{
    const b=document.createElement("button"); b.type="button"; b.textContent=text; if(kind)b.className=kind; b.onclick=handler; return b;
  };
  function closeEditor() {
    sequence++; editing=null; q("vault-editor").reset(); q("vault-editor").hidden=true;
    q("vault-editor-fields").replaceChildren();q("vault-uri-rows").replaceChildren();q("vault-editor-passkeys").replaceChildren();
  }
  function closeHistory() { sequence++;history=null;q("vault-history-rows").replaceChildren();q("vault-history").hidden=true; }
  function answerConfirm(value) {
    const resolve=confirmResolver; confirmResolver=null;if(q("vault-confirm").open)q("vault-confirm").close();q("vault-confirm").hidden=true;q("vault-confirm-message").textContent="";
    resolve?.(value);
  }
  function ask(message) {
    answerConfirm(false);q("vault-confirm-message").textContent=message;q("vault-confirm").hidden=false;q("vault-confirm").showModal();q("vault-confirm-accept").focus();
    return new Promise(resolve=>{confirmResolver=resolve;});
  }
  async function mutate(action,args) {
    busy=true;
    try { await call(action,args);showError("已更新本地密码库 / Vault updated");signature=""; }
    catch(error){showError(error);}
    finally {busy=false;refresh();}
  }
  function apply(value) {
    if(!value){snapshot={items:[],trash:[]};signature="";q("vault-all-items").replaceChildren();return;}
    const next=JSON.stringify(value);if(next===signature)return;signature=next;snapshot=value;
    const folder=q("vault-folder").value;
    const folders=[...new Set([...value.items,...value.trash.map(v=>v.item)].map(i=>i.folder).filter(Boolean))].sort();
    q("vault-folder").replaceChildren(new Option("所有文件夹 / All folders",""),...folders.map(f=>new Option(f,f)));
    if(folders.includes(folder))q("vault-folder").value=folder;render();
  }
  function render() {
    const trash=q("vault-view").value==="trash";
    q("vault-new").disabled=trash;
    const source=trash?snapshot.trash:snapshot.items.map(item=>({item}));
    const term=q("vault-search").value.trim().toLocaleLowerCase(),kind=q("vault-kind").value,folder=q("vault-folder").value;
    const entries=source.filter(({item})=>(!kind || (kind==="passkey"?item.passkeys?.length:item.itemType===kind))
      &&(!folder||item.folder===folder)&&(!q("vault-favorites").checked||item.favorite)
      &&(!term||[item.name,item.folder,item.baseUrl,...(item.loginUris||[]).map(u=>u.uri)].join(" ").toLocaleLowerCase().includes(term)))
      .sort((a,b)=>Number(b.item.favorite)-Number(a.item.favorite)||a.item.name.localeCompare(b.item.name));
    const container=q("vault-all-items");container.replaceChildren();
    if(!entries.length){const p=document.createElement("p");p.textContent=trash?"回收站为空或没有匹配项 / No matching trash items":"没有匹配项目 / No matching items";container.append(p);}
    for(const entry of entries){
      const item=entry.item,row=document.createElement("article");row.className="vault-row";row.dataset.vaultId=item.id;
      const title=document.createElement("strong");title.textContent=(item.favorite?"★ ":"")+item.name;
      const sub=document.createElement("small");sub.textContent=[labels[item.itemType]||item.itemType,item.folder,!item.enabled?"已停用 / Disabled":""].filter(Boolean).join(" · ");
      const actions=document.createElement("div");actions.className="personal-actions";
      row.append(title,sub,actions);container.append(row);
      if(trash){
        const restore=button("恢复 / Restore",()=>mutate("vault-restore",{id:item.id,deletedAt:entry.deletedAt}));
        const purge=button("永久删除 / Delete forever",async()=>{
          if(await ask("永久删除此项目及其 Passkey？无法撤销；已有备份不受影响。 / Delete permanently? Existing backups remain unchanged."))
            await mutate("vault-purge",{id:item.id,deletedAt:entry.deletedAt});
        },"danger");actions.append(restore,purge);
      }else{
        const edit=button("查看 / 编辑 · Edit",()=>openItem(item.id));edit.dataset.vaultEdit="";actions.append(edit);
        if(item.passwordHistoryCount)actions.append(button("历史 / History",()=>openHistory(item.id)));
        actions.append(button("移入回收站 / Trash",async()=>{
          if(await ask("移入回收站？项目将停止用于填写和登录。 / Move to trash and stop using this item?"))
            await mutate("vault-trash",{id:item.id,expectedUpdatedAt:item.updatedAt});
        },"secondary"));
      }
    }
  }
  function addUri(uri="",matchType="origin") {
    const row=document.createElement("div");row.className="vault-uri-row";
    const input=document.createElement("input");input.value=uri;input.maxLength=8192;input.dataset.uri="";input.setAttribute("aria-label","网站 / Website");
    const select=document.createElement("select");select.dataset.match="";
    for(const [key,name] of [["origin","同源 / Origin"],["domain","主域名 / Domain"],["host","主机 / Host"],["exact","完整网址 / Exact"],["prefix","前缀 / Prefix"],["regex","正则 / Regex"],["never","不匹配 / Never"]])select.add(new Option(name,key));
    select.value=matchType;row.append(input,select,button("×",()=>row.remove(),"secondary"));q("vault-uri-rows").append(row);
  }
  function showEditor(item,fields=[]) {
    closeEditor();closeHistory();closeSave();closePersonal();
    editing=item;
    q("vault-editor-title").textContent=labels[item.itemType]||item.itemType;
    q("vault-item-name").value=item.name||"";q("vault-item-folder").value=item.folder||"";
    q("vault-item-favorite").checked=Boolean(item.favorite);q("vault-item-enabled").checked=item.enabled!==false;
    const values=Object.fromEntries(fields.map(field=>[field.name,field.value]));
    const standard=item.itemType==="login"?loginFields:{...(PERSONAL_LABELS[item.itemType]||{}),secureNote:"备注 / Notes"};
    const existing=(item.modules||[]).filter(m=>m.secret).map(m=>m.kind==="customSecret"?m.name:m.kind);
    for(const name of [...new Set([...Object.keys(standard),...existing])]){
      const label=document.createElement("label");label.textContent=standard[name]||name;
      const row=document.createElement("div");row.className="vault-field";
      const input=document.createElement(name==="secureNote"?"textarea":"input");input.dataset.vaultField=name;
      input.id=`vault-field-${q("vault-editor-fields").children.length}`;label.htmlFor=input.id;input.autocomplete="off";
      input.maxLength=name==="secureNote"?1048576:16384;
      if(name==="secureNote")input.rows=5;
      else input.type=["username","cardholderName","cardBrand","cardExpMonth","cardExpYear","identityTitle","firstName","middleName","lastName","company","email","phone","address1","address2","address3","city","state","postalCode","country"].includes(name)?"text":"password";
      input.value=values[name]||"";if(name==="privateKey")input.readOnly=true;
      const actions=document.createElement("div");actions.className="personal-actions";
      if(input.tagName==="INPUT"&&input.type==="password")actions.append(button("显示 / Show",e=>{input.type=input.type==="password"?"text":"password";e.currentTarget.textContent=input.type==="password"?"显示 / Show":"隐藏 / Hide";},"secondary"));
      actions.append(button("复制 / Copy",async()=>{try{await navigator.clipboard.writeText(input.value);showError("已复制 / Copied");}catch(e){showError(e);}},"secondary"));
      row.append(label,input,actions);q("vault-editor-fields").append(row);
    }
    q("vault-editor-websites").hidden=item.itemType!=="login";
    const uris=item.loginUris?.length?item.loginUris:item.baseUrl?[{uri:item.baseUrl,matchType:"origin"}]:[];
    for(const rule of uris)addUri(rule.uri,rule.matchType);
    for(const key of item.passkeys||[]){const p=document.createElement("p");p.textContent=`Passkey · ${key.rpId} · ${key.displayName||key.userName}`;q("vault-editor-passkeys").append(p);}
    q("vault-editor").hidden=false;q("vault-item-name").focus();
  }
  async function openItem(id) {
    const stamp=++sequence;busy=true;
    try { const result=await call("vault-get",{id});if(stamp===sequence)showEditor(result.item,result.fields); }
    catch(e){showError(e);}finally{busy=false;}
  }
  async function save(event) {
    event.preventDefault();if(!editing||busy)return;busy=true;
    try{
      const item=editing,modules=(item.modules||[]).map(m=>({kind:m.kind,name:m.name,value:m.value,agentVisible:m.agentVisible}));
      const secrets={namedSecrets:{}},removeSecretNames=[];
      const standard=item.itemType==="login"?loginFields:{...(PERSONAL_LABELS[item.itemType]||{}),secureNote:"Notes"};
      for(const input of q("vault-editor-fields").querySelectorAll("[data-vault-field]")){
        const name=input.dataset.vaultField;
        if(name==="privateKey")continue;
        if(!modules.some(m=>(m.kind==="customSecret"?m.name:m.kind)===name))modules.push({kind:Object.hasOwn(standard,name)?name:"customSecret",name,value:"",agentVisible:false});
        if(!input.value)removeSecretNames.push(name);
        else if(name==="password")secrets.password=input.value;
        else if(name==="passphrase")secrets.passphrase=input.value;
        else secrets.namedSecrets[name]=input.value;
      }
      let loginUris=item.loginUris||[];
      if(item.itemType==="login"){
        loginUris=[...q("vault-uri-rows").children].map(row=>({uri:row.querySelector("[data-uri]").value.trim(),matchType:row.querySelector("[data-match]").value})).filter(u=>u.uri);
        const urlIndex=modules.findIndex(m=>m.kind==="url");if(urlIndex>=0)modules.splice(urlIndex,1);
        const web=loginUris.find(u=>/^https?:\/\//.test(u.uri));if(web)modules.push({kind:"url",value:web.uri,agentVisible:false});
      }
      const input={id:item.id||null,itemType:item.itemType,name:q("vault-item-name").value,folder:q("vault-item-folder").value,
        favorite:q("vault-item-favorite").checked,enabled:q("vault-item-enabled").checked,modules,secrets,removeSecretNames,loginUris,
        description:item.description||"",httpAuthType:item.httpAuthType||"",authHeader:item.authHeader||"",authLocation:item.authLocation||"",
        authPrefix:item.authPrefix||"",apiAuthHeaders:item.apiAuthHeaders||[],testPath:item.testPath||""};
      await call("vault-save",{input,expectedUpdatedAt:item.updatedAt});
      closeEditor();signature="";showError("已保存到 OpenKeylet / Saved");
    }catch(e){showError(e);}finally{busy=false;refresh();}
  }
  async function openHistory(id) {
    closeEditor();closeHistory();const stamp=++sequence;busy=true;
    try{
      const view=await call("vault-history",{id});if(stamp!==sequence)return;
      history={id,updatedAt:view.updatedAt};q("vault-history-rows").replaceChildren();
      for(const entry of view.entries){
        const row=document.createElement("div");row.className="vault-row";
        const date=document.createElement("small");date.textContent=new Date(entry.changedAt).toLocaleString();
        const input=document.createElement("input");input.type="password";input.readOnly=true;input.autocomplete="off";input.value=entry.password;
        const actions=document.createElement("div");actions.className="personal-actions";
        actions.append(button("显示 / Show",e=>{input.type=input.type==="password"?"text":"password";e.currentTarget.textContent=input.type==="password"?"显示 / Show":"隐藏 / Hide";}),
          button("复制 / Copy",async()=>{try{await navigator.clipboard.writeText(input.value);showError("已复制 / Copied");}catch(e){showError(e);}}));
        row.append(date,input,actions);q("vault-history-rows").append(row);
      }
      if(!view.entries.length)q("vault-history-rows").textContent="暂无旧密码 / No previous passwords";
      q("vault-history-clear").hidden=!view.entries.length;q("vault-history").hidden=false;
    }catch(e){showError(e);}finally{busy=false;}
  }
  for(const id of ["vault-search","vault-kind","vault-folder","vault-favorites","vault-view"])q(id).addEventListener(id==="vault-search"?"input":"change",render);
  q("vault-new").onclick=()=>showEditor({itemType:q("vault-new-kind").value,modules:[],enabled:true});
  q("vault-editor").onsubmit=save;
  q("vault-editor-cancel").onclick=()=>{closeEditor();refresh();};
  q("vault-uri-add").onclick=()=>addUri();
  q("vault-history-close").onclick=()=>{closeHistory();refresh();};
  q("vault-confirm-accept").onclick=()=>answerConfirm(true);q("vault-confirm-cancel").onclick=()=>answerConfirm(false);
  q("vault-confirm").oncancel=event=>{event.preventDefault();answerConfirm(false);};
  q("vault-history-clear").onclick=async()=>{
    const current=history;if(!current||!await ask("清除全部旧密码？当前密码保持不变。 / Clear history and keep the current password?"))return;
    await mutate("vault-clear-history",{id:current.id,expectedUpdatedAt:current.updatedAt});await openHistory(current.id);
  };
  return {apply,isEditing:()=>Boolean(editing||history||busy||confirmResolver),close:()=>{closeEditor();closeHistory();answerConfirm(false);apply(null);}};
})();
