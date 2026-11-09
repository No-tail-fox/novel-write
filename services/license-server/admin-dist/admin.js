(() => {
  const loginView = document.querySelector('#login-view');
  const adminView = document.querySelector('#admin-view');
  const loginForm = document.querySelector('#login-form');
  const loginPassword = document.querySelector('#login-password');
  const loginError = document.querySelector('#login-error');
  const rows = document.querySelector('#announcement-rows');
  const categoryFilter = document.querySelector('#category-filter');
  const listCount = document.querySelector('#list-count');
  const listEmpty = document.querySelector('#list-empty');
  const listError = document.querySelector('#list-error');
  const announcementForm = document.querySelector('#announcement-form');
  const titleInput = document.querySelector('#announcement-title');
  const bodyInput = document.querySelector('#announcement-body');
  const titleCount = document.querySelector('#title-count');
  const bodyCount = document.querySelector('#body-count');
  const publishError = document.querySelector('#publish-error');
  const publishSuccess = document.querySelector('#publish-success');
  const publishButton = document.querySelector('#publish-button');
  const toast = document.querySelector('#toast');
  let announcements = [];
  let toastTimer;
  let activeView = 'announcements';
  let uploadId = null;
  let blockmapUploadId = null;
  let uploading = false;
  let serverNow = Date.now() / 1000;
  const lists = Object.fromEntries(['licenses', 'devices', 'releases', 'audit'].map((kind) => [kind, { page: 1, q: '' }]));
  const viewNames = { announcements: ['公告', '问题公告与版本更新公告'], releases: ['版本更新', 'Windows x64 · 签名发布'], licenses: ['授权码', '客户授权与设备名额'], devices: ['设备', '绑定记录与机器访问权限'], audit: ['操作记录', '授权、设备和发布操作'] };
  const errors = { RELEASE_MUST_INCREASE: '版本号必须高于所有已发布版本。', INVALID_RELEASE: '请检查版本号、最低版本和更新说明。', INVALID_VERSION: '版本号应为三段数字，例如 1.0.4。', INVALID_WINDOWS_INSTALLER: '文件不是有效的 Windows 安装包。', INVALID_INSTALLER_UPLOAD: '安装包大小须在 2 字节至 4 GB 之间。', INVALID_BLOCKMAP: '差分索引无效或与安装包不匹配，请选择同一次打包生成的 .exe.blockmap 文件。', UPLOAD_BUSY: '另一个安装包正在处理，请稍后重试。', UPLOAD_NOT_FOUND: '暂存安装包已失效，请重新选择文件。', INSUFFICIENT_DISK_SPACE: '服务器空间不足，无法安全完成发布。', INVALID_LICENSE_PARAMETERS: '请检查授权天数和设备名额。', RATE_LIMITED: '操作过于频繁，请稍后重试。', SERVER_UNAVAILABLE: '服务器暂时不可用，请稍后重试。' };

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(errors[result.error] || result.error || `请求失败 (${response.status})`);
      error.status = response.status;
      if (result.error === 'UPLOAD_NOT_FOUND') { uploadId = null; blockmapUploadId = null; }
      throw error;
    }
    return result;
  }

  function showLogin(message = '') {
    document.querySelector('#issued-code').value = '';
    document.querySelector('#license-result').hidden = true;
    loginView.hidden = false;
    adminView.hidden = true;
    loginError.hidden = !message;
    loginError.textContent = message;
  }

  function showAdmin() {
    loginView.hidden = true;
    adminView.hidden = false;
  }

  function formatDate(timestamp) {
    if (timestamp == null || !Number.isFinite(Number(timestamp))) return '—';
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(timestamp) * 1000));
  }

  function makeCell(className, text) {
    const cell = document.createElement('td');
    if (className) cell.className = className;
    cell.textContent = text;
    return cell;
  }

  function renderAnnouncements() {
    rows.replaceChildren();
    const filter = categoryFilter.value;
    const visible = announcements.filter((item) => filter === 'all' || item.category === filter);
    listCount.textContent = `${visible.length} 条公告`;
    listEmpty.hidden = visible.length !== 0;

    for (const item of visible) {
      const row = document.createElement('tr');
      const titleCell = document.createElement('td');
      const title = document.createElement('div');
      title.className = 'notice-title';
      title.textContent = item.title;
      const body = document.createElement('div');
      body.className = 'notice-body';
      body.textContent = item.body;
      titleCell.append(title, body);

      const categoryCell = document.createElement('td');
      const category = document.createElement('span');
      category.className = `badge ${item.category === 'update' ? 'badge-update' : 'badge-problem'}`;
      category.textContent = item.category === 'update' ? `版本更新${item.version ? ` · ${item.version}` : ''}` : '问题公告';
      categoryCell.append(category);

      const stateCell = document.createElement('td');
      const state = document.createElement('span');
      state.className = `badge ${item.withdrawn ? 'badge-withdrawn' : 'badge-active'}`;
      state.textContent = item.withdrawn ? '已撤回' : '已发布';
      stateCell.append(state);

      row.append(titleCell, categoryCell, makeCell('', formatDate(item.created_at)), stateCell);
      const actionCell = document.createElement('td');
      if (item.category === 'problem' && !item.withdrawn) {
        const withdraw = document.createElement('button');
        withdraw.className = 'button button-danger';
        withdraw.type = 'button';
        withdraw.textContent = '撤回';
        withdraw.setAttribute('aria-label', `撤回公告：${item.title}`);
        withdraw.addEventListener('click', () => withdrawAnnouncement(item));
        actionCell.append(withdraw);
      }
      row.append(actionCell);
      rows.append(row);
    }
  }

  async function loadAnnouncements() {
    listError.hidden = true;
    listCount.textContent = '正在加载';
    try {
      const result = await request('/admin/api/announcements');
      announcements = result.announcements;
      renderAnnouncements();
    } catch (error) {
      if (error.status === 401) return showLogin('登录状态已失效，请重新登录。');
      listCount.textContent = '加载失败';
      listError.hidden = false;
      listError.textContent = error.message;
    }
  }

  async function withdrawAnnouncement(item) {
    if (!window.confirm(`确认撤回“${item.title}”？撤回后客户端下次检查时将不再收到。`)) return;
    try {
      await request(`/admin/api/announcements/${encodeURIComponent(item.id)}/withdraw`, { method: 'POST' });
      await refreshView();
      toast.textContent = '公告已撤回';
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
    } catch (error) {
      if (error.status === 401) return showLogin('登录状态已失效，请重新登录。');
      window.alert(`撤回失败：${error.message}`);
    }
  }

  function updateCounts() {
    titleCount.textContent = String(titleInput.value.length);
    bodyCount.textContent = String(bodyInput.value.length);
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.hidden = true;
    const button = loginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await request('/admin/api/login', { method: 'POST', body: JSON.stringify({ password: loginPassword.value }) });
      loginPassword.value = '';
      showAdmin();
      await refreshView();
    } catch (error) {
      loginError.hidden = false;
      loginError.textContent = error.status === 429 ? '尝试次数过多，请稍后再试。' : error.status === 503 ? '后台尚未初始化管理员密码，请先在服务器设置。' : '密码错误或登录失败，请重试。';
      loginPassword.select();
    } finally {
      button.disabled = false;
    }
  });

  announcementForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    publishError.hidden = true;
    publishSuccess.hidden = true;
    publishButton.disabled = true;
    publishButton.textContent = '正在发布…';
    try {
      await request('/admin/api/announcements', {
        method: 'POST',
        body: JSON.stringify({ title: titleInput.value, body: bodyInput.value }),
      });
      announcementForm.reset();
      updateCounts();
      publishSuccess.hidden = false;
      await refreshView();
    } catch (error) {
      if (error.status === 401) return showLogin('登录状态已失效，请重新登录。');
      publishError.hidden = false;
      publishError.textContent = error.status === 429 ? '操作过于频繁，请稍后重试。' : '发布失败：请检查标题和正文长度后重试。';
    } finally {
      publishButton.disabled = false;
      publishButton.textContent = '发布公告';
    }
  });

  function notify(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
  }

  function handleError(error) {
    if (error.status === 401) return showLogin('登录状态已失效，请重新登录。');
    notify(error.message || '网络连接失败，请重试。');
  }

  function detailCell(primary, secondary = '') {
    const cell = document.createElement('td');
    const title = document.createElement('div');
    title.className = 'record-title';
    title.textContent = primary;
    const detail = document.createElement('div');
    detail.className = 'record-detail';
    detail.textContent = secondary;
    cell.append(title, detail);
    return cell;
  }

  function stateCell(text, active) {
    const cell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${active ? 'badge-active' : 'badge-withdrawn'}`;
    badge.textContent = text;
    cell.append(badge);
    return cell;
  }

  function actionButton(label, action, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${danger ? 'button-danger' : 'button-secondary'}`;
    button.textContent = label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await action(); } catch (error) { handleError(error); } finally { button.disabled = false; }
    });
    return button;
  }

  async function mutation(path, message, body) {
    if (!window.confirm(message)) return;
    await request(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
    await refreshView();
    notify('操作已完成');
  }

  async function loadList(kind) {
    const state = lists[kind];
    const result = await request(`/admin/api/${kind}?${new URLSearchParams({ q: state.q, page: state.page })}`);
    const target = document.querySelector(`#${kind}-rows`);
    target.replaceChildren();
    for (const item of result.items) {
      const row = document.createElement('tr');
      const actions = document.createElement('td');
      actions.className = 'row-actions';
      if (kind === 'licenses') {
        const expired = item.expires_at != null && item.expires_at <= serverNow;
        row.append(detailCell(item.label || '未命名客户', `尾号 ${item.tail} · ${item.id}`), makeCell('', `${item.seats} / ${item.max_devices}`), detailCell(item.started_at == null ? '未激活' : formatDate(item.expires_at), `${item.days} 天`), stateCell(item.revoked ? '已停用' : expired ? '已过期' : item.started_at == null ? '待激活' : '有效', !item.revoked && !expired));
        const operation = item.revoked ? 'restore' : 'revoke';
        actions.append(actionButton(item.revoked ? '恢复' : '停用', () => mutation(`/admin/api/licenses/${item.id}/${operation}`, `确认${item.revoked ? '恢复' : '停用'}授权「${item.label || item.tail}」？设备将在下次授权验证时生效。`), !item.revoked));
        actions.append(actionButton('续期', async () => {
          const input = window.prompt('增加有效天数（过期授权从当前时间起续期；停用状态不变）', '30');
          if (input == null) return;
          const days = Number(input);
          if (!Number.isInteger(days) || days < 1 || days > 36500) throw new Error('请输入 1 至 36500 的整数天数。');
          await mutation(`/admin/api/licenses/${item.id}/extend`, `确认增加 ${days} 天有效期？`, { days });
        }));
        row.append(actions);
      } else if (kind === 'devices') {
        row.append(detailCell(item.label || '未命名设备', item.device_id), detailCell(item.license_label || '未命名客户', `授权尾号 ${item.tail}`), makeCell('', formatDate(item.last_seen)), stateCell(item.locked ? '已锁定' : item.released ? '已解绑' : '已绑定', !item.locked && !item.released));
        actions.append(actionButton(item.locked ? '解锁' : '锁定', async () => {
          const reason = item.locked ? '' : window.prompt('锁定原因（最多 500 字）', '');
          if (reason == null) return;
          if (reason.length > 500) throw new Error('锁定原因不能超过 500 字。');
          await mutation(`/admin/api/devices/${item.device_id}/${item.locked ? 'unlock' : 'lock'}`, `确认${item.locked ? '解锁' : '锁定'}设备「${item.label || item.device_id}」？将在下次授权验证时生效。`, { reason });
        }, !item.locked));
        if (!item.released) actions.append(actionButton('解绑', () => mutation(`/admin/api/devices/${item.device_id}/release`, '确认解绑这台设备并释放名额？未被锁定的设备仍可使用有效授权码重新激活。', {}), true));
        row.append(actions);
      } else if (kind === 'releases') {
        row.append(detailCell(item.version, `最低版本 ${item.minimumVersion}`), detailCell(`${(item.size / 1024 ** 2).toFixed(1)} MB`, `SHA-256 ${item.sha256}`), makeCell('', formatDate(item.issuedAt)), stateCell(item.withdrawn ? '已撤回' : '已发布', !item.withdrawn));
        if (!item.withdrawn) actions.append(actionButton('撤回', () => mutation(`/admin/api/releases/${item.version}/withdraw`, `确认撤回 ${item.version}？安装包下载与更新公告将同时停止；不会回退到旧版本。`), true));
        row.append(actions);
        row.title = item.notes || '';
      } else {
        const names = { issue: '签发授权', 'revoke-license': '停用授权', 'restore-license': '恢复授权', 'extend-license': '延长授权（天）', 'lock-device': '锁定设备', 'unlock-device': '解锁设备', 'release-device': '解绑设备', publish: '发布版本', withdraw: '撤回版本', announce: '发布公告', 'withdraw-announcement': '撤回公告' };
        row.append(makeCell('', formatDate(item.at)), makeCell('', names[item.action] || item.action), detailCell(item.target), detailCell(item.detail || '—'));
      }
      target.append(row);
    }
    if (!result.items.length) {
      const row = document.createElement('tr');
      const cell = makeCell('empty-state', state.q ? '没有匹配记录' : '暂无记录');
      cell.colSpan = kind === 'audit' ? 4 : 5;
      row.append(cell);
      target.append(row);
    }
    const pager = document.querySelector(`#${kind}-pager`);
    const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
    const previous = actionButton('上一页', async () => { state.page -= 1; await loadList(kind); });
    const next = actionButton('下一页', async () => { state.page += 1; await loadList(kind); });
    previous.disabled = state.page <= 1;
    next.disabled = state.page >= pages;
    const label = document.createElement('span');
    label.textContent = `共 ${result.total} 条 · ${state.page} / ${pages} 页`;
    pager.replaceChildren(label, previous, next);
  }

  async function refreshView() {
    try {
      const result = await request('/admin/api/summary');
      serverNow = result.serverTime;
      const strip = document.querySelector('#summary-strip');
      strip.replaceChildren();
      for (const [name, value] of [['授权码', result.licenses], ['绑定设备', result.devices], ['已锁定', result.blockedDevices], ['最新版本', result.latestRelease ? `${result.latestRelease.version}${result.latestRelease.withdrawn ? '（已撤回）' : ''}` : '未发布']]) {
        const metric = document.createElement('div');
        const caption = document.createElement('span');
        const number = document.createElement('strong');
        caption.textContent = name;
        number.textContent = value;
        metric.append(caption, number);
        strip.append(metric);
      }
      if (activeView === 'announcements') await loadAnnouncements();
      else await loadList(activeView);
    } catch (error) { handleError(error); }
  }

  for (const button of document.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => {
      activeView = button.dataset.view;
      for (const tab of document.querySelectorAll('[data-view]')) tab.setAttribute('aria-pressed', String(tab === button));
      for (const view of document.querySelectorAll('.module-view')) view.hidden = view.id !== `view-${activeView}`;
      document.querySelector('#view-title').textContent = viewNames[activeView][0];
      document.querySelector('#view-subtitle').textContent = viewNames[activeView][1];
      void refreshView();
    });
  }
  for (const form of document.querySelectorAll('.search-form')) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const kind = form.dataset.kind;
      lists[kind] = { page: 1, q: new FormData(form).get('q').trim() };
      try { await loadList(kind); } catch (error) { handleError(error); }
    });
  }

  document.querySelector('#license-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!window.confirm('确认按当前有效天数和设备名额签发一个新授权码？')) return;
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    const errorElement = document.querySelector('#license-error');
    errorElement.hidden = true;
    try {
      const result = await request('/admin/api/licenses', { method: 'POST', body: JSON.stringify({ label: document.querySelector('#license-label').value, days: Number(document.querySelector('#license-days').value), maxDevices: Number(document.querySelector('#license-seats').value) }) });
      document.querySelector('#issued-code').value = result.code;
      document.querySelector('#license-result').hidden = false;
      await refreshView();
    } catch (error) { errorElement.textContent = error.message; errorElement.hidden = false; handleError(error); } finally { button.disabled = false; }
  });
  document.querySelector('#copy-code').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(document.querySelector('#issued-code').value); notify('授权码已复制'); } catch { notify('复制失败，请选中授权码手动复制。'); }
  });
  document.querySelector('#dismiss-code').addEventListener('click', () => {
    document.querySelector('#issued-code').value = '';
    document.querySelector('#license-result').hidden = true;
  });

  function upload(file, blockmap = false) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', blockmap ? '/admin/api/uploads/blockmap' : '/admin/api/uploads');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.timeout = 60 * 60 * 1000;
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.floor(event.loaded / event.total * 100);
        document.querySelector('#upload-progress').value = percent;
        document.querySelector('#upload-status').textContent = `${blockmap ? '差分索引' : '安装包'}正在上传 ${percent}%`;
      };
      xhr.onload = () => {
        let result;
        try { result = JSON.parse(xhr.responseText); } catch { return reject(new Error('上传响应无效，请重试。')); }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(result);
        const error = new Error(errors[result.error] || result.error || '上传失败');
        error.status = xhr.status;
        reject(error);
      };
      xhr.onerror = () => reject(new Error('安装包上传失败，请检查网络后重试。'));
      xhr.ontimeout = () => reject(new Error('安装包上传超时，请重试。'));
      xhr.send(file);
    });
  }
  document.querySelector('#release-file').addEventListener('change', () => {
    uploadId = null; blockmapUploadId = null; document.querySelector('#release-blockmap').value = '';
  });
  document.querySelector('#release-blockmap').addEventListener('change', () => { blockmapUploadId = null; });
  document.querySelector('#release-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const file = document.querySelector('#release-file').files[0];
    if (!file || !file.name.toLowerCase().endsWith('.exe') || file.size < 2 || file.size > 4 * 1024 ** 3) return notify('请选择不超过 4 GB 的 Windows .exe 安装包。');
    const blockmap = document.querySelector('#release-blockmap').files[0];
    if (blockmap && (blockmap.name !== `${file.name}.blockmap` || blockmap.size < 2 || blockmap.size > 8 * 1024 ** 2)) return notify('请选择与安装包同名、不超过 8 MB 的 .exe.blockmap 文件。');
    const version = document.querySelector('#release-version').value;
    const minimumVersion = document.querySelector('#release-minimum').value;
    const notes = document.querySelector('#release-notes').value;
    if (!window.confirm(`确认发布 ${version} 并向所有客户端提供更新？最低版本为 ${minimumVersion}，更新公告将自动发布。`)) return;
    const errorElement = document.querySelector('#release-error');
    errorElement.hidden = true;
    uploading = true;
    document.querySelector('#logout-button').disabled = true;
    for (const control of form.elements) control.disabled = true;
    document.querySelector('#upload-progress').hidden = false;
    try {
      if (!uploadId) uploadId = (await upload(file)).uploadId;
      if (blockmap && !blockmapUploadId) blockmapUploadId = (await upload(blockmap, true)).uploadId;
      document.querySelector('#upload-status').textContent = '正在校验、签名和发布';
      await request('/admin/api/releases', { method: 'POST', body: JSON.stringify({ uploadId, blockmapUploadId, version, minimumVersion, notes }) });
      uploadId = null;
      blockmapUploadId = null;
      form.reset();
      document.querySelector('#upload-status').textContent = blockmap ? '差分更新版本及公告已发布' : '全量更新版本及公告已发布';
      await refreshView();
    } catch (error) { errorElement.textContent = error.message; errorElement.hidden = false; handleError(error); } finally {
      uploading = false;
      for (const control of form.elements) control.disabled = false;
      document.querySelector('#logout-button').disabled = false;
    }
  });
  window.addEventListener('beforeunload', (event) => { if (uploading) { event.preventDefault(); event.returnValue = ''; } });

  document.querySelector('#refresh-button').addEventListener('click', refreshView);
  document.querySelector('#logout-button').addEventListener('click', async () => {
    try { await request('/admin/api/logout', { method: 'POST' }); showLogin(); } catch (error) { handleError(error); }
  });
  categoryFilter.addEventListener('change', renderAnnouncements);
  titleInput.addEventListener('input', updateCounts);
  bodyInput.addEventListener('input', updateCounts);

  request('/admin/api/session')
    .then(() => { showAdmin(); return refreshView(); })
    .catch(() => showLogin());
})();
