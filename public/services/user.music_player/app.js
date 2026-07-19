// 音乐播放器 - 前台逻辑
(function() {
  var token = null;
  var tracks = [];
  var currentIndex = -1;
  var isPlaying = false;
  var playMode = 'sequence'; // sequence | loop | shuffle
  var filterKeyword = '';
  var duration = 0;
  var position = 0;
  var seeking = false;

  var el = function(id) { return document.getElementById(id); };

  // 检测是否为 Android 平台
  var isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

  var MODES = ['sequence', 'loop', 'shuffle'];
  var MODE_ICONS = { sequence: '🔁', loop: '🔂', shuffle: '🔀' };
  var MODE_NAMES = { sequence: '顺序播放', loop: '单曲循环', shuffle: '随机播放' };

  // ---- 文件夹选择 ----

  el('btn-pick-folder').onclick = async function() {
    try {
      el('btn-pick-folder').textContent = '选择中...';
      el('btn-pick-folder').disabled = true;

      var grant = await __amiba__.fileAccess.requestAccess({
        pattern: isAndroid ? '**/{*.mp3,*.flac,*.wav,*.ogg,*.m4a}' : '{*.mp3,*.flac,*.wav,*.ogg,*.m4a}',
        purpose: '扫描音乐文件用于播放'
      });

      token = grant.token;
      el('btn-pick-folder').style.display = 'none';
      el('folder-info').style.display = 'flex';
      el('folder-path').textContent = grant.path;
      el('folder-path').title = grant.path;

      await scanLibrary();
    } catch(e) {
      el('btn-pick-folder').innerHTML = '<span class="btn-icon">📁</span> 选择音乐文件夹';
      el('btn-pick-folder').disabled = false;
      if (e && e.message) __amiba__.showToast(e.message, 'error');
    }
  };

  el('btn-repick').onclick = function() {
    el('btn-pick-folder').style.display = '';
    el('folder-info').style.display = 'none';
    el('btn-pick-folder').innerHTML = '<span class="btn-icon">📁</span> 选择音乐文件夹';
    el('btn-pick-folder').disabled = false;
  };

  async function scanLibrary() {
    if (!token) return;

    el('btn-rescan').textContent = '扫描中...';
    el('btn-rescan').disabled = true;

    try {
      var files = await __amiba__.fileAccess.listFiles(token);
      tracks = files.filter(function(f) { return !f.isDir; });
      await __amiba__.storage.set('music_token', token);
      await __amiba__.storage.set('music_tracks', tracks);
      renderLibrary();
      el('library-section').style.display = 'block';
      if (tracks.length > 0) __amiba__.showToast('找到 ' + tracks.length + ' 首歌曲', 'success');
    } catch(e) {
      __amiba__.showToast('扫描失败: ' + (e.message || e), 'error');
    }

    el('btn-rescan').textContent = '🔄 重新扫描';
    el('btn-rescan').disabled = false;
  }

  el('btn-rescan').onclick = function() {
    if (!token) return;
    scanLibrary();
  };

  // ---- 搜索过滤 ----

  el('search-input').oninput = function() {
    filterKeyword = this.value.trim().toLowerCase();
    renderLibrary();
  };

  // ---- 曲库渲染 ----

  function renderLibrary() {
    el('track-count').textContent = tracks.length + ' 首歌曲';

    var list = [];
    for (var i = 0; i < tracks.length; i++) {
      var name = tracks[i].name.replace(/\.[^.]+$/, '');
      if (!filterKeyword || name.toLowerCase().indexOf(filterKeyword) >= 0) {
        list.push({ track: tracks[i], name: name, index: i });
      }
    }

    if (list.length === 0) {
      el('track-list').innerHTML = '<div class="track-empty">' +
        (filterKeyword ? '未找到匹配的歌曲' : '文件夹中没有音乐文件') + '</div>';
      return;
    }

    var html = '';
    for (var j = 0; j < list.length; j++) {
      var item = list[j];
      var active = item.index === currentIndex;
      html += '<div class="track-item' + (active ? ' active' : '') + '" data-index="' + item.index + '">';
      html += '<span class="track-num">' + (active && isPlaying
        ? '<span class="eq"><i></i><i></i><i></i></span>'
        : (item.index + 1)) + '</span>';
      html += '<span class="track-name">' + _esc(item.name) + '</span>';
      html += '<span class="track-size">' + _formatSize(item.track.size) + '</span>';
      html += '</div>';
    }
    el('track-list').innerHTML = html;

    var items = document.querySelectorAll('.track-item');
    for (var k = 0; k < items.length; k++) {
      items[k].onclick = function() {
        var idx = parseInt(this.getAttribute('data-index'));
        playTrack(idx);
      };
    }
  }

  function scrollToActive() {
    var active = document.querySelector('.track-item.active');
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---- 播放控制 ----

  async function playTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    currentIndex = index;

    var track = tracks[index];
    el('now-playing').textContent = track.name.replace(/\.[^.]+$/, '');
    el('now-playing').title = track.name;
    el('player').style.display = 'flex';
    el('btn-play').textContent = '⏳';

    try {
      await notifyBackground('play', { token: token, path: track.path, name: track.name, index: index });
      el('btn-play').textContent = '⏸️';
      isPlaying = true;
      renderLibrary();
      scrollToActive();
    } catch(e) {
      el('btn-play').textContent = '▶️';
      isPlaying = false;
      el('now-playing').textContent = '播放失败: ' + track.name;
    }
  }

  el('btn-play').onclick = async function() {
    if (tracks.length === 0) return;
    if (currentIndex < 0 && !isPlaying) { playTrack(0); return; }
    try {
      if (isPlaying) {
        await notifyBackground('pause', {});
        el('btn-play').textContent = '▶️';
        isPlaying = false;
      } else {
        await notifyBackground('resume', {});
        el('btn-play').textContent = '⏸️';
        isPlaying = true;
      }
      renderLibrary();
    } catch(e) { /* 启动失败已提示 */ }
  };

  el('btn-prev').onclick = function() {
    if (tracks.length === 0) return;
    notifyBackground('prev', {});
  };

  el('btn-next').onclick = function() {
    if (tracks.length === 0) return;
    notifyBackground('next', {});
  };

  el('btn-mode').onclick = async function() {
    var i = MODES.indexOf(playMode);
    playMode = MODES[(i + 1) % MODES.length];
    updateModeBtn();
    await __amiba__.storage.set('music_mode', playMode);
    notifyBackground('mode', { mode: playMode });
    __amiba__.showToast(MODE_NAMES[playMode], 'info');
  };

  function updateModeBtn() {
    el('btn-mode').textContent = MODE_ICONS[playMode];
    el('btn-mode').title = MODE_NAMES[playMode];
    el('btn-mode').className = 'btn-ctrl btn-mode' + (playMode !== 'sequence' ? ' active' : '');
  }

  // ---- 进度条拖动 ----

  function seekTo(e) {
    var bar = el('progress-bar');
    var rect = bar.getBoundingClientRect();
    var pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    if (duration > 0) {
      var pos = pct * duration;
      notifyBackground('seek', { position: pos });
      position = pos;
      updateProgress();
    }
  }

  el('progress-bar').onclick = seekTo;

  function updateProgress() {
    var pct = duration > 0 ? (position / duration) * 100 : 0;
    el('progress-fill').style.width = pct + '%';
    el('progress-thumb').style.left = pct + '%';
    el('time-current').textContent = _formatTime(position);
    el('time-duration').textContent = _formatTime(duration);
  }

  // ---- 音量 ----

  var volumeTimer = null;
  el('volume-slider').oninput = function() {
    var v = parseInt(this.value) / 100;
    notifyBackground('volume', { volume: v });
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(function() { __amiba__.storage.set('music_volume', v); }, 500);
  };

  // ---- 后台通信 ----

  var bgReady = false;

  async function notifyBackground(action, data) {
    if (!bgReady) {
      try {
        var state = await __amiba__.background.getState();
        if (!state.running) {
          el('now-playing').textContent = '正在启动后台...';
          await __amiba__.background.start();
          var state2 = await __amiba__.background.getState();
          if (!state2.running) throw new Error('后台启动失败');
        }
        bgReady = true;
      } catch(e) {
        bgReady = false;
        throw new Error('后台服务: ' + (e.message || '启动失败'));
      }
    }
    __amiba__.background.postMessage({ action: action, data: data });
  }

  // ---- 接收后台状态更新 ----

  __amiba__.background.onMessage(function(msg) {
    if (msg.type === 'state') {
      var wasIndex = currentIndex;
      isPlaying = msg.playing;
      el('btn-play').textContent = msg.playing ? '⏸️' : '▶️';
      el('cover').className = 'cover' + (msg.playing ? ' playing' : '');
      if (msg.currentName) {
        el('now-playing').textContent = msg.currentName.replace(/\.[^.]+$/, '');
        el('now-playing').title = msg.currentName;
        el('player').style.display = 'flex';
      }
      if (msg.index !== undefined && msg.index !== wasIndex) {
        currentIndex = msg.index;
        renderLibrary();
        scrollToActive();
      }
      if (msg.duration) {
        duration = msg.duration;
        position = msg.position || 0;
        updateProgress();
      }
    }
    if (msg.type === 'track-change') {
      currentIndex = msg.index;
      renderLibrary();
      scrollToActive();
    }
  });

  // ---- 初始化 ----

  async function init() {
    var savedToken = await __amiba__.storage.get('music_token');
    var savedTracks = await __amiba__.storage.get('music_tracks');
    var savedMode = await __amiba__.storage.get('music_mode');
    var savedVolume = await __amiba__.storage.get('music_volume');
    var savedState = await __amiba__.storage.get('player_state');

    if (savedToken) {
      token = savedToken;
      el('btn-pick-folder').style.display = 'none';
      el('folder-info').style.display = 'flex';
      el('folder-path').textContent = '(已授权)';
    }

    if (savedMode && MODES.indexOf(savedMode) >= 0) {
      playMode = savedMode;
    }
    updateModeBtn();

    if (savedVolume !== null && savedVolume !== undefined) {
      el('volume-slider').value = Math.round(savedVolume * 100);
    }

    if (savedTracks && savedTracks.length > 0) {
      tracks = savedTracks;
      renderLibrary();
      el('library-section').style.display = 'block';
    }

    // 恢复上次播放状态
    if (savedState && savedState.currentName) {
      if (savedState.index !== undefined && savedState.index >= 0 && savedState.index < tracks.length) {
        currentIndex = savedState.index;
      }
      isPlaying = !!savedState.playing;
      el('now-playing').textContent = savedState.currentName.replace(/\.[^.]+$/, '');
      el('now-playing').title = savedState.currentName;
      el('btn-play').textContent = isPlaying ? '⏸️' : '▶️';
      el('player').style.display = 'flex';
      el('cover').className = 'cover' + (isPlaying ? ' playing' : '');
      if (savedState.duration) {
        duration = savedState.duration;
        position = savedState.position || 0;
        updateProgress();
      }
      renderLibrary();
    }
  }

  // ---- 工具函数 ----

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function _formatSize(bytes) {
    if (!bytes) return '';
    var mb = bytes / 1048576;
    return mb >= 1 ? mb.toFixed(1) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
  }

  function _formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  init();
})();
