const KeyHubUI = (() => {
  const messages = {
  "LOCAL PASSWORDS & PASSKEYS": [
    "本地密码与 Passkey",
    "Local passwords & passkeys"
  ],
  "BRIDGE PORT": [
    "连接端口",
    "Bridge port"
  ],
  "RECONNECT LOCAL BRIDGE": [
    "重新连接本地服务",
    "Reconnect local bridge"
  ],
  "KeyHub unavailable": [
    "KeyHub 暂不可用",
    "KeyHub unavailable"
  ],
  "Request unavailable": [
    "请求暂不可用",
    "Request unavailable"
  ],
  "Invalid port": [
    "端口无效",
    "Invalid port"
  ],
  "CARD": [
    "信用卡",
    "Card"
  ],
  "NOTE": [
    "笔记",
    "Note"
  ],
  "IDENTITY": [
    "身份",
    "Identity"
  ],
  "Notes": [
    "备注",
    "Notes"
  ],
  "Website": [
    "网站",
    "Website"
  ],
  "Vault or trash": [
    "密码库或回收站",
    "Vault or trash"
  ],
  "Item type": [
    "项目类型",
    "Item type"
  ],
  "New item type": [
    "新项目类型",
    "New item type"
  ],
  "Confirm vault action": [
    "确认密码库操作",
    "Confirm vault action"
  ],
  "Generated password": [
    "生成的密码",
    "Generated password"
  ],
  "登录": [
    "登录",
    "Login"
  ],
  "注册": [
    "注册",
    "Sign up"
  ],
  "修改密码": [
    "修改密码",
    "Change password"
  ],
  "已连接本地密码库 / CONNECTED": [
    "已连接本地密码库",
    "CONNECTED"
  ],
  "待保存信息已过期或来源网页已变化 / The save suggestion expired or its source changed": [
    "待保存信息已过期或来源网页已变化",
    "The save suggestion expired or its source changed"
  ],
  "来源网站 / Source: ": [
    "来源网站",
    "Source: "
  ],
  "这个网站还没有保存的密码 / No saved logins": [
    "这个网站还没有保存的密码",
    "No saved logins"
  ],
  "填写 / Fill": [
    "填写",
    "Fill"
  ],
  "已填写 / Filled": [
    "已填写",
    "Filled"
  ],
  "暂不可用 / UNAVAILABLE": [
    "暂不可用",
    "UNAVAILABLE"
  ],
  "请确认 KeyHub 已打开且浏览器连接已启用。 / Check that KeyHub and Browser Bridge are running.\n": [
    "请确认 KeyHub 已打开且浏览器连接已启用。",
    "Check that KeyHub and Browser Bridge are running.\n"
  ],
  "账号待确认 / Check account": [
    "账号待确认",
    "Check account"
  ],
  "新项目 / New item": [
    "新项目",
    "New item"
  ],
  "显示密码 / Show password": [
    "显示密码",
    "Show password"
  ],
  "隐藏密码 / Hide password": [
    "隐藏密码",
    "Hide password"
  ],
  "已保存到本地密码库 / Saved to KeyHub": [
    "已保存到本地密码库",
    "Saved to KeyHub"
  ],
  "在 KeyHub 安装指引中点击“打开扩展页” / Click Open extensions page in KeyHub": [
    "在 KeyHub 安装指引中点击“打开扩展页”",
    "Click Open extensions page in KeyHub"
  ],
  "安全笔记 / Secure note": [
    "安全笔记",
    "Secure note"
  ],
  "持卡人 / Cardholder": [
    "持卡人",
    "Cardholder"
  ],
  "卡号 / Number": [
    "卡号",
    "Number"
  ],
  "卡组织 / Brand": [
    "卡组织",
    "Brand"
  ],
  "到期月 / Expiry month": [
    "到期月",
    "Expiry month"
  ],
  "到期年 / Expiry year": [
    "到期年",
    "Expiry year"
  ],
  "安全码 / Security code": [
    "安全码",
    "Security code"
  ],
  "称谓 / Title": [
    "称谓",
    "Title"
  ],
  "名字 / First name": [
    "名字",
    "First name"
  ],
  "中间名 / Middle name": [
    "中间名",
    "Middle name"
  ],
  "姓氏 / Last name": [
    "姓氏",
    "Last name"
  ],
  "公司 / Company": [
    "公司",
    "Company"
  ],
  "邮箱 / Email": [
    "邮箱",
    "Email"
  ],
  "电话 / Phone": [
    "电话",
    "Phone"
  ],
  "地址第一行 / Address line 1": [
    "地址第一行",
    "Address line 1"
  ],
  "地址第二行 / Address line 2": [
    "地址第二行",
    "Address line 2"
  ],
  "地址第三行 / Address line 3": [
    "地址第三行",
    "Address line 3"
  ],
  "城市 / City": [
    "城市",
    "City"
  ],
  "省或州 / State": [
    "省或州",
    "State"
  ],
  "邮编 / Postal code": [
    "邮编",
    "Postal code"
  ],
  "国家或地区 / Country": [
    "国家或地区",
    "Country"
  ],
  "护照 / Passport": [
    "护照",
    "Passport"
  ],
  "驾照 / License": [
    "驾照",
    "License"
  ],
  "身份证 / National ID": [
    "身份证",
    "National ID"
  ],
  " 个字段 / Fields filled": [
    " 个字段",
    "Fields filled"
  ],
  "编辑 / Edit": [
    "编辑",
    "Edit"
  ],
  "信用卡 / Card": [
    "信用卡",
    "Card"
  ],
  "身份资料 / Identity": [
    "身份资料",
    "Identity"
  ],
  "已复制 / Copied": [
    "已复制",
    "Copied"
  ],
  "登录 / Login": [
    "登录",
    "Login"
  ],
  "身份 / Identity": [
    "身份",
    "Identity"
  ],
  "笔记 / Note": [
    "笔记",
    "Note"
  ],
  "其他 / Other": [
    "其他",
    "Other"
  ],
  "账号 / Username": [
    "账号",
    "Username"
  ],
  "密码 / Password": [
    "密码",
    "Password"
  ],
  "TOTP 密钥 / TOTP key": [
    "TOTP 密钥",
    "TOTP key"
  ],
  "备注 / Notes": [
    "备注",
    "Notes"
  ],
  "已更新本地密码库 / Vault updated": [
    "已更新本地密码库",
    "Vault updated"
  ],
  "所有文件夹 / All folders": [
    "所有文件夹",
    "All folders"
  ],
  "回收站为空或没有匹配项 / No matching trash items": [
    "回收站为空或没有匹配项",
    "No matching trash items"
  ],
  "没有匹配项目 / No matching items": [
    "没有匹配项目",
    "No matching items"
  ],
  "已停用 / Disabled": [
    "已停用",
    "Disabled"
  ],
  "恢复 / Restore": [
    "恢复",
    "Restore"
  ],
  "永久删除 / Delete forever": [
    "永久删除",
    "Delete forever"
  ],
  "永久删除此项目及其 Passkey？无法撤销；已有备份不受影响。 / Delete permanently? Existing backups remain unchanged.": [
    "永久删除此项目及其 Passkey？无法撤销；已有备份不受影响。",
    "Delete permanently? Existing backups remain unchanged."
  ],
  "查看 / 编辑 · Edit": [
    "查看或编辑",
    "View / edit"
  ],
  "历史 / History": [
    "历史",
    "History"
  ],
  "移入回收站 / Trash": [
    "移入回收站",
    "Trash"
  ],
  "移入回收站？项目将停止用于填写和登录。 / Move to trash and stop using this item?": [
    "移入回收站？项目将停止用于填写和登录。",
    "Move to trash and stop using this item?"
  ],
  "网站 / Website": [
    "网站",
    "Website"
  ],
  "同源 / Origin": [
    "同源",
    "Origin"
  ],
  "主域名 / Domain": [
    "主域名",
    "Domain"
  ],
  "主机 / Host": [
    "主机",
    "Host"
  ],
  "完整网址 / Exact": [
    "完整网址",
    "Exact"
  ],
  "前缀 / Prefix": [
    "前缀",
    "Prefix"
  ],
  "正则 / Regex": [
    "正则",
    "Regex"
  ],
  "不匹配 / Never": [
    "不匹配",
    "Never"
  ],
  "显示 / Show": [
    "显示",
    "Show"
  ],
  "隐藏 / Hide": [
    "隐藏",
    "Hide"
  ],
  "复制 / Copy": [
    "复制",
    "Copy"
  ],
  "已保存到 KeyHub / Saved": [
    "已保存到 KeyHub",
    "Saved"
  ],
  "暂无旧密码 / No previous passwords": [
    "暂无旧密码",
    "No previous passwords"
  ],
  "清除全部旧密码？当前密码保持不变。 / Clear history and keep the current password?": [
    "清除全部旧密码？当前密码保持不变。",
    "Clear history and keep the current password?"
  ],
  "保存 Passkey / Save passkey": [
    "保存 Passkey",
    "Save passkey"
  ],
  "使用 Passkey 登录 / Sign in": [
    "使用 Passkey 登录",
    "Sign in"
  ],
  "此网站要求身份验证。请先在 KeyHub 设置六位 PIN，再重新发起请求。 / Set a KeyHub PIN, then retry.": [
    "此网站要求身份验证。请先在 KeyHub 设置六位 PIN，再重新发起请求。",
    "Set a KeyHub PIN, then retry."
  ],
  "凭据保存在本机 KeyHub。确认后完成此网站的请求。 / Stored in your local KeyHub vault.": [
    "凭据保存在本机 KeyHub。确认后完成此网站的请求。",
    "Stored in your local KeyHub vault."
  ],
  "正在检查 / CHECKING": [
    "正在检查",
    "CHECKING"
  ],
  "完成 / Done": [
    "完成",
    "Done"
  ],
  "检测到已提交的登录信息 / Login detected": [
    "检测到已提交的登录信息",
    "Login detected"
  ],
  "预览并保存 / Review & save": [
    "预览并保存",
    "Review & save"
  ],
  "忽略 / Dismiss": [
    "忽略",
    "Dismiss"
  ],
  "解锁 / Unlock": [
    "解锁",
    "Unlock"
  ],
  "完整密码库 / All vault items": [
    "完整密码库",
    "All vault items"
  ],
  "搜索 / Search": [
    "搜索",
    "Search"
  ],
  "密码库 / Vault": [
    "密码库",
    "Vault"
  ],
  "回收站 / Trash": [
    "回收站",
    "Trash"
  ],
  "所有类型 / All types": [
    "所有类型",
    "All types"
  ],
  "文件夹 / Folder": [
    "文件夹",
    "Folder"
  ],
  "仅收藏 / Favorites": [
    "仅收藏",
    "Favorites"
  ],
  "＋ 新建 / New": [
    "＋ 新建",
    "New"
  ],
  "名称 / Name": [
    "名称",
    "Name"
  ],
  "收藏 / Favorite": [
    "收藏",
    "Favorite"
  ],
  "启用 / Enabled": [
    "启用",
    "Enabled"
  ],
  "网站 / Websites": [
    "网站",
    "Websites"
  ],
  "＋ 网站 / Website": [
    "＋ 网站",
    "Website"
  ],
  "保存 / Save": [
    "保存",
    "Save"
  ],
  "取消 / Cancel": [
    "取消",
    "Cancel"
  ],
  "密码历史 / Password history": [
    "密码历史",
    "Password history"
  ],
  "最近 20 条旧密码 / Latest 20 previous passwords": [
    "最近 20 条旧密码",
    "Latest 20 previous passwords"
  ],
  "清除历史 / Clear history": [
    "清除历史",
    "Clear history"
  ],
  "关闭 / Close": [
    "关闭",
    "Close"
  ],
  "确认 / Confirm": [
    "确认",
    "Confirm"
  ],
  "保存当前网站的账号 / Save login": [
    "保存当前网站的账号",
    "Save login"
  ],
  "密码生成器 / Password generator": [
    "密码生成器",
    "Password generator"
  ],
  "长度 / Length · 8–128": [
    "长度",
    "Length · 8–128"
  ],
  "生成 / Generate": [
    "生成",
    "Generate"
  ],
  "检测到多个表单 / Choose a form": [
    "检测到多个表单",
    "Choose a form"
  ],
  "保存位置 / Save to": [
    "保存位置",
    "Save to"
  ],
  "生成新密码 / Generate password": [
    "生成新密码",
    "Generate password"
  ],
  "保存到 KeyHub / Save": [
    "保存到 KeyHub",
    "Save"
  ],
  "锁定 / Lock": [
    "锁定",
    "Lock"
  ],
  "信用卡、身份与笔记 / Cards, identities & notes": [
    "信用卡、身份与笔记",
    "Cards, identities & notes"
  ],
  "＋ 信用卡 / Card": [
    "＋ 信用卡",
    "Card"
  ],
  "＋ 身份 / Identity": [
    "＋ 身份",
    "Identity"
  ],
  "＋ 笔记 / Note": [
    "＋ 笔记",
    "Note"
  ],
  "连接设置 / Connection": [
    "连接设置",
    "Connection"
  ],
  "开启登录保存提示 / Enable save suggestions": [
    "开启登录保存提示",
    "Enable save suggestions"
  ],
  "隐私说明 / Privacy": [
    "隐私说明",
    "Privacy"
  ],
  "语言 / Language": [
    "语言",
    "Language"
  ],
  "外观 / Theme": [
    "外观",
    "Theme"
  ],
  "跟随系统 / System": [
    "跟随系统",
    "System"
  ],
  "浅色 / Light": [
    "浅色",
    "Light"
  ],
  "深色 / Dark": [
    "深色",
    "Dark"
  ],
  "开启后，在提交表单、点击登录或按 Enter 时读取账号和密码，仅发送到本机 KeyHub。草稿最多暂存 5 分钟，确认后才保存。 / When enabled, login fields are read on submit, sign-in or Enter and sent only to local KeyHub. Drafts expire within 5 minutes and are saved only after confirmation.": [
    "开启后，在提交表单、点击登录或按 Enter 时读取账号和密码，仅发送到本机 KeyHub。草稿最多暂存 5 分钟，确认后才保存。",
    "When enabled, login fields are read on submit, sign-in or Enter and sent only to local KeyHub. Drafts expire within 5 minutes and are saved only after confirmation."
  ],
  "账号 / Account": [
    "账号",
    "Account"
  ],
  "使用设备或安全密钥 / Use device": [
    "使用设备或安全密钥",
    "Use device"
  ],
  "下一步：打开需要登录的网站": [
    "下一步：打开需要登录的网站",
    "Next: open a sign-in website"
  ],
  "然后点击 KeyHub 插件，即可查看、填写或保存该网站的账号。": [
    "然后点击 KeyHub 插件，即可查看、填写或保存该网站的账号。",
    "Then open KeyHub to view, fill or save a login."
  ],
  "扩展管理页、新标签页等浏览器页面无法填写密码，无需重新连接。": [
    "扩展管理页、新标签页等浏览器页面无法填写密码，无需重新连接。",
    "Browser pages cannot be filled; no reconnection is needed."
  ],
  "账号信息已写入本地加密密码库。": [
    "账号信息已写入本地加密密码库。",
    "The login was saved to your local encrypted vault."
  ],
  "请确认账号及密码是否正确。提交表单不代表登录或注册成功。待保存信息最多保留 5 分钟。": [
    "请确认账号及密码是否正确。提交表单不代表登录或注册成功。待保存信息最多保留 5 分钟。",
    "Check the account and password. Submitting a form does not guarantee successful sign-in. Drafts expire within 5 minutes."
  ],
  "与本机 KeyHub 共用密码库 · LOCAL VAULT": [
    "与本机 KeyHub 共用密码库",
    "Shared with your local KeyHub vault"
  ],
  "KeyHub PIN": [
    "KeyHub 验证码",
    "KeyHub PIN"
  ],
  "无法保存界面设置，请重试。 / Could not save appearance settings. Try again.": [
    "无法保存界面设置，请重试。",
    "Could not save appearance settings. Try again."
  ],
  "网页已经变化，请重新读取 / The page changed; read the form again": [
    "网页已经变化，请重新读取",
    "The page changed; read the form again"
  ],
  "识别到不同的密码，请手动确认 / Multiple different passwords; check manually": [
    "识别到不同的密码，请手动确认",
    "Multiple different passwords; check manually"
  ],
  "两次输入的密码不一致 / Password confirmation does not match": [
    "两次输入的密码不一致",
    "Password confirmation does not match"
  ],
  "账号字段不明确，请手动确认 / Check the account field": [
    "账号字段不明确，请手动确认",
    "Check the account field"
  ],
  "字段超过支持长度，请手动确认 / Field exceeds the supported length": [
    "字段超过支持长度，请手动确认",
    "Field exceeds the supported length"
  ],
  "请手动检查注册或改密表单 / Check the new-password form manually": [
    "请手动检查注册或改密表单",
    "Check the new-password form manually"
  ],
  "无法明确选择密码字段，请先聚焦 / Focus the password field first": [
    "无法明确选择密码字段，请先聚焦",
    "Focus the password field first"
  ],
  "网页显示的是另一个账号 / This form belongs to a different account": [
    "网页显示的是另一个账号",
    "This form belongs to a different account"
  ],
  "待保存信息已过期，请重新填写 / The save suggestion expired": [
    "待保存信息已过期，请重新填写",
    "The save suggestion expired"
  ],
  "来源网站已变化，请重新填写 / The source website changed": [
    "来源网站已变化，请重新填写",
    "The source website changed"
  ],
  "请先解锁 KeyHub / Unlock KeyHub first": [
    "请先解锁 KeyHub",
    "Unlock KeyHub first"
  ],
  "Bridge unavailable": [
    "本地连接暂不可用",
    "Bridge unavailable"
  ],
  "storage failed": [
    "无法保存设置",
    "Could not save settings"
  ]
};
  let language = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en', theme = 'system';
  const bindings = new WeakMap(), nodes = new Set();
  const t = source => messages[source]?.[language === 'en' ? 1 : 0] ?? source;
  function text(node, source) {
    let previous;
    const render = () => {
      if (previous !== undefined && node.textContent !== previous) { bindings.delete(node); return; }
      previous = source(); node.textContent = previous;
    };
    if (!bindings.has(node)) nodes.add(new WeakRef(node));
    bindings.set(node, render); render();
  }
  function option(source, value) { const node = new Option('', value); text(node, source); return node; }
  function paint() {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.documentElement.dataset.theme = theme;
    document.getElementById('ui-language').value = language;
    document.getElementById('ui-theme').value = theme;
    for (const reference of nodes) {
      const node = reference.deref();
      if (!node || !node.isConnected) nodes.delete(reference);
      else bindings.get(node)?.();
    }
  }
  function staticText() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      if (node.parentElement.closest('script, textarea, #ui-language')) continue;
      const source = node.textContent.trim();
      if (messages[source]) {
        const original = node.textContent;
        text(node, () => original.replace(source, t(source)));
      }
    }
    for (const node of document.querySelectorAll('[aria-label], [placeholder]')) {
      for (const name of ['aria-label','placeholder']) {
        const source = node.getAttribute(name);
        if (messages[source]) {
          const marker = document.createTextNode(''); node.append(marker);
          text(marker, () => { node.setAttribute(name, t(source)); return ''; });
        }
      }
    }
  }
  async function change(key, value) {
    try {
      await chrome.storage.local.set({[key]:value});
      if (key === 'uiLanguage') language = value;
      else theme = value;
      paint();
    } catch {
      paint();
      text(document.getElementById('error'), () => t('无法保存界面设置，请重试。 / Could not save appearance settings. Try again.'));
    }
  }
  staticText(); paint();
  const ready = chrome.storage.local.get(['uiLanguage','uiTheme']).then(stored => {
    if (['zh','en'].includes(stored.uiLanguage)) language = stored.uiLanguage;
    if (['system','light','dark'].includes(stored.uiTheme)) theme = stored.uiTheme;
    paint();
  }).catch(() => { paint(); });
  document.getElementById('ui-language').addEventListener('change', event => { void change('uiLanguage', event.target.value); });
  document.getElementById('ui-theme').addEventListener('change', event => { void change('uiTheme', event.target.value); });
  return {t, text, option, ready, date: value => new Date(value).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')};
})();
