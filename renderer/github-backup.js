/* GitHub backup UI. No credentials are persisted in browser storage. */
window.OpenKeyletGithubBackup = {
  create({ invoke, localized, toast, isUnlocked, confirmAction, onRestore }) {
    const $ = (id) => document.getElementById(id);
    const modal = $('github-modal');
    let status = { connected: false };
    let busy = false;
    let refreshing = false;
    let secretEpoch = 0;
    let previousFocus;
    let inertElements = [];
    let lastError = '';
    let formError = '';

    const copy = {
      'github-heading': ['GitHub 加密备份', 'GITHUB BACKUP'],
      'github-description': ['将保险库加密备份到自己的私有仓库。', 'Encrypted snapshots in your own private repository.'],
      'github-repository-label': ['仓库', 'Repository'],
      'github-backup-label': ['上次上传', 'Last upload'],
      'github-restore-label': ['上次恢复', 'Last restore'],
      'github-connect': ['连接仓库', 'CONNECT'],
      'github-upload': ['立即备份', 'BACK UP NOW'],
      'github-restore': ['从云端恢复', 'RESTORE'],
      'github-show-key': ['查看恢复密钥', 'RECOVERY KEY'],
      'github-reconfigure': ['更新连接', 'RECONNECT'],
      'github-disconnect': ['断开', 'DISCONNECT'],
      'github-saved-key-label': ['恢复密钥', 'Recovery key'],
      'github-copy-saved-key': ['复制密钥', 'COPY KEY'],
      'github-hide-key': ['隐藏', 'HIDE'],
      'github-key-warning': ['请保存在仓库之外。拥有此密钥及备份文件的人可以读取整个备份。', 'Keep this outside the repository. Anyone with this key and the backup can read its contents.'],
      'github-modal-title': ['连接 GitHub', 'Connect GitHub'],
      'github-repository-input-label': ['私有仓库', 'Private repository'],
      'github-create-repo': ['创建私有仓库 ↗', 'CREATE PRIVATE REPO ↗'],
      'github-create-token': ['创建访问令牌 ↗', 'CREATE ACCESS TOKEN ↗'],
      'github-token-label': ['GitHub 访问令牌', 'GitHub access token'],
      'github-token-help': ['使用细粒度令牌，仅选择这个仓库，并授予 Contents 读写权限。令牌只在本机加密保存。', 'Use a fine-grained token for only this repository, with Contents: Read and write. It is stored encrypted on this device.'],
      'github-mode-label': ['连接方式', 'Connection mode'],
      'github-mode-new': ['创建新备份', 'Create a new backup'],
      'github-mode-existing': ['连接已有备份', 'Connect an existing backup'],
      'github-key-label': ['恢复密钥', 'Recovery key'],
      'github-generate-key': ['生成恢复密钥', 'GENERATE KEY'],
      'github-copy-key': ['复制密钥', 'COPY KEY'],
      'github-recovery-help': ['换机时需要这把密钥。请另行保管；密钥丢失且没有已连接设备时，无法恢复云端备份。', 'You need this key on a new device. Keep a separate copy: without it or a connected device, the backup cannot be recovered.'],
      'github-key-saved-label': ['已将恢复密钥保存到仓库之外', 'I saved the recovery key outside the repository'],
      'github-local-only': ['连接成功后，手动点击“立即备份”。', 'Connect first, then choose Back up now.'],
      'github-submit': ['连接仓库', 'CONNECT'],
    };

    const errors = {
      GITHUB_REPOSITORY_INVALID: ['请输入 owner/repository 或 GitHub 仓库链接。', 'Enter owner/repository or a GitHub repository URL.'],
      GITHUB_TOKEN_INVALID: ['请输入有效的 GitHub 访问令牌。', 'Enter a valid GitHub access token.'],
      GITHUB_KEY_INVALID: ['恢复密钥格式不正确。请完整粘贴以 okv1_ 开头的密钥。', 'Paste the complete recovery key beginning with okv1_.'],
      GITHUB_KEY_NOT_SAVED: ['请先将恢复密钥保存到仓库之外。', 'Save your recovery key outside the repository first.'],
      GITHUB_KEY_MISMATCH: ['密钥不匹配，或云端备份已损坏。本地数据未被恢复操作修改。', 'The key does not match, or the backup is damaged. No data was restored.'],
      GITHUB_PRIVATE_REQUIRED: ['只支持私有仓库。请检查仓库可见性。', 'Only private repositories are supported. Check its visibility.'],
      GITHUB_AUTH: ['令牌无效或已过期，请更新连接。', 'The token is invalid or expired. Reconnect with a new token.'],
      GITHUB_PERMISSION: ['无法访问仓库。请检查令牌的仓库选择、Contents 读写权限和组织授权。', 'Check the token’s repository access, Contents read/write permission, and organization approval.'],
      GITHUB_NOT_FOUND: ['找不到仓库或无权访问。请检查仓库名称和令牌权限。', 'Repository not found or inaccessible. Check its name and token permissions.'],
      GITHUB_BACKUP_EXISTS: ['仓库已有备份。请选择“连接已有备份”并使用原来的恢复密钥。', 'A backup already exists. Choose Connect an existing backup and use its original key.'],
      GITHUB_BACKUP_MISSING: ['没有找到云端备份。若要重新建立备份，请更新连接并选择“创建新备份”。', 'No remote backup was found. To start again, reconnect and choose Create a new backup.'],
      GITHUB_RESTORE_REQUIRED: ['请先恢复合并云端备份，再上传本机数据。', 'Restore and merge the remote backup before uploading this device.'],
      GITHUB_REMOTE_CHANGED: ['云端版本已变更，已停止上传。请先恢复合并；若云端已被删除，请重新连接。', 'The remote version changed. Upload stopped. Restore first, or reconnect if the remote file was deleted.'],
      GITHUB_CONFLICT: ['云端发生并发更新，或仓库规则拒绝了提交。请先恢复，并检查分支保护规则。', 'A concurrent update or repository rule rejected the write. Restore first and check branch protection.'],
      GITHUB_UPLOAD_UNCONFIRMED: ['上传结果尚未确认。请先恢复云端备份，确认最新版本后再上传。', 'Upload could not be confirmed. Restore the remote backup before uploading again.'],
      GITHUB_RATE_LIMIT: ['GitHub 暂时限制了请求。请稍后再试。', 'GitHub temporarily limited requests. Try again later.'],
      GITHUB_NETWORK: ['无法连接 GitHub。请检查网络后重试。', 'Cannot reach GitHub. Check your connection and try again.'],
      GITHUB_REDIRECT: ['仓库地址发生跳转。请使用仓库的最新地址重新连接。', 'The repository address redirects. Reconnect using its current address.'],
      GITHUB_REPOSITORY_CHANGED: ['该地址对应的仓库已改变。请重新连接。', 'This address now identifies a different repository. Reconnect to continue.'],
      GITHUB_BRANCH_CHANGED: ['默认分支已变更，请重新连接。', 'The default branch changed. Reconnect to continue.'],
      GITHUB_REPOSITORY_READ_ONLY: ['仓库已归档或停用，无法用于备份。', 'The repository is archived or disabled.'],
      GITHUB_BACKUP_INVALID: ['云端文件不是受支持的完整加密备份。', 'The remote file is not a valid supported encrypted backup.'],
      GITHUB_BACKUP_TOO_LARGE: ['备份超过当前 8 MB 限制，未上传或恢复。', 'The backup exceeds the current 8 MB limit. It was not uploaded or restored.'],
      GITHUB_NOT_CONNECTED: ['请先连接 GitHub 仓库。', 'Connect a GitHub repository first.'],
      GITHUB_LOCAL_STATE: ['无法读取或保存本机连接配置。请检查数据目录；可重新连接。', 'Cannot read or save the local connection. Check the data directory or reconnect.'],
      GITHUB_RESTORE_FAILED: ['恢复未完成，请检查备份和本机数据目录后重试。', 'Restore did not complete. Check the backup and local data directory.'],
      GITHUB_LOCAL_VAULT: ['无法读取本机保险库，请检查数据目录。', 'Cannot read the local vault. Check its data directory.'],
    };

    function errorText(error) {
      const code = String(error?.message || error).match(/GITHUB_[A-Z_]+/)?.[0];
      return errors[code] ? localized(...errors[code]) : localized('操作未完成，请检查连接后重试。', 'The operation did not complete. Check your connection and retry.');
    }

    function dateText(value) {
      return value ? new Date(value).toLocaleString(document.documentElement.lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : localized('尚无', 'Not yet');
    }

    function render() {
      for (const [id, values] of Object.entries(copy)) $(id).textContent = localized(...values);
      $('github-modal-close').setAttribute('aria-label', localized('关闭', 'Close'));
      $('github-backup-card').setAttribute('aria-busy', String(busy));
      const connected = status.connected && isUnlocked();
      const strip = $('github-status');
      strip.className = `status-strip ${lastError ? 'error' : connected ? '' : 'offline'}`;
      strip.textContent = busy ? localized('正在处理，请稍候…', 'Working, please wait…')
        : connected ? (status.needsRestore ? localized('先恢复云端备份', 'RESTORE REQUIRED') : localized('已连接 · 手动备份', 'CONNECTED · MANUAL BACKUP'))
          : localized('未连接 · 仅本地', 'NOT CONNECTED · LOCAL ONLY');
      $('github-connect').classList.toggle('hidden', connected);
      for (const id of ['github-upload', 'github-restore', 'github-details', 'github-manage']) $(id).classList.toggle('hidden', !connected);
      $('github-repository-value').textContent = connected ? `${status.repository} · ${status.branch}` : '';
      $('github-backup-value').textContent = dateText(status.lastBackupAt);
      $('github-restore-value').textContent = dateText(status.lastRestoreAt);
      $('github-note').textContent = connected && status.needsRestore
        ? localized('此设备需要先恢复合并云端内容，才能上传。现有本地项目会保留。', 'Restore and merge the remote contents before uploading. Existing local items are kept.')
        : localized('仅在点击备份时上传。换机恢复需要独立密钥；本机配对、PIN 和 Agent 接入配置不会上传。', 'Uploads only when you choose Back up now. Restore requires your recovery key. Pairing, PIN and agent setup stay on this device.');
      $('github-error').textContent = lastError ? errorText(lastError) : '';
      $('github-error').classList.toggle('hidden', !lastError);
      $('github-form-error').textContent = formError ? errorText(formError) : '';
      $('github-form-error').classList.toggle('hidden', !formError);
      for (const button of document.querySelectorAll('#github-backup-card button, #github-modal button')) button.disabled = busy || !isUnlocked();
      for (const input of document.querySelectorAll('#github-form input, #github-form select, #github-form textarea')) input.disabled = busy;
      $('github-upload').disabled = busy || !isUnlocked() || status.needsRestore;
      $('github-restore').disabled = busy || !isUnlocked() || !status.hasRemoteBackup;
      const isNew = $('github-mode').value === 'new';
      $('github-recovery-key').readOnly = isNew;
      $('github-generate-key').classList.toggle('hidden', !isNew);
      $('github-copy-key').disabled = busy || !$('github-recovery-key').value || !isUnlocked();
      $('github-submit').textContent = busy ? localized('连接中…', 'CONNECTING…') : localized(...copy['github-submit']);
    }

    async function refresh() {
      if (busy || refreshing || !isUnlocked()) return render();
      refreshing = true;
      try { status = await invoke('github_backup_status'); }
      catch (error) { lastError = error; }
      finally { refreshing = false; render(); }
    }

    function closeModal(restoreFocus = true) {
      secretEpoch += 1;
      modal.classList.add('hidden');
      $('github-form').reset();
      $('github-token').value = '';
      $('github-recovery-key').value = '';
      formError = '';
      inertElements.forEach((element) => { element.inert = false; });
      inertElements = [];
      if (restoreFocus && previousFocus?.isConnected && !previousFocus.closest('.hidden')) previousFocus.focus();
      previousFocus = null;
    }

    function clearSecrets() {
      closeModal(false);
      $('github-saved-key').value = '';
      $('github-key-display').classList.add('hidden');
    }

    function openModal() {
      if (busy || !isUnlocked()) return;
      clearSecrets();
      previousFocus = document.activeElement;
      $('github-repository').value = status.repository || '';
      $('github-mode').value = status.hasRemoteBackup ? 'existing' : 'new';
      inertElements = [...document.body.children].filter((element) => element !== modal && !element.inert && !['SCRIPT', 'STYLE'].includes(element.tagName));
      inertElements.forEach((element) => { element.inert = true; });
      modal.classList.remove('hidden');
      render();
      $('github-repository').focus();
    }

    async function operate(action) {
      if (busy || !isUnlocked()) return;
      busy = true;
      lastError = '';
      render();
      try { await action(); }
      catch (error) { lastError = error; toast(errorText(error), 'error'); }
      finally { busy = false; await refresh(); }
    }

    $('github-connect').addEventListener('click', openModal);
    $('github-reconfigure').addEventListener('click', openModal);
    $('github-modal-close').addEventListener('click', () => { if (!busy) closeModal(); });
    modal.addEventListener('click', (event) => { if (event.target === modal && !busy) closeModal(); });
    modal.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) closeModal(); }
      if (event.key === 'Tab') {
        const focusable = [...modal.querySelectorAll('button, input, select, textarea')].filter((element) => !element.disabled && !element.closest('.hidden'));
        if (!focusable.length) { event.preventDefault(); return; }
        const index = focusable.indexOf(document.activeElement);
        if ((event.shiftKey && index <= 0) || (!event.shiftKey && index === focusable.length - 1)) {
          event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0].focus();
        }
      }
    });
    $('github-mode').addEventListener('change', () => {
      secretEpoch += 1;
      $('github-recovery-key').value = '';
      $('github-key-saved').checked = false;
      render();
    });
    $('github-recovery-key').addEventListener('input', () => { $('github-key-saved').checked = false; render(); });
    $('github-generate-key').addEventListener('click', async () => {
      const epoch = secretEpoch;
      try {
        const key = await invoke('github_backup_generate_key');
        if (epoch !== secretEpoch || !isUnlocked() || modal.classList.contains('hidden')) return;
        $('github-recovery-key').value = key;
        $('github-key-saved').checked = false;
        render();
      } catch (error) { formError = error; render(); }
    });
    async function copyKey(id) {
      const value = $(id).value;
      if (!value || !isUnlocked()) return;
      try { await invoke('copy_owner_value', { value }); toast(localized('密钥已复制，请保存在仓库之外', 'Key copied. Save it outside the repository.')); }
      catch (error) { toast(errorText(error), 'error'); }
    }
    $('github-copy-key').addEventListener('click', () => copyKey('github-recovery-key'));
    $('github-copy-saved-key').addEventListener('click', () => copyKey('github-saved-key'));
    $('github-show-key').addEventListener('click', async () => {
      const epoch = secretEpoch;
      try {
        const key = await invoke('github_backup_recovery_key');
        if (epoch !== secretEpoch || !isUnlocked()) return;
        $('github-saved-key').value = key;
        $('github-key-display').classList.remove('hidden');
        $('github-saved-key').focus();
      } catch (error) { lastError = error; render(); }
    });
    $('github-hide-key').addEventListener('click', clearSecrets);
    for (const button of document.querySelectorAll('[data-github-help]')) button.addEventListener('click', async () => {
      try { await invoke('github_backup_help', { page: button.dataset.githubHelp }); }
      catch (error) { formError = error; render(); }
    });
    $('github-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !isUnlocked()) return;
      if (!/^okv1_[A-Za-z0-9_-]{43}$/.test($('github-recovery-key').value.trim())) {
        formError = 'GITHUB_KEY_INVALID'; render(); return;
      }
      const input = { repository: $('github-repository').value.trim(), token: $('github-token').value.trim(), recoveryKey: $('github-recovery-key').value.trim(), mode: $('github-mode').value, recoveryKeySaved: $('github-key-saved').checked };
      busy = true; formError = ''; render();
      try {
        status = await invoke('github_backup_connect', { input });
        lastError = '';
        closeModal();
        toast(status.needsRestore ? localized('连接成功，请先恢复云端备份', 'Connected. Restore the remote backup first.') : localized('连接成功，可以备份了', 'Connected. Ready to back up.'));
      } catch (error) { formError = error; }
      finally { input.token = ''; input.recoveryKey = ''; busy = false; render(); }
    });
    $('github-upload').addEventListener('click', async () => {
      if (busy || !await confirmAction({ title: localized('上传加密备份？', 'Upload encrypted backup?'), message: localized(`将整个保险库加密上传到 ${status.repository}。GitHub 历史会保留旧版密文。`, `Encrypt and upload the entire vault to ${status.repository}. GitHub history retains older encrypted snapshots.`), acceptLabel: localized('立即备份', 'BACK UP'), tag: localized('手动云端备份', 'MANUAL CLOUD BACKUP') })) return;
      await operate(async () => { status = await invoke('github_backup_upload'); toast(localized('加密备份已上传', 'Encrypted backup uploaded')); });
    });
    $('github-restore').addEventListener('click', async () => {
      if (busy || !await confirmAction({ title: localized('恢复云端备份？', 'Restore remote backup?'), message: localized('云端项目会合并到本机。相同内容不重复导入；同名但内容不同的项目会另存，现有项目不会被覆盖或删除。', 'Merge cloud items into this device. Identical items are skipped; differing items are kept separately. Existing items are never overwritten or deleted.'), acceptLabel: localized('恢复并合并', 'RESTORE & MERGE'), tag: localized('恢复加密备份', 'RESTORE BACKUP') })) return;
      await operate(async () => {
        const result = await invoke('github_backup_restore'); status = result.status;
        toast(localized(`恢复完成：新增 ${result.summary.added}，跳过重复 ${result.summary.merged}`, `Restored: ${result.summary.added} added, ${result.summary.merged} duplicates skipped`));
        await onRestore();
      });
    });
    $('github-disconnect').addEventListener('click', async () => {
      if (busy || !await confirmAction({ title: localized('断开 GitHub 备份？', 'Disconnect GitHub backup?'), message: localized('移除此设备保存的令牌和恢复密钥。仓库中的备份及本机项目会保留；请确保另有恢复密钥副本。', 'Remove this device’s saved token and recovery key. Remote backups and local items remain. Make sure you have a separate copy of your recovery key.'), acceptLabel: localized('断开', 'DISCONNECT'), tag: localized('移除本机连接', 'REMOVE LOCAL CONNECTION') })) return;
      await operate(async () => { status = await invoke('github_backup_disconnect'); clearSecrets(); toast(localized('已断开，云端备份已保留', 'Disconnected. Remote backups are retained.')); });
    });
    document.addEventListener('click', (event) => { const nav = event.target.closest('[data-page]'); if (nav && nav.dataset.page !== 'settings') clearSecrets(); });
    window.addEventListener('pagehide', clearSecrets);
    return { render, refresh, clearSecrets, isOpen: () => !modal.classList.contains('hidden') };
  },
};
