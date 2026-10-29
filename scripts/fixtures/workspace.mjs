// Synthetic Tauri boundary only. No native app, vault, or external service is used.
export const WORKSPACE_FOLDER = 'Operations folder with a deliberately long name';
export const WORKSPACE_PASSWORD = 'synthetic-workspace-password-NOT-A-REAL-SECRET';
export const WORKSPACE_PIN = '654321';

export function createWorkspaceFixture({ language = 'en', theme = 'dark', locked = false, empty = false } = {}) {
  const item = (id, name, overrides = {}) => ({
    id, name, itemType: 'custom', description: '', folder: '', favorite: false,
    enabled: true, updatedAt: `synthetic-revision-${id}`, capabilities: [],
    modules: [], passkeys: [], secret: { fields: [] }, passwordHistoryCount: 0,
    canTest: false, ...overrides,
  });
  const password = { kind: 'password', value: '', secret: true, configured: true, agentVisible: false };
  return {
    theme, pin: WORKSPACE_PIN,
    owner: { pinConfigured: true, unlocked: !locked, expiresInSeconds: locked ? 0 : 300 },
    state: {
      settings: { language, closeBehavior: 'tray', browserEnabled: false, browserPort: 39272 },
      connections: empty ? [] : [
        item('login-acme', 'Acme console', {
          itemType: 'login', folder: 'Work', favorite: true, capabilities: ['fill'],
          description: 'Synthetic administration login',
          modules: [{ kind: 'username', value: 'workspace-user', secret: false, agentVisible: false }, password],
          loginUris: [{ uri: 'https://console.example.test/login', matchType: 'exact' }],
          secret: { fields: [{ name: 'password', kind: 'password' }] },
        }),
        item('login-personal', 'Personal mailbox', {
          itemType: 'login', folder: 'Personal', capabilities: ['fill'], modules: [password],
          description: 'Synthetic mail account', secret: { fields: [{ name: 'password', kind: 'password' }] },
        }),
        item('api-build', 'Build API', {
          folder: 'Work', favorite: true, capabilities: ['http'], canTest: true,
          description: 'Pipeline deployment credential', baseUrl: 'https://build.example.test',
          modules: [{ kind: 'apiCredential', value: '', secret: true, configured: true, agentVisible: false }],
          secret: { fields: [{ name: 'apiCredential', kind: 'apiCredential' }] },
        }),
        item('ssh-operations', 'Operations host with a deliberately long credential name', {
          folder: WORKSPACE_FOLDER, enabled: false, capabilities: ['ssh'], canTest: true,
          host: 'operations.example.test', port: 22,
          modules: [{ kind: 'host', value: 'operations.example.test', agentVisible: true }, password],
          secret: { fields: [{ name: 'password', kind: 'password' }] },
        }),
        item('card-travel', 'Travel card', {
          itemType: 'card', folder: 'Personal',
          modules: [{ kind: 'cardNumber', value: '', secret: true, configured: true, agentVisible: false }],
          secret: { fields: [{ name: 'cardNumber', kind: 'cardNumber' }] },
        }),
        item('note-recovery', 'Recovery note', {
          itemType: 'secureNote', folder: 'Work', enabled: false,
          modules: [{ kind: 'secureNote', value: '', secret: true, configured: true, agentVisible: false }],
          secret: { fields: [{ name: 'secureNote', kind: 'secureNote' }] },
        }),
      ],
      activities: [
        { id: 'synthetic-success', action: 'Synthetic fixture operation', connectionName: 'Build API', status: 'success', source: 'mcp', durationMs: 12, time: '2026-01-01T00:00:00Z' },
        { id: 'synthetic-failure', action: 'Synthetic failed operation', connectionName: 'Operations host', status: 'error', source: 'mcp', durationMs: 20, error: 'Synthetic fixture failure', time: '2026-01-01T00:00:00Z' },
      ],
      mcp: { status: 'ready', endpoint: 'synthetic-stdio', stdioCommand: 'synthetic-openkeylet mcp stdio' },
      browserBridge: { status: 'off', enabled: false, connected: false, paired: false, endpoint: 'synthetic-offline' },
      security: { encrypted: true, storage: 'synthetic-memory-only' },
    },
    privateById: {
      'login-acme': { password: WORKSPACE_PASSWORD },
      'login-personal': { password: 'synthetic-personal-mail-password' },
      'api-build': { apiCredential: 'synthetic-api-token-not-real' },
      'ssh-operations': { password: 'synthetic-ssh-password-not-real' },
      'card-travel': { cardNumber: '4111111111111111' },
      'note-recovery': { secureNote: 'synthetic recovery note private content' },
    },
  };
}

