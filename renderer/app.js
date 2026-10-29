const { invoke } = window.__TAURI__.core;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const HAN_TEXT = /[\u3400-\u9fff]/;

function bindBackdropGesture(backdrop, dismiss) {
  let origin = null;
  let released = null;
  const clear = () => { origin = released = null; };
  backdrop.addEventListener('pointerdown', event => {
    clear();
    origin = event.button === 0 && event.isPrimary && event.target === backdrop
      ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      : null;
  });
  const moved = event => Math.abs(event.clientX - origin.x) > 3 || Math.abs(event.clientY - origin.y) > 3;
  backdrop.addEventListener('pointermove', event => {
    if (origin && (event.pointerId !== origin.pointerId || moved(event))) clear();
  });
  backdrop.addEventListener('pointerup', event => {
    released = origin && event.button === 0 && event.isPrimary
      && event.pointerId === origin.pointerId
      && event.target === backdrop
      && !moved(event) ? { pointerId: event.pointerId } : null;
    origin = null;
  });
  backdrop.addEventListener('click', event => {
    const accepted = released && event.button === 0 && event.detail > 0
      && event.target === backdrop
      && (!('pointerId' in event) || event.pointerId === released.pointerId);
    clear();
    if (accepted) {
      // Complete the click on the modal, never on a control uncovered at mouseup.
      event.stopPropagation();
      dismiss();
    }
  });
  backdrop.addEventListener('pointercancel', clear);
  backdrop.addEventListener('lostpointercapture', event => {
    if (origin?.pointerId === event.pointerId) clear();
  });
  window.addEventListener('blur', clear);
}

// Search and creation stay visible while switching between the existing pages.
$('#workspace-toolbar').append($('#title-search'), $('.creation-control'));
$('.main-content').append($('#metrics'));

const isMacOS = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');
document.documentElement.classList.toggle('platform-macos', isMacOS);
if (isMacOS) $('.title-drag-region').prepend($('.window-controls'));

if (isMacOS) {
  const titleDragRegion = document.querySelector('.title-drag-region');
  window.KeyHubTitlebar.install({
    element: titleDragRegion,
    invoke,
    isMacOS,
    onError: error => toast(cleanError(error), 'error'),
  });
}

// Keep the first paint deterministic. The persisted setting from the vault is
// applied by refresh(); browser storage can survive an app reinstall and must
// not override the English default while the native state is loading.
let language = 'en';

function localized(zh, en) {
  return language === 'en' ? en : zh;
}

const staticCopy = [
  ['.nav', 'aria-label', '主导航', 'Main navigation'],
  ['#connections-list', 'aria-label', '项目列表', 'Vault items'],
  ['.activity-panel', 'aria-label', '操作记录', 'Activity log'],
  ['.settings-layout', 'aria-label', '设置', 'Settings'],
  ['#title-search-input', 'placeholder', '搜索项目…', 'Search items…'],
  ['#page-activity .page-search-input', 'placeholder', '搜索记录…', 'Search activity…'],
  ['#page-settings .page-search-input', 'placeholder', '搜索设置…', 'Search settings…'],
  ['#desktop-shortcut-enabled', 'aria-label', '创建桌面快捷方式', 'Create desktop shortcut'],
  ['#launch-at-login-enabled', 'aria-label', '开机自启动', 'Launch at login'],
  ['#pin-enabled', 'aria-label', '启用 PIN 锁', 'Enable PIN lock'],
  ['#browser-enabled', 'aria-label', '启用浏览器桥接', 'Enable Browser Bridge'],
  ['.window-control[data-window-action="minimize"]', 'aria-label', '最小化', 'Minimize'],
  ['.window-control[data-window-action="maximize"]', 'aria-label', '最大化或还原', 'Maximize or restore'],
  ['.window-control[data-window-action="close"]', 'aria-label', '关闭', 'Close'],
  ['[data-workspace-settings="MCP"]', 'aria-label', '接入 AI Agent', 'Connect an agent'],
  ['.nav-item[data-page="connections"] > span', 'text', '密钥库', 'Vault'],
  ['.nav-item[data-page="activity"] > span', 'text', '使用记录', 'Activity'],
  ['.nav-item[data-page="settings"] > span', 'text', '设置与接入', 'Settings'],
  ['#page-connections .page-header h1', 'text', '秘密项目', 'VAULT ITEMS'],
  ['#title-search-input', 'aria-label', '搜索秘密项目', 'Search vault items'],
  ['#add-connection-button', 'text', '＋ 新建凭据', '+ New credential'],
  ['#drafts-button', 'text', '草稿', 'DRAFT'],
  ['.creation-control', 'aria-label', '添加 / 草稿切换', 'Add / draft selector'],
  ['#generator-open', 'text', '生成器', 'GENERATE'],
  ['#trash-open', 'text', '回收站', 'TRASH'],
  ['#delete-draft-button', 'aria-label', '删除草稿', 'Delete draft'],
  ['#page-activity .page-search-input', 'aria-label', '搜索操作记录', 'Search activity'],
  ['#page-settings .page-search-input', 'aria-label', '搜索系统设置', 'Search settings'],
  ['#header-export-backup-button', 'text', '一键打包', 'EXPORT'],
  ['#header-import-backup-button', 'text', '一键导入包', 'IMPORT'],
  ['[data-module="SYSTEM / 01"] .settings-heading h2', 'text', '系统入口', 'SYSTEM ACCESS'],
  ['[data-module="SYSTEM / 01"] .settings-heading p', 'text', '控制 KeyHub 的桌面快捷方式与开机启动。', 'Control the KeyHub desktop shortcut and launch at login.'],
  ['#desktop-shortcut-option strong', 'text', '创建快捷方式到桌面', 'CREATE DESKTOP SHORTCUT'],
  ['#desktop-shortcut-option small', 'text', '在当前用户桌面创建 KeyHub 快捷方式', 'Create a KeyHub shortcut on the current user’s desktop.'],
  ['#launch-at-login-option strong', 'text', '开机自启动', 'LAUNCH AT LOGIN'],
  ['#launch-at-login-option small', 'text', '登录系统后自动启动 KeyHub，并保持单实例', 'Start KeyHub after sign-in while preserving single-instance behavior.'],
  ['[data-module="MCP / 02"] .settings-heading h2', 'text', 'Agent 接入', 'AGENT SETUP'],
  ['[data-module="MCP / 02"] .settings-heading p', 'text', '注册本地 stdio MCP；支持的 Agent 同时安装“认证任务优先使用 KeyHub”规则。', 'Register the local stdio MCP and install the KeyHub-first authentication rule where supported.'],
  ['[data-module="APP / 03"] .settings-heading h2', 'text', '窗口与锁定', 'WINDOW & LOCK'],
  ['[data-module="APP / 03"] .settings-heading p', 'text', '控制关闭按钮与本地 PIN 锁。', 'Control the close button and local PIN lock.'],
  ['label[for="close-behavior"] strong', 'text', '关闭按钮', 'CLOSE BUTTON'],
  ['label[for="close-behavior"] small', 'text', '最小化可保留托盘菜单', 'Minimizing keeps tray controls available.'],
  ['#close-behavior option[value="tray"]', 'text', '最小化到托盘', 'MINIMIZE TO TRAY'],
  ['#close-behavior option[value="exit"]', 'text', '退出 KeyHub', 'QUIT KeyHub'],
  ['#menu-bar-only-option strong', 'text', '仅在菜单栏运行', 'Menu bar only'],
  ['#menu-bar-only-option small', 'text', '隐藏底部 Dock 图标，点击顶部菜单栏图标打开快捷面板。', 'Hide the Dock icon. Click the menu bar icon for quick access.'],
  ['#menu-bar-only-enabled', 'aria-label', '仅在菜单栏运行', 'Menu bar only'],
  ['#quick-panel-label', 'text', '菜单栏快捷面板', 'Menu bar quick panel'],
  ['#quick-panel-help', 'text', '点击顶部图标可随时打开，也可以在这里预览。', 'Click the menu bar icon any time, or preview the panel here.'],
  ['#open-quick-panel', 'text', '打开快捷面板', 'Open quick panel'],
  ['.pin-option strong', 'text', 'PIN 锁', 'PIN LOCK'],
  ['.pin-option small', 'text', '关闭后移除当前 PIN；再次开启时设置新的 PIN', 'Turning this off removes the current PIN. Set a new PIN when enabling it again.'],
  ['.agent-restart-notice span', 'text', '完成后重启 Agent。', 'Restart the agent after setup.'],
  ['.agent-restart-notice strong', 'text', '需要重启 Agent', 'NEW SESSION REQUIRED'],
  ['#owner-lock-button', 'text', '锁定', 'LOCK'],
  ['#agent-client-list .agent-scan-placeholder', 'text', '正在扫描本机 Agent', 'SCANNING LOCAL AGENTS'],
  ['#rescan-agents', 'text', '重新扫描', 'RESCAN'],
  ['[data-copy-format="stdio-json"]', 'text', '复制 JSON', 'COPY JSON'],
  ['[data-copy-format="stdio-toml"]', 'text', '复制 TOML', 'COPY TOML'],
  ['.endpoint-box > span', 'text', '本地 STDIO', 'STDIO / LOCAL'],
  ['.manual-mcp-config summary', 'text', '其他 Agent / 手动配置', 'OTHER AGENT / MANUAL SETUP'],
  ['.manual-config-steps > div:nth-child(1) span', 'text', '打开目标 Agent 的 MCP 配置', 'Open the target agent MCP configuration'],
  ['.manual-config-steps > div:nth-child(2) span', 'text', '按配置格式复制 JSON 或 TOML', 'Copy JSON or TOML to match its config format'],
  ['.manual-config-steps > div:nth-child(3) span', 'text', '粘贴保存并重新启动 Agent', 'Paste, save, and restart the agent'],
  ['[data-module="WEB / 04"] .settings-heading h2', 'text', '浏览器接入', 'BROWSER BRIDGE'],
  ['[data-module="WEB / 04"] .settings-heading p', 'text', '通过已配对扩展填写当前浏览器控件。', 'Fill the focused browser field through the paired extension.'],
  ['label[for="browser-port"]', 'text', '本地端口', 'LOCAL PORT'],
  ['#save-browser-settings-button', 'text', '保存', 'SAVE'],
  ['#browser-install-heading', 'text', '安装插件 · 只需两步', 'INSTALL IN TWO STEPS'],
  ['#browser-step-open-title', 'text', '打开扩展页', 'Open the extensions page'],
  ['#browser-step-open-description', 'text', '点击下方按钮，然后开启扩展页右上角的“开发者模式”。', 'Click below, then turn on Developer mode in the top-right corner of the extensions page.'],
  ['#browser-open-help', 'text', '未能自动打开。请在 Chrome 地址栏输入 chrome://extensions，再开启“开发者模式”。', "Could not open it automatically. Enter chrome://extensions in Chrome's address bar, then turn on Developer mode."],
  ['#browser-step-drag-title', 'text', '拖入插件', 'Drag in the extension'],
  ['#browser-step-drag-description', 'text', '按住下方标识，拖到扩展页的空白区域，松开即可安装。', 'Hold the icon below, drag it onto an empty area of the extensions page, and release to install.'],
  ['#browser-install-complete', 'text', '安装后会自动连接，请保持 KeyHub 运行。', 'Once installed, the extension connects automatically. Keep KeyHub running.'],
  ['#browser-fallback-title', 'text', '拖拽无法安装？', "Can't install by dragging?"],
  ['#browser-fallback-description', 'text', '打开下方扩展目录，然后在扩展页点击“加载已解压的扩展程序”，选择该目录。', 'Open the extension folder below. On the extensions page, click Load unpacked and select that folder.'],
  ['#drag-extension-label', 'text', '按住此处，拖入扩展页', 'Hold and drag to the extensions page'],
  ['#drag-extension-button', 'aria-label', '拖动插件到 Chrome 扩展页；也可按回车打开扩展目录', 'Drag the extension to Chrome Extensions, or press Enter to open its folder'],
  ['#quick-pairing-button', 'text', '打开扩展页', 'OPEN EXTENSIONS PAGE'],
  ['#open-extension-button', 'text', '扩展目录', 'EXTENSION FOLDER'],
  ['#reset-pairing-button', 'text', '重置', 'RESET'],
  ['[data-module="SAFE / 05"] .settings-heading h2', 'text', '本地数据', 'LOCAL DATA'],
  ['#migration-open', 'text', '迁入密码库', 'IMPORT VAULT'],
  ['[data-module="SAFE / 05"] .settings-heading p', 'text', '用独立备份密码加密导出全部项目与 Passkey，也可恢复旧版备份。', 'Export all items and passkeys encrypted with a separate backup password, or restore an existing backup.'],
  ['#open-data-button', 'text', '打开数据目录', 'OPEN DATA FOLDER'],
  ['#owner-lock-description', 'text', 'PIN 保护明文查看、浏览器密码库访问和 Passkey 验证；模块值默认对 Agent 隐藏。', 'The PIN protects plaintext viewing, browser vault access and passkey verification. Module values are hidden from agents by default.'],
  ['#owner-pin', 'label', '六位数字 PIN', 'SIX-DIGIT PIN'],
  ['#owner-pin-confirm', 'label', '再次输入 PIN', 'CONFIRM PIN'],
  ['.lock-note span', 'text', '秘密由本机随机主密钥加密；PIN 用于本地解锁与验证。', 'Secrets are encrypted by the local random master key. The PIN is used for local unlocking and verification.'],
  ['.lock-display > span', 'text', '所有者访问', 'OWNER ACCESS'],
  ['.lock-display > small', 'text', '本地界面锁定不限制 MCP 使用', 'LOCAL GUI / MCP REMAINS READY'],
  ['#owner-pin-cancel', 'text', '取消', 'CANCEL'],
  ['[data-close-modal].icon-button', 'aria-label', '关闭编辑器', 'Close editor'],
  ['#connection-name', 'label', '名称', 'NAME'],
  ['#connection-type', 'label', '类型', 'TYPE'],
  ['#connection-folder', 'label', '文件夹', 'FOLDER'],
  ['#connection-description', 'label-html', '公开用途 <em>可选</em>', 'PUBLIC PURPOSE <em>OPTIONAL</em>'],
  ['.template-copy strong', 'text', '从一个组合开始', 'START WITH A PRESET'],
  ['.template-copy small', 'text', '模板只添加模块，不会限制之后的修改。', 'Templates only add modules; you can change anything afterward.'],
  ['.module-editor-heading > div > strong', 'text', '项目模块', 'ITEM MODULES'],
  ['.module-editor-heading > div > small', 'text', '拖动排序 · 开关控制 Agent 可读取的明文 · 自定义字段名可作为 ENV KEY', 'DRAG TO REORDER · SWITCH CONTROLS PLAINTEXT AGENTS CAN READ · CUSTOM NAMES CAN BE USED AS ENV KEYS'],
  ['#add-module-button', 'text', '＋ 添加模块', '+ ADD MODULE'],
  ['[data-add-env-group]', 'text', '环境变量组…', 'ENVIRONMENT VARIABLE GROUP…'],
  ['#env-group-title', 'text', '添加环境变量', 'ADD ENVIRONMENT VARIABLES'],
  ['.env-group-heading small', 'text', '每行一个 KEY=VALUE，支持 # 注释和 export；值只保存在本地，添加到凭据并保存后才会写入。', 'One KEY=VALUE per line. Supports # comments and export. Values remain local and are written only after adding them and saving the credential.'],
  ['#env-group-input', 'placeholder', 'DATABASE_URL=postgres://…\nAPI_TOKEN=…', 'DATABASE_URL=postgres://…\nAPI_TOKEN=…'],
  ['#env-group-help', 'text', '字段名只能使用字母、数字和下划线，且不能以数字开头。行内 # 会作为值的一部分。', 'Field names use letters, numbers and underscores, and cannot start with a number. Inline # is kept as part of the value.'],
  ['#env-group-cancel', 'text', '取消', 'CANCEL'],
  ['#env-group-add', 'text', '添加变量', 'ADD VARIABLES'],
  ['#env-group-close', 'aria-label', '关闭环境变量组', 'Close environment variable group'],
  ['#module-menu [data-add-module="username"]', 'text', '账号', 'USERNAME'],
  ['#module-menu [data-add-module="password"]', 'text', '密码', 'PASSWORD'],
  ['#module-menu [data-add-module="apiCredential"]', 'text', 'API 凭据', 'API CREDENTIAL'],
  ['#module-menu [data-add-module="privateKey"]', 'text', '私钥', 'PRIVATE KEY'],
  ['#module-menu [data-add-module="passphrase"]', 'text', '私钥口令', 'KEY PASSPHRASE'],
  ['#module-menu [data-add-module="totp"]', 'text', 'TOTP', 'TOTP'],
  ['#module-menu [data-add-module="customSecret"]', 'text', '自定义字段', 'CUSTOM FIELD'],
  ['#module-menu [data-add-module="host"]', 'text', '主机 / IP', 'HOST / IP'],
  ['#module-menu [data-add-module="port"]', 'text', '端口', 'PORT'],
  ['#module-menu [data-add-module="url"]', 'text', '服务 URL', 'SERVICE URL'],
  ['[data-item-template="login"] > span', 'html', '登录<small>账号 + 密码</small>', 'LOGIN<small>USERNAME + PASSWORD</small>'],
  ['[data-item-template="card"] > span', 'html', '信用卡<small>卡号 + 有效期 + 安全码</small>', 'CARD<small>NUMBER + EXPIRY + CODE</small>'],
  ['[data-item-template="identity"] > span', 'html', '身份资料<small>姓名 + 联系方式 + 地址</small>', 'IDENTITY<small>NAME + CONTACT + ADDRESS</small>'],
  ['[data-item-template="secureNote"] > span', 'html', '安全笔记<small>加密保存长文本</small>', 'SECURE NOTE<small>ENCRYPTED TEXT</small>'],
  ['[data-item-template="env"] > span', 'html', '环境变量<small>批量粘贴 KEY=VALUE</small>', 'ENVIRONMENT VARIABLES<small>PASTE MULTIPLE KEY=VALUE ENTRIES</small>'],
  ['[data-item-template="ssh"] > span', 'html', 'SSH<small>主机 + 端口 + 账号 + 密码</small>', 'SSH<small>HOST + PORT + USER + PASSWORD</small>'],
  ['[data-item-template="api"] > span', 'html', 'API<small>API 凭据</small>', 'API<small>API CREDENTIAL</small>'],
  ['[data-item-template="blank"] > span', 'html', '空白<small>从零添加模块</small>', 'BLANK<small>START WITH NO MODULES</small>'],
  ['#template-passkey-note', 'text', 'Passkey 不在这里手动创建。请在支持 Passkey 的网站注册或登录时，通过 KeyHub 浏览器扩展创建；也可以从 Bitwarden 导入。', 'Passkeys are not created manually here. Use the KeyHub browser extension while registering or signing in on a supporting website; Bitwarden imports are also supported.'],
  ['#connection-enabled-label', 'text', '启用此项目', 'ENABLE ITEM'],
  ['#connection-enabled-help', 'text', '禁用后 Agent 无法使用', 'Agents cannot use a disabled item.'],
  ['.secret-hint', 'text', '当前项目的明文只在已解锁 GUI 中显示', 'Plaintext is visible only in the unlocked GUI.'],
  ['#connection-form .modal-footer [data-close-modal]', 'text', '关闭', 'CLOSE'],
  ['#save-connection-button', 'text', '保存', 'SAVE'],
  ['.login-websites summary', 'text', '网站匹配', 'WEBSITE MATCHING'],
  ['.login-websites > p', 'text', '设置多个网站及匹配规则', 'Configure websites and matching rules.'],
  ['#login-uri-add', 'text', '＋ 添加网站', '+ ADD WEBSITE'],
  ['#settings-search-empty', 'text', '没有匹配设置', 'NO MATCHING SETTINGS'],
  ['#generator-title', 'text', '密码生成器', 'Password generator'],
  ['#generator-length', 'label', '长度 · 8–128', 'Length · 8–128'],
  ['#generator-result', 'aria-label', '生成的密码', 'Generated password'],
  ['#generator-regenerate', 'text', '重新生成', 'Generate'],
  ['#generator-copy', 'text', '复制', 'Copy'],
  ['#generator-use', 'text', '使用', 'Use'],
  ['#backup-password', 'label', '备份密码', 'Backup password'],
  ['#backup-password-confirm', 'label', '再次输入', 'Confirm password'],
  ['#backup-password-form button[type="submit"]', 'text', '选择文件', 'Choose file'],
  ['#migration-title', 'text', '迁入密码库', 'Import vault'],
  ['#migration-format', 'label', '来源', 'Source'],
  ['#migration-select', 'text', '选择文件', 'Choose file'],
  ['#migration-confirm', 'text', '确认导入', 'Import'],
  ['#history-clear', 'text', '清除历史', 'Clear history'],
  ['#generator-close, #backup-password-close, #migration-close, #vault-management-close', 'aria-label', '关闭', 'Close'],
];

function applyLanguage() {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  window.OpenKeyletAppearance.setLanguage(localized);
  $$('.language-switch button').forEach((button) => button.classList.toggle('active', button.dataset.language === language));
  for (const [selector, target, zh, en] of staticCopy) {
    for (const element of $$(selector)) {
      const copy = localized(zh, en);
      if (target === 'text') element.textContent = copy;
      else if (target === 'html') element.innerHTML = copy;
      else if (target === 'aria-label' || target === 'placeholder') element.setAttribute(target, copy);
      else if (target === 'label' || target === 'label-html') {
        const label = element.closest('label')?.querySelector(':scope > span') || element.closest('.field')?.querySelector(':scope > span');
        if (label) target === 'label-html' ? label.innerHTML = copy : label.textContent = copy;
      }
    }
  }
  if (isMacOS) {
    $('[data-module="SYSTEM / 01"] .settings-heading p').textContent = localized(
      '控制 KeyHub 的登录时启动。',
      'Control whether KeyHub launches at login.',
    );
  }
  syncItemTypeFilter();
  syncActivityFilterControl();
  syncSettingsFilterControl();
  syncTitleSearch();
  if (!$('#env-group-composer').classList.contains('hidden')) refreshEnvGroup();
}

function publicMessage(value, fallback = localized('操作失败', 'Operation failed')) {
  const raw = String(value || '').replace(/^Error:\s*/, '');
  if (language !== 'en' || !HAN_TEXT.test(raw)) return raw || fallback;
  return fallback;
}

let settingsWriteQueue = Promise.resolve();

function updateSettings(patch) {
  const operation = settingsWriteQueue.then(() => invoke('update_settings', { patch }));
  settingsWriteQueue = operation.catch(() => {});
  return operation;
}

