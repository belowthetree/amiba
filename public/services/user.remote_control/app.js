// 演示遥控器 - 放映端 / 遥控端
(function() {
  var SERVICE_KEY = 'remote-control';

  // 内置幻灯片
  var SLIDES = [
    { emoji: '🎬', title: '演示遥控器', body: '用另一台设备远程翻页\n打开手机或电脑上的同一服务即可控制' },
    { emoji: '📊', title: '第一页：数据', body: '季度增长 +42%\n用户活跃 +18%\n满意度 4.8 / 5.0' },
    { emoji: '💡', title: '第二页：想法', body: '简单 > 完备\n标准 > 自创\n调试友好 > 性能极致' },
    { emoji: '🚀', title: '第三页：计划', body: '第一阶段：打好基础\n第二阶段：完善生态\n第三阶段：持续演进' },
    { emoji: '🎉', title: '谢谢观看', body: '由变形虫演示遥控器呈现' }
  ];

  var mode = null;           // 'screen' | 'remote'
  var current = 0;
  var blanked = false;
  var screenSession = null;  // 放映端：遥控端会话
  var remoteSession = null;  // 遥控端：到放映端的会话
  var devices = [];

  var el = function(id) { return document.getElementById(id); };

  // ============================================================
  // 公共网络初始化
  // ============================================================

  async function initNetwork() {
    if (!window.__amiba__) return false;
    try {
      await __amiba__.network.setVisibility({ lan: true });
      await __amiba__.network.startListening(SERVICE_KEY);
      await __amiba__.network.startDiscovery('lan');

      // 入站会话（放映端收到遥控端连接）
      __amiba__.network.onSession(function(session) {
        console.log('[Remote] === 收到连接:', session.peerName);
        if (mode === 'screen') {
          screenSession = session;
          el('screen-status').textContent = '🟢 遥控端已连接: ' + (session.peerName || '对方');
          sendState();
          session.on('message', function(raw) { onScreenMessage(raw); });
          session.on('close', function() {
            screenSession = null;
            el('screen-status').textContent = '🔍 等待遥控端连接';
          });
        }
      });

      __amiba__.network.onPeerDiscovered(function() { if (mode === 'remote') refreshDevices(); });
      return true;
    } catch (e) {
      console.log('[Remote] ✗ 网络初始化失败:', e.message);
      return false;
    }
  }

  // ============================================================
  // 放映端
  // ============================================================

  function enterScreen() {
    mode = 'screen';
    el('mode-view').style.display = 'none';
    el('screen-view').style.display = 'flex';
    renderSlide();
  }

  function renderSlide() {
    var s = SLIDES[current];
    el('slide-emoji').textContent = s.emoji;
    el('slide-title').textContent = s.title;
    el('slide-body').textContent = s.body;
    el('screen-page').textContent = (current + 1) + ' / ' + SLIDES.length;
    el('slide-stage').className = 'slide-stage' + (blanked ? ' blank' : '');
  }

  function onScreenMessage(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    console.log('[Remote] ← 指令:', msg.cmd);

    if (msg.type !== 'cmd') return;
    switch (msg.cmd) {
      case 'next':
        if (current < SLIDES.length - 1) current++;
        break;
      case 'prev':
        if (current > 0) current--;
        break;
      case 'goto':
        if (msg.index >= 0 && msg.index < SLIDES.length) current = msg.index;
        break;
      case 'blank':
        blanked = !blanked;
        break;
    }
    renderSlide();
    sendState();
  }

  function sendState() {
    if (!screenSession) return;
    try {
      screenSession.send(JSON.stringify({
        type: 'state',
        index: current,
        total: SLIDES.length,
        blanked: blanked
      }));
    } catch (e) { /* 会话可能已断开 */ }
  }

  // ============================================================
  // 遥控端
  // ============================================================

  function enterRemote() {
    mode = 'remote';
    el('mode-view').style.display = 'none';
    el('remote-view').style.display = 'block';
    refreshDevices();
    setInterval(function() { if (mode === 'remote') refreshDevices(); }, 4000);
  }

  async function refreshDevices() {
    try {
      devices = await __amiba__.network.getVisibleDevices() || [];
      renderDevices();
    } catch (e) {
      console.log('[Remote] refreshDevices error:', e.message);
    }
  }

  function renderDevices() {
    var box = el('device-list');
    if (devices.length === 0) {
      box.innerHTML = '<p class="hint">🔍 未发现设备，请确认对方选择了「放映端」</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      html += '<div class="device-item" data-id="' + d.id + '">';
      html += '  <div><div class="device-name">' + _esc(d.name) + '</div>';
      html += '  <div class="device-addr">' + _esc(d.address || '') + '</div></div>';
      html += '  <span>›</span>';
      html += '</div>';
    }
    box.innerHTML = html;

    var items = box.querySelectorAll('.device-item');
    for (var j = 0; j < items.length; j++) {
      items[j].onclick = function() { connectTo(this.getAttribute('data-id')); };
    }
  }

  async function connectTo(peerId) {
    var d = null;
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === peerId) { d = devices[i]; break; }
    }
    if (!d) return;

    try {
      remoteSession = await __amiba__.network.connect(peerId, SERVICE_KEY);
      console.log('[Remote] ✓ 已连接:', d.name);
      el('remote-target').textContent = '🟢 ' + d.name;
      el('remote-devices').style.display = 'none';
      el('remote-controls').style.display = 'block';

      remoteSession.on('message', function(raw) {
        var msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        if (msg.type === 'state') {
          el('remote-page').textContent = (msg.index + 1) + ' / ' + msg.total + (msg.blanked ? '（黑屏）' : '');
        }
      });
      remoteSession.on('close', function() {
        remoteSession = null;
        el('remote-controls').style.display = 'none';
        el('remote-devices').style.display = 'block';
        __amiba__.showToast('连接已断开', 'none');
      });
    } catch (e) {
      console.log('[Remote] ✗ 连接失败:', e.message);
      __amiba__.showToast('连接失败: ' + (e.message || e), 'error');
    }
  }

  function sendCmd(cmd, extra) {
    if (!remoteSession) {
      __amiba__.showToast('未连接放映端', 'error');
      return;
    }
    var msg = { type: 'cmd', cmd: cmd };
    if (extra) for (var k in extra) msg[k] = extra[k];
    try { remoteSession.send(JSON.stringify(msg)); } catch (e) {
      __amiba__.showToast('发送失败', 'error');
    }
  }

  // ============================================================
  // 事件绑定
  // ============================================================

  el('btn-mode-screen').onclick = function() { enterScreen(); };
  el('btn-mode-remote').onclick = function() { enterRemote(); };

  el('btn-exit-screen').onclick = function() {
    mode = null;
    if (screenSession) { try { screenSession.close(); } catch (e) {} screenSession = null; }
    current = 0; blanked = false;
    el('screen-view').style.display = 'none';
    el('mode-view').style.display = 'block';
  };

  el('btn-exit-remote').onclick = function() {
    mode = null;
    if (remoteSession) { try { remoteSession.close(); } catch (e) {} remoteSession = null; }
    el('remote-view').style.display = 'none';
    el('remote-controls').style.display = 'none';
    el('remote-devices').style.display = 'block';
    el('mode-view').style.display = 'block';
  };

  el('btn-refresh').onclick = function() { refreshDevices(); };
  el('btn-next').onclick = function() { sendCmd('next'); };
  el('btn-prev').onclick = function() { sendCmd('prev'); };
  el('btn-blank').onclick = function() { sendCmd('blank'); };

  // 放映端键盘翻页（本机调试方便）
  document.addEventListener('keydown', function(e) {
    if (mode !== 'screen') return;
    if (e.key === 'ArrowRight' || e.key === ' ') {
      if (current < SLIDES.length - 1) current++;
      renderSlide(); sendState();
    } else if (e.key === 'ArrowLeft') {
      if (current > 0) current--;
      renderSlide(); sendState();
    }
  });

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  initNetwork();
})();
