// 传纸条 - 局域网文本互发
(function() {
  var SERVICE_KEY = 'lan-clipboard';
  var HISTORY_KEY = 'clip_history';
  var MAX_HISTORY = 50;

  var devices = [];
  var sessions = {};      // peerId -> session
  var targetPeer = null;  // { id, name }
  var history = [];

  var el = function(id) { return document.getElementById(id); };

  // ---- 网络初始化 ----

  async function initNetwork() {
    if (!window.__amiba__) {
      el('net-status').textContent = '⚠️ 网络不可用';
      return;
    }
    try {
      await __amiba__.network.setVisibility({ lan: true });
      await __amiba__.network.startListening(SERVICE_KEY);
      await __amiba__.network.startDiscovery('lan');
      el('net-status').textContent = '✅ 在线';

      // 入站会话
      __amiba__.network.onSession(function(session) {
        console.log('[Clip] === 收到连接:', session.peerName);
        bindSession(session);
        __amiba__.showToast(session.peerName + ' 已连接', 'success');
        renderDevices();
      });

      __amiba__.network.onPeerDiscovered(function() { refreshDevices(); });

      refreshDevices();
      setInterval(refreshDevices, 4000);
    } catch (e) {
      console.log('[Clip] ✗ 网络初始化失败:', e.message);
      el('net-status').textContent = '✗ 初始化失败';
    }
  }

  function bindSession(session) {
    sessions[session.peerId] = session;
    session.on('message', function(raw) {
      var msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.type === 'clip' && msg.text) {
        addHistory({ dir: 'in', peer: session.peerName || '对方', text: msg.text, at: Date.now() });
        __amiba__.showToast('📨 收到新纸条', 'none');
      }
    });
    session.on('close', function() {
      console.log('[Clip] === 会话关闭:', session.peerName);
      delete sessions[session.peerId];
      renderConnState();
    });
  }

  async function refreshDevices() {
    try {
      devices = await __amiba__.network.getVisibleDevices() || [];
      renderDevices();
    } catch (e) {
      console.log('[Clip] refreshDevices error:', e.message);
    }
  }

  // ---- 设备选择 / 连接 ----

  function renderDevices() {
    var box = el('device-list');
    if (devices.length === 0) {
      box.innerHTML = '<p class="hint">🔍 未发现设备，请确认对方也打开了传纸条</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      var active = targetPeer && targetPeer.id === d.id ? ' active' : '';
      var connected = sessions[d.id] ? ' 🟢' : '';
      html += '<div class="device-item' + active + '" data-id="' + d.id + '">';
      html += '  <div><div class="device-name">' + _esc(d.name) + connected + '</div>';
      html += '  <div class="device-addr">' + _esc(d.address || '') + '</div></div>';
      html += '  <span>›</span>';
      html += '</div>';
    }
    box.innerHTML = html;

    var items = box.querySelectorAll('.device-item');
    for (var j = 0; j < items.length; j++) {
      items[j].onclick = function() { selectDevice(this.getAttribute('data-id')); };
    }
  }

  async function selectDevice(peerId) {
    var d = null;
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === peerId) { d = devices[i]; break; }
    }
    if (!d) return;

    targetPeer = { id: d.id, name: d.name };
    el('target-name').textContent = d.name;
    el('send-section').style.display = 'block';
    renderDevices();
    renderConnState();

    // 已有会话则复用，否则主动连接
    if (!sessions[peerId]) {
      el('conn-state').textContent = '连接中...';
      try {
        var session = await __amiba__.network.connect(peerId, SERVICE_KEY);
        bindSession(session);
        console.log('[Clip] ✓ 已连接:', d.name);
      } catch (e) {
        console.log('[Clip] ✗ 连接失败:', e.message);
        el('conn-state').textContent = '连接失败';
        __amiba__.showToast('连接失败: ' + (e.message || e), 'error');
        return;
      }
    }
    renderConnState();
  }

  function renderConnState() {
    if (!targetPeer) return;
    var s = sessions[targetPeer.id];
    el('conn-state').textContent = s ? '已连接' : '未连接';
    el('conn-state').className = 'conn-state' + (s ? ' ok' : '');
  }

  // ---- 发送 ----

  el('btn-send').onclick = function() {
    var text = el('msg-input').value.trim();
    if (!text) return;
    if (!targetPeer || !sessions[targetPeer.id]) {
      __amiba__.showToast('请先选择设备并连接', 'error');
      return;
    }
    try {
      sessions[targetPeer.id].send(JSON.stringify({ type: 'clip', text: text }));
      addHistory({ dir: 'out', peer: targetPeer.name, text: text, at: Date.now() });
      el('msg-input').value = '';
    } catch (e) {
      __amiba__.showToast('发送失败: ' + (e.message || e), 'error');
    }
  };

  el('btn-refresh').onclick = function() { refreshDevices(); };

  el('btn-clear').onclick = async function() {
    history = [];
    await __amiba__.storage.set(HISTORY_KEY, history);
    renderHistory();
  };

  // ---- 历史 ----

  async function addHistory(item) {
    history.unshift(item);
    if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
    await __amiba__.storage.set(HISTORY_KEY, history);
    renderHistory();
  }

  async function loadHistory() {
    var saved = await __amiba__.storage.get(HISTORY_KEY);
    history = Array.isArray(saved) ? saved : [];
    renderHistory();
  }

  function renderHistory() {
    el('empty-tip').style.display = history.length === 0 ? 'block' : 'none';
    var html = '';
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      var dirLabel = h.dir === 'in'
        ? '<span class="dir-in">← 来自 ' + _esc(h.peer) + '</span>'
        : '<span class="dir-out">→ 发给 ' + _esc(h.peer) + '</span>';
      html += '<div class="history-item">';
      html += '  <div class="history-head">' + dirLabel + '<span>' + _formatTime(h.at) + '</span></div>';
      html += '  <div class="history-text">' + _esc(h.text) + '</div>';
      html += '</div>';
    }
    el('history-list').innerHTML = html;
  }

  // ---- 工具 ----

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function _formatTime(ts) {
    var d = new Date(ts);
    var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  loadHistory();
  initNetwork();
})();