// Passed directly to addInitScript: this function must not close over Node values.
export function installWorkspaceFixture(config) {
  localStorage.setItem('openkeylet.appearance.v1', JSON.stringify({ theme: config.theme, sound: false }));
  // Use state-changed events explicitly instead of racing the renderer's polling.
  window.setInterval = () => 0;
  const listeners = new Map();
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const fixture = window.workspaceFixture = {
    ...config, calls: [], unexpectedCommands: [], saved: [], deleted: [], drafts: [], trash: [], revision: 0,
    async emit(name, payload = null) {
      for (const callback of listeners.get(name) || []) await callback({ event: name, payload });
    },
  };
  const requireOwner = () => {
    if (!fixture.owner.unlocked) throw Error('Synthetic owner is locked');
  };
  const requireItem = id => {
    const item = fixture.state.connections.find(candidate => candidate.id === id);
    if (!item) throw Error(`Unknown synthetic item: ${id}`);
    return item;
  };
  const requireRevision = (item, revision) => {
    if (item.updatedAt !== revision) throw Error('Stale synthetic item revision');
  };
  window.__TAURI__ = {
    event: {
      async listen(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
        return () => listeners.get(name).delete(callback);
      },
    },
    core: {
      async invoke(command, args = {}) {
        fixture.calls.push({ command, args: clone(args) });
        switch (command) {
          case 'get_state': return clone(fixture.state);
          case 'owner_status': return clone(fixture.owner);
          case 'owner_lock':
            fixture.owner.unlocked = false;
            fixture.owner.expiresInSeconds = 0;
            return clone(fixture.owner);
          case 'owner_unlock':
            if (args.pin !== fixture.pin) throw Error('Incorrect synthetic PIN');
            fixture.owner.unlocked = true;
            fixture.owner.expiresInSeconds = 300;
            return clone(fixture.owner);
          case 'owner_secret_view': {
            requireOwner();
            requireItem(args.id);
            return { id: args.id, fields: Object.entries(fixture.privateById[args.id] || {}).map(([name, value]) => ({ name, kind: name, value })) };
          }
          case 'owner_editor_drafts': requireOwner(); return clone(fixture.drafts);
          case 'save_editor_draft': {
            requireOwner();
            const draft = { id: args.draftId || `synthetic-draft-${++fixture.revision}`, input: clone(args.input), updatedAt: `synthetic-draft-revision-${fixture.revision}` };
            fixture.drafts = [draft, ...fixture.drafts.filter(candidate => candidate.id !== draft.id)];
            return clone(draft);
          }
          case 'delete_editor_draft':
            requireOwner();
            fixture.drafts = fixture.drafts.filter(draft => draft.id !== args.id);
            return;
          case 'save_connection': {
            requireOwner();
            const input = clone(args.input);
            const existing = input.id ? requireItem(input.id) : null;
            if (existing) requireRevision(existing, args.expectedUpdatedAt);
            fixture.saved.push({ input: clone(input), expectedUpdatedAt: args.expectedUpdatedAt });
            const id = existing?.id || `synthetic-created-${++fixture.revision}`;
            const { secrets = {}, ...metadata } = input;
            const values = { ...fixture.privateById[id], ...secrets.namedSecrets };
            if (secrets.password) values.password = secrets.password;
            for (const name of secrets.removeFields || []) delete values[name];
            fixture.privateById[id] = values;
            const secretKinds = new Set(['password', 'apiCredential', 'privateKey', 'cardNumber', 'cardSecurityCode', 'secureNote']);
            const saved = {
              capabilities: [], passkeys: [], passwordHistoryCount: 0, ...existing, ...metadata,
              id, updatedAt: `synthetic-saved-revision-${++fixture.revision}`,
              modules: (input.modules || []).map(module => {
                const name = module.kind === 'customSecret' ? module.name : module.kind;
                const secret = module.secret || secretKinds.has(module.kind) || module.kind === 'customSecret';
                return { ...module, secret, configured: secret ? Boolean(values[name]) : Boolean(module.value), value: secret ? '' : module.value };
              }),
              secret: { fields: Object.keys(values).map(name => ({ name, kind: name })) },
            };
            if (existing) fixture.state.connections.splice(fixture.state.connections.indexOf(existing), 1, saved);
            else fixture.state.connections.push(saved);
            return clone(saved);
          }
          case 'set_connection_enabled': {
            requireOwner();
            const item = requireItem(args.id);
            item.enabled = args.enabled;
            item.updatedAt = `synthetic-enabled-revision-${++fixture.revision}`;
            return clone(item);
          }
          case 'delete_connection': {
            requireOwner();
            const item = requireItem(args.id);
            requireRevision(item, args.expectedUpdatedAt);
            fixture.deleted.push(clone(args));
            fixture.trash.push({ item: clone(item), deletedAt: `synthetic-deletion-${++fixture.revision}` });
            fixture.state.connections = fixture.state.connections.filter(candidate => candidate.id !== item.id);
            return;
          }
          case 'update_settings':
            if (fixture.failSettings) throw Error('Synthetic settings write failure');
            Object.assign(fixture.state.settings, args.patch);
            return clone(fixture.state.settings);
          case 'agent_mcp_status': return [];
          case 'github_backup_status': return { connected: false };
          case 'system_integration_status': return { desktopShortcut: false, launchAtLogin: false };
          case 'owner_trash': requireOwner(); return clone(fixture.trash);
          case 'generate_password': return 'Aa1!'.repeat(32).slice(0, args.options.length);
          default:
            fixture.unexpectedCommands.push(command);
            throw Error(`Unsupported synthetic Tauri command: ${command}`);
        }
      },
    },
  };
}