const api = {
  state: () => invoke('get_state'),
  ownerStatus: () => invoke('owner_status'),
  ownerSetPin: (pin) => invoke('owner_set_pin', { pin }),
  ownerDisablePin: () => invoke('owner_disable_pin'),
  ownerUnlock: (pin) => invoke('owner_unlock', { pin }),
  ownerLock: () => invoke('owner_lock'),
  ownerSecrets: (id) => invoke('owner_secret_view', { id }),
  drafts: () => invoke('owner_editor_drafts'),
  saveDraft: (draftId, input) => invoke('save_editor_draft', { draftId, input }),
  deleteDraft: (id) => invoke('delete_editor_draft', { id }),
  copyOwnerValue: (value) => invoke('copy_owner_value', { value }),
  save: (input) => invoke('save_connection', { input, expectedUpdatedAt: editorExistingItem?.updatedAt || null }),
  reorder: (ids, expectedOrder) => invoke('reorder_connections', { ids, expectedOrder }),
  remove: (id, expectedUpdatedAt) => invoke('delete_connection', { id, expectedUpdatedAt }),
  trash: () => invoke('owner_trash'),
  restore: (id, deletedAt) => invoke('owner_restore_item', { id, deletedAt }),
  purge: (id, deletedAt) => invoke('owner_purge_item', { id, deletedAt }),
  history: (id) => invoke('owner_password_history', { id }),
  clearHistory: (id, expectedUpdatedAt) => invoke('owner_clear_password_history', { id, expectedUpdatedAt }),
  test: (id) => invoke('test_connection', { id }),
  settings: updateSettings,
  systemIntegration: () => invoke('system_integration_status'),
  setDesktopShortcut: (enabled) => invoke('set_desktop_shortcut', { enabled }),
  setLaunchAtLogin: (enabled) => invoke('set_launch_at_login', { enabled }),
  clear: () => invoke('clear_activities'),
  copyConfig: (format) => invoke('copy_mcp_config', { format }),
  agents: () => invoke('agent_mcp_status'),
  registerAgents: (clientIds) => invoke('agent_mcp_register', { clientIds }),
  repairAgent: (clientId) => invoke('agent_mcp_repair', { clientId }),
  removeAgent: (clientId) => invoke('agent_mcp_remove', { clientId }),
  chooseKey: () => invoke('choose_private_key'),
  quickPair: (port) => invoke('quick_pair_browser', { port }),
  resetPair: () => invoke('reset_browser_pairing'),
  extensionFolder: () => invoke('open_browser_extension_folder'),
  exportBackup: (password) => invoke('export_backup', { password }),
  importBackup: (password) => invoke('import_backup', { password }),
  prepareImport: (format) => invoke('prepare_import', { format }),
  commitImport: (id) => invoke('commit_import', { id }),
  cancelImport: () => invoke('cancel_import'),
  dataFolder: () => invoke('open_data_folder'),
  window: (action) => invoke('window_action', { action }),
};

let state;
let systemIntegrationState = { desktopShortcut: false, launchAtLogin: false };
let activePage = 'connections';
let currentActivityFilter = 'all';
const pageSearch = { connections: '', activity: '', settings: '' };
const itemTypeFilterOrder = ['all', 'ssh', 'login', 'api', 'passkey', 'card', 'identity', 'secureNote', 'custom'];
let currentItemTypeFilter = 'all';
let workspaceScope = 'all';
let workspaceFolder = null;
let workspaceSelectedId = null;
const settingsFilterOrder = ['all', 'SYSTEM', 'MCP', 'APP', 'WEB', 'CLOUD', 'SAFE'];
let currentSettingsFilter = 'all';
let titleSearchOpen = false;
let creationMode = 'add';
let currentModules = [];
let editorDrafts = [];
let currentDraftId = '';
let removedSecretFields = new Set();
let editorExistingItem = null;
let editorSourceInput = null;
let editorOpenedFromDraft = false;
let editorInitialSnapshot = '';
let editorReturnFocus = null;
let inlineEditorItemId = null;
let editorOpening = false;
let editorClosing = null;
let editorFoldAnimation = null;
let switchPointerDrag = null;
let switchSelectionPending = false;
let suppressSwitchClick = null;
let itemPointerDrag = null;
let itemOrderSaving = false;
let suppressItemClick = false;
// Keep the editor below its nested dialogs in the original stacking order.
const editorHome = document.createComment('Item editor home');
$('#connection-modal').before(editorHome);
let agentClients = [];
let agentRestartRequired = false;
let renderedConnectionsSignature = '';
const ACTIVITY_PAGE_SIZE = 50;
let activityVisibleCount = ACTIVITY_PAGE_SIZE;
let activityMatchCount = 0;
let activityLoadPending = false;
const expandedActivityErrors = new Set();
let ownerLockState = { pinConfigured: false, unlocked: false, expiresInSeconds: 0 };
let privateReadEpoch = 0;
let ownerStateGeneration = 0;
let ownerPinSetupRequested = false;
let confirmationResolver = null;
let confirmationPreviousFocus = null;
let confirmationInertElements = [];
const githubBackup = window.OpenKeyletGithubBackup.create({
  invoke, localized, toast,
  bindBackdropGesture,
  isUnlocked: () => ownerLockState.unlocked,
  confirmAction: confirmDestructiveAction,
  onRestore: () => refresh(),
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

function cleanError(error) {
  return publicMessage(error?.message || error, localized('未知错误', 'Unknown error'));
}

function normalizeSearch(value = '') {
  return String(value).trim().toLocaleLowerCase('zh-CN');
}

function toast(message, type = '') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.textContent = message;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 3200);
}

function finishConfirmation(accepted, restoreFocus = true) {
  if (!confirmationResolver) return;
  const resolve = confirmationResolver;
  confirmationResolver = null;
  $('#confirmation-modal').classList.add('hidden');
  confirmationInertElements.forEach((element) => { element.inert = false; });
  confirmationInertElements = [];
  if (restoreFocus) {
    let previousFocus = confirmationPreviousFocus;
    if (!previousFocus?.isConnected && previousFocus?.dataset.action && previousFocus?.dataset.id) {
      previousFocus = $$('[data-action][data-id]').find((button) => button.dataset.action === confirmationPreviousFocus.dataset.action && button.dataset.id === confirmationPreviousFocus.dataset.id);
    }
    if (previousFocus?.isConnected && !previousFocus.closest('.hidden')) previousFocus.focus();
    else if ($('#connection-modal').classList.contains('hidden')) $('#add-connection-button').focus();
  }
  confirmationPreviousFocus = null;
  resolve(accepted);
}

function confirmDestructiveAction({ title, message, acceptLabel = localized('删除', 'DELETE'), tag = localized('确认删除', 'CONFIRM DELETION') }) {
  if (confirmationResolver) return Promise.resolve(false);
  finishModulePointerDrag(false);
  $('#confirmation-tag').textContent = tag;
  $('#confirmation-title').textContent = title;
  $('#confirmation-message').textContent = message;
  $('#confirmation-cancel').textContent = localized('取消', 'CANCEL');
  $('#confirmation-accept').textContent = acceptLabel;
  confirmationPreviousFocus = document.activeElement;
  confirmationInertElements = [...document.body.children].filter((element) => element !== $('#confirmation-modal') && !element.inert && !['SCRIPT', 'STYLE'].includes(element.tagName));
  confirmationInertElements.forEach((element) => { element.inert = true; });
  $('#confirmation-modal').classList.remove('hidden');
  requestAnimationFrame(() => { if (confirmationResolver) $('#confirmation-cancel').focus(); });
  return new Promise((resolve) => { confirmationResolver = resolve; });
}

function clearOwnerPlaintext() {
  void finishSwitchDrag(false);
  finishItemPointerDrag(false);
  githubBackup.clearSecrets();
  finishConfirmation(false, false);
  closeEditor();
  currentModules.forEach((module) => { module.secretValue = ''; });
  $$('[data-secret-value]').forEach((input) => {
    input.value = '';
    input.removeAttribute('value');
    if (input.tagName === 'TEXTAREA') input.textContent = '';
  });
  $('#module-list').replaceChildren();
}

function pinInputs(id) {
  return $$(`[data-pin-group="${id}"] .pin-cell-input`);
}

function readPin(id) {
  return pinInputs(id).map((input) => input.value).join('');
}

function clearPin(id) {
  pinInputs(id).forEach((input) => { input.value = ''; });
}

function focusPin(id) {
  const inputs = pinInputs(id);
  (inputs.find((input) => !input.value) || inputs[inputs.length - 1])?.focus();
}

function renderOwnerLock() {
  const configured = ownerLockState.pinConfigured;
  const unlocked = ownerLockState.unlocked;
  const setupRequested = ownerPinSetupRequested && !configured;
  const locked = configured && !unlocked;
  const layerVisible = setupRequested || locked;
  if (!unlocked) closeAgentUsage();
  $('#owner-lock-layer').classList.toggle('hidden', !layerVisible);
  $('#owner-lock-button').classList.toggle('hidden', !configured || !unlocked);
  $('#owner-pin-confirm-field').classList.toggle('hidden', configured);
  $('#owner-pin-cancel').classList.toggle('hidden', !setupRequested);
  pinInputs('owner-pin-confirm').forEach((input) => { input.required = !configured; });
  $('#owner-lock-mode').textContent = configured ? localized('身份验证', 'OWNER VERIFY') : localized('设置本地 PIN', 'SET LOCAL PIN');
  $('#owner-lock-title').textContent = configured
    ? localized('输入六位 PIN', 'ENTER SIX-DIGIT PIN')
    : localized('设置六位 PIN', 'SET SIX-DIGIT PIN');
  $('#owner-lock-code').textContent = configured ? localized('已锁定', 'LOCK') : localized('初始化', 'INIT');
  $('#owner-unlock-action').textContent = configured ? localized('解锁', 'Unlock') : localized('设置 PIN', 'Set PIN');
  if (locked) {
    privateReadEpoch += 1;
    ownerStateGeneration += 1;
    workspaceSelectedId = null;
    if (!$('#vault-management-modal').classList.contains('hidden')) closeVaultManagement();
    if (!$('#migration-modal').classList.contains('hidden')) closeMigration();
    closeGenerator();
    finishBackupPassword(null);
    clearOwnerPlaintext();
    editorDrafts = [];
    renderDrafts();
  }
  clearPin('owner-pin');
  clearPin('owner-pin-confirm');
  if (layerVisible) setTimeout(() => focusPin('owner-pin'), 0);
  if (state) renderConnections();
}

async function refreshOwnerLock(showError = true) {
  const generation = ++ownerStateGeneration;
  const epoch = privateReadEpoch;
  try {
    const status = await api.ownerStatus();
    if (generation !== ownerStateGeneration || epoch !== privateReadEpoch) return;
    ownerLockState = status;
    renderOwnerLock();
  } catch (error) {
    if (showError) toast(cleanError(error), 'error');
  }
}

async function lockOwner() {
  ownerStateGeneration += 1;
  ownerLockState.unlocked = false;
  renderOwnerLock();
  try { await api.ownerLock(); } catch (_) {}
}

async function refresh(showError = true) {
  try {
    state = await api.state();
    try {
      systemIntegrationState = await api.systemIntegration();
    } catch (_) {
      systemIntegrationState = { desktopShortcut: false, launchAtLogin: false };
    }
    language = state.settings.language === 'en' ? 'en' : 'zh';
    await githubBackup.refresh();
    applyLanguage();
    render();
  } catch (error) {
    if (showError) toast(cleanError(error), 'error');
  }
}

function render() {
  renderMetrics();
  renderConnections();
  renderDrafts();
  renderActivity();
  renderSettings();
}

function activityCode(action = '') {
  const value = String(action).toUpperCase();
  if (/BROWSER|浏览器|\bWEB\b/.test(value)) return 'WEB';
  if (/TERMINAL|终端|PTY/.test(value)) return 'TERM';
  if (/SSH/.test(value)) return 'SSH';
  if (/API|HTTP|\bGET\b|\bPOST\b|\bPUT\b|\bPATCH\b|\bDELETE\b/.test(value)) return 'API';
  if (/FILL|填写|填入/.test(value)) return 'FILL';
  if (/TEST|测试|CHECK/.test(value)) return 'CHECK';
  return 'CALL';
}

const workspaceCopy = {
  library: ['密钥库', 'Library'],
  all: ['全部凭据', 'All credentials'], favorites: ['我的收藏', 'Favorites'],
  folders: ['文件夹', 'Folders'], connect: ['Agent 接入', 'Agent connections'],
  connectHelp: ['本地 stdio MCP', 'Local stdio MCP'],
  local: ['本地密码库', 'Local vault'],
  credentials: ['名称', 'Name'], listHelp: ['选择查看详情 · 编辑时访问明文', 'Select to inspect · Edit to access values'],
};

function renderMetrics() {
  const enabled = state.connections.filter(item => item.enabled).length;
  const registered = agentClients.filter(client => client.state === 'registered').length;
  const errors = agentClients.filter(client => ['stale', 'conflict', 'error'].includes(client.state)).length;
  const bridge = state.browserBridge;
  const browserLabel = bridge.status === 'error' ? localized('连接异常', 'Connection error')
    : bridge.connected ? localized('已连接', 'Connected')
    : !bridge.enabled ? localized('已关闭', 'Off')
    : bridge.paired ? localized('等待扩展', 'Waiting for extension') : localized('尚未配对', 'Not paired');
  const summaries = [
    { icon: 'all', value: state.connections.length, label: localized('全部凭据', 'Total credentials'), hint: localized(`${enabled} 项已启用`, `${enabled} enabled`) },
    { icon: 'MCP', value: registered, label: localized('已接入 Agent', 'Connected agents'), hint: errors ? localized(`${errors} 项接入待修复`, `${errors} need repair`) : localized('本地 stdio MCP', 'Local stdio MCP') },
    { icon: 'WEB', value: browserLabel, label: localized('浏览器桥接', 'Browser Bridge'), hint: localized('当前扩展连接状态', 'Current extension connection'), status: true },
    { icon: 'SAFE', value: ownerLockState.pinConfigured ? localized('已设置', 'Configured') : localized('未设置', 'Not configured'), label: localized('本地 PIN', 'Local PIN'), hint: localized('不限制 MCP 使用权限', 'Does not restrict MCP actions'), status: true },
  ];
  $('#metrics').className = 'metric-grid workspace-summary';
  $('#metrics').setAttribute('role', 'status');
  $('#metrics').setAttribute('aria-label', localized('本地状态', 'Local status'));
  $('#metrics').innerHTML = summaries.map(metric => `<div class="workspace-metric" title="${escapeHtml(`${metric.label}: ${metric.value} · ${metric.hint}`)}"><span class="workspace-metric-icon">${itemTypeIcon(metric.icon)}</span><span class="workspace-metric-label">${metric.label}</span><strong class="${metric.status ? 'is-status' : ''}">${metric.value}</strong></div>`).join('');
  renderWorkspaceNavigation();
}

