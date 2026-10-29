const $=s=>document.querySelector(s), id=new URL(location.href).searchParams.get("id");
async function call(action, fields={}) { const r=await chrome.runtime.sendMessage({type:"credential-ui",id,action,...fields}); if(!r?.ok)throw new Error(r?.error || KeyHubUI.t("Request unavailable")); return r.result; }
async function load(){
  try { const info=await call("info"); $("#origin").textContent=info.origin; $("#account").textContent=info.operation==="create" ? `${info.account} · ${info.rpId}` : info.rpId;
    KeyHubUI.text($("#title"), () => info.operation==="create" ? KeyHubUI.t("保存 Passkey / Save passkey") : KeyHubUI.t("使用 Passkey 登录 / Sign in"));
    $("#credential").hidden=info.operation==="create"; document.querySelector('label[for="credential"]').hidden=info.operation==="create";
    for(const e of info.entries) $("#credential").add(new Option(`${e.passkey.displayName || e.passkey.userName} · ${e.name}`,e.passkey.credentialId));
    $("#pin-panel").hidden=!info.pinConfigured; $("#pin").required=info.pinConfigured;
    if(info.verificationRequired && !info.pinConfigured){ KeyHubUI.text($("#note"), () => KeyHubUI.t("此网站要求身份验证。请先在 KeyHub 设置六位 PIN，再重新发起请求。 / Set a KeyHub PIN, then retry.")); $("#confirm").disabled=true; }
    else KeyHubUI.text($("#note"), () => KeyHubUI.t("凭据保存在本机 KeyHub。确认后完成此网站的请求。 / Stored in your local KeyHub vault."));
  }catch(e){KeyHubUI.text($("#error"),()=>KeyHubUI.t(e.message));$("#confirm").disabled=true;}
}
$("#request-form").addEventListener("submit",async e=>{e.preventDefault();$("#confirm").disabled=true;try{await call("confirm",{credentialId:$("#credential").value,pin:$("#pin").value});}catch(e){KeyHubUI.text($("#error"),()=>KeyHubUI.t(e.message));$("#confirm").disabled=false;}finally{$("#pin").value="";}});
for(const action of ["fallback","cancel"])$("#"+action).addEventListener("click",()=>call(action).catch(()=>window.close()));
load();
