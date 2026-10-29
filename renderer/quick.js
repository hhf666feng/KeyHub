(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const words = {
    subtitle: ['Your keys, at hand.', '凭据，触手可及。'], credentials: ['Credentials', '凭据'], agents: ['Agents', '智能体'], activity: ['Activity', '活动'],
    privacy: ['Metadata only. Secrets stay in your vault.', '仅展示元数据，密钥始终留在保险库。'], full: ['Full window', '完整窗口'], lock: ['Lock', '锁定'], quit: ['Quit', '退出'],
    refresh: ['Refresh', '刷新'], settings: ['Settings', '设置'], search: ['Search credential names', '搜索凭据名称'], placeholder: ['Find a credential', '查找凭据'],
    ready: ['Vault unlocked', '保险库已解锁'], locked: ['Vault locked', '保险库已锁定'], setup: ['Set up PIN', '设置 PIN'], checking: ['Checking vault', '正在检查保险库'],
    connected: ['Connected', '已连接'], waiting: ['Waiting', '等待连接'], off: ['Off', '已关闭'], enabled: ['Enabled', '已启用'], disabled: ['Disabled', '已停用'],
    headingCredentials: ['YOUR CREDENTIALS', '我的凭据'], headingAgents: ['AGENT CONNECTIONS', '智能体连接'], headingActivity: ['RECENT ACTIVITY', '近期活动'],
    loading: ['Refreshing…', '正在刷新…'], loadingHint: ['Checking the latest vault state.', '正在确认最新保险库状态。'],
    noCredentials: ['No credentials yet', '暂无凭据'], noAgents: ['No agents detected', '暂无智能体'], noActivity: ['No recent activity', '暂无近期活动'],
    noMatch: ['No matching credentials', '未找到匹配凭据'], matchHint: ['Try another credential name.', '请尝试其他凭据名称。'],
    lockedHint: ['Open the full window to unlock your vault.', '请在完整窗口中解锁保险库。'], emptyHint: ['Manage your vault in the full window.', '在完整窗口中管理保险库。'],
    agentsHint: ['Connect an agent in MCP settings.', '在 MCP 设置中连接智能体。'], open: ['Open full window', '打开完整窗口'],
    error: ['Could not update the panel. Try Refresh.', '面板更新失败，请点击刷新重试。'], actionError: ['Action failed. Refresh to try again.', '操作失败，请刷新后重试。'],
    detected: ['Detected', '已检测到'], notDetected: ['Not detected', '未检测到'], configure: ['MCP settings', 'MCP 设置'],
    bridge: ['Bridge', '浏览器桥接'],
    login: ['Login', '登录'], card: ['Card', '信用卡'], identity: ['Identity', '身份资料'],
    secureNote: ['Secure note', '安全笔记'], note: ['Note', '笔记'], custom: ['Custom', '自定义'], credential: ['Credential', '凭据'],
    registered: ['Connected', '已连接'], available: ['Ready to connect', '可连接'], stale: ['Needs repair', '需修复'],
    conflict: ['Config conflict', '配置冲突'], stateError: ['Detection failed', '检测失败'],
    success: ['Success', '成功'], activityError: ['Failed', '失败'], fill: ['Credential fill', '填写凭据'],
  };
  let language = 'en';
  let selected = 'credentials';
  let snapshot = null;
  let loading = true;
  let errorKey = '';
  let revision = 0;
  let running = false;
  let queued = false;
  let locking = false;
  const translate = key => words[key][language === 'en' ? 0 : 1];

  function theme(value) {
    try { document.documentElement.dataset.theme = JSON.parse(value || 'null')?.theme === 'dark' ? 'dark' : 'light'; }
    catch { document.documentElement.dataset.theme = 'light'; }
  }
  try { theme(localStorage.getItem('openkeylet.appearance.v1')); } catch { theme(null); }
  window.addEventListener('storage', event => {
    if (event.key === 'openkeylet.appearance.v1' || event.key === null) theme(event.newValue);
  });

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function openMain(args) { return command('quick_open_main', args); }
  async function command(name, args) {
    try { await window.__TAURI__.core.invoke(name, args); }
    catch {
      errorKey = 'actionError';
      render();
    }
  }
  function clearPrivate() {
    if (snapshot) snapshot = { ...snapshot, credentials: [], activities: [], credentialCount: 0, enabledCount: 0 };
  }
  function empty(title, hint, action) {
    const container = node('div', 'empty');
    const mark = node('span', 'empty-mark', selected === 'agents' ? '◇' : '⌑');
    mark.setAttribute('aria-hidden', 'true');
    container.append(mark, node('strong', '', translate(title)), node('p', '', translate(hint)));
    if (action) {
      const button = node('button', '', translate(action === 'MCP' ? 'configure' : 'open'));
      button.type = 'button';
      button.addEventListener('click', () => openMain(action === 'MCP' ? { page: 'settings', section: 'MCP' } : { page: 'connections' }));
      container.append(button);
    }
    byId('content').append(container);
  }
  function row(title, metadata, glyph, onClick, favorite = false) {
    const button = node('button', 'row');
    button.type = 'button';
    const icon = node('span', 'row-icon', glyph);
    icon.setAttribute('aria-hidden', 'true');
    const copy = node('span', 'row-copy');
    copy.append(node('span', 'row-title', title), node('span', 'row-meta', metadata));
    const end = node('span', 'row-end');
    end.setAttribute('aria-hidden', 'true');
    if (favorite) end.append(node('span', 'favorite', '★'));
    end.append(node('span', '', '›'));
    button.append(icon, copy, end);
    button.addEventListener('click', onClick);
    byId('content').append(button);
    return button;
  }
  function render() {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-label]').forEach(element => { element.textContent = translate(element.dataset.label); });
    for (const [id, label] of [['refresh', 'refresh'], ['open', 'open'], ['settings', 'settings']]) {
      byId(id).title = translate(label);
      byId(id).setAttribute('aria-label', translate(label));
    }
    byId('search').placeholder = translate('placeholder');
    byId('search').setAttribute('aria-label', translate('search'));
    byId('search-wrap').hidden = selected !== 'credentials';
    document.querySelectorAll('[data-tab]').forEach(tab => {
      const active = tab.dataset.tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    const owner = snapshot?.owner;
    const unlocked = owner?.unlocked === true && !locking;
    byId('owner').textContent = translate(!owner ? 'checking' : locking ? 'locked' : !owner.pinConfigured ? 'setup' : unlocked ? 'ready' : 'locked');
    byId('owner-dot').classList.toggle('ready', unlocked);
    byId('bridge').textContent = `${translate('bridge')} · ${translate(!snapshot?.browser?.enabled ? 'off' : snapshot.browser.connected ? 'connected' : 'waiting')}`;
    byId('bridge').classList.toggle('connected', snapshot?.browser?.enabled === true && snapshot.browser.connected === true);
    byId('lock').disabled = locking;
    byId('section-title').textContent = translate({ credentials: 'headingCredentials', agents: 'headingAgents', activity: 'headingActivity' }[selected]);
    byId('summary').textContent = loading ? translate('loading') : selected === 'credentials'
      ? `${unlocked ? Number(snapshot?.credentialCount) || 0 : 0} · ${unlocked ? Number(snapshot?.enabledCount) || 0 : 0} ${translate('enabled').toLocaleLowerCase()}`
      : String((snapshot?.[selected === 'agents' ? 'agents' : 'activities'] || []).length);
    byId('error').hidden = !errorKey;
    byId('error').textContent = errorKey ? translate(errorKey) : '';
    const content = byId('content');
    content.setAttribute('aria-labelledby', `tab-${selected}`);
    content.setAttribute('aria-busy', String(loading));
    content.replaceChildren();
    if (loading) return empty('loading', 'loadingHint');
    if (errorKey) return empty('error', 'emptyHint');
    if (!unlocked && selected !== 'agents') return empty('locked', 'lockedHint', 'main');
    if (selected === 'credentials') {
      const query = byId('search').value.trim().toLocaleLowerCase();
      const credentials = (snapshot?.credentials || []).filter(item => String(item.name || '').toLocaleLowerCase().includes(query))
        .slice().sort((first, second) => Number(Boolean(second.favorite)) - Number(Boolean(first.favorite)) || String(first.name).localeCompare(String(second.name)));
      if (!credentials.length) return empty(query ? 'noMatch' : 'noCredentials', query ? 'matchHint' : 'emptyHint', query ? null : 'main');
      for (const item of credentials) {
        const name = String(item.name || '—');
        const type = ['ssh', 'api', 'passkey'].includes(item.itemType) ? {ssh:'SSH',api:'API',passkey:'Passkey'}[item.itemType] : translate(words[item.itemType] ? item.itemType : 'credential');
        const metadata = `${type} · ${translate(item.enabled ? 'enabled' : 'disabled')}`;
        const button = row(name, metadata, name.charAt(0).toLocaleUpperCase(), () => openMain({ page: 'connections', itemId: item.id }), item.favorite);
        button.dataset.itemId = item.id;
      }
    } else if (selected === 'agents') {
      if (!snapshot?.agents?.length) return empty('noAgents', 'agentsHint', 'MCP');
      for (const agent of snapshot.agents) {
        const stateKey = ({registered:'registered',connected:'connected',available:'available',notDetected:'notDetected',stale:'stale',conflict:'conflict',error:'stateError'})[agent.state];
        const button = row(String(agent.displayName || 'Agent'), `${translate(agent.detected ? 'detected' : 'notDetected')} · ${stateKey ? translate(stateKey) : '—'}`, '◇', () => openMain({ page: 'settings', section: 'MCP' }));
        button.dataset.agentId = agent.clientId;
      }
    } else {
      if (!snapshot?.activities?.length) return empty('noActivity', 'emptyHint');
      for (const activity of snapshot.activities) {
        const date = new Date(activity.time);
        const time = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(language === 'en' ? 'en' : 'zh-CN', { hour: '2-digit', minute: '2-digit' });
        const action = activity.action === 'fill' ? translate('fill') : activity.action;
        const status = activity.status === 'error' ? translate('activityError') : activity.status === 'success' ? translate('success') : '';
        const button = row(String(activity.connectionName || '—'), [action, status, time].filter(Boolean).join(' · '), '↗', () => openMain({ page: 'activity' }));
        button.dataset.activityId = activity.id;
      }
    }
  }
  function refresh() {
    revision++;
    queued = true;
    loading = true;
    errorKey = '';
    clearPrivate();
    render();
    void drain();
  }
  async function drain() {
    if (running || locking) return;
    running = true;
    try {
      while (queued && !locking) {
        queued = false;
        const requestRevision = revision;
        try {
          const state = await window.__TAURI__.core.invoke('quick_state');
          if (requestRevision !== revision || locking) continue;
          if (!state || !state.owner || !Array.isArray(state.credentials) || !Array.isArray(state.activities) || !Array.isArray(state.agents)) throw new Error('Invalid snapshot');
          snapshot = state;
          language = state.language === 'en' ? 'en' : 'zh';
          if (state.owner.unlocked !== true) clearPrivate();
          errorKey = '';
        } catch {
          if (requestRevision !== revision || locking) continue;
          snapshot = null;
          errorKey = 'error';
        }
        loading = false;
        render();
      }
    } finally { running = false; }
  }
  async function lock() {
    if (locking) return;
    revision++;
    locking = true;
    loading = false;
    clearPrivate();
    render();
    try {
      await window.__TAURI__.core.invoke('quick_action', { action: 'lock' });
      locking = false;
      refresh();
    } catch {
      locking = false;
      queued = false;
      loading = false;
      errorKey = 'actionError';
      render();
    }
  }
  function selectTab(tab) { selected = tab.dataset.tab; render(); }
  const tabs = [...document.querySelectorAll('[data-tab]')];
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  });
  byId('search').addEventListener('input', render);
  byId('refresh').addEventListener('click', refresh);
  byId('open').addEventListener('click', () => openMain({ page: 'connections' }));
  byId('full-window').addEventListener('click', () => openMain({ page: 'connections' }));
  byId('settings').addEventListener('click', () => openMain({ page: 'settings', section: 'APP' }));
  byId('bridge').addEventListener('click', () => openMain({ page: 'settings', section: 'WEB' }));
  byId('lock').addEventListener('click', lock);
  byId('quit').addEventListener('click', () => command('quick_action', { action: 'quit' }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); void command('quick_action', { action: 'hide' }); }
  });
  // Webview blur is a fallback for native window blur on platforms where the
  // outer window can lose key status without emitting Tauri's Focused(false).
  document.addEventListener('blur', () => { void command('quick_action', { action: 'hide' }); });
  window.addEventListener('focus', refresh);
  async function start() {
    render();
    try {
      await window.__TAURI__.event.listen('state-changed', refresh);
      refresh();
    } catch {
      loading = false;
      errorKey = 'error';
      render();
    }
  }
  void start();
})();