function renderWorkspaceNavigation() {
  document.body.dataset.workspacePage = activePage;
  const headings = {
    connections: [localized('凭据', 'Credentials'), localized('管理保存在此设备的凭据与 Agent 可见性。', 'Manage local credentials and inspect agent visibility.')],
    activity: [localized('使用记录', 'Activity'), localized('查看此设备上的凭据操作记录。', 'Credential operations recorded on this device.')],
    settings: [localized('设置', 'Settings'), localized('管理 Agent 接入、本地访问与备份。', 'Agent connections, local access and backups.')],
  };
  $('#workspace-heading').textContent = headings[activePage][0];
  $('#workspace-description').textContent = headings[activePage][1];
  $('#workspace-breadcrumb-section').textContent = activePage === 'settings' ? localized('应用', 'Application') : localized('密码库', 'Vault');
  $('#workspace-breadcrumb-page').textContent = headings[activePage][0];
  $('.workspace-breadcrumb').setAttribute('aria-label', localized('当前位置', 'Current location'));
  $$('[data-workspace-copy]').forEach(element => { element.textContent = localized(...workspaceCopy[element.dataset.workspaceCopy]); });
  $('#workspace-all-count').textContent = state.connections.length;
  $('#workspace-favorite-count').textContent = state.connections.filter(item => item.favorite).length;
  $$('[data-workspace-filter]').forEach(button => {
    const active = workspaceFolder === null && button.dataset.workspaceFilter === workspaceScope;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const folders = [...new Set(state.connections.map(item => item.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const folderMarkup = folders.length ? folders.map(folder => `<button type="button" class="workspace-scope ${workspaceFolder === folder ? 'active' : ''}" data-workspace-folder="${escapeHtml(folder)}" aria-pressed="${workspaceFolder === folder}"><span>${escapeHtml(folder)}</span><small>${state.connections.filter(item => item.folder === folder).length}</small></button>`).join('')
    : `<p class="workspace-no-folders">${localized('编辑凭据时可添加文件夹', 'Add folders in the credential editor')}</p>`;
  if ($('#workspace-folders').innerHTML !== folderMarkup) $('#workspace-folders').innerHTML = folderMarkup;
  $('.creation-control').classList.toggle('hidden', activePage !== 'connections');
}

function renderWorkspaceDetail(item) {
  const panel = $('#workspace-detail');
  panel.dataset.itemId = item?.id || '';
  panel.hidden = !item || !ownerLockState.unlocked;
  $('.workspace-vault-layout').classList.toggle('without-detail', panel.hidden);
  if (!item || !ownerLockState.unlocked) {
    panel.replaceChildren();
    return;
  }
  const modules = item.modules || [];
  const secrets = modules.filter(module => module.secret || MODULE_DEFS[module.kind]?.secret);
  const visible = secrets.filter(module => module.agentVisible).length;
  const capabilities = itemCapabilities(item);
  const actionLabels = { fill: localized('填写凭据', 'Credential fill'), ssh: 'SSH', http: 'HTTP API', transfer: 'SFTP' };
  panel.innerHTML = `<div class="workspace-detail-top"><span>${localized('凭据详情', 'CREDENTIAL DETAILS')}</span><span class="workspace-detail-state ${item.enabled ? '' : 'is-off'}"><i></i>${item.enabled ? localized('已启用', 'Enabled') : localized('已停用', 'Disabled')}</span></div>
    <div class="workspace-detail-identity"><span class="workspace-detail-icon" data-kind="${itemDisplayKind(item)}">${itemTypeIcon(itemDisplayKind(item))}</span><span class="workspace-detail-type">${escapeHtml(itemDisplayType(item))}${item.favorite ? ' · ★' : ''}</span><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.description || localized('尚未添加公开用途说明', 'No public purpose added.'))}</p></div>
    <dl class="workspace-detail-facts"><div><dt>${localized('文件夹', 'Folder')}</dt><dd>${escapeHtml(item.folder || localized('未分类', 'Unfiled'))}</dd></div><div><dt>${localized('最近更新', 'Updated')}</dt><dd>${item.updatedAt ? escapeHtml(formatTime(item.updatedAt)) : '—'}</dd></div></dl>
    <section class="workspace-detail-section"><h3>${localized('字段与可见性', 'FIELDS & VISIBILITY')}<span>${localized(`${modules.length} 个字段`, `${modules.length} field${modules.length === 1 ? '' : 's'}`)}</span></h3><div class="workspace-detail-modules">${modules.map(module => {
      const secret = module.secret || MODULE_DEFS[module.kind]?.secret !== false;
      const label = module.kind === 'customSecret' || !MODULE_DEFS[module.kind] ? module.name || moduleLabel(module.kind) : moduleLabel(module.kind);
      const missing = module.configured === false || !secret && (!String(module.value ?? '').trim() || module.kind === 'port' && Number(module.value) <= 0);
      const value = missing ? localized('未设置', 'Not set') : secret ? localized('已保存 · 已加密', 'Saved · Encrypted') : String(module.value ?? '');
      return `<div><div class="workspace-field-copy"><span class="workspace-field-label">${escapeHtml(label)}</span><span class="workspace-field-value ${missing ? 'is-missing' : ''}">${escapeHtml(value)}</span></div><small class="${secret && module.agentVisible ? 'is-visible' : ''}">${secret ? module.agentVisible ? localized('Agent 可见', 'Agent visible') : localized('Agent 隐藏', 'Agent hidden') : localized('公开字段', 'Public field')}</small></div>`;
    }).join('') || `<p>${localized('暂无模块', 'No modules')}</p>`}</div></section>
    <section class="workspace-detail-section"><h3>${localized('可用动作', 'AVAILABLE ACTIONS')}</h3><div class="workspace-capabilities">${capabilities.map(capability => `<span>${escapeHtml(actionLabels[capability] || capability)}</span>`).join('') || `<span>${localized('暂无可用动作', 'No available actions')}</span>`}</div>${itemUsageIssue(item) ? `<p class="workspace-action-help">${escapeHtml(itemUsageIssue(item))}</p>` : ''}</section>
    <div class="workspace-visibility-note ${visible ? 'is-warning' : ''}">${itemTypeIcon(visible ? 'error' : 'SAFE')}<p><strong>${visible ? localized(`${visible} 个秘密字段对 Agent 可见`, `${visible} secret fields visible to agents`) : secrets.length ? localized('秘密字段不返回给 Agent', 'Secret fields hidden from agents') : localized('仅展示项目元数据', 'Metadata-only preview')}</strong><span>${localized('隐藏明文不限制可用动作的权限。修改字段需打开编辑器。', 'Hidden values do not restrict available actions. Open the editor to change fields.')}</span></p></div>
    <div class="workspace-detail-actions"><button class="button primary" id="workspace-detail-edit" type="button" data-action="edit" data-id="${escapeHtml(item.id)}">${localized('编辑凭据', 'Edit credential')}</button>${itemOffersAgentUse(item) ? `<button class="button secondary" type="button" data-action="use" data-id="${escapeHtml(item.id)}" ${itemUsageIssue(item) ? 'disabled' : ''}>${localized('Agent 使用', 'Use with agent')}</button>` : ''}</div>`;
  $('.workspace-detail-identity', panel).after($('.workspace-detail-actions', panel));
}

function itemOffersAgentUse(item) {
  return ['ssh', 'api', 'login'].includes(itemDisplayKind(item)) || itemCapabilities(item).length > 0;
}

function itemUsageIssue(item) {
  if (!item.enabled) return localized('此凭据已停用。请编辑凭据，启用并保存后再供 Agent 使用。', 'This credential is disabled. Edit the credential, enable it and save before agent use.');
  if (itemDisplayKind(item) === 'ssh' && !itemCapabilities(item).includes('ssh')) return localized('SSH 认证信息未配置完整。请编辑凭据，检查账号，并保存密码或私钥；主机和端口也可在使用时指定。', 'SSH authentication is incomplete. Edit the credential, check the account, and save a password or private key; the host and port can also be supplied at use time.');
  if (!itemCapabilities(item).length) return localized('凭据已保存，但暂无可用动作。请编辑凭据，补充需要的账号、密码或私钥等信息。', 'Credential saved, but no actions are available. Edit the credential and add the required account, password or private key.');
  return '';
}

let usageReturnFocus = null;
let usageInertElements = [];
function closeAgentUsage() {
  $('#workspace-use-dialog').classList.add('hidden');
  $('#workspace-use-prompt').value = '';
  usageInertElements.forEach(element => { element.inert = false; });
  usageInertElements = [];
  usageReturnFocus?.isConnected && usageReturnFocus.focus({ preventScroll: true });
  usageReturnFocus = null;
}
function openAgentUsage(item, launcher) {
  if (!ownerLockState.unlocked || itemUsageIssue(item)) return;
  usageReturnFocus = launcher;
  $('#workspace-use-title').textContent = localized('通过 Agent 使用凭据', 'Use a credential with your agent');
  $('#workspace-use-help').textContent = localized('复制下方指令，粘贴到已接入 KeyHub 的 Agent，再说明要执行的任务。此处不会连接服务器、执行命令或读取秘密明文。', 'Copy this instruction into an agent connected to KeyHub, then describe your task. This dialog does not connect, execute commands or read secret values.');
  $('#workspace-use-prompt').value = `use ${item.name} in KeyHub MCP`;
  $('#workspace-use-copy').textContent = localized('复制指令', 'Copy instruction');
  $('#workspace-use-close').setAttribute('aria-label', localized('关闭', 'Close'));
  $('#workspace-use-prompt').setAttribute('aria-label', localized('Agent 使用指令', 'Agent instruction'));
  usageInertElements = [...document.body.children].filter(element => element !== $('#workspace-use-dialog') && !element.inert && !['SCRIPT', 'STYLE'].includes(element.tagName));
  usageInertElements.forEach(element => { element.inert = true; });
  $('#workspace-use-dialog').classList.remove('hidden');
  $('#workspace-use-copy').focus();
}

function itemDetail(item) {
  if (['card', 'identity', 'secureNote'].includes(item.itemType)) {
    return [itemTypeLabel(item.itemType), item.folder, localized('字段已加密', 'ENCRYPTED FIELDS')].filter(Boolean).join(' · ');
  }
  if (item.passkeys?.length && !itemCapabilities(item).length) return `PASSKEY · ${item.passkeys.map(k => k.rpId).join(' · ')}`;
  const capabilities = itemCapabilities(item);
  const targets = [];
  if (capabilities.includes('ssh') && item.host) targets.push(`${item.host}:${item.port || 22}`);
  if (capabilities.includes('http') && item.baseUrl) targets.push(item.baseUrl);
  if (targets.length) return targets.join(' · ');
  const count = (item.modules || []).filter((module) => module.secret).length || item.secret?.fields?.length || 0;
  return capabilities.includes('fill')
    ? localized(`${count} 个加密字段`, `${count} encrypted field${count === 1 ? '' : 's'}`)
    : localized('已保存 · 暂无可用动作', 'Saved · No available actions');
}

function itemCapabilities(item) {
  return Array.isArray(item.capabilities) ? item.capabilities : [];
}

function itemMatchesTypeFilter(item, kind) {
  if (kind === 'all') return true;
  if (kind === 'passkey') return Boolean(item.passkeys?.length);
  return itemDisplayKind(item) === kind;
}

function itemDisplayKind(item) {
  if (item.itemType && item.itemType !== 'custom' && ITEM_TYPES[item.itemType]) return item.itemType;
  const capabilities = itemCapabilities(item);
  if (capabilities.includes('ssh')) return 'ssh';
  if (capabilities.includes('http')) return 'api';
  if (item.passkeys?.length) return 'passkey';
  if (item.modules?.some(module => module.kind === 'apiCredential')) return 'api';
  if (item.modules?.some(module => module.kind === 'password')) return 'login';
  return 'custom';
}

function itemFilterLabel(kind) {
  if (kind === 'all') return localized('全部类型', 'All types');
  if (kind === 'login') return localized('密码', 'Password');
  return itemTypeLabel(kind);
}

function itemDisplayType(item) { return itemFilterLabel(itemDisplayKind(item)); }

function itemTypeIcon(kind) {
  const paths = {
    all: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    ssh: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    login: '<circle cx="8" cy="8" r="4.5"/><path d="m11.3 11.3 9.2 9.2m-4-4 2-2m-5-1 2-2"/>',
    api: '<path d="m7 7-5 5 5 5m10-10 5 5-5 5M14 4l-4 16"/>',
    passkey: '<circle cx="8" cy="7" r="3"/><path d="M3 20v-2a5 5 0 0 1 10 0v2m5-5v6m0-3h3"/><circle cx="18" cy="12" r="3"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
    identity: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 17v-1a3 3 0 0 1 6 0v1m3-8h4m-4 4h4m-4 4h2"/>',
    secureNote: '<path d="M5 3h10l4 4v14H5Zm9 0v5h5M8 12h8m-8 4h6"/>',
    custom: '<path d="m12 3 8 4v10l-8 4-8-4V7Zm-8 4 8 4 8-4m-8 4v10"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
    SYSTEM: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-5 0h10"/>',
    MCP: '<path d="M9 3v4m6-4v4M6 7h12v4a6 6 0 0 1-12 0Zm6 10v4"/>',
    APP: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    WEB: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    CLOUD: '<path d="M7 18a5 5 0 1 1 0-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 0 11Z"/>',
    SAFE: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  };
  return `<svg class="item-type-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[kind] || paths.custom}</svg>`;
}

function syncFilterStrip(selector, order, selected, attribute, label, showLabels = false) {
  const control = $(selector);
  if (!control.children.length) {
    control.innerHTML = order.map(kind => `<button type="button" ${attribute}="${kind}">${itemTypeIcon(kind)}${showLabels ? '<span data-filter-label></span>' : ''}</button>`).join('');
  }
  control.style.setProperty('--type-count', order.length);
  control.style.setProperty('--selected-type', order.indexOf(selected));
  $$('button', control).forEach(button => {
    const kind = button.getAttribute(attribute);
    button.setAttribute('aria-pressed', String(kind === selected));
    button.tabIndex = kind === selected ? 0 : -1;
    button.title = label(kind);
    button.setAttribute('aria-label', button.title);
    if (showLabels) $('[data-filter-label]', button).textContent = button.title;
  });
}

function syncItemTypeFilter() {
  $('#item-type-switch').setAttribute('aria-label', localized('项目类型筛选', 'Item type filter'));
  syncFilterStrip('#item-type-switch', itemTypeFilterOrder, currentItemTypeFilter, 'data-item-type-filter', itemFilterLabel, true);
}

function syncSettingsFilterControl() {
  const labels = { all: ['全部设置', 'All settings'], SYSTEM: ['系统入口', 'System access'], MCP: ['Agent 接入', 'Agent setup'], APP: ['窗口与锁定', 'Window & lock'], WEB: ['浏览器', 'Browser'], CLOUD: ['云端备份', 'Cloud backup'], SAFE: ['本地数据', 'Local data'] };
  $('#settings-filter-switch').setAttribute('aria-label', localized('设置分组筛选', 'Settings section filter'));
  syncFilterStrip('#settings-filter-switch', settingsFilterOrder, currentSettingsFilter, 'data-settings-filter', kind => localized(...labels[kind]), true);
}

async function selectFilterButton(button) {
  if (button.dataset.itemTypeFilter) await setItemTypeFilter(button.dataset.itemTypeFilter);
  if (button.dataset.activityFilter) {
    currentActivityFilter = button.dataset.activityFilter;
    activityVisibleCount = ACTIVITY_PAGE_SIZE;
    $('.activity-panel').scrollTop = 0;
    renderActivity();
  }
  if (button.dataset.settingsFilter) {
    currentSettingsFilter = button.dataset.settingsFilter;
    syncSettingsFilterControl();
    applySettingsSearch();
    $('.settings-layout').scrollTop = 0;
  }
}

async function setItemTypeFilter(kind) {
  if (!itemTypeFilterOrder.includes(kind) || kind === currentItemTypeFilter) return;
  const edited = state.connections.find(item => item.id === inlineEditorItemId);
  if (edited && kind !== 'all' && itemDisplayKind(edited) !== kind && !await closeEditorWithDraft()) return;
  currentItemTypeFilter = kind;
  syncItemTypeFilter();
  renderConnections();
}

async function selectPage(page) {
  if (inlineEditorItemId && page !== 'connections' && !await closeEditorWithDraft()) return;
  activePage = page;
  syncTitleSearch();
  $('.nav').dataset.active = page;
  $$('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
    if (item.dataset.page === page) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  $$('.page').forEach(item => item.classList.toggle('active', item.id === `page-${page}`));
  renderMetrics();
  if (page === 'settings') scanAgents();
}

async function selectCreationMode(mode) {
  if (mode === 'draft' && !editorDrafts[0]) return;
  if (!await openEditor(null, mode === 'draft' ? editorDrafts[0] : null)) return;
  creationMode = mode;
  renderDrafts();
}

function moduleAgentVisibilityText(visible) {
  return visible
    ? { label: localized('Agent 可见，点击关闭可见性', 'Agent visible. Click to hide.'), status: localized('Agent 可见', 'AGENT VISIBLE') }
    : { label: localized('Agent 隐藏，点击允许 Agent 查看', 'Hidden from agent. Click to make visible.'), status: localized('Agent 隐藏', 'AGENT HIDDEN') };
}

function setModuleAgentVisibility(button, visible) {
  button.setAttribute('aria-pressed', String(visible));
  const { label, status } = moduleAgentVisibilityText(visible);
  button.setAttribute('aria-label', label);
  button.title = label;
  button.closest('.module-row').querySelector('[data-module-visibility]').textContent = status;
  const caption = button.closest('.module-row').querySelector('[data-module-agent-caption]');
  if (caption) caption.textContent = status;
  syncModuleDraft();
}

// Every travelling cap uses the same drag lifecycle and its existing action.
function switchControlFor(target) {
  const strip = target.closest?.('.filter-strip, .title-switch, .language-switch, .nav, .creation-options, .switch, .module-agent-toggle');
  if (strip?.matches('.nav, .filter-strip')) return null;
  if (!strip || strip.closest('[inert]') || strip.matches(':disabled, [aria-disabled="true"]')) return null;
  if (strip.matches('.title-switch')) {
    return { strip, count: 2, read: () => Number(strip.getAttribute('aria-checked') === 'true'),
      preview: $$('.title-switch-option', strip), focus: () => strip,
      commit: index => window.OpenKeyletAppearance[strip.id === 'theme-toggle' ? 'setTheme' : 'setSound'](Boolean(index)) };
  }
  if (strip.matches('.switch')) {
    const input = $('input', strip);
    if (input.disabled) return null;
    return { strip, count: 2, read: () => Number(input.checked), focus: () => input,
      disabled: () => input.disabled,
      commit: async index => {
        input.checked = Boolean(index);
        if (input.id === 'desktop-shortcut-enabled') await setSystemIntegration('desktop', input.checked);
        else if (input.id === 'launch-at-login-enabled') await setSystemIntegration('startup', input.checked);
        else if (input.id === 'browser-enabled') await saveBrowserSettings();
        else if (input.id === 'pin-enabled') await savePinSettings();
        else if (input.id === 'menu-bar-only-enabled') await saveMenuBarSettings();
      } };
  }
  if (strip.matches('.module-agent-toggle')) {
    return { strip, count: 2, read: () => Number(strip.getAttribute('aria-pressed') === 'true'), focus: () => strip,
      commit: index => setModuleAgentVisibility(strip, Boolean(index)) };
  }
  const buttons = $$('button', strip);
  const read = () => buttons.findIndex(button => strip.matches('.nav, .language-switch') ? button.classList.contains('active') : button.getAttribute('aria-pressed') === 'true');
  return { strip, count: buttons.length, buttons, preview: buttons, read,
    disabled: index => buttons[index]?.disabled,
    focus: () => buttons[read()],
    commit: async index => {
      const button = buttons[index];
      if (strip.matches('.filter-strip')) await selectFilterButton(button);
      else if (strip.matches('.language-switch')) await setLanguage(button.dataset.language);
      else if (strip.matches('.nav')) await selectPage(button.dataset.page);
      else await selectCreationMode(button.id === 'drafts-button' ? 'draft' : 'add');
    } };
}

function moveSwitchThumb(event) {
  const drag = switchPointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dx = event.clientX - drag.startX;
  if (!drag.started && Math.abs(dx) < 4) return;
  if (!drag.started && event.pointerType === 'touch' && Math.abs(event.clientY - drag.startY) > Math.abs(dx)) return;
  event.preventDefault();
  if (!drag.started) {
    drag.started = true;
    drag.strip.classList.add('is-dragging');
    drag.strip.classList.add('has-drag-preview');
    drag.strip.setPointerCapture(event.pointerId);
  }
  const position = Math.max(0, Math.min(drag.count - 1, drag.origin + dx / drag.cellWidth));
  drag.index = Math.round(position);
  drag.strip.style.setProperty('--drag-type', position);
  drag.preview?.forEach((button, index) => button.classList.toggle('is-preview', index === drag.index && !drag.disabled?.(index)));
}

async function finishSwitchDrag(commit) {
  const drag = switchPointerDrag;
  if (!drag) return;
  switchPointerDrag = null;
  if (drag.strip.hasPointerCapture(drag.pointerId)) drag.strip.releasePointerCapture(drag.pointerId);
  drag.strip.classList.remove('is-dragging');
  drag.preview?.forEach(button => button.classList.remove('is-preview'));
  if (drag.started) {
    // Escape may precede pointer release by any duration. Keep ownership of
    // that gesture's click until it arrives or a new pointer gesture starts.
    suppressSwitchClick = drag.strip;
  }
  if (commit && drag.started && drag.index !== drag.read() && !drag.disabled?.(drag.index) && drag.strip.isConnected) {
    switchSelectionPending = true;
    drag.strip.setAttribute('aria-busy', 'true');
    drag.strip.style.setProperty('--drag-type', drag.index);
    try {
      if (titleSearchOpen) setTitleSearchOpen(false, false);
      await drag.commit(drag.index);
      if (drag.read() === drag.index && drag.strip.id !== 'sound-toggle') window.OpenKeyletAppearance.feedback();
    } catch (error) { toast(cleanError(error), 'error'); }
    finally {
      switchSelectionPending = false;
      drag.strip.removeAttribute('aria-busy');
      drag.strip.style.removeProperty('--drag-type');
      drag.strip.classList.remove('has-drag-preview');
      // Opening a drawer or confirmation retains its own focus management.
      if (!confirmationResolver && (drag.strip.contains(document.activeElement) || document.activeElement === document.body)) drag.focus()?.focus({ preventScroll: true });
    }
  } else {
    drag.strip.style.removeProperty('--drag-type');
    drag.strip.classList.remove('has-drag-preview');
  }
}

document.addEventListener('pointerdown', event => {
  suppressSwitchClick = null;
  if (event.button !== 0 || !event.isPrimary || switchPointerDrag || switchSelectionPending || event.ctrlKey || event.metaKey) return;
  const control = switchControlFor(event.target);
  if (!control) return;
  const { strip } = control;
  const button = event.target.closest('button');
  if (button?.disabled) return;
  const style = getComputedStyle(strip);
  const width = strip.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const origin = control.buttons?.includes(button) ? control.buttons.indexOf(button) : control.read();
  const cellWidth = parseFloat(style.getPropertyValue('--switch-travel')) || width / control.count;
  switchPointerDrag = { ...control, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, index: origin, cellWidth, started: false };
});
document.addEventListener('pointermove', moveSwitchThumb, { passive: false });
document.addEventListener('pointerup', event => {
  if (switchPointerDrag?.pointerId === event.pointerId) { moveSwitchThumb(event); void finishSwitchDrag(true); }
});
document.addEventListener('pointercancel', event => { if (switchPointerDrag?.pointerId === event.pointerId) void finishSwitchDrag(false); });
document.addEventListener('lostpointercapture', event => { if (switchPointerDrag?.pointerId === event.pointerId) void finishSwitchDrag(false); });
window.addEventListener('blur', () => { void finishSwitchDrag(false); });
document.addEventListener('click', event => {
  const strip = suppressSwitchClick;
  suppressSwitchClick = null;
  if (!strip || event.detail === 0 || !strip.contains(event.target)) return;
  event.preventDefault(); event.stopImmediatePropagation();
}, true);

function syncTitleSearch() {
  const open = true;
  const labels = { connections: ['搜索项目', 'Search items'], activity: ['搜索记录', 'Search activity'], settings: ['搜索设置', 'Search settings'] };
  const label = localized(...labels[activePage]);
  const control = $('#title-search');
  control.classList.toggle('is-open', open);
  control.classList.toggle('has-query', Boolean(pageSearch[activePage]));
  const input = $('#title-search-input');
  input.hidden = !open;
  input.dataset.pageSearch = activePage;
  input.placeholder = `${label}…`;
  input.setAttribute('aria-label', label);
  if (input.value !== pageSearch[activePage]) input.value = pageSearch[activePage];
  const button = $('#title-search-toggle');
  button.setAttribute('aria-expanded', String(open));
  button.title = label;
  if (pageSearch[activePage] && !open) button.title += localized(' · 筛选中', ' · Filter active');
  button.setAttribute('aria-label', button.title);
}

function setTitleSearchOpen(open, focus = true) {
  titleSearchOpen = open;
  syncTitleSearch();
  if (focus) (open ? $('#title-search-input') : $('#title-search-toggle')).focus({ preventScroll: true });
}

function itemPermission(item) {
  const capabilities = itemCapabilities(item);
  if (capabilities.includes('http')) return 'HTTP';
  if (capabilities.includes('ssh')) return 'SSH';
  return capabilities.includes('fill') ? localized('聚焦填写', 'FOCUS INPUT') : localized('未开放', 'NOT EXPOSED');
}

const activityFilterDefinitions = {
  all: { key: 'A', label: 'ALL' },
  error: { key: 'B', label: 'ERROR' },
  success: { key: 'C', label: 'PASS' },
};
const activityFilterOrder = Object.keys(activityFilterDefinitions);

function syncActivityFilterControl() {
  const labels = { all: ['全部', 'ALL'], error: ['错误', 'ERROR'], success: ['成功', 'PASS'] };
  $('#activity-filter-switch').setAttribute('aria-label', localized('记录结果筛选', 'Activity result filter'));
  syncFilterStrip('#activity-filter-switch', activityFilterOrder, currentActivityFilter, 'data-activity-filter', kind => localized(...labels[kind]), true);
}

function connectionRenderSignature(query) {
  return JSON.stringify([state.connections, query, language, inlineEditorItemId, currentItemTypeFilter, workspaceScope, workspaceFolder, ownerLockState.unlocked]);
}

function renderConnections() {
  if (itemPointerDrag || itemOrderSaving) return;
  const query = normalizeSearch(pageSearch.connections);
  const items = state.connections.filter((item) => {
    if (item.id === inlineEditorItemId) return true;
    if (workspaceFolder !== null && item.folder !== workspaceFolder) return false;
    if (workspaceScope === 'favorites' && !item.favorite) return false;
    if (!itemMatchesTypeFilter(item, currentItemTypeFilter)) return false;
    if (!query) return true;
    const fields = (item.secret?.fields || []).map((field) => field.name).join(' ');
    return normalizeSearch([item.name, item.description, item.folder, itemTypeLabel(item.itemType), itemDisplayType(item), itemCapabilities(item).join(' '), itemDetail(item), itemPermission(item), fields].join(' ')).includes(query);
  });
  if (!items.some(item => item.id === workspaceSelectedId)) workspaceSelectedId = items[0]?.id || null;
  const signature = connectionRenderSignature(query);
  if (signature === renderedConnectionsSignature) {
    if ($('#workspace-detail').dataset.itemId !== (workspaceSelectedId || '')) {
      $$('.connection-card').forEach(card => {
        const selected = card.dataset.itemId === workspaceSelectedId;
        card.classList.toggle('is-selected', selected);
        $('.connection-name', card).setAttribute('aria-pressed', String(selected));
      });
      renderWorkspaceDetail(items.find(item => item.id === workspaceSelectedId));
    }
    return;
  }
  renderedConnectionsSignature = signature;
  const container = $('#connections-list');
  $('.workspace-vault-layout').classList.toggle('is-empty', items.length === 0);
  $('#workspace-result-count').textContent = localized(`${items.length} 项`, `${items.length} items`);
  $('#workspace-scope-label').textContent = workspaceFolder || (workspaceScope === 'favorites' ? localized('我的收藏', 'Favorites') : localized('全部凭据', 'All credentials'));
  renderWorkspaceDetail(items.find(item => item.id === workspaceSelectedId));
  const editor = $('#connection-modal');
  const focusedEditorControl = editor.contains(document.activeElement) ? document.activeElement : null;
  // Preserve the live form (and unsaved values) when language or list data refreshes.
  if (container.contains(editor)) editorHome.after(editor);
  if (inlineEditorItemId && !state.connections.some(item => item.id === inlineEditorItemId)) closeEditor();
  if (!items.length) {
    const hasItems = state.connections.length > 0;
    const hasPasskeys = state.connections.some(item => Boolean(item.passkeys?.length));
    if (currentItemTypeFilter === 'passkey') {
      container.innerHTML = `<div class="empty-state"><div><span class="workspace-empty-icon">${itemTypeIcon('passkey')}</span><h3>${hasPasskeys ? localized('当前范围内没有 Passkey', 'No passkeys in this view') : localized('还没有 Passkey', 'No passkeys yet')}</h3><p>${hasPasskeys ? localized('清除当前搜索或文件夹筛选后重试。', 'Clear the current search or folder filter and try again.') : localized('Passkey 由浏览器扩展在网站注册或登录时创建，并自动出现在 KeyHub；它必须绑定网站域名，不能在桌面端手动生成。也可以从 Bitwarden 导入。', 'Passkeys are created by the browser extension during website registration or sign-in and appear in KeyHub automatically. They must be bound to a website domain and cannot be generated manually in the desktop app. Bitwarden imports are also supported.')}</p>${hasPasskeys ? `<button class="button primary" id="workspace-empty-action" data-action="clear-connection-filters">${localized('清除筛选', 'Clear filters')}</button>` : `<button class="button primary" id="workspace-empty-action" data-workspace-settings="WEB">${localized('查看浏览器接入', 'Browser setup')}</button>`}</div></div>`;
      return;
    }
    container.innerHTML = `<div class="empty-state"><div><span class="workspace-empty-icon">${itemTypeIcon('login')}</span><h3>${hasItems ? localized('没有找到匹配的凭据', 'No matching credentials') : localized('添加第一项凭据', 'Add your first credential')}</h3><p>${hasItems ? localized('试试其他关键词，或清除当前筛选。', 'Try another search, or clear the current filters.') : localized('将 API 密钥、SSH 私钥或登录凭据保存在本机，按需供 Agent 使用。', 'Store an API key, SSH key or login locally for your agents to use.')}</p><button class="button primary" id="workspace-empty-action" data-action="${hasItems ? 'clear-connection-filters' : 'add'}">${hasItems ? localized('清除筛选', 'Clear filters') : localized('＋ 添加凭据', '+ Add credential')}</button></div></div>`;
    return;
  }
  container.innerHTML = items.map((item, index) => {
    const type = itemDisplayType(item);
    const canTest = item.enabled && item.canTest;
    const agentActions = itemOffersAgentUse(item);
    const usageIssue = itemUsageIssue(item);
    const reorderLabel = localized(`${item.name}：拖动排序，或按上/下方向键`, `${item.name}: drag to reorder, or use the Up/Down arrow keys`);
    return `<article class="connection-card ${itemCapabilities(item).includes('ssh') ? 'ssh' : itemCapabilities(item).includes('http') ? 'http' : 'fill'} ${item.enabled ? '' : 'disabled'} ${item.id === workspaceSelectedId ? 'is-selected' : ''}" data-item-id="${escapeHtml(item.id)}">
      <div class="item-disclosure-well"><button class="item-disclosure" type="button" data-action="edit" data-id="${escapeHtml(item.id)}" aria-expanded="false" aria-controls="connection-modal" aria-label="${escapeHtml(localized(`编辑 ${item.name}`, `Edit ${item.name}`))}" title="${localized('编辑凭据', 'Edit credential')}">${localized('编辑', 'Edit')}</button></div>
      <span class="connection-type" role="img" data-item-type="${itemDisplayKind(item)}" aria-label="${escapeHtml(type)}" title="${escapeHtml(type)}">${itemTypeIcon(itemDisplayKind(item))}</span>
      <button class="connection-name" type="button" data-workspace-select="${escapeHtml(item.id)}" aria-pressed="${item.id === workspaceSelectedId}" title="${escapeHtml(item.name)}"><span class="workspace-row-name">${escapeHtml(item.name)}${item.favorite ? `<span class="workspace-row-star" aria-label="${localized('收藏', 'Favorite')}">★</span>` : ''}</span><small>${escapeHtml(itemDetail(item))}</small></button>
      <button class="workspace-reorder" type="button" draggable="false" data-item-reorder="${escapeHtml(item.id)}" aria-label="${escapeHtml(reorderLabel)}" aria-keyshortcuts="ArrowUp ArrowDown Home End" title="${escapeHtml(reorderLabel)}"><svg viewBox="0 0 12 20" aria-hidden="true"><path d="M4 5h.01M8 5h.01M4 10h.01M8 10h.01M4 15h.01M8 15h.01"/></svg></button>
      <div class="card-actions" role="group" aria-label="${escapeHtml(item.name)}">
        <span class="workspace-item-state" data-enabled="${item.enabled}"><i class="status-dot ${item.enabled ? '' : 'off'}" aria-hidden="true"></i>${item.enabled ? localized('已启用', 'Enabled') : localized('已停用', 'Disabled')}</span>
        ${agentActions ? `<button class="small-button workspace-use" type="button" data-action="use" data-id="${escapeHtml(item.id)}" title="${escapeHtml(usageIssue || localized('查看 Agent 使用指令，不会直接执行操作', 'View agent instructions; no action is executed'))}" ${usageIssue ? 'disabled' : ''}>${localized('Agent 使用', 'Use with agent')}</button>` : ''}
      </div>
      <button class="workspace-more" type="button" popovertarget="workspace-more-${index}" aria-expanded="false" aria-controls="workspace-more-${index}" aria-label="${escapeHtml(localized(`${item.name}：更多操作`, `${item.name}: More actions`))}" title="${localized('更多操作', 'More actions')}">···</button>
      <div class="workspace-action-menu" id="workspace-more-${index}" popover="auto" role="group" aria-label="${escapeHtml(localized(`${item.name}的更多操作`, `More actions for ${item.name}`))}">
        ${agentActions ? `<button type="button" data-action="test" data-id="${escapeHtml(item.id)}" ${canTest ? '' : 'disabled'}>${localized('测试连接', 'Test connection')}</button>` : ''}${item.passwordHistoryCount ? `<button type="button" data-action="history" data-id="${escapeHtml(item.id)}">${localized('密码历史', 'Password history')}</button>` : ''}<button class="delete" type="button" data-action="delete" data-id="${escapeHtml(item.id)}">${localized('删除凭据…', 'Delete credential…')}</button>
      </div>
    </article>`;
  }).join('');
  if (inlineEditorItemId) {
    placeItemEditor();
    if (focusedEditorControl?.isConnected) focusedEditorControl.focus({ preventScroll: true });
  }
}

function draftSecretValues(secrets = {}) {
  const named = secrets.namedSecrets || {};
  return {
    ...named,
    password: secrets.password || named.password || '',
    passphrase: secrets.passphrase || named.passphrase || '',
    privateKey: secrets.privateKey || '',
    apiCredential: named.apiCredential || secrets.token || secrets.apiKey || '',
  };
}

function renderDrafts() {
  const button = $('#drafts-button');
  const hasDraft = Boolean(editorDrafts[0]);
  if (!hasDraft) creationMode = 'add';
  $('.creation-control').dataset.mode = creationMode;
  $('#add-connection-button').setAttribute('aria-pressed', String(creationMode === 'add'));
  button.setAttribute('aria-pressed', String(creationMode === 'draft'));
  const deleteButton = $('#delete-draft-button');
  button.disabled = !hasDraft;
  button.textContent = localized('草稿', 'DRAFT');
  button.title = hasDraft ? localized('继续最近的草稿', 'Continue the most recent draft') : localized('暂无草稿', 'No draft');
  deleteButton.classList.toggle('hidden', !hasDraft || creationMode !== 'draft');
  deleteButton.title = localized('删除草稿', 'Delete draft');
}

async function refreshDrafts(showError = false) {
  if (!ownerLockState.unlocked) {
    editorDrafts = [];
    renderDrafts();
    return;
  }
  const epoch = privateReadEpoch;
  try {
    const drafts = await api.drafts();
    if (epoch !== privateReadEpoch || !ownerLockState.unlocked) return;
    editorDrafts = drafts;
    renderDrafts();
  } catch (error) {
    if (showError) toast(cleanError(error), 'error');
  }
}

function formatTime(value) {
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return '—';
  if (diff < 60_000) return localized('刚刚', 'JUST NOW');
  if (diff < 3_600_000) return localized(`${Math.floor(diff / 60_000)} 分钟前`, `${Math.floor(diff / 60_000)} MIN AGO`);
  if (diff < 86_400_000) return localized(`${Math.floor(diff / 3_600_000)} 小时前`, `${Math.floor(diff / 3_600_000)} HR AGO`);
  return new Date(value).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function activityAction(action = '') {
  const raw = String(action);
  if (language !== 'en' || !HAN_TEXT.test(raw)) return raw;
  if (/测试连接/.test(raw)) return 'Test connection';
  if (/重置.*SSH.*主机信任/.test(raw)) return 'Reset SSH host trust';
  if (/导入备份/.test(raw)) return 'Import portable backup';
  if (/填写|填入/.test(raw)) return `Fill secret field (${activityCode(raw)})`;
  return 'KeyHub operation';
}

function activitySource(source = '') {
  if (language === 'en' && HAN_TEXT.test(String(source))) return 'APP';
  if (language === 'zh' && /^(app|gui|browser|terminal|mcp)$/i.test(String(source))) return ({app:'应用',gui:'客户端',browser:'浏览器',terminal:'终端',mcp:'MCP'})[String(source).toLowerCase()];
  return source;
}

function renderActivity() {
  syncActivityFilterControl();
  const container = $('#activity-list');
  const query = normalizeSearch(pageSearch.activity);
  const activities = state.activities.map((activity, sourceIndex) => ({ activity, sourceIndex })).filter(({ activity }) => {
    if (currentActivityFilter !== 'all' && activity.status !== currentActivityFilter) return false;
    return !query || normalizeSearch([activity.action, activity.connectionName, activity.source, activity.status, activity.error].join(' ')).includes(query);
  });
  activityMatchCount = activities.length;
  if (!activities.length) {
    const hasActivity = state.activities.length > 0;
    container.innerHTML = `<div class="empty-state"><div><h3>${hasActivity ? localized('没有匹配记录', 'NO MATCHING ACTIVITY') : localized('暂无操作记录', 'NO ACTIVITY YET')}</h3><p>${hasActivity ? localized('当前搜索或结果筛选没有记录。', 'No activity matches the current search and result filter.') : localized('Agent 使用 KeyHub 后，这里只显示不含秘密的摘要。', 'After an agent uses KeyHub, only secret-free summaries appear here.')}</p>${hasActivity ? `<button class="button primary" data-action="clear-activity-filters">${localized('重置搜索与筛选', 'RESET SEARCH & FILTER')}</button>` : ''}</div></div>`;
    return;
  }
  container.innerHTML = activities.slice(0, activityVisibleCount).map(({ activity, sourceIndex }) => {
    const errorExpanded = expandedActivityErrors.has(activity.id);
    return `<article class="activity-item"><div class="log-index">${String(state.activities.length - sourceIndex).padStart(4, '0')}</div><div class="activity-status ${activity.status === 'error' ? 'error' : ''}">${activity.status === 'error' ? '×' : '✓'}</div><div><div class="activity-title">${escapeHtml(activityAction(activity.action))} · ${escapeHtml(activity.connectionName)}</div><div class="activity-meta">${escapeHtml(activitySource(activity.source))} · ${activity.durationMs} ms</div>${activity.error ? `<button type="button" class="activity-error ${errorExpanded ? 'expanded' : ''}" data-expand-error="${activity.id}" aria-expanded="${errorExpanded}">${escapeHtml(publicMessage(activity.error, localized('操作失败', 'Operation failed. Details are available in the local log.')))}</button>` : ''}</div><time class="activity-time">${formatTime(activity.time)}</time></article>`;
  }).join('');
}

function queueMoreActivities() {
  if (activityLoadPending || activityVisibleCount >= activityMatchCount) return;
  activityLoadPending = true;
  setTimeout(() => {
    activityVisibleCount = Math.min(activityVisibleCount + ACTIVITY_PAGE_SIZE, activityMatchCount);
    renderActivity();
    activityLoadPending = false;
  }, 120);
}

function applySettingsSearch() {
  const query = normalizeSearch(pageSearch.settings);
  let visible = 0;
  for (const card of $$('.settings-card')) {
    const matchesSection = currentSettingsFilter === 'all' || card.dataset.module?.startsWith(`${currentSettingsFilter} /`);
    const matches = matchesSection && (!query || normalizeSearch(`${card.dataset.module || ''} ${card.textContent}`).includes(query));
    card.classList.toggle('search-hidden', !matches);
    if (matches) visible += 1;
  }
  $('#settings-search-empty').classList.toggle('hidden', visible > 0);
}

function renderSettings() {
  githubBackup.render();
  $('#mcp-endpoint').textContent = `${state.mcp.stdioCommand} mcp stdio`;
  const mcpFault = state.mcp.status === 'error';
  const mcpStrip = $('#mcp-status-strip');
  mcpStrip.className = `status-strip ${mcpFault ? 'error' : ''}`;
  mcpStrip.innerHTML = `<span class="status-dot"></span><span class="status-key">${mcpFault ? localized('异常', 'FAULT') : localized('就绪', 'READY')}</span><span>${mcpFault ? escapeHtml(publicMessage(state.mcp.error)) : localized('Agent 使用时自动启动 stdio，无需常驻服务。', 'stdio starts on demand. No background service.')}</span>`;
  $('#agent-restart-notice').classList.toggle('hidden', !agentRestartRequired);
  $('#desktop-shortcut-enabled').checked = Boolean(systemIntegrationState.desktopShortcut);
  $('#launch-at-login-enabled').checked = Boolean(systemIntegrationState.launchAtLogin);
  $('#pin-enabled').checked = ownerLockState.pinConfigured || ownerPinSetupRequested;
  $('#close-behavior').value = state.settings.closeBehavior === 'exit' ? 'exit' : 'tray';
  $('#menu-bar-only-option').hidden = !document.documentElement.classList.contains('platform-macos');
  $('#menu-bar-only-enabled').checked = Boolean(state.settings.menuBarOnly);
  $('#browser-enabled').checked = state.settings.browserEnabled;
  $('#browser-port').value = state.settings.browserPort;
  const bridge = state.browserBridge;
  const online = ['listening', 'delegated'].includes(bridge.status);
  const strip = $('#browser-status-strip');
  strip.className = `status-strip ${bridge.status === 'error' ? 'error' : online ? '' : 'offline'}`;
  strip.innerHTML = `<span class="status-dot"></span><span class="status-key">${bridge.status === 'error' ? localized('异常', 'FAULT') : online ? (bridge.connected ? localized('已连接', 'CONNECTED') : bridge.paired ? localized('等待连接', 'WAITING') : localized('就绪', 'READY')) : localized('已关闭', 'OFF')}</span><span>${bridge.status === 'error' ? escapeHtml(publicMessage(bridge.error)) : online ? escapeHtml(bridge.endpoint) : localized('浏览器桥接已关闭', 'Browser Bridge is off')}</span>`;
  $('#reset-pairing-button').disabled = !bridge.paired;
  renderAgents();
  applySettingsSearch();
}

const agentLabels = { notDetected: ['未找到', 'NOT FOUND'], available: ['就绪', 'READY'], registered: ['已连接', 'CONNECTED'], stale: ['需修复', 'NEEDS REPAIR'], conflict: ['配置冲突', 'CONFLICT'], error: ['错误', 'ERROR'] };
function agentDiagnosticText(value) {
  return String(value || '')
    .replace(/\b(Bearer|Basic)\s+[^\s;,]+/gi, '$1 [REDACTED]')
    .replace(/((?:["']?)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization)(?:["']?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s;,]+)/gi, '$1[REDACTED]')
    .slice(0, 1600);
}
function agentDetectionIssue(client) {
  const message = String(client.message || '').trim();
  if (/Configuration detected, but no callable CLI was found/i.test(message)) return {
    reason: localized('检测到配置，但未找到可调用的命令行程序（CLI）。', 'Configuration found, but no callable CLI was found.'),
    help: localized('安装或恢复此 Agent 的命令行工具，确认终端中可以运行后，点击“重新扫描”。旧配置或失效的快捷链接也会导致此状态。', 'Install or restore this agent’s CLI, confirm it runs in a terminal, then rescan. A leftover configuration or broken launcher link can cause this state.'),
  };
  if (/timed out/i.test(message)) return {
    reason: localized('Agent 命令行检测超时，尚未确认连接状态。', 'Agent CLI detection timed out; connection state is not confirmed.'),
    help: localized('检查命令行工具是否能正常启动，再重新扫描。此状态不代表密钥库或远程服务故障。', 'Check that the CLI starts normally, then rescan. This does not indicate a vault or remote-service failure.'),
  };
  if (/Unable to start Agent CLI/i.test(message)) return {
    reason: localized('找到了命令行程序，但无法启动。', 'The CLI was found but could not be started.'),
    help: localized('检查程序路径、执行权限及运行环境，再重新扫描。', 'Check the executable path, permissions and runtime, then rescan.'),
  };
  if (/Invalid .*configuration|not a table|not an object/i.test(message)) return {
    reason: localized('Agent 配置格式无效，无法读取接入状态。', 'Invalid Agent configuration format (TOML / JSON / JSONC); unable to read connection state.'),
    help: localized('核对下方配置文件的格式，修正后重新扫描。KeyHub 不会在检测时覆盖该配置。', 'Check the configuration file shown below, correct its format, then rescan. Detection does not overwrite this configuration.'),
  };
  return {
    reason: message ? agentDiagnosticText(message) : localized('检测失败，Agent 未返回具体原因。', 'Detection failed; the agent returned no specific reason.'),
    help: localized('查看下方诊断信息，检查命令行工具与配置后重新扫描。', 'Review the diagnostics below, check the CLI and configuration, then rescan.'),
  };
}
function agentDiagnostics(client) {
  if (client.state !== 'error') return '';
  const issue = agentDetectionIssue(client);
  const facts = [
    [localized('诊断消息', 'Diagnostic message'), agentDiagnosticText(client.message) || localized('未返回具体原因', 'No specific reason returned')],
    [localized('配置文件', 'Configuration file'), agentDiagnosticText(client.configPath) || localized('未提供路径', 'Path not provided')],
    [localized('命令行程序', 'CLI executable'), agentDiagnosticText(client.installPath) || localized('未找到可调用的 CLI', 'No callable CLI found')],
  ];
  return `<p class="agent-recovery-help">${escapeHtml(issue.help)}</p><details class="agent-diagnostics"><summary>${localized('诊断详情', 'Diagnostics')}</summary><dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></details>`;
}
function agentDetail(client) {
  if (client.state === 'error') return agentDetectionIssue(client).reason;
  const details = language === 'en'
    ? { notDetected: 'Not installed', available: 'Ready to connect', registered: 'Connected', stale: 'KeyHub setup needs repair', conflict: 'Config conflict', error: 'Detection failed' }
    : { notDetected: '未安装或未发现', available: '可连接', registered: '已连接', stale: 'KeyHub 连接或全局规则需要修复', conflict: '配置冲突', error: '检测失败' };
  return details[client.state] || publicMessage(client.message, localized('状态已更新', 'Status updated'));
}
function renderAgents() {
  const container = $('#agent-client-list');
  container.innerHTML = agentClients.length ? agentClients.map((client) => `<div class="agent-client-row ${client.state === 'notDetected' ? 'is-disabled' : ''}" data-agent-client="${escapeHtml(client.clientId)}"><div class="agent-client-copy"><strong>${escapeHtml(client.displayName)}</strong><span>${escapeHtml(agentDetail(client))}</span>${agentDiagnostics(client)}</div><div class="agent-row-controls"><span class="agent-state ${escapeHtml(client.state)}">${escapeHtml(localized(...(agentLabels[client.state] || ['未知状态', 'Unknown'])))}</span><div class="agent-row-actions">${client.canRegister ? `<button type="button" class="agent-row-action primary" data-agent-action="connect" data-client-id="${escapeHtml(client.clientId)}">${localized('连接', 'CONNECT')}</button>` : ''}${client.canRepair ? `<button type="button" class="agent-row-action primary" data-agent-action="repair" data-client-id="${escapeHtml(client.clientId)}">${localized('修复', 'REPAIR')}</button>` : ''}${client.canRemove ? `<button type="button" class="agent-row-action" data-agent-action="remove" data-client-id="${escapeHtml(client.clientId)}">${localized('移除', 'REMOVE')}</button>` : ''}</div></div></div>`).join('') : `<div class="agent-scan-placeholder">${localized('没有检测到支持的 Agent', 'NO SUPPORTED AGENT DETECTED')}</div>`;
  applySettingsSearch();
}

async function scanAgents(showToast = false) {
  try {
    agentClients = await api.agents();
    renderAgents();
    if (state) renderMetrics();
    if (showToast) toast(localized('Agent 扫描完成', 'Agent scan complete'));
  } catch (error) { toast(cleanError(error), 'error'); }
}

const MODULE_DEFS = {
  cardholderName: { code: 'CHN', zh: '持卡人姓名', en: 'CARDHOLDER', secret: true },
  cardNumber: { code: 'PAN', zh: '卡号', en: 'CARD NUMBER', secret: true },
  cardBrand: { code: 'BRD', zh: '卡组织', en: 'BRAND', secret: true },
  cardExpMonth: { code: 'MM', zh: '到期月份', en: 'EXPIRY MONTH', secret: true },
  cardExpYear: { code: 'YYYY', zh: '到期年份', en: 'EXPIRY YEAR', secret: true },
  cardSecurityCode: { code: 'CVC', zh: '安全码', en: 'SECURITY CODE', secret: true },
  identityTitle: { code: 'TTL', zh: '称谓', en: 'TITLE', secret: true },
  firstName: { code: 'FN', zh: '名字', en: 'FIRST NAME', secret: true },
  middleName: { code: 'MN', zh: '中间名', en: 'MIDDLE NAME', secret: true },
  lastName: { code: 'LN', zh: '姓氏', en: 'LAST NAME', secret: true },
  company: { code: 'ORG', zh: '公司', en: 'COMPANY', secret: true },
  email: { code: 'MAIL', zh: '电子邮箱', en: 'EMAIL', secret: true },
  phone: { code: 'TEL', zh: '电话号码', en: 'PHONE', secret: true },
  address1: { code: 'AD1', zh: '地址第一行', en: 'ADDRESS LINE 1', secret: true },
  address2: { code: 'AD2', zh: '地址第二行', en: 'ADDRESS LINE 2', secret: true },
  address3: { code: 'AD3', zh: '地址第三行', en: 'ADDRESS LINE 3', secret: true },
  city: { code: 'CTY', zh: '城市', en: 'CITY', secret: true },
  state: { code: 'REG', zh: '省 / 州', en: 'STATE / REGION', secret: true },
  postalCode: { code: 'ZIP', zh: '邮政编码', en: 'POSTAL CODE', secret: true },
  country: { code: 'CTR', zh: '国家 / 地区', en: 'COUNTRY / REGION', secret: true },
  passportNumber: { code: 'PPT', zh: '护照号码', en: 'PASSPORT', secret: true },
  licenseNumber: { code: 'DL', zh: '驾照号码', en: 'DRIVER LICENSE', secret: true },
  nationalId: { code: 'ID', zh: '身份证号码', en: 'NATIONAL ID', secret: true },
  secureNote: { code: 'NOTE', zh: '安全笔记', en: 'SECURE NOTE', secret: true, multiline: true },
  username: { code: 'USR', zh: '账号', en: 'USERNAME', secret: true },
  password: { code: 'PWD', zh: '密码', en: 'PASSWORD', secret: true },
  apiCredential: { code: 'API', zh: 'API 凭据', en: 'API CREDENTIAL', secret: true },
  privateKey: { code: 'KEY', zh: '私钥', en: 'PRIVATE KEY', secret: true },
  passphrase: { code: 'PPH', zh: '私钥口令', en: 'KEY PASSPHRASE', secret: true },
  totp: { code: 'OTP', zh: 'TOTP', en: 'TOTP', secret: true },
  customSecret: { code: 'SEC', zh: '自定义字段', en: 'CUSTOM FIELD', secret: true },
  host: { code: 'HST', zh: '主机 / IP', en: 'HOST / IP', secret: false },
  port: { code: 'PRT', zh: '端口', en: 'PORT', secret: false },
  url: { code: 'URL', zh: '服务 URL', en: 'SERVICE URL', secret: false },
};
const PERSONAL_FIELDS = Object.keys(MODULE_DEFS).slice(0, Object.keys(MODULE_DEFS).indexOf('username'));
const ITEM_TYPES = { login: ['登录', 'Login'], card: ['信用卡', 'Card'], identity: ['身份资料', 'Identity'], secureNote: ['安全笔记', 'Secure note'], ssh: ['SSH', 'SSH'], api: ['API', 'API'], custom: ['自定义', 'Custom'], passkey: ['Passkey', 'Passkey'] };
function itemTypeLabel(kind) { const labels = ITEM_TYPES[kind] || ITEM_TYPES.custom; return localized(...labels); }
function typeOptions(emptyLabel, selected, includePasskey = false) {
  return `${emptyLabel ? `<option value="">${emptyLabel}</option>` : ''}${Object.keys(ITEM_TYPES).filter(k => includePasskey || k !== 'passkey').map(k => `<option value="${k}" ${k === selected ? 'selected' : ''}>${itemTypeLabel(k)}</option>`).join('')}`;
}
for (const kind of PERSONAL_FIELDS) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.addModule = kind;
  button.textContent = moduleLabel(kind); $('#module-menu').append(button);
  staticCopy.push([`#module-menu [data-add-module="${kind}"]`, 'text', MODULE_DEFS[kind].zh, MODULE_DEFS[kind].en]);
}

function moduleHasPlaintextReveal(kind) {
  return Boolean(MODULE_DEFS[kind]?.secret);
}

function defaultModuleAgentVisible(kind) {
  return !moduleHasPlaintextReveal(kind);
}

function moduleSecretName(module) {
  return module.kind === 'customSecret' ? String(module.name || '').trim() : MODULE_DEFS[module.kind]?.secret ? module.kind : '';
}

function moduleLabel(kind) {
  const definition = MODULE_DEFS[kind] || MODULE_DEFS.customSecret;
  return language === 'en' ? definition.en : definition.zh;
}

function syncModuleDraft() {
  const rows = $$('.module-row', $('#module-list'));
  if (!rows.length) return;
  currentModules = rows.map((row, index) => {
    row.dataset.moduleIndex = String(index);
    return {
      kind: row.dataset.kind,
      name: $('[data-module-name]', row)?.value ?? row.dataset.name ?? '',
      value: $('[data-module-value]', row)?.value ?? '',
      secretValue: $('[data-secret-value]', row)?.value ?? '',
      configured: row.dataset.configured === 'true',
      existing: row.dataset.existing === 'true',
      privateKeyName: row.dataset.privateKeyName || '',
      pending: row.dataset.pending === 'true',
      agentVisible: $('[data-module-agent-visible]', row)?.getAttribute('aria-pressed') === 'true',
    };
  });
}

function renderModules() {
  finishModulePointerDrag(false);
  const container = $('#module-list');
  if (!currentModules.length) {
    container.innerHTML = `<div class="module-empty"><b>${localized('暂无模块 / 草稿', 'EMPTY / DRAFT')}</b><span>${localized('选择模板或添加任意模块', 'Choose a template or add any module')}</span></div>`;
    syncModuleDraft();
    return;
  }
  container.innerHTML = currentModules.map((module, index) => {
    const definition = MODULE_DEFS[module.kind] || MODULE_DEFS.customSecret;
    const agentVisible = typeof module.agentVisible === 'boolean' ? module.agentVisible : defaultModuleAgentVisible(module.kind);
    const { label: agentVisibilityLabel, status: agentVisibilityStatus } = moduleAgentVisibilityText(agentVisible);
    const secretName = moduleSecretName(module);
    const nameControl = module.kind === 'customSecret'
      ? `<label class="module-name-field"><span>${localized('字段 / 环境变量名', 'FIELD / ENV KEY')}</span><input class="input module-name-input" data-module-name value="${escapeHtml(module.name || '')}" placeholder="DATABASE_URL" aria-label="${localized('字段或环境变量名称', 'Field or environment variable name')}" /></label>`
      : `<strong>${escapeHtml(moduleLabel(module.kind))}</strong>`;
    const secretCaption = '';
    const customName = `${nameControl}<div class="module-metadata">${secretCaption}<span class="module-visibility-state" data-module-visibility aria-hidden="true">${agentVisibilityStatus}</span></div>`;
    let control = '';
    let actions = '';
    if (module.kind === 'privateKey') {
      const keyState = module.pending ? module.privateKeyName : module.configured ? (module.privateKeyName || localized('已导入私钥', 'IMPORTED KEY')) : localized('尚未导入', 'NOT IMPORTED');
      control = `<div class="module-key-control"><span>${escapeHtml(keyState)}</span><button type="button" class="copy-secret-button" data-choose-module-key>${localized('选择文件', 'SELECT')}</button></div>${module.secretValue ? `<div class="secret-input-control module-secret-control multiline module-key-secret"><textarea class="input textarea secret-masked" data-secret-value readonly>${escapeHtml(module.secretValue)}</textarea></div>` : '<input type="hidden" data-secret-value value="" />'}`;
      const keyActionsDisabled = !module.secretValue;
      actions = `${secretActionButton('reveal', true, keyActionsDisabled)}${secretActionButton('copy', true, keyActionsDisabled)}`;
    } else if (definition.secret) {
      const placeholder = module.kind === 'totp' ? localized('Base32 设置密钥', 'BASE32 SETUP KEY') : localized('输入秘密值', 'ENTER SECRET VALUE');
      control = definition.multiline
        ? `<div class="secret-input-control module-secret-control multiline"><textarea class="input textarea secret-masked" data-secret-value rows="6" maxlength="65536" autocomplete="off" placeholder="${placeholder}">${escapeHtml(module.secretValue || '')}</textarea></div>`
        : `<div class="secret-input-control module-secret-control"><input class="input" data-secret-value type="password" autocomplete="off" value="${escapeHtml(module.secretValue || '')}" placeholder="${placeholder}" /></div>`;
      actions = `${secretActionButton('reveal')}${secretActionButton('copy')}`;
      if (module.kind === 'password') control += `<button class="small-button" type="button" data-generate-password>${localized('生成密码', 'GENERATE')}</button>`;
    } else {
      const inputType = module.kind === 'port' ? 'number' : 'text';
      const placeholder = module.kind === 'url' ? 'api.example.com/v1/' : module.kind === 'host' ? 'host.example.com' : '22';
      control = `<input class="input" data-module-value type="${inputType}" ${module.kind === 'port' ? 'min="1" max="65535"' : ''} value="${escapeHtml(module.value || '')}" placeholder="${placeholder}" />`;
      actions = `<span class="module-action-spacer" aria-hidden="true"></span>${secretActionButton('copy', false)}`;
    }
    const removeLabel = localized('删除模块', 'Remove module');
    const reorderLabel = localized('拖动调整顺序，或聚焦后按上/下方向键', 'Drag to reorder, or focus and use the Up/Down arrow keys');
    return `<div class="module-row" data-module-index="${index}" data-kind="${escapeHtml(module.kind)}" data-name="${escapeHtml(module.name || '')}" data-existing="${Boolean(module.existing)}" data-configured="${Boolean(module.configured)}" data-private-key-name="${escapeHtml(module.privateKeyName || '')}" data-pending="${Boolean(module.pending)}"><button type="button" class="module-drag-handle" data-module-drag-handle aria-label="${reorderLabel}" title="${reorderLabel}" aria-keyshortcuts="ArrowUp ArrowDown"><svg viewBox="0 0 12 20" aria-hidden="true"><path d="M4 5h.01M8 5h.01M4 10h.01M8 10h.01M4 15h.01M8 15h.01"/></svg></button><span class="module-agent-control"><button type="button" class="module-agent-toggle" data-module-agent-visible aria-pressed="${agentVisible}" aria-label="${agentVisibilityLabel}" title="${agentVisibilityLabel}"><i aria-hidden="true"></i></button><small class="module-agent-caption" data-module-agent-caption>${agentVisibilityStatus}</small></span><div class="module-identity">${customName}</div><div class="module-control">${control}</div><div class="module-actions ${actions ? 'full' : 'single'}">${actions}<button type="button" class="remove-module module-action-icon" data-remove-module aria-label="${removeLabel}" title="${removeLabel}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M7.5 5.5V3.25h5v2.25M5.25 5.5l.75 11h8l.75-11M8.25 8.5v5M11.75 8.5v5"/></svg></button></div></div>`;
  }).join('');
  syncModuleDraft();
}

function secretActionButton(kind, secret = true, disabled = false) {
  const disabledAttribute = disabled ? ' disabled' : '';
  if (kind === 'reveal') {
    const label = localized('显示明文', 'Show secret');
    return `<button type="button" class="reveal-secret-button secret-icon-button module-action-icon" data-toggle-module-secret aria-pressed="false" aria-label="${label}" title="${label}"${disabledAttribute}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10s2.4-4.75 7-4.75S17 10 17 10s-2.4 4.75-7 4.75S3 10 3 10Z"/><circle cx="10" cy="10" r="2.5"/><path class="secret-icon-slash" d="M3.5 3.5l13 13"/></svg></button>`;
  }
  const label = secret ? localized('复制隐私值', 'Copy private value') : localized('复制值', 'Copy value');
  const attribute = secret ? 'data-copy-module-secret' : 'data-copy-module-value';
  return `<button type="button" class="copy-secret-button secret-icon-button module-action-icon" ${attribute} aria-label="${label}" title="${label}"${disabledAttribute}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10"/><path d="M14 7V3H3v11h4"/></svg></button>`;
}

function positionModuleMenu() {
  const menu = $('#module-menu');
  if (menu.classList.contains('hidden')) return;
  const buttonRect = $('#add-module-button').getBoundingClientRect();
  const gutter = 8;
  const menuWidth = Math.min(276, window.innerWidth - gutter * 2);
  menu.style.width = `${menuWidth}px`;
  menu.style.left = `${Math.round(Math.min(Math.max(gutter, buttonRect.right - menuWidth), window.innerWidth - menuWidth - gutter))}px`;
  menu.style.right = 'auto';
  menu.style.maxHeight = `${window.innerHeight - gutter * 2}px`;
  const menuHeight = Math.min(menu.scrollHeight, window.innerHeight - gutter * 2);
  const below = buttonRect.bottom + 4;
  const top = below + menuHeight <= window.innerHeight - gutter
    ? below
    : Math.max(gutter, buttonRect.top - menuHeight - 4);
  menu.style.top = `${Math.round(top)}px`;
}

function setModuleMenu(open) {
  const menu = $('#module-menu');
  const home = $('#add-module-button').closest('.module-add-wrap');
  if (open) {
    document.body.appendChild(menu);
    menu.classList.remove('hidden');
    positionModuleMenu();
  } else {
    menu.classList.add('hidden');
    home.appendChild(menu);
    menu.removeAttribute('style');
  }
  $('#add-module-button').setAttribute('aria-expanded', String(Boolean(open)));
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_GROUP_LIMIT = 256;

function normalizedSecretName(name) {
  return String(name || '').toLocaleLowerCase().replace(/[\s_-]+/g, '');
}

function envValue(raw) {
  const value = raw.trim();
  if (!value) return '';
  const quote = value[0];
  if (!['"', "'"].includes(quote)) return value;
  if (!value.endsWith(quote) || value.length < 2) throw new Error(localized('引号未闭合', 'Unclosed quote'));
  const inner = value.slice(1, -1);
  return quote === '"'
    ? inner.replace(/\\([nrt\\"])/g, (_, character) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"' })[character])
    : inner;
}

function parseEnvGroup(text) {
  const entries = [];
  const errors = [];
  const seen = new Set();
  String(text || '').split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    let source = line.trim();
    if (!source || source.startsWith('#')) return;
    if (/^export\s+/i.test(source)) source = source.replace(/^export\s+/i, '');
    const separator = source.indexOf('=');
    if (separator < 1) {
      errors.push({ line: lineNumber, code: 'format' });
      return;
    }
    const key = source.slice(0, separator).trim();
    if (!ENV_KEY.test(key)) {
      errors.push({ line: lineNumber, code: 'key', key: key.slice(0, 80) });
      return;
    }
    const normalized = normalizedSecretName(key);
    if (seen.has(normalized)) {
      errors.push({ line: lineNumber, code: 'duplicate', key });
      return;
    }
    seen.add(normalized);
    try {
      entries.push({ line: lineNumber, key, value: envValue(source.slice(separator + 1)) });
    } catch (error) {
      errors.push({ line: lineNumber, code: 'quote', key, message: error.message });
    }
  });
  if (entries.length > ENV_GROUP_LIMIT) errors.push({ line: 0, code: 'limit', count: entries.length });
  return { entries, errors };
}

function envGroupErrorText(error) {
  if (error.code === 'format') return localized(`第 ${error.line} 行缺少 KEY=VALUE 格式`, `Line ${error.line}: expected KEY=VALUE`);
  if (error.code === 'key') return localized(`第 ${error.line} 行的变量名无效：${error.key || '空名称'}`, `Line ${error.line}: invalid variable name: ${error.key || 'empty'}`);
  if (error.code === 'duplicate') return localized(`变量名重复：${error.key}`, `Duplicate variable name: ${error.key}`);
  if (error.code === 'quote') return localized(`第 ${error.line} 行：${error.message}`, `Line ${error.line}: ${error.message}`);
  if (error.code === 'limit') return localized(`一次最多添加 ${ENV_GROUP_LIMIT} 个变量，当前识别到 ${error.count} 个`, `Add at most ${ENV_GROUP_LIMIT} variables at a time; ${error.count} were found`);
  return localized('环境变量格式无效', 'Invalid environment variable format');
}

function envGroupConflict(key) {
  const normalized = normalizedSecretName(key);
  const builtIn = [...Object.keys(MODULE_DEFS).map(kind => kind.toLocaleLowerCase()), 'token', 'apikey'];
  if (builtIn.includes(normalized)) return localized(`变量名与内置字段冲突：${key}`, `Variable name conflicts with a built-in field: ${key}`);
  const existing = currentModules.find(module => module.kind === 'customSecret' && normalizedSecretName(module.name) === normalized);
  return existing ? localized(`变量名已存在：${key}`, `Variable name already exists: ${key}`) : '';
}

function refreshEnvGroup() {
  const parsed = parseEnvGroup($('#env-group-input').value);
  let error = parsed.errors[0] ? envGroupErrorText(parsed.errors[0]) : '';
  if (!error && !parsed.entries.length) error = localized('粘贴至少一个 KEY=VALUE', 'Paste at least one KEY=VALUE');
  if (!error) error = parsed.entries.map(entry => envGroupConflict(entry.key)).find(Boolean) || '';
  const status = $('#env-group-status');
  status.textContent = error || localized(`已识别 ${parsed.entries.length} 个变量`, `${parsed.entries.length} variable${parsed.entries.length === 1 ? '' : 's'} parsed`);
  status.classList.toggle('error', Boolean(error));
  $('#env-group-input').setAttribute('aria-invalid', String(Boolean(error)));
  $('#env-group-add').disabled = Boolean(error);
  $('#env-group-add').textContent = parsed.entries.length && !error
    ? localized(`添加 ${parsed.entries.length} 个变量`, `ADD ${parsed.entries.length} VARIABLE${parsed.entries.length === 1 ? '' : 'S'}`)
    : localized('添加变量', 'ADD VARIABLES');
}

function openEnvGroup() {
  syncModuleDraft();
  setModuleMenu(false);
  $('#template-picker').classList.add('hidden');
  $('#env-group-composer').classList.remove('hidden');
  $('#save-connection-button').disabled = true;
  $('#env-group-input').focus({ preventScroll: false });
  refreshEnvGroup();
}

function closeEnvGroup(restoreFocus = true) {
  const composer = $('#env-group-composer');
  if (composer.classList.contains('hidden')) return;
  composer.classList.add('hidden');
  $('#env-group-input').value = '';
  $('#env-group-input').removeAttribute('aria-invalid');
  $('#env-group-status').textContent = '';
  $('#env-group-status').classList.remove('error');
  $('#env-group-add').disabled = true;
  $('#save-connection-button').disabled = false;
  if (restoreFocus) $('#add-module-button').focus({ preventScroll: true });
}

function addEnvironmentGroup() {
  refreshEnvGroup();
  if ($('#env-group-add').disabled) return;
  const { entries } = parseEnvGroup($('#env-group-input').value);
  syncModuleDraft();
  const conflict = entries.map(entry => envGroupConflict(entry.key)).find(Boolean);
  if (conflict) {
    $('#env-group-status').textContent = conflict;
    $('#env-group-status').classList.add('error');
    return;
  }
  currentModules.push(...entries.map(entry => ({
    kind: 'customSecret', name: entry.key, value: '', secretValue: entry.value,
    configured: false, existing: false, privateKeyName: '', pending: false, agentVisible: false,
  })));
  closeEnvGroup(false);
  renderModules();
  const rows = $$('.module-row[data-kind="customSecret"]');
  const firstAdded = rows.at(-entries.length);
  ($('[data-module-name]', firstAdded) || firstAdded)?.focus({ preventScroll: true });
  toast(localized(`已添加 ${entries.length} 个环境变量`, `${entries.length} environment variable${entries.length === 1 ? '' : 's'} added`));
}

function addModule(kind, options = {}) {
  syncModuleDraft();
  if (kind !== 'customSecret' && currentModules.some((module) => module.kind === kind)) {
    setModuleMenu(false);
    return toast(localized('这个模块已经存在', 'That module already exists'));
  }
  currentModules.push({
    kind,
    name: kind === 'customSecret' ? '' : kind,
    value: kind === 'port' ? '22' : '',
    secretValue: '',
    configured: false,
    existing: false,
    privateKeyName: '',
    pending: false,
    agentVisible: defaultModuleAgentVisible(kind),
    ...options,
  });
  setModuleMenu(false);
  $('#template-picker').classList.add('hidden');
  renderModules();
  const row = $$('.module-row').at(-1);
  ($('[data-module-name]', row) || $('[data-secret-value]', row) || $('[data-module-value]', row))?.focus();
}

function applyTemplate(template) {
  const presets = {
    login: ['url', 'username', 'password'],
    card: ['cardholderName', 'cardNumber', 'cardBrand', 'cardExpMonth', 'cardExpYear', 'cardSecurityCode'],
    identity: ['firstName', 'lastName', 'email', 'phone', 'address1', 'address2', 'city', 'state', 'postalCode', 'country'],
    secureNote: ['secureNote'],
    ssh: ['host', 'port', 'username', 'password'],
    api: ['apiCredential'],
    blank: [],
  };
  if (template === 'env') {
    value('#connection-type', 'custom');
    currentModules = [];
    $('#template-picker').classList.add('hidden');
    renderModules();
    openEnvGroup();
    return;
  }
  value('#connection-type', template === 'blank' ? 'custom' : template);
  currentModules = (presets[template] || []).map((kind) => ({ kind, name: kind, value: kind === 'port' ? '22' : '', secretValue: '', configured: false, existing: false, privateKeyName: '', pending: false, agentVisible: defaultModuleAgentVisible(kind) }));
  $('#template-picker').classList.add('hidden');
  renderModules();
}

function value(selector, next) {
  const element = $(selector);
  if (arguments.length > 1) element.value = next ?? '';
  return element.value;
}

function updateEditorTitle() {
  $('#modal-title').textContent = editorOpenedFromDraft
    ? (editorExistingItem ? localized('继续编辑', 'CONTINUE EDIT') : localized('继续草稿', 'CONTINUE DRAFT'))
    : (editorExistingItem ? localized('编辑项目', 'EDIT ITEM') : localized('添加项目', 'ADD ITEM'));
}

function placeItemEditor() {
  const editor = $('#connection-modal');
  const card = $$('.connection-card').find(card => card.dataset.itemId === inlineEditorItemId);
  if (card) {
    card.appendChild(editor);
    card.classList.add('is-editing');
    const trigger = $('.item-disclosure', card);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-label', localized(`完成编辑 ${editorExistingItem.name}`, `Finish editing ${editorExistingItem.name}`));
    trigger.textContent = localized('完成', 'Done');
    trigger.title = localized('收起编辑并保留未保存修改', 'Close editor and keep unsaved changes');
    editorReturnFocus = trigger;
  } else editorHome.after(editor);
  editor.classList.toggle('inline-editor', Boolean(card));
  editor.setAttribute('role', card ? 'region' : 'dialog');
  if (card) editor.removeAttribute('aria-modal');
  else editor.setAttribute('aria-modal', 'true');
}

async function animateInlineEditor(open) {
  const editor = $('#connection-modal');
  if (!inlineEditorItemId || editor.classList.contains('hidden') || matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  const height = editor.getBoundingClientRect().height;
  editorFoldAnimation?.cancel();
  editor.classList.add('is-folding');
  // Animate the real content height: modules and multiline fields need no cap.
  const animation = editor.animate([
    { height: `${open ? 0 : height}px`, opacity: open ? 0 : 1 },
    { height: `${open ? height : 0}px`, opacity: open ? 1 : 0 },
  ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
  editorFoldAnimation = animation;
  let completed = true;
  try { await animation.finished; } catch (_) { completed = false; }
  if (editorFoldAnimation === animation) {
    animation.cancel();
    editorFoldAnimation = null;
    editor.classList.remove('is-folding');
  }
  return completed;
}

async function openEditor(item = null, draft = null) {
  if (editorOpening || !ownerLockState.unlocked) return false;
  const epoch = privateReadEpoch;
  editorOpening = true;
  try {
    const launcher = document.activeElement;
    const collapseCurrent = inlineEditorItemId && inlineEditorItemId === item?.id && !draft;
    if (!$('#connection-modal').classList.contains('hidden') && !await closeEditorWithDraft()) return false;
    if (epoch !== privateReadEpoch || !ownerLockState.unlocked) return false;
    if (collapseCurrent) return true;
    if (!draft && item) draft = editorDrafts.find((candidate) => candidate.input?.id === item.id) || null;
    if (!item && draft?.input?.id) item = state.connections.find((candidate) => candidate.id === draft.input.id) || null;
    let ownerValues = {};
    if (draft) {
      ownerValues = draftSecretValues(draft.input?.secrets);
    } else if (item) {
      try {
        const view = await api.ownerSecrets(item.id);
        if (epoch !== privateReadEpoch || !ownerLockState.unlocked) return false;
        ownerValues = Object.fromEntries(view.fields.map((field) => [field.name, field.value]));
      } catch (error) {
        toast(cleanError(error), 'error');
        await refreshOwnerLock(false);
        return false;
      }
    }
    const source = draft?.input || item || null;
    removedSecretFields = new Set();
    editorExistingItem = item;
    editorSourceInput = source;
    editorOpenedFromDraft = Boolean(draft);
    currentDraftId = draft?.id || '';
    value('#connection-id', item?.id);
    value('#connection-name', source?.name);
    value('#connection-description', source?.description);
    $('#connection-type').innerHTML = typeOptions('', source?.itemType || 'custom');
    value('#connection-folder', source?.folder);
    renderLoginUris(source?.loginUris || []);
    $('#vault-folder-options').innerHTML = [...new Set(state.connections.map(i => i.folder).filter(Boolean))].map(f => `<option value="${escapeHtml(f)}"></option>`).join('');
    $('#connection-enabled').checked = source?.enabled ?? true;
    updateEditorTitle();
    $('#template-picker').classList.toggle('hidden', Boolean(item || draft?.input?.modules?.length));
    currentModules = (source?.modules || []).map((module) => {
      const secretName = module.kind === 'customSecret' ? module.name : module.kind;
      const privateKeyName = draft?.input?.secrets?.privateKeyName || item?.privateKeyName || '';
      return { ...module, secretValue: ownerValues[secretName] || '', configured: Boolean(module.configured || ownerValues[secretName]), existing: Boolean(item), privateKeyName: module.kind === 'privateKey' ? privateKeyName : '', pending: false, agentVisible: typeof module.agentVisible === 'boolean' ? module.agentVisible : defaultModuleAgentVisible(module.kind) };
    });
    renderModules();
    editorReturnFocus = launcher;
    inlineEditorItemId = item?.id || null;
    if (inlineEditorItemId) renderConnections();
    placeItemEditor();
    $('#connection-modal').classList.remove('hidden');
    $('#passkey-list').innerHTML = (item?.passkeys || []).map(key => `<div class="passkey-summary"><strong>PASSKEY · ${escapeHtml(key.rpId)}</strong><span>${escapeHtml(key.displayName || key.userName)}</span><small>${localized('私钥加密保存在本地；在浏览器中使用。移入回收站会停用 Passkey，恢复后可继续使用。', 'Private key encrypted locally. Moving this item to trash disables its passkeys; restore it to use them again.')}</small></div>`).join('');
    $('.form-scroll', $('#connection-modal')).scrollTop = 0;
    editorInitialSnapshot = JSON.stringify(serializeItem(false));
    void animateInlineEditor(true).then(completed => {
      if (!completed) return;
      requestAnimationFrame(() => {
        if (!$('#workspace-use-dialog').classList.contains('hidden')) return;
        if (!$('#connection-modal').classList.contains('hidden') && editorExistingItem === item) {
          if ($('#connection-modal').contains(document.activeElement)) return;
          if (inlineEditorItemId) $('#connection-name').scrollIntoView({ block: 'nearest' });
          $('#connection-name').focus({ preventScroll: true });
        }
      });
    });
    return true;
  } finally { editorOpening = false; }
}

function closeEditor() {
  editorFoldAnimation?.cancel();
  editorFoldAnimation = null;
  $('#connection-modal').classList.remove('is-folding');
  closeEnvGroup(false);
  finishModulePointerDrag(false);
  $('#connection-modal').classList.add('hidden');
  setModuleMenu(false);
  const card = $$('.connection-card').find(card => card.dataset.itemId === inlineEditorItemId);
  if (card) {
    card.classList.remove('is-editing');
    const trigger = $('.item-disclosure', card);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', localized(`编辑 ${editorExistingItem.name}`, `Edit ${editorExistingItem.name}`));
    trigger.textContent = localized('编辑', 'Edit');
    trigger.title = localized('编辑凭据', 'Edit credential');
    editorReturnFocus = trigger;
  }
  inlineEditorItemId = null;
  placeItemEditor();
  editorSourceInput = null;
  editorOpenedFromDraft = false;
  editorInitialSnapshot = '';
  currentModules = [];
  $('#module-list').replaceChildren();
  if (editorReturnFocus?.isConnected && !editorReturnFocus.closest('.hidden')) editorReturnFocus.focus({ preventScroll: true });
  editorReturnFocus = null;
}

function collectModules(validate = true) {
  syncModuleDraft();
  const modules = [];
  const secrets = { namedSecrets: {} };
  const secretNames = new Set();
  for (const module of currentModules) {
    const name = moduleSecretName(module);
    if (module.kind === 'customSecret') {
      if (validate && !name) throw new Error(localized('请输入字段名称', 'Enter a field name'));
      const normalizedName = name.toLocaleLowerCase().replace(/[\s_-]+/g, '');
      if (validate && [...Object.keys(MODULE_DEFS).map(k => k.toLowerCase()), 'token', 'apikey'].includes(normalizedName)) throw new Error(localized(`字段名与内置模块冲突：${name}`, `Field name conflicts with a built-in module: ${name}`));
    }
    const uniqueName = name.toLocaleLowerCase().replace(/[\s_-]+/g, '');
    if (validate && name && secretNames.has(uniqueName)) throw new Error(localized(`字段名重复：${name}`, `Duplicate field name: ${name}`));
    if (name) secretNames.add(uniqueName);
    modules.push({ kind: module.kind, name: module.kind === 'customSecret' ? name : '', value: MODULE_DEFS[module.kind]?.secret ? '' : String(module.value || '').trim(), agentVisible: Boolean(module.agentVisible) });
    const fieldValue = module.secretValue || '';
    if (name === 'password') secrets.password = fieldValue;
    else if (name === 'passphrase') secrets.passphrase = fieldValue;
    else if (name === 'privateKey') secrets.privateKey = fieldValue;
    else if (name) secrets.namedSecrets[name] = fieldValue;
  }
  return { modules, secrets, privateKeyImportPath: currentModules.some((module) => module.kind === 'privateKey' && module.pending) ? 'pending' : '' };
}

function serializeItem(validate = true) {
  const name = value('#connection-name').trim();
  if (validate && !name) throw new Error(localized('请输入项目名称', 'Enter an item name'));
  const id = value('#connection-id') || null;
  if (validate && state.connections.some((item) => item.id !== id && item.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error(localized('项目名称已存在，请使用其他名称', 'An item with this name already exists'));
  }
  syncModuleDraft();
  if (validate && !currentModules.length) throw new Error(localized('请至少添加一个模块', 'Add at least one module'));
  const collected = collectModules(validate);
  return {
    id,
    itemType: value('#connection-type'),
    folder: value('#connection-folder').trim(),
    favorite: Boolean(editorSourceInput?.favorite),
    loginUris: $$('#login-uri-list .login-uri-row').map(row => ({uri: $('[data-login-uri]', row).value.trim(), matchType: $('[data-login-match]', row).value})).filter(rule => rule.uri),
    modules: collected.modules,
    name,
    description: value('#connection-description'),
    enabled: $('#connection-enabled').checked,
    httpAuthType: editorSourceInput?.httpAuthType || 'auto',
    authHeader: editorSourceInput?.authHeader || '',
    authLocation: editorSourceInput?.authLocation || '',
    authPrefix: editorSourceInput?.authPrefix || '',
    apiAuthHeaders: editorSourceInput?.apiAuthHeaders || [],
    testPath: editorSourceInput?.testPath || '',
    privateKeyImportPath: collected.privateKeyImportPath,
    // A newly entered replacement must not be deleted by the earlier removal.
    removeSecretNames: [...new Set([...removedSecretFields, ...currentModules.filter(m => PERSONAL_FIELDS.includes(m.kind) && m.configured && !m.secretValue).map(moduleSecretName)])].filter((name) => !currentModules.some((module) =>
      moduleSecretName(module) === name && (module.secretValue || module.pending))),
    secrets: collected.secrets,
  };
}

function editorHasDraftContent() {
  syncModuleDraft();
  return Boolean(value('#connection-name').trim() || value('#connection-description').trim() || currentModules.length);
}

function closeEditorWithDraft() {
  if (!$('#env-group-composer').classList.contains('hidden') && $('#env-group-input').value.trim()) {
    refreshEnvGroup();
    toast(localized('请先添加或取消当前环境变量组，再关闭编辑器', 'Add or cancel the current environment variable group before closing the editor.'), 'error');
    $('#env-group-input').focus({ preventScroll: false });
    return Promise.resolve(false);
  }
  closeEnvGroup(false);
  if (editorClosing) return editorClosing;
  editorClosing = saveDraftAndCloseEditor().finally(() => { editorClosing = null; });
  return editorClosing;
}

async function saveDraftAndCloseEditor() {
  try {
    const input = serializeItem(false);
    const changed = JSON.stringify(input) !== editorInitialSnapshot;
    if (!editorHasDraftContent() && !editorExistingItem) {
      if (currentDraftId) await api.deleteDraft(currentDraftId);
    } else if (changed || editorOpenedFromDraft || !editorExistingItem) {
      const saved = await api.saveDraft(currentDraftId || null, input);
      currentDraftId = saved.id;
      toast(editorExistingItem
        ? localized('未保存修改已保留，可随时继续', 'Unsaved changes kept for later')
        : localized('草稿已加密保存', 'Draft saved and encrypted'));
    }
    await refreshDrafts();
    const trigger = $(`.connection-card[data-item-id="${inlineEditorItemId}"] .item-disclosure`);
    trigger?.setAttribute('aria-expanded', 'false');
    await animateInlineEditor(false);
    closeEditor();
    return true;
  } catch (error) {
    toast(cleanError(error), 'error');
    return false;
  }
}

async function saveBrowserSettings() {
  try {
    state.settings = await api.settings({ browserEnabled: $('#browser-enabled').checked, browserPort: Number($('#browser-port').value) });
    toast(localized('Browser Bridge 设置已保存', 'Browser Bridge settings saved'));
    await refresh();
  } catch (error) {
    toast(cleanError(error), 'error');
    await refresh(false);
  }
}

async function saveDesktopSettings() {
  try {
    state.settings = await api.settings({
      closeBehavior: $('#close-behavior').value,
    });
    renderSettings();
    toast(localized('窗口设置已保存', 'Window settings saved'));
  } catch (error) {
    toast(cleanError(error), 'error');
    await refresh(false);
  }
}

async function saveMenuBarSettings() {
  const input = $('#menu-bar-only-enabled');
  input.disabled = true;
  try {
    state.settings = await api.settings({ menuBarOnly: input.checked });
    toast(localized('显示方式已保存', 'Display preference saved'));
  } catch (error) { toast(cleanError(error), 'error'); }
  finally { input.disabled = false; renderSettings(); }
}

async function setSystemIntegration(kind, enabled) {
  const input = kind === 'desktop' ? $('#desktop-shortcut-enabled') : $('#launch-at-login-enabled');
  input.disabled = true;
  try {
    systemIntegrationState = kind === 'desktop'
      ? await api.setDesktopShortcut(enabled)
      : await api.setLaunchAtLogin(enabled);
    renderSettings();
    toast(kind === 'desktop'
      ? (enabled ? localized('桌面快捷方式已创建', 'Desktop shortcut created') : localized('桌面快捷方式已移除', 'Desktop shortcut removed'))
      : (enabled ? localized('开机自启动已开启', 'Launch at login enabled') : localized('开机自启动已关闭', 'Launch at login disabled')));
  } catch (error) {
    input.checked = kind === 'desktop'
      ? Boolean(systemIntegrationState.desktopShortcut)
      : Boolean(systemIntegrationState.launchAtLogin);
    toast(cleanError(error), 'error');
  } finally {
    input.disabled = false;
  }
}

async function savePinSettings() {
  const toggle = $('#pin-enabled');
  if (toggle.checked) {
    ownerPinSetupRequested = true;
    renderOwnerLock();
    return;
  }
  if (!await confirmDestructiveAction({
    title: localized('关闭 PIN 锁？', 'Turn off PIN lock?'),
    message: localized('当前 PIN 将被移除；再次开启时需要设置新 PIN。', 'The current PIN will be removed. You will need to set a new PIN when enabling the lock again.'),
    acceptLabel: localized('关闭并移除', 'TURN OFF'),
    tag: localized('确认移除 PIN', 'CONFIRM PIN REMOVAL'),
  })) {
    toggle.checked = true;
    return;
  }
  toggle.disabled = true;
  const generation = ++ownerStateGeneration;
  const epoch = privateReadEpoch;
  try {
    const status = await api.ownerDisablePin();
    if (generation !== ownerStateGeneration || epoch !== privateReadEpoch) return;
    ownerLockState = status;
    ownerPinSetupRequested = false;
    renderOwnerLock();
    renderMetrics();
    renderSettings();
    toast(localized('PIN 锁已关闭', 'PIN lock disabled'));
  } catch (error) {
    toast(cleanError(error), 'error');
    await refreshOwnerLock(false);
    renderSettings();
  } finally {
    toggle.disabled = false;
  }
}

async function setLanguage(next) {
  const selected = next === 'en' ? 'en' : 'zh';
  if (selected === language) return;
  language = selected;
  applyLanguage();
  if (state) {
    state.settings.language = language;
    renderOwnerLock();
    render();
    syncModuleDraft();
    if (!$('#connection-modal').classList.contains('hidden')) renderModules();
    if (!$('#connection-modal').classList.contains('hidden')) updateEditorTitle();
    try {
      state.settings = await api.settings({ language });
    } catch (error) {
      toast(cleanError(error), 'error');
    }
  }
}

function toastImportSummary(summary) {
  toast(localized(`导入完成：新增 ${summary.added}，合并重复 ${summary.merged}`, `Import complete: ${summary.added} added, ${summary.merged} duplicates merged`));
}

async function exportBackup(button) {
  button.disabled = true;
  try {
    const password = await askBackupPassword(true);
    if (password === null) return;
    const path = await api.exportBackup(password);
    if (path) toast(localized('加密备份已导出；恢复时需要备份密码', 'Encrypted backup exported; keep its password for restoration'));
  } catch (error) {
    toast(cleanError(error), 'error');
  } finally {
    button.disabled = false;
  }
}

async function importBackup(button) {
  button.disabled = true;
  try {
    const password = await askBackupPassword(false);
    if (password === null) return;
    const result = await api.importBackup(password);
    if (!result) return;
    toastImportSummary(result);
    await refresh();
  } catch (error) {
    toast(cleanError(error), 'error');
  } finally {
    button.disabled = false;
  }
}

let vaultManagement = null, vaultManagementSequence = 0;
function closeVaultManagement() {
  vaultManagementSequence++; vaultManagement = null;
  $('#vault-management-modal').classList.add('hidden');
  $('#vault-management-list').replaceChildren();
  $('#history-clear').classList.add('hidden');
}
async function openVaultManagement(mode, id = null) {
  await refreshOwnerLock();
  if (!ownerLockState.unlocked) return;
  const sequence = ++vaultManagementSequence;
  vaultManagement = { mode, id };
  $('#vault-management-title').textContent = mode === 'trash' ? localized('回收站', 'TRASH') : localized('密码历史', 'PASSWORD HISTORY');
  $('#vault-management-help').textContent = mode === 'trash'
    ? localized('已删除项目会保留到你选择永久删除。恢复时如有同名项目，会自动改名。', 'Deleted items remain until you permanently delete them. Restored items are renamed if necessary.')
    : localized('保留最近 20 条旧密码；密码历史不会提供给 Agent 或自动填写。', 'The latest 20 previous passwords are kept. History is unavailable to agents and autofill.');
  $('#vault-management-list').textContent = localized('正在读取…', 'Loading…');
  $('#history-clear').classList.add('hidden');
  $('#vault-management-modal').classList.remove('hidden');
  try {
    const data = mode === 'trash' ? await api.trash() : await api.history(id);
    if (sequence !== vaultManagementSequence) return;
    const list = $('#vault-management-list'); list.replaceChildren();
    const entries = mode === 'trash' ? data : data.entries;
    if (!entries.length) { list.textContent = mode === 'trash' ? localized('回收站为空', 'Trash is empty') : localized('暂无旧密码', 'No previous passwords'); return; }
    if (mode === 'history') { vaultManagement.updatedAt = data.updatedAt; $('#history-clear').classList.remove('hidden'); }
    for (const entry of entries) {
      const row = document.createElement('section'); row.className = 'vault-management-row';
      const title = document.createElement('strong');
      const date = new Date(mode === 'trash' ? entry.deletedAt : entry.changedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en');
      title.textContent = mode === 'trash' ? `${entry.item.name} · ${itemTypeLabel(entry.item.itemType)}` : date;
      const actions = document.createElement('div'); actions.className = 'button-row';
      row.append(title);
      if (mode === 'trash') {
        const subtitle = document.createElement('small'); subtitle.textContent = date; row.append(subtitle);
        for (const action of ['restore','purge']) {
          const button = document.createElement('button'); button.type='button'; button.className = action === 'purge' ? 'button danger-soft' : 'button';
          button.textContent = action === 'restore' ? localized('恢复', 'RESTORE') : localized('永久删除', 'DELETE FOREVER');
          button.dataset.trashAction = action;
          button.onclick = async () => {
            if (action === 'purge' && !await confirmDestructiveAction({title:localized('永久删除此项目？','Permanently delete this item?'),message:localized('本机回收站中的秘密和 Passkey 将被移除，无法撤销。已有备份不会被改动。','The item and its passkeys will be removed from this vault permanently. Existing backups are unchanged.')})) return;
            button.disabled=true;
            try { await api[action](entry.item.id,entry.deletedAt); await refresh(); if (sequence === vaultManagementSequence) await openVaultManagement('trash'); }
            catch(error) { toast(cleanError(error),'error'); button.disabled=false; }
          };
          actions.append(button);
        }
      } else {
        const input=document.createElement('input'); input.className='input'; input.type='password'; input.readOnly=true; input.autocomplete='off'; input.value=entry.password; input.setAttribute('aria-label',localized('旧密码','Previous password'));
        const reveal=document.createElement('button'); reveal.type='button'; reveal.className='button'; reveal.textContent=localized('显示','SHOW');
        reveal.onclick=()=>{ input.type=input.type==='password'?'text':'password'; reveal.textContent=input.type==='password'?localized('显示','SHOW'):localized('隐藏','HIDE'); };
        const copy=document.createElement('button'); copy.type='button'; copy.className='button'; copy.textContent=localized('复制','COPY');
        copy.onclick=async()=>{ try { await api.copyOwnerValue(input.value); toast(localized('已复制','Copied')); } catch(error){toast(cleanError(error),'error');} };
        row.append(input); actions.append(reveal,copy);
      }
      row.append(actions); list.append(row);
    }
  } catch(error) { if (sequence === vaultManagementSequence) $('#vault-management-list').textContent=cleanError(error); }
}
$('#trash-open').onclick = () => openVaultManagement('trash');
$('#vault-management-close').onclick = closeVaultManagement;
$('#history-clear').onclick = async () => {
  const snapshot = vaultManagement;
  if (snapshot?.mode !== 'history' || !await confirmDestructiveAction({title:localized('清除密码历史？','Clear password history?'),message:localized('只清除旧密码，当前密码保持不变。此操作无法撤销。','Previous passwords will be removed permanently. The current password is preserved.')})) return;
  try { await api.clearHistory(snapshot.id,snapshot.updatedAt); await refresh(); if (vaultManagement === snapshot) await openVaultManagement('history',snapshot.id); }
  catch(error){toast(cleanError(error),'error');}
};

function renderLoginUris(rules) {
  const choices = [['origin','同源','Same origin'],['domain','主域名','Base domain'],['host','主机与端口','Host and port'],['exact','完整网址','Exact URL'],['prefix','网址前缀','URL prefix'],['regex','正则表达式','Regular expression'],['never','不匹配','Never']];
  $('#login-uri-list').innerHTML = rules.map(rule => `<div class="login-uri-row"><input class="input" data-login-uri aria-label="${localized('网站地址','Website address')}" value="${escapeHtml(rule.uri)}" maxlength="8192"><select class="input" data-login-match aria-label="${localized('匹配规则','Matching rule')}">${choices.map(([key,zh,en]) => `<option value="${key}" ${rule.matchType===key?'selected':''}>${localized(zh,en)}</option>`).join('')}</select><button class="small-button" data-remove-uri type="button" aria-label="${localized('移除网站','Remove website')}">×</button></div>`).join('');
}
$('#login-uri-add').onclick = () => renderLoginUris([...$$('#login-uri-list .login-uri-row').map(row => ({uri:$('[data-login-uri]',row).value,matchType:$('[data-login-match]',row).value})),{uri:'',matchType:'origin'}]);
$('#login-uri-list').onclick = event => event.target.closest('[data-remove-uri]')?.closest('.login-uri-row').remove();
$('#env-group-input').addEventListener('input', refreshEnvGroup);

let migrationId = null;
let migrationSequence = 0;
const migrationWarnings = {
  nonWebUris: ['非网页地址已保留，设为“不匹配”。','Non-web addresses are preserved with matching disabled.'],
  defaultDomainMatch: ['未指定规则的网址使用主域名匹配；保存的协议和端口必须一致。可在项目内调整。','Unspecified rules use base-domain matching, with matching scheme and port. Edit rules in the item.'],
  unsupportedTotp: ['部分验证码密钥格式尚不支持生成；原始密钥已保留。','Some TOTP formats cannot generate codes yet; their original keys are preserved.'],
  passkeyCounter: ['包含旧版计数型 Passkey。导入后请只在 KeyHub 中使用这些 Passkey，避免另一副本的计数超前。','Includes legacy counter-based passkeys. Use these only in KeyHub after migration to avoid diverging counters.'],
  linkedFields: ['关联字段已作为加密自定义字段保留，暂不自动关联填写。','Linked fields are preserved as encrypted custom fields; automatic linking is unavailable.'],
  passwordHistory: ['最近 20 条旧密码会进入密码历史，更早的记录保留在加密自定义字段中。','The latest 20 previous passwords appear in history; older records are archived in an encrypted custom field.'],
  reprompt: ['原逐项主密码验证设置不生效；本地 PIN 锁仍适用。','Source per-item master-password reprompt settings are not applied; the local PIN lock still applies.'],
  attachments: ['JSON 不含附件文件内容；请从原密码库单独保留附件。','JSON does not contain attachment files. Keep them separately from the source vault.'],
  organization: ['组织项目将成为本地个人项目，不保留共享权限。','Organization items become local personal items without sharing permissions.'],
};
function migrationHelp() {
  $('#migration-help').textContent = $('#migration-format').value === 'bitwarden'
    ? localized('在 Bitwarden 中导出未加密 JSON，然后选择文件预览。原文件不变；导入的秘密会加密存入本地库。', 'Export unencrypted JSON from Bitwarden, then choose the file to preview. The source is unchanged; imported secrets are encrypted locally.')
    : localized('选择 Chrome 或 Edge 导出的密码 CSV。支持带引号、逗号和多行备注的文件。', 'Choose a password CSV exported by Chrome or Edge. Quoted fields, commas and multiline notes are supported.');
}
function resetMigration() {
  migrationSequence++; migrationId = null;
  $('#migration-preview').replaceChildren(); $('#migration-preview').classList.add('hidden');
  $('#migration-confirm').classList.add('hidden');
  $('#migration-error').classList.add('hidden');
}
function closeMigration() {
  resetMigration(); $('#migration-modal').classList.add('hidden');
  api.cancelImport().catch(() => {});
}
$('#migration-open').onclick = async () => {
  await refreshOwnerLock();
  if (!ownerLockState.unlocked) return;
  resetMigration(); migrationHelp(); $('#migration-modal').classList.remove('hidden');
};
$('#migration-close').onclick = closeMigration;
$('#migration-format').onchange = () => { resetMigration(); api.cancelImport().catch(() => {}); migrationHelp(); };
$('#migration-select').onclick = async () => {
  resetMigration(); const sequence = migrationSequence;
  $('#migration-select').disabled = true;
  try {
    const result = await api.prepareImport($('#migration-format').value);
    if (!result || sequence !== migrationSequence) return;
    migrationId = result.id;
    const p = result.preview;
    const lines = [localized(`可导入 ${p.total} 项 · Passkey ${p.passkeys} 个`, `${p.total} items · ${p.passkeys} passkeys`),
      ...Object.entries(p.types).map(([type,count]) => `${itemTypeLabel(type)}: ${count}`),
      ...(p.skippedDeleted ? [localized(`跳过回收站项目 ${p.skippedDeleted} 项`, `Skipped ${p.skippedDeleted} deleted items`)] : []),
      ...p.warnings.map(key => migrationWarnings[key] ? localized(...migrationWarnings[key]) : key)];
    const preview = $('#migration-preview'); preview.replaceChildren(...lines.map(line => {const p = document.createElement('p'); p.textContent=line; return p;}));
    preview.classList.remove('hidden'); $('#migration-confirm').classList.toggle('hidden', p.total === 0);
  } catch(error) {
    if (sequence === migrationSequence) { $('#migration-error').textContent=cleanError(error); $('#migration-error').classList.remove('hidden'); }
  } finally { $('#migration-select').disabled = false; }
};
$('#migration-confirm').onclick = async () => {
  if (!migrationId) return;
  $('#migration-confirm').disabled = true;
  try { const result = await api.commitImport(migrationId); closeMigration(); toastImportSummary(result); await refresh(); }
  catch(error) { $('#migration-error').textContent=cleanError(error); $('#migration-error').classList.remove('hidden'); }
  finally { $('#migration-confirm').disabled = false; }
};

document.addEventListener('click', async (event) => {
  const scopeButton = event.target.closest('[data-workspace-filter], [data-workspace-folder]');
  if (scopeButton) {
    if (inlineEditorItemId && !await closeEditorWithDraft()) return;
    workspaceScope = scopeButton.dataset.workspaceFilter || 'all';
    workspaceFolder = scopeButton.hasAttribute('data-workspace-folder') ? scopeButton.dataset.workspaceFolder : null;
    await selectPage('connections');
    renderConnections();
    $$('[data-workspace-folder]').find(button => button.dataset.workspaceFolder === workspaceFolder)?.focus({ preventScroll: true });
  }
  const workspaceItem = event.target.closest('[data-workspace-select]');
  if (workspaceItem) {
    workspaceSelectedId = workspaceItem.dataset.workspaceSelect;
    $$('.connection-card').forEach(card => {
      const selected = card.dataset.itemId === workspaceSelectedId;
      card.classList.toggle('is-selected', selected);
      $('.connection-name', card).setAttribute('aria-pressed', String(selected));
    });
    renderWorkspaceDetail(state.connections.find(item => item.id === workspaceSelectedId));
    if (event.detail === 2) await openEditor(state.connections.find(item => item.id === workspaceSelectedId));
  }
  const settingsShortcut = event.target.closest('[data-workspace-settings]');
  if (settingsShortcut) {
    if (inlineEditorItemId && !await closeEditorWithDraft()) return;
    currentSettingsFilter = settingsShortcut.dataset.workspaceSettings;
    pageSearch.settings = '';
    await selectPage('settings');
    syncSettingsFilterControl();
    applySettingsSearch();
  }
  if (event.target.closest('#title-search-toggle')) setTitleSearchOpen(!titleSearchOpen);
  else if (titleSearchOpen && !event.target.closest('#title-search')) setTitleSearchOpen(false, false);
  const filterButton = event.target.closest('.filter-strip button');
  if (filterButton && !switchSelectionPending) await selectFilterButton(filterButton);
  const languageButton = event.target.closest('[data-language]');
  if (languageButton) await setLanguage(languageButton.dataset.language);
  const nav = event.target.closest('[data-page]');
  if (nav) await selectPage(nav.dataset.page);
  const windowButton = event.target.closest('[data-window-action]');
  if (windowButton) {
    if (windowButton.dataset.windowAction === 'close' && !$('#connection-modal').classList.contains('hidden')) await closeEditorWithDraft();
    await api.window(windowButton.dataset.windowAction);
    if (windowButton.dataset.windowAction === 'minimize') await refreshOwnerLock(false);
  }
  if (event.target.closest('#owner-lock-button')) {
    if (!$('#connection-modal').classList.contains('hidden')) await closeEditorWithDraft();
    await lockOwner();
  }
  const deleteDraftButton = event.target.closest('#delete-draft-button');
  if (deleteDraftButton && editorDrafts[0]) {
    const draftId = editorDrafts[0].id;
    if (!await confirmDestructiveAction({
      title: localized('删除当前草稿？', 'Delete this draft?'),
      message: localized('草稿中的未保存内容将永久丢失。', 'Unsaved content in this draft will be permanently lost.'),
    })) return;
    try {
      await api.deleteDraft(draftId);
      editorDrafts = editorDrafts.filter((draft) => draft.id !== draftId);
      renderDrafts();
      $('#add-connection-button').focus();
      toast(localized('草稿已删除', 'Draft deleted'));
    } catch (error) { toast(cleanError(error), 'error'); }
    return;
  }
  const draftsButton = event.target.closest('#drafts-button');
  if (draftsButton && editorDrafts[0]) await selectCreationMode('draft');
  const moduleButton = event.target.closest('#add-module-button');
  if (moduleButton) setModuleMenu(moduleButton.getAttribute('aria-expanded') !== 'true');
  else if (!event.target.closest('#module-menu')) setModuleMenu(false);
  const addModuleButton = event.target.closest('[data-add-module]');
  if (addModuleButton) addModule(addModuleButton.dataset.addModule);
  if (event.target.closest('[data-add-env-group]')) openEnvGroup();
  if (event.target.closest('#env-group-close') || event.target.closest('#env-group-cancel')) closeEnvGroup();
  if (event.target.closest('#env-group-add')) addEnvironmentGroup();
  const templateButton = event.target.closest('[data-item-template]');
  if (templateButton) applyTemplate(templateButton.dataset.itemTemplate);
  if (event.target.closest('#add-connection-button') || event.target.closest('[data-action="add"]')) {
    await selectCreationMode('add');
  }
  if (event.target.closest('[data-close-modal]')) await closeEditorWithDraft();
  const copyInput = event.target.closest('[data-copy-input]');
  const copyModule = event.target.closest('[data-copy-module-secret], [data-copy-module-value]');
  if (copyInput || copyModule) {
    const input = copyInput ? $(`#${copyInput.dataset.copyInput}`) : $('[data-secret-value], [data-module-value]', copyModule.closest('.module-row'));
    try { await api.copyOwnerValue(input.value); toast(localized('已复制', 'Copied')); } catch (error) { toast(cleanError(error), 'error'); }
  }
  const toggleModuleSecret = event.target.closest('[data-toggle-module-secret]');
  if (toggleModuleSecret) {
    const field = $('[data-secret-value]', toggleModuleSecret.closest('.module-row'));
    const revealed = toggleModuleSecret.getAttribute('aria-pressed') !== 'true';
    if (field.tagName === 'INPUT') field.type = revealed ? 'text' : 'password';
    else field.classList.toggle('secret-masked', !revealed);
    toggleModuleSecret.setAttribute('aria-pressed', String(revealed));
    const label = revealed ? localized('隐藏明文', 'Hide secret') : localized('显示明文', 'Show secret');
    toggleModuleSecret.setAttribute('aria-label', label);
    toggleModuleSecret.title = label;
  }
  const toggleAgentVisible = event.target.closest('[data-module-agent-visible]');
  if (toggleAgentVisible) setModuleAgentVisibility(toggleAgentVisible, toggleAgentVisible.getAttribute('aria-pressed') !== 'true');
  const chooseModuleKey = event.target.closest('[data-choose-module-key]');
  if (chooseModuleKey) {
    try {
      const name = await api.chooseKey();
      if (name) {
        syncModuleDraft();
        const index = Number(chooseModuleKey.closest('.module-row').dataset.moduleIndex);
        currentModules[index].pending = true;
        currentModules[index].configured = true;
        currentModules[index].privateKeyName = name;
        renderModules();
      }
    } catch (error) { toast(cleanError(error), 'error'); }
  }
  const removeModuleButton = event.target.closest('[data-remove-module]');
  if (removeModuleButton) {
    syncModuleDraft();
    const row = removeModuleButton.closest('.module-row');
    const index = Number(row.dataset.moduleIndex);
    const removed = currentModules[index];
    if (!removed) return;
    const moduleName = removed.kind === 'customSecret' && removed.name.trim() ? removed.name.trim() : moduleLabel(removed.kind);
    if (!await confirmDestructiveAction({
      title: localized(`删除“${moduleName}”模块？`, `Delete the "${moduleName}" module?`),
      message: removed?.existing
        ? localized('保存项目后，该模块及其加密值将永久删除。', 'After you save the item, this module and its encrypted value will be permanently deleted.')
        : localized('该模块中尚未保存的内容将丢失。', 'Unsaved content in this module will be lost.'),
    })) return;
    if (!row.isConnected || $('#connection-modal').classList.contains('hidden')) return;
    if (removed?.existing && moduleSecretName(removed)) removedSecretFields.add(moduleSecretName(removed));
    currentModules.splice(index, 1);
    renderModules();
    const remainingRows = $$('.module-row', $('#module-list'));
    ($('[data-remove-module]', remainingRows[Math.min(index, remainingRows.length - 1)] || $('#module-list')) || $('#add-module-button')).focus();
  }
  const action = event.target.closest('[data-action]');
  const moreMenu = action?.closest('.workspace-action-menu');
  if (moreMenu?.matches(':popover-open')) moreMenu.hidePopover();
  if (action?.dataset.action === 'clear-connection-filters') {
    pageSearch.connections = '';
    currentItemTypeFilter = 'all';
    workspaceScope = 'all'; workspaceFolder = null;
    renderWorkspaceNavigation();
    $('[data-page-search="connections"]').value = '';
    syncItemTypeFilter();
    syncTitleSearch();
    renderConnections();
  }
  if (action?.dataset.action === 'clear-activity-filters') {
    currentActivityFilter = 'all';
    pageSearch.activity = '';
    $('[data-page-search="activity"]').value = '';
    activityVisibleCount = ACTIVITY_PAGE_SIZE;
    renderActivity();
  }
  if (action?.dataset.id) {
    const item = state.connections.find((candidate) => candidate.id === action.dataset.id);
    if (action.dataset.action === 'use') openAgentUsage(item, action);
    if (action.dataset.action === 'edit') await openEditor(item);
    if (action.dataset.action === 'history') await openVaultManagement('history', item.id);
    if (action.dataset.action === 'copy-name') {
      try {
        await api.copyOwnerValue(`use ${item.name} in KeyHub MCP`);
        toast(localized('KeyHub MCP 使用提示已复制', 'KeyHub MCP use prompt copied'));
      } catch (error) { toast(cleanError(error), 'error'); }
    }
    if (action.dataset.action === 'test') {
      try { toast(publicMessage(await api.test(item.id), localized('连接测试完成', 'Connection test complete'))); await refresh(false); } catch (error) { toast(cleanError(error), 'error'); }
    }
    if (action.dataset.action === 'delete' && await confirmDestructiveAction({
      title: localized(`将“${item.name}”移入回收站？`, `Move "${item.name}" to trash?`),
      message: localized('项目将停止用于填写、Passkey 登录和 Agent 操作。你可以在回收站恢复它。', 'The item will stop being available for autofill, passkeys and agents. You can restore it from Trash.'),
      acceptLabel: localized('移入回收站', 'MOVE TO TRASH'),
    })) {
      try { await api.remove(item.id, item.updatedAt); toast(localized('已移入回收站', 'Moved to trash')); await refresh(); $('#add-connection-button').focus(); } catch (error) { toast(cleanError(error), 'error'); }
    }
  }
  const errorDetail = event.target.closest('[data-expand-error]');
  if (errorDetail) {
    const expanded = errorDetail.getAttribute('aria-expanded') === 'true';
    if (expanded) expandedActivityErrors.delete(errorDetail.dataset.expandError);
    else expandedActivityErrors.add(errorDetail.dataset.expandError);
    errorDetail.setAttribute('aria-expanded', String(!expanded));
    errorDetail.classList.toggle('expanded', !expanded);
  }
  const copy = event.target.closest('[data-copy-format]');
  if (copy) {
    try { await api.copyConfig(copy.dataset.copyFormat); toast(localized('stdio 配置已复制', 'stdio configuration copied')); } catch (error) { toast(cleanError(error), 'error'); }
  }
  const agentAction = event.target.closest('[data-agent-action]');
  if (agentAction) {
    const kind = agentAction.dataset.agentAction;
    if (kind === 'remove') {
      const client = agentClients.find((candidate) => candidate.clientId === agentAction.dataset.clientId);
      if (!await confirmDestructiveAction({
        title: localized(`移除 ${client?.displayName || 'Agent'} 的 KeyHub 接入？`, `Remove KeyHub from ${client?.displayName || 'this agent'}?`),
        message: localized('将删除该 Agent 的 KeyHub MCP 配置；之后可以重新连接。', 'This removes the KeyHub MCP configuration from the agent. You can connect it again later.'),
        acceptLabel: localized('移除', 'REMOVE'),
        tag: localized('确认移除接入', 'CONFIRM INTEGRATION REMOVAL'),
      })) return;
    }
    try {
      const result = kind === 'connect'
        ? (await api.registerAgents([agentAction.dataset.clientId]))[0]
        : kind === 'repair'
          ? await api.repairAgent(agentAction.dataset.clientId)
          : await api.removeAgent(agentAction.dataset.clientId);
      if (result?.ok) {
        agentRestartRequired = true;
        $('#agent-restart-notice').classList.remove('hidden');
      }
      toast(result?.ok ? localized('已更新 · 新开 Agent 会话后生效', 'Updated · Open a new agent session to apply') : publicMessage(result?.message), result?.ok ? '' : 'error');
      await scanAgents();
    } catch (error) { toast(cleanError(error), 'error'); }
  }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('.pin-cell-input')) {
    event.target.value = event.target.value.replace(/\D/g, '').slice(-1);
    if (event.target.value) {
      const inputs = $$('.pin-cell-input', event.target.closest('.pin-control'));
      inputs[inputs.indexOf(event.target) + 1]?.focus();
    }
  }
  if (event.target.closest('.module-row')) syncModuleDraft();
  const page = event.target.dataset.pageSearch;
  if (!page) return;
  pageSearch[page] = event.target.value;
  syncTitleSearch();
  if (page === 'connections') renderConnections();
  if (page === 'activity') {
    activityVisibleCount = ACTIVITY_PAGE_SIZE;
    renderActivity();
  }
  if (page === 'settings') applySettingsSearch();
});

const itemList = $('#connections-list');

function visibleItemIds() { return $$('.connection-card', itemList).map(row => row.dataset.itemId); }

async function saveItemOrder(visibleOrder, expectedOrder, focusedId) {
  if (itemOrderSaving) return;
  const visible = new Set(visibleOrder);
  let index = 0;
  // A filtered list rearranges only its own slots, leaving hidden items in place.
  const ids = expectedOrder.map(id => visible.has(id) ? visibleOrder[index++] : id);
  if (ids.every((id, position) => id === expectedOrder[position])) { renderConnections(); return; }
  itemOrderSaving = true;
  itemList.setAttribute('aria-busy', 'true');
  let saved = false;
  try { await api.reorder(ids, expectedOrder); saved = true; }
  catch (error) { toast(cleanError(error), 'error'); }
  finally {
    itemOrderSaving = false;
    renderedConnectionsSignature = '';
    await refresh(false);
    itemList.removeAttribute('aria-busy');
    const handle = $$('[data-item-reorder]', itemList).find(button => button.dataset.itemReorder === focusedId);
    handle?.focus({ preventScroll: true });
    if (saved) {
      handle?.scrollIntoView({ block: 'nearest' });
      const name = state.connections.find(item => item.id === focusedId)?.name || '';
      $('#item-reorder-status').textContent = localized(`${name}：第 ${ids.indexOf(focusedId) + 1} 项，共 ${ids.length} 项`, `${name}: position ${ids.indexOf(focusedId) + 1} of ${ids.length}`);
    }
  }
}

function clearItemDropSeam() {
  $$('.item-drop-before, .item-drop-after', itemList).forEach(row => row.classList.remove('item-drop-before', 'item-drop-after'));
}

function updateItemDropSeam() {
  const drag = itemPointerDrag;
  if (!drag?.started) return;
  clearItemDropSeam();
  const bounds = itemList.getBoundingClientRect();
  drag.valid = drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom;
  drag.preview.style.opacity = drag.valid ? '1' : '.5';
  drag.target = null;
  if (!drag.valid) return;
  const others = $$('.connection-card', itemList).filter(row => row !== drag.row);
  if (!others.length) return;
  const seams = others.map(row => ({ row, after: false, y: row.getBoundingClientRect().top }));
  seams.push({ row: others.at(-1), after: true, y: others.at(-1).getBoundingClientRect().bottom });
  drag.target = seams.reduce((nearest, seam) => Math.abs(drag.y - seam.y) < Math.abs(drag.y - nearest.y) ? seam : nearest);
  drag.target.row.classList.add(drag.target.after ? 'item-drop-after' : 'item-drop-before');
}

function itemDragFrame() {
  const drag = itemPointerDrag;
  if (!drag?.started) return;
  const bounds = itemList.getBoundingClientRect();
  if (drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom) {
    if (drag.y < bounds.top + 32) itemList.scrollTop -= Math.ceil((bounds.top + 32 - drag.y) / 3);
    else if (drag.y > bounds.bottom - 32) itemList.scrollTop += Math.ceil((drag.y - bounds.bottom + 32) / 3);
  }
  updateItemDropSeam();
  const x = Math.max(8, Math.min(drag.x + 14, innerWidth - drag.preview.offsetWidth - 8));
  const y = Math.max(8, Math.min(drag.y + 14, innerHeight - drag.preview.offsetHeight - 8));
  drag.preview.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  drag.frame = requestAnimationFrame(itemDragFrame);
}

function finishItemPointerDrag(commit) {
  const drag = itemPointerDrag;
  if (!drag) return;
  itemPointerDrag = null;
  cancelAnimationFrame(drag.frame);
  try { if (itemList.hasPointerCapture(drag.pointerId)) itemList.releasePointerCapture(drag.pointerId); } catch (_) { /* Already released. */ }
  drag.row.classList.remove('is-item-dragging');
  itemList.classList.remove('is-reordering');
  document.body.classList.remove('item-pointer-dragging');
  drag.preview?.remove();
  clearItemDropSeam();
  if (drag.started) {
    suppressItemClick = true;
    setTimeout(() => { suppressItemClick = false; }, 0);
  }
  if (commit && drag.started && drag.valid && drag.target) {
    const ids = drag.visibleOrder.filter(id => id !== drag.id);
    const position = ids.indexOf(drag.target.row.dataset.itemId) + (drag.target.after ? 1 : 0);
    ids.splice(position, 0, drag.id);
    void saveItemOrder(ids, drag.expectedOrder, drag.id);
  } else renderConnections();
}

itemList.addEventListener('dragstart', event => {
  if (event.target.closest?.('[data-item-reorder]')) event.preventDefault();
});
itemList.addEventListener('pointerdown', event => {
  const handle = event.target.closest?.('[data-item-reorder]');
  if (!handle || event.button !== 0 || !event.isPrimary || event.ctrlKey || event.metaKey || event.shiftKey || itemPointerDrag || itemOrderSaving || confirmationResolver || !ownerLockState.unlocked) return;
  event.preventDefault();
  handle.focus({ preventScroll: true });
  itemPointerDrag = { id: handle.dataset.itemReorder, item: state.connections.find(item => item.id === handle.dataset.itemReorder), row: handle.closest('.connection-card'), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, started: false, visibleOrder: visibleItemIds(), expectedOrder: state.connections.map(item => item.id) };
});
document.addEventListener('pointermove', event => {
  const drag = itemPointerDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX; drag.y = event.clientY;
  if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
  event.preventDefault();
  if (!drag.started) {
    drag.started = true;
    drag.row.classList.add('is-item-dragging');
    itemList.classList.add('is-reordering');
    document.body.classList.add('item-pointer-dragging');
    const item = drag.item;
    drag.preview = document.createElement('div');
    drag.preview.className = 'item-drag-preview';
    drag.preview.setAttribute('aria-hidden', 'true');
    drag.preview.innerHTML = `${itemTypeIcon(itemDisplayKind(item))}<span>${escapeHtml(item.name)}</span>`;
    document.body.appendChild(drag.preview);
    try { itemList.setPointerCapture(event.pointerId); } catch (_) { /* Document tracking remains active. */ }
    itemDragFrame();
  }
  updateItemDropSeam();
}, { passive: false });
document.addEventListener('pointerup', event => {
  if (itemPointerDrag?.pointerId !== event.pointerId) return;
  if (itemPointerDrag.started) { event.preventDefault(); updateItemDropSeam(); }
  finishItemPointerDrag(true);
});
document.addEventListener('pointercancel', event => { if (itemPointerDrag?.pointerId === event.pointerId) finishItemPointerDrag(false); });
itemList.addEventListener('lostpointercapture', event => { if (itemPointerDrag?.pointerId === event.pointerId) finishItemPointerDrag(false); });
window.addEventListener('blur', () => finishItemPointerDrag(false));
document.addEventListener('click', event => {
  if (!suppressItemClick) return;
  suppressItemClick = false;
  event.preventDefault(); event.stopImmediatePropagation();
}, true);
itemList.addEventListener('keydown', event => {
  const handle = event.target.closest?.('[data-item-reorder]');
  if (!handle || itemPointerDrag || itemOrderSaving || confirmationResolver || !ownerLockState.unlocked || event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const ids = visibleItemIds(), id = handle.dataset.itemReorder, from = ids.indexOf(id);
  const to = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : Math.max(0, Math.min(ids.length - 1, from + (event.key === 'ArrowUp' ? -1 : 1)));
  ids.splice(from, 1); ids.splice(to, 0, id);
  void saveItemOrder(ids, state.connections.map(item => item.id), id);
});

let draggedModuleRow = null;
let moduleDropTarget = null;
let moduleDropAfter = false;
let moduleDragPreview = null;
let modulePointerDrag = null;
let suppressModuleClick = false;
const moduleList = $('#module-list');
function clearModuleDropSeam() {
  $$('.module-row.drop-before, .module-row.drop-after', moduleList).forEach((row) => row.classList.remove('drop-before', 'drop-after'));
  moduleDropTarget = null;
  moduleDropAfter = false;
}

function beginModulePointerDrag(event) {
  draggedModuleRow = modulePointerDrag.row;
  draggedModuleRow.classList.add('is-dragging');
  moduleList.classList.add('is-sorting');
  document.body.classList.add('module-pointer-dragging');
  const definition = MODULE_DEFS[draggedModuleRow.dataset.kind] || MODULE_DEFS.customSecret;
  moduleDragPreview = document.createElement('div');
  moduleDragPreview.className = 'module-drag-preview';
  moduleDragPreview.innerHTML = `<b>${escapeHtml(definition.code)}</b><span>${escapeHtml(moduleLabel(draggedModuleRow.dataset.kind))}</span>`;
  document.body.appendChild(moduleDragPreview);
  modulePointerDrag.started = true;
  try { draggedModuleRow.setPointerCapture(event.pointerId); } catch (_) { /* document tracking remains active */ }
}

function updateModuleDropSeam(clientY) {
  clearModuleDropSeam();
  const rows = $$('.module-row', moduleList);
  if (!rows.length) return;
  const seams = rows.map((row) => ({ row, after: false, y: row.getBoundingClientRect().top }));
  const lastRow = rows.at(-1);
  seams.push({ row: lastRow, after: true, y: lastRow.getBoundingClientRect().bottom });
  const closest = seams.reduce((best, seam) => Math.abs(clientY - seam.y) < Math.abs(clientY - best.y) ? seam : best);
  moduleDropTarget = closest.row;
  moduleDropAfter = closest.after;
  moduleDropTarget.classList.add(moduleDropAfter ? 'drop-after' : 'drop-before');
}

function positionModuleDragPreview(clientX, clientY) {
  if (moduleDragPreview) moduleDragPreview.style.transform = `translate3d(${Math.round(clientX + 14)}px, ${Math.round(clientY + 14)}px, 0)`;
}

function autoScrollModuleEditor(clientY) {
  const scroller = inlineEditorItemId ? $('#connections-list') : $('.form-scroll', $('#connection-modal'));
  if (!scroller) return;
  const bounds = scroller.getBoundingClientRect();
  if (clientY < bounds.top + 34) scroller.scrollTop -= 12;
  else if (clientY > bounds.bottom - 34) scroller.scrollTop += 12;
}

function finishModulePointerDrag(commit) {
  if (!modulePointerDrag) return;
  const { row, pointerId, started } = modulePointerDrag;
  if (started && commit && moduleDropTarget) {
    moduleList.insertBefore(row, moduleDropAfter ? moduleDropTarget.nextElementSibling : moduleDropTarget);
  }
  try { if (row.hasPointerCapture(pointerId)) row.releasePointerCapture(pointerId); } catch (_) { /* capture may already be released */ }
  row.classList.remove('is-dragging');
  moduleList.classList.remove('is-sorting');
  document.body.classList.remove('module-pointer-dragging');
  moduleDragPreview?.remove();
  moduleDragPreview = null;
  draggedModuleRow = null;
  modulePointerDrag = null;
  clearModuleDropSeam();
  if (started && commit) {
    syncModuleDraft();
    $('[data-module-drag-handle]', row)?.focus({ preventScroll: true });
    announceModuleOrder(row);
  }
}

function announceModuleOrder(row) {
  const rows = $$('.module-row', moduleList);
  const name = $('[data-module-name]', row)?.value.trim() || moduleLabel(row.dataset.kind);
  const position = rows.indexOf(row) + 1;
  $('#module-reorder-status').textContent = localized(`${name}：第 ${position} 项，共 ${rows.length} 项`, `${name}: position ${position} of ${rows.length}`);
}

moduleList.addEventListener('dragstart', (event) => {
  if (event.target.closest?.('[data-module-drag-handle]')) event.preventDefault();
});
moduleList.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary || confirmationResolver) return;
  const handle = event.target.closest?.('[data-module-drag-handle]');
  const row = handle?.closest('.module-row');
  if (!row || modulePointerDrag) return;
  event.preventDefault();
  handle.focus({ preventScroll: true });
  modulePointerDrag = { row, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false };
});
moduleList.addEventListener('keydown', (event) => {
  const handle = event.target.closest?.('[data-module-drag-handle]');
  if (!handle || confirmationResolver || modulePointerDrag || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const row = handle.closest('.module-row');
  const sibling = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  moduleList.insertBefore(row, event.key === 'ArrowUp' ? sibling : sibling.nextElementSibling);
  syncModuleDraft();
  handle.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
  announceModuleOrder(row);
});
document.addEventListener('pointermove', (event) => {
  if (!modulePointerDrag || event.pointerId !== modulePointerDrag.pointerId) return;
  if (!modulePointerDrag.started && Math.hypot(event.clientX - modulePointerDrag.startX, event.clientY - modulePointerDrag.startY) < 6) return;
  if (!modulePointerDrag.started) beginModulePointerDrag(event);
  event.preventDefault();
  autoScrollModuleEditor(event.clientY);
  updateModuleDropSeam(event.clientY);
  positionModuleDragPreview(event.clientX, event.clientY);
}, { passive: false });
document.addEventListener('pointerup', (event) => {
  if (!modulePointerDrag || event.pointerId !== modulePointerDrag.pointerId) return;
  if (modulePointerDrag.started) {
    event.preventDefault();
    suppressModuleClick = true;
    setTimeout(() => { suppressModuleClick = false; }, 0);
  }
  finishModulePointerDrag(true);
});
document.addEventListener('pointercancel', (event) => {
  if (modulePointerDrag?.pointerId === event.pointerId) finishModulePointerDrag(false);
});
document.addEventListener('click', (event) => {
  if (!suppressModuleClick) return;
  suppressModuleClick = false;
  if (event.target.closest?.('.module-row')) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
window.addEventListener('blur', () => {
  if (modulePointerDrag) finishModulePointerDrag(false);
});

document.addEventListener('paste', (event) => {
  if (!event.target.matches('.pin-cell-input')) return;
  const digits = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6) || '';
  if (!digits) return;
  event.preventDefault();
  const inputs = $$('.pin-cell-input', event.target.closest('.pin-control'));
  inputs.forEach((input, index) => { input.value = digits[index] || ''; });
  (inputs[Math.min(digits.length, inputs.length) - 1] || inputs[0])?.focus();
});

document.addEventListener('keydown', (event) => {
  if (!$('#env-group-composer').classList.contains('hidden')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeEnvGroup();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && event.target === $('#env-group-input')) {
      event.preventDefault();
      addEnvironmentGroup();
      return;
    }
  }
  if (!$('#workspace-use-dialog').classList.contains('hidden')) {
    if (event.key === 'Escape') { event.preventDefault(); closeAgentUsage(); }
    if (event.key === 'Tab') {
      const controls = $$('#workspace-use-dialog button, #workspace-use-dialog textarea');
      const index = controls.indexOf(document.activeElement);
      event.preventDefault();
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }
    return;
  }
  const menuTrigger = event.target.closest('.workspace-more');
  const triggeredMenu = menuTrigger && document.getElementById(menuTrigger.getAttribute('aria-controls'));
  const menu = event.target.closest('.workspace-action-menu') || (triggeredMenu?.matches(':popover-open') ? triggeredMenu : null);
  if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'].includes(event.key)) {
    const trigger = menu.closest('.connection-card').querySelector('.workspace-more');
    if (event.key === 'Escape' || event.key === 'Tab') { menu.hidePopover(); trigger.focus(); if (event.key === 'Escape') event.preventDefault(); }
    else {
      event.preventDefault();
      const controls = $$('button:not(:disabled)', menu), index = controls.indexOf(document.activeElement);
      controls[event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + controls.length) % controls.length]?.focus();
    }
    return;
  }
  if (event.key === 'Escape' && switchPointerDrag) {
    event.preventDefault(); void finishSwitchDrag(false); return;
  }
  if (event.key === 'Escape' && itemPointerDrag) {
    event.preventDefault(); finishItemPointerDrag(false); return;
  }
  if (confirmationResolver) {
    if (event.key === 'Escape') {
      event.preventDefault();
      finishConfirmation(false);
      return;
    }
    if (event.key === 'Tab') {
      const buttons = [$('#confirmation-cancel'), $('#confirmation-accept')];
      const index = buttons.indexOf(document.activeElement);
      event.preventDefault();
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
    return;
  }
  if (event.key === 'Escape' && modulePointerDrag) {
    event.preventDefault();
    finishModulePointerDrag(false);
    return;
  }
  if (event.key === 'Escape' && vaultManagement) {
    event.preventDefault();
    closeVaultManagement();
    return;
  }
  // Like Bricktone's WorkspaceDialog, keep keyboard navigation in the editor.
  // Nested dialogs keep their own keyboard handling and draft saving stays intact.
  const editor = $('#connection-modal');
  const editorIsTopmost = !editor.classList.contains('hidden') &&
    !$$('.modal-backdrop:not(.hidden)').some(modal => modal !== editor);
  const editorOwnsKey = !inlineEditorItemId || event.key === 'Escape' && (editor.contains(event.target) || $('#module-menu').contains(event.target));
  if (editorIsTopmost && editorOwnsKey && ['Tab', 'Escape'].includes(event.key) && !event.defaultPrevented) {
    const menu = $('#module-menu');
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!menu.classList.contains('hidden')) { setModuleMenu(false); $('#add-module-button').focus(); }
      else void closeEditorWithDraft();
      return;
    }
    const selector = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]';
    const controls = [...$$(selector, editor), ...(!editor.contains(menu) && !menu.classList.contains('hidden') ? $$(selector, menu) : [])]
      .filter(control => control.getClientRects().length && !control.closest('[inert], .hidden'));
    const first = controls[0], last = controls.at(-1);
    if (first && (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement)) ||
      !event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement)))) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
  if (event.target.closest('.creation-options') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const button = $(event.key === 'ArrowLeft' ? '#add-connection-button' : '#drafts-button');
    if (!button.disabled) { button.focus(); button.click(); }
    return;
  }
  if (event.target.matches('.pin-cell-input')) {
    const inputs = $$('.pin-cell-input', event.target.closest('.pin-control'));
    const index = inputs.indexOf(event.target);
    if (event.key === 'Backspace' && !event.target.value && index > 0) {
      event.preventDefault();
      inputs[index - 1].value = '';
      inputs[index - 1].focus();
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); inputs[index - 1].focus(); return; }
    if (event.key === 'ArrowRight' && index < inputs.length - 1) { event.preventDefault(); inputs[index + 1].focus(); return; }
  }
  const filterButton = event.target.closest?.('.filter-strip button');
  if (filterButton && !switchSelectionPending && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const strip = filterButton.closest('.filter-strip');
    const buttons = $$('button', strip);
    const index = buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true');
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
    void selectFilterButton(buttons[next]).then(() => $('[aria-pressed="true"]', strip).focus());
    return;
  }
  const pageSearchAvailable = $('#connection-modal').classList.contains('hidden') && $('#owner-lock-layer').classList.contains('hidden') && !githubBackup.isOpen();
  if (pageSearchAvailable && (event.ctrlKey || event.metaKey) && ['f', 'k'].includes(event.key.toLowerCase()) && !event.altKey) {
    event.preventDefault();
    setTitleSearchOpen(true);
    const search = $(`[data-page-search="${activePage}"]`);
    search?.focus();
    search?.select();
    return;
  }
  if (event.key === 'Escape') {
    const search = event.target.closest?.('[data-page-search]');
    if (search?.value) {
      const page = search.dataset.pageSearch;
      search.value = '';
      pageSearch[page] = '';
      if (page === 'connections') renderConnections();
      if (page === 'activity') { activityVisibleCount = ACTIVITY_PAGE_SIZE; renderActivity(); }
      if (page === 'settings') applySettingsSearch();
    }
    if (event.target.closest?.('#title-search')) { event.preventDefault(); setTitleSearchOpen(false); }
  }
});

$('#connection-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!$('#env-group-composer').classList.contains('hidden')) {
    refreshEnvGroup();
    return toast(localized('请先添加或取消当前环境变量组', 'Add or cancel the current environment variable group first.'), 'error');
  }
  const button = $('#save-connection-button');
  button.disabled = true;
  try {
    const input = serializeItem();
    await api.save(input);
    if (currentDraftId) await api.deleteDraft(currentDraftId);
    currentDraftId = '';
    await animateInlineEditor(false);
    closeEditor();
    toast(localized('项目已加密保存', 'Item saved and encrypted'));
    await refresh();
    await refreshDrafts();
  } catch (error) { toast(cleanError(error), 'error'); } finally { button.disabled = false; }
});
$('#owner-lock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pin = readPin('owner-pin');
  if (!/^\d{6}$/.test(pin)) return toast(localized('PIN 必须是六位数字', 'PIN must contain six digits'), 'error');
  if (!ownerLockState.pinConfigured && pin !== readPin('owner-pin-confirm')) return toast(localized('两次 PIN 不一致', 'PIN entries do not match'), 'error');
  const button = $('#owner-unlock-action');
  const cancelButton = $('#owner-pin-cancel');
  button.disabled = true;
  cancelButton.disabled = true;
  const generation = ++ownerStateGeneration;
  const epoch = privateReadEpoch;
  try {
    const settingPin = !ownerLockState.pinConfigured;
    const status = ownerLockState.pinConfigured ? await api.ownerUnlock(pin) : await api.ownerSetPin(pin);
    if (generation !== ownerStateGeneration || epoch !== privateReadEpoch) return;
    ownerLockState = status;
    ownerPinSetupRequested = false;
    renderOwnerLock();
    if (state) {
      renderMetrics();
      renderSettings();
    }
    if (settingPin) toast(localized('PIN 锁已开启', 'PIN lock enabled'));
    await refreshDrafts(true);
    await githubBackup.refresh();
  } catch (error) {
    toast(cleanError(error), 'error');
    clearPin('owner-pin');
    focusPin('owner-pin');
  } finally {
    button.disabled = false;
    cancelButton.disabled = false;
  }
});
$('#owner-pin-cancel').addEventListener('click', () => {
  ownerPinSetupRequested = false;
  renderOwnerLock();
  renderSettings();
});
$('#confirmation-modal').addEventListener('click', (event) => {
  if (event.target.closest('#confirmation-cancel')) finishConfirmation(false);
  if (event.target.closest('#confirmation-accept')) finishConfirmation(true);
});
bindBackdropGesture($('#connection-modal'), () => { if (!inlineEditorItemId) void closeEditorWithDraft(); });
bindBackdropGesture($('#confirmation-modal'), () => finishConfirmation(false));
bindBackdropGesture($('#workspace-use-dialog'), closeAgentUsage);
$('#workspace-use-close').addEventListener('click', closeAgentUsage);
$('#workspace-use-copy').addEventListener('click', async () => {
  if (!ownerLockState.unlocked || $('#workspace-use-dialog').classList.contains('hidden')) return;
  try { await api.copyOwnerValue($('#workspace-use-prompt').value); toast(localized('指令已复制，请粘贴到 Agent', 'Instruction copied. Paste it into your agent.')); }
  catch (error) { toast(cleanError(error), 'error'); }
});
document.addEventListener('toggle', event => {
  if (!event.target.matches('.workspace-action-menu')) return;
  const menu = event.target, trigger = menu.closest('.connection-card')?.querySelector('.workspace-more');
  trigger?.setAttribute('aria-expanded', String(event.newState === 'open'));
  if (event.newState === 'open' && trigger) {
    const box = trigger.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, box.right - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, box.bottom + 5))}px`;
  }
}, true);
$('#clear-activity-button').addEventListener('click', async () => {
  if (!await confirmDestructiveAction({
    title: localized('清空本地操作记录？', 'Clear the local activity log?'),
    message: localized('全部本地操作记录将永久删除。', 'All local activity entries will be permanently deleted.'),
    acceptLabel: localized('清空', 'CLEAR'),
    tag: localized('确认清空记录', 'CONFIRM LOG DELETION'),
  })) return;
  try {
    await api.clear();
    currentActivityFilter = 'all';
    pageSearch.activity = '';
    expandedActivityErrors.clear();
    $('[data-page-search="activity"]').value = '';
    await refresh();
  } catch (error) { toast(cleanError(error), 'error'); }
});
$('#save-browser-settings-button').addEventListener('click', saveBrowserSettings);
$('#browser-enabled').addEventListener('change', saveBrowserSettings);
if (!isMacOS) $('#desktop-shortcut-enabled').addEventListener('change', (event) => setSystemIntegration('desktop', event.currentTarget.checked));
$('#launch-at-login-enabled').addEventListener('change', (event) => setSystemIntegration('startup', event.currentTarget.checked));
$('#pin-enabled').addEventListener('change', savePinSettings);
$('#close-behavior').addEventListener('change', saveDesktopSettings);
$('#menu-bar-only-enabled').addEventListener('change', saveMenuBarSettings);
$('#open-quick-panel').addEventListener('click', () => api.window('quick').catch(error => toast(cleanError(error), 'error')));
$('#quick-pairing-button').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const opened = await api.quickPair(Number($('#browser-port').value));
    $('#browser-enabled').checked = true;
    $('#browser-open-help').hidden = opened;
    toast(opened
      ? localized('已打开扩展页：开启开发者模式后，完成第 2 步。', 'Extensions page opened. Enable Developer mode, then complete step 2.')
      : localized('请手动打开 chrome://extensions，配对已准备。', 'Open chrome://extensions manually. Pairing is ready.'));
    await refresh();
  } catch (error) {
    toast(cleanError(error), 'error');
  } finally {
    button.disabled = false;
  }
});
$('#reset-pairing-button').addEventListener('click', async () => {
  if (!await confirmDestructiveAction({
    title: localized('重置浏览器配对？', 'Reset browser pairing?'),
    message: localized('所有已配对扩展会立即失效，需要重新配对才能继续使用。', 'Every paired extension will be revoked immediately and must be paired again.'),
    acceptLabel: localized('重置', 'RESET'),
    tag: localized('确认重置配对', 'CONFIRM PAIRING RESET'),
  })) return;
  try { await api.resetPair(); toast(localized('配对已重置', 'Pairing reset')); await refresh(); } catch (error) { toast(cleanError(error), 'error'); }
});
$('#open-extension-button').addEventListener('click', () => api.extensionFolder().catch((error) => toast(cleanError(error), 'error')));
$('#open-data-button').addEventListener('click', () => api.dataFolder().catch((error) => toast(cleanError(error), 'error')));
$('#rescan-agents').addEventListener('click', () => scanAgents(true));
$('#header-export-backup-button').addEventListener('click', (event) => exportBackup(event.currentTarget));
$('#header-import-backup-button').addEventListener('click', (event) => importBackup(event.currentTarget));

let generatorTarget = null, generatorSequence = 0;
let backupPasswordResolve = null, backupPasswordExport = false;
function finishBackupPassword(result) {
  $('#backup-password-form').reset(); $('#backup-password-modal').classList.add('hidden');
  const resolve = backupPasswordResolve; backupPasswordResolve = null; resolve?.(result);
}
function askBackupPassword(exporting) {
  finishBackupPassword(null); backupPasswordExport = exporting;
  $('#backup-password-title').textContent = exporting ? localized('导出加密备份', 'EXPORT ENCRYPTED BACKUP') : localized('恢复备份', 'RESTORE BACKUP');
  $('#backup-password-help').textContent = exporting
    ? localized('设置至少 12 个字符的备份密码。恢复时需要此密码，请妥善保管。', 'Use a backup password of at least 12 characters. Keep it for restoration.')
    : localized('输入创建备份时设置的密码；旧版自动解锁备份可留空。', 'Enter the backup password. Leave blank for older automatically unlocked backups.');
  $('#backup-password-confirm-field').classList.toggle('hidden', !exporting);
  $('#backup-password').required = exporting;
  $('#backup-password-confirm').required = exporting;
  $('#backup-password-modal').classList.remove('hidden'); $('#backup-password').focus();
  return new Promise(resolve => { backupPasswordResolve = resolve; });
}
$('#backup-password-close').onclick = () => finishBackupPassword(null);
$('#backup-password-form').onsubmit = e => {
  e.preventDefault();
  const password = $('#backup-password').value;
  if (backupPasswordExport && ([...password].length < 12 || password !== $('#backup-password-confirm').value))
    return toast(localized('密码须至少 12 个字符，且两次输入一致', 'Use at least 12 characters and matching passwords'), 'error');
  finishBackupPassword(password);
};
function closeGenerator() {
  generatorSequence++;
  $('#generator-modal').classList.add('hidden'); $('#generator-result').value = ''; generatorTarget = null;
}
async function generatePassword() {
  const sequence = ++generatorSequence;
  try {
    const options = { length: Number($('#generator-length').value) };
    for (const key of ['uppercase', 'lowercase', 'digits', 'symbols']) options[key] = $(`#generator-${key}`).checked;
    const result = await invoke('generate_password', { options });
    if (sequence === generatorSequence && !$('#generator-modal').classList.contains('hidden')) $('#generator-result').value = result;
  } catch (error) { toast(cleanError(error), 'error'); }
}
function openGenerator(target = null) {
  generatorTarget = target; $('#generator-use').classList.toggle('hidden', !target);
  $('#generator-modal').classList.remove('hidden'); generatePassword();
}
$('#generator-open').onclick = () => openGenerator();
$('#generator-close').onclick = closeGenerator;
$('#generator-regenerate').onclick = generatePassword;
$('#generator-copy').onclick = async () => { try { if ($('#generator-result').value) { await api.copyOwnerValue($('#generator-result').value); toast(localized('已复制', 'Copied')); } } catch(error) { toast(cleanError(error), 'error'); } };
$('#generator-use').onclick = () => {
  if (generatorTarget?.isConnected && $('#generator-result').value) { generatorTarget.value = $('#generator-result').value; generatorTarget.dispatchEvent(new Event('input', { bubbles:true })); syncModuleDraft(); }
  closeGenerator();
};
document.addEventListener('click', e => {
  const button = e.target.closest('[data-generate-password]');
  if (button) openGenerator($('[data-secret-value]', button.closest('.module-row')));
});

$('#page-activity .activity-panel').addEventListener('scroll', (event) => {
  const panel = event.currentTarget;
  if (panel.scrollHeight - panel.scrollTop - panel.clientHeight < 160) queueMoreActivities();
}, { passive: true });

window.__TAURI__.event.listen('state-changed', async () => { await refreshOwnerLock(false); await refresh(false); await refreshDrafts(); });
window.__TAURI__.event.listen('workspace-navigation', async ({ payload }) => {
  if (!['connections', 'activity', 'settings'].includes(payload?.page)) return;
  if (!$('#connection-modal').classList.contains('hidden') && !await closeEditorWithDraft()) return;
  await refreshOwnerLock(false);
  await refresh(false);
  if (payload.page === 'connections') {
    currentItemTypeFilter = 'all'; workspaceScope = 'all'; workspaceFolder = null;
    pageSearch.connections = ''; workspaceSelectedId = payload.itemId || null;
    syncItemTypeFilter();
  }
  if (payload.page === 'settings') {
    currentSettingsFilter = ['APP', 'MCP', 'WEB'].includes(payload.section) ? payload.section : 'all';
    pageSearch.settings = ''; syncSettingsFilterControl();
  }
  await selectPage(payload.page);
  render();
});
window.__TAURI__.event.listen('pin-setup-requested', async () => {
  await refreshOwnerLock(false);
  if (ownerLockState.pinConfigured) return;
  ownerPinSetupRequested = true;
  renderOwnerLock();
  if (state) renderSettings();
});
window.addEventListener('focus', async () => { await refreshOwnerLock(false); await refresh(false); await refreshDrafts(); });
window.addEventListener('resize', positionModuleMenu);
$('.form-scroll', $('#connection-modal')).addEventListener('scroll', positionModuleMenu, { passive: true });
$('#connections-list').addEventListener('scroll', positionModuleMenu, { passive: true });
setInterval(() => { if ($('#page-activity').classList.contains('active')) refresh(false); }, 2000);
setInterval(() => { if (!document.hidden && $('#connection-modal').classList.contains('hidden') && $('#page-connections').classList.contains('active')) refresh(false); }, 2000);
let extensionDragStart = null, extensionDragBusy = false;
$('#drag-extension-button').addEventListener('pointerdown', event => { if(event.button === 0) extensionDragStart = {x:event.clientX,y:event.clientY}; });
window.addEventListener('pointerup', () => { extensionDragStart = null; });
window.addEventListener('pointercancel', () => { extensionDragStart = null; });
$('#drag-extension-button').addEventListener('pointermove', async event => {
  if(event.buttons !== 1 || !extensionDragStart || extensionDragBusy || Math.hypot(event.clientX-extensionDragStart.x,event.clientY-extensionDragStart.y)<5)return;
  extensionDragStart=null; extensionDragBusy=true;
  try { await invoke('drag_browser_extension'); } catch(error) { toast(cleanError(error), 'error'); } finally { extensionDragBusy=false; }
});
$('#drag-extension-button').addEventListener('dragstart', event => event.preventDefault());
$('#drag-extension-button').addEventListener('keydown', event => { if(event.key==='Enter' || event.key===' ') { event.preventDefault(); api.extensionFolder().catch(error=>toast(cleanError(error),'error')); } });

async function bootstrap() {
  applyLanguage();
  await refreshOwnerLock();
  await refresh();
  await refreshDrafts();
  scanAgents();
}
bootstrap();
