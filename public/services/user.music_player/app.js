// 音乐播放器 - 前台逻辑
(function() {
  var token = null;
  var tracks = [];
  var currentIndex = -1;
  var isPlaying = false;

  var el = function(id) { return document.getElementById(id); };

  // 检测是否为 Android 平台
  var isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

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
      el('folder-path').textContent = grant.path;
      el('btn-pick-folder').textContent = '📁 选择音乐文件夹';

      await scanLibrary();
    } catch(e) {
      el('btn-pick-folder').textContent = '📁 选择音乐文件夹';
      el('btn-pick-folder').disabled = false;
      if (e && e.message) __amiba__.showToast(e.message, 'error');
    }
  };

  async function scanLibrary() {
    el('btn-rescan').textContent = '扫描中...';
    el('btn-rescan').disabled = true;

    try {
      var files = await __amiba__.fileAccess.listFiles(token);
      tracks = files.filter(function(f) { return !f.isDir; });
      await __amiba__.storage.set('music_token', token);
      await __amiba__.storage.set('music_tracks', tracks);
      renderLibrary();
      el('library-section').style.display = 'block';
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

  // ---- 曲库渲染 ----

  function renderLibrary() {
    el('track-count').textContent = tracks.length + ' 首歌曲';
    var html = '';
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var name = t.name.replace(/\.[^.]+$/, '');
      html += '<div class="track-item' + (i === currentIndex ? ' active' : '') + '" data-index="' + i + '">';
      html += '<span class="track-num">' + (i + 1) + '</span>';
      html += '<span class="track-name">' + _esc(name) + '</span>';
      html += '<span class="track-size">' + _formatSize(t.size) + '</span>';
      html += '</div>';
    }
    el('track-list').innerHTML = html;

    var items = document.querySelectorAll('.track-item');
    for (var j = 0; j < items.length; j++) {
      items[j].onclick = function() {
        var idx = parseInt(this.getAttribute('data-index'));
        playTrack(idx);
      };
    }
  }

  // ---- 播放控制 ----

  async function playTrack(index) {
    if (index < 0 || index >= tracks.length) return;
    currentIndex = index;

    var track = tracks[index];
    el('now-playing').textContent = track.name;
    el('player').style.display = 'block';
    el('btn-play').textContent = '⏳';

    try {
      notifyBackground('play', { token: token, path: track.path, name: track.name, index: index });
      el('btn-play').textContent = '⏸️';
      isPlaying = true;
      renderLibrary();
    } catch(e) {
      el('btn-play').textContent = '▶️';
      isPlaying = false;
      el('now-playing').textContent = '播放失败: ' + track.name;
    }
  }

  el('btn-play').onclick = function() {
    if (currentIndex < 0 || tracks.length === 0) return;
    if (isPlaying) {
      notifyBackground('pause', {});
      el('btn-play').textContent = '▶️';
      isPlaying = false;
    } else {
      notifyBackground('resume', {});
      el('btn-play').textContent = '⏸️';
      isPlaying = true;
    }
  };

  el('btn-prev').onclick = function() {
    if (tracks.length === 0) return;
    var idx = currentIndex <= 0 ? tracks.length - 1 : currentIndex - 1;
    playTrack(idx);
  };

  el('btn-next').onclick = function() {
    if (tracks.length === 0) return;
    var idx = currentIndex >= tracks.length - 1 ? 0 : currentIndex + 1;
    playTrack(idx);
  };

  el('volume-slider').oninput = function() {
    notifyBackground('volume', { volume: parseInt(this.value) / 100 });
  };

  // ---- 后台通信 ----

  var bgReady = false

  async function notifyBackground(action, data) {
    // 确保后台已启动
    if (!bgReady) {
      try {
        var state = await __amiba__.background.getState()
        if (!state.running) {
          el('now-playing').textContent = '正在启动后台...'
          await __amiba__.background.start()
          // 验证启动成功
          var state2 = await __amiba__.background.getState()
          if (!state2.running) throw new Error('后台启动失败')
        }
        bgReady = true
      } catch(e) {
        bgReady = false
        throw new Error('后台服务: ' + (e.message || '启动失败'))
      }
    }
    __amiba__.background.postMessage({ action: action, data: data })
  }

  // ---- 接收后台状态更新 ----

  __amiba__.background.onMessage(function(msg) {
    if (msg.type === 'state') {
      isPlaying = msg.playing;
      el('btn-play').textContent = msg.playing ? '⏸️' : '▶️';
      if (msg.currentName) {
        el('now-playing').textContent = msg.currentName;
        el('player').style.display = 'block';
      }
      if (msg.position !== undefined && msg.duration) {
        var pct = (msg.position / msg.duration) * 100;
        el('progress-fill').style.width = pct + '%';
        el('time-current').textContent = _formatTime(msg.position);
        el('time-duration').textContent = _formatTime(msg.duration);
      }
    }
    if (msg.type === 'track-change') {
      currentIndex = msg.index;
      renderLibrary();
    }
  });

  // ---- 初始化 ----

  async function init() {
    if (isAndroid) {
      await androidAutoScan();
      return;
    }

    var savedToken = await __amiba__.storage.get('music_token');
    var savedTracks = await __amiba__.storage.get('music_tracks');
    if (savedToken) {
      token = savedToken;
      el('folder-section').style.display = 'block';
      el('btn-pick-folder').style.display = 'none';
      el('folder-path').textContent = '(已授权)';
    }
    if (savedTracks && savedTracks.length > 0) {
      tracks = savedTracks;
      renderLibrary();
      el('library-section').style.display = 'block';
    }
  }

  // Android 自动扫描根目录
  async function androidAutoScan() {
    // 先渲染已缓存的曲目（即时展示）
    var savedTracks = await __amiba__.storage.get('music_tracks');
    if (savedTracks && savedTracks.length > 0) {
      tracks = savedTracks;
      renderLibrary();
      el('library-section').style.display = 'block';
    }

    // 标记正在自动扫描
    el('folder-section').style.display = 'block';
    el('btn-pick-folder').textContent = '正在扫描手机存储...';
    el('btn-pick-folder').disabled = true;

    var rootPaths = ['/storage/emulated/0/', '/sdcard/'];
    var grant = null;

    for (var i = 0; i < rootPaths.length; i++) {
      try {
        grant = await __amiba__.fileAccess.requestAccess({
          pattern: '**/{*.mp3,*.flac,*.wav,*.ogg,*.m4a}',
          purpose: '扫描手机音乐文件',
          path: rootPaths[i],
          silent: true
        });
        break;
      } catch(e) {
        console.warn('[MusicPlayer] 扫描 ' + rootPaths[i] + ' 失败:', e.message || e);
      }
    }

    if (!grant) {
      el('btn-pick-folder').textContent = '📁 选择音乐文件夹';
      el('btn-pick-folder').disabled = false;
      if (!tracks.length) {
        __amiba__.showToast('自动扫描失败，请手动选择文件夹', 'error');
      }
      return;
    }

    token = grant.token;
    el('folder-path').textContent = '手机存储';
    el('btn-pick-folder').style.display = 'none';

    await scanLibrary();
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
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  init();
})();