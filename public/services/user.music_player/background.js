// 音乐播放器 - 后台播放引擎
(function() {
  var audio = new Audio();
  var token = null;
  var tracks = [];
  var currentIndex = -1;
  var playMode = 'sequence'; // sequence | loop | shuffle
  var playState = { playing: false, currentName: '', position: 0, duration: 0 };

  // ---- 音频事件 ----

  audio.addEventListener('timeupdate', function() {
    playState.position = audio.currentTime;
    playState.duration = audio.duration || 0;
    notifyFront('state');
  });

  audio.addEventListener('ended', function() {
    if (playMode === 'loop') {
      audio.currentTime = 0;
      audio.play().catch(function(){});
      return;
    }
    playNext();
  });

  audio.addEventListener('error', function() {
    playState.playing = false;
    notifyFront('state');
  });

  audio.addEventListener('play', function() {
    playState.playing = true;
    notifyFront('state');
  });

  audio.addEventListener('pause', function() {
    playState.playing = false;
    notifyFront('state');
  });

  // ---- 前台/悬浮块指令 ----

  __amiba__.background.onMessage(function(msg) {
    var action = msg.action;
    var data = msg.data || {};

    console.log('[BgWorker] onMessage:', action, JSON.stringify(data));

    switch (action) {
      case 'play':
        loadAndPlay(data.token, data.path, data.name, data.index);
        break;
      case 'pause':
        audio.pause();
        break;
      case 'resume':
        if (audio.src) {
          audio.play().catch(function(e) { console.error('[BgWorker] audio.play() 失败:', e); });
        } else {
          autoPlayFirst();
        }
        break;
      case 'volume':
        audio.volume = data.volume !== undefined ? data.volume : 0.8;
        break;
      case 'seek':
        if (audio.src && data.position !== undefined && isFinite(data.position)) {
          audio.currentTime = data.position;
          playState.position = data.position;
          notifyFront('state');
        }
        break;
      case 'mode':
        if (data.mode) {
          playMode = data.mode;
          console.log('[BgWorker] 播放模式 →', playMode);
        }
        break;
      case 'prev':
        if (tracks.length === 0) {
          ensureTracksLoaded().then(function() { playPrev(); });
        } else {
          playPrev();
        }
        break;
      case 'next':
        if (tracks.length === 0) {
          ensureTracksLoaded().then(function() { playNext(); });
        } else {
          playNext();
        }
        break;
    }
  });

  // ---- 播放逻辑 ----

  async function ensureTracksLoaded() {
    if (!token) {
      token = await __amiba__.storage.get('music_token');
    }
    if (!tracks || tracks.length === 0) {
      var saved = await __amiba__.storage.get('music_tracks');
      if (saved) tracks = saved;
    }
  }

  async function autoPlayFirst() {
    await ensureTracksLoaded();
    if (tracks.length > 0 && token) {
      loadAndPlay(token, tracks[0].path, tracks[0].name, 0);
    } else {
      console.warn('[BgWorker] autoPlayFirst: 无曲目或无 token，无法播放');
    }
  }

  async function loadAndPlay(newToken, trackPath, trackName, index) {
    console.log('[BgWorker] loadAndPlay: name=' + trackName + ' index=' + index);
    try {
      token = newToken;
      currentIndex = index;
      playState.currentName = trackName;
      playState.position = 0;
      playState.duration = 0;
      playState.playing = true;
      notifyFront('track-change');

      // 从 storage 获取缓存曲目列表
      var saved = await __amiba__.storage.get('music_tracks');
      if (saved) tracks = saved;

      // 读取音频数据
      var b64 = await __amiba__.fileAccess.readBinary(token, trackPath);

      // 释放旧 blob URL
      if (audio.src && audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
      }

      // 推断 MIME 类型
      var ext = trackPath.split('.').pop().toLowerCase();
      var mimeMap = { mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };
      var mime = mimeMap[ext] || 'audio/mpeg';

      // base64 → blob URL
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
      var blob = new Blob([bytes], { type: mime });
      var url = URL.createObjectURL(blob);

      audio.src = url;
      await audio.play();
      console.log('[BgWorker] ✓ 播放成功:', trackName);
      notifyFront('state');
    } catch(e) {
      console.error('[BgWorker] ✗ loadAndPlay 失败:', e.message || e);
      playState.playing = false;
      notifyFront('state');
    }
  }

  function pickNextIndex() {
    if (tracks.length === 0) return -1;
    if (playMode === 'shuffle' && tracks.length > 1) {
      var idx;
      do { idx = Math.floor(Math.random() * tracks.length); } while (idx === currentIndex);
      return idx;
    }
    var next = currentIndex + 1;
    return next >= tracks.length ? 0 : next;
  }

  function playNext() {
    var idx = pickNextIndex();
    if (idx < 0) return;
    var track = tracks[idx];
    if (track && token) {
      loadAndPlay(token, track.path, track.name, idx);
    }
  }

  function playPrev() {
    if (tracks.length === 0) return;
    // 播放超过 3 秒时按"上一首"回到本曲开头（常见播放器行为）
    if (audio.currentTime > 3 && playMode !== 'shuffle') {
      audio.currentTime = 0;
      return;
    }
    var idx = currentIndex - 1;
    if (idx < 0) idx = tracks.length - 1;
    var track = tracks[idx];
    if (track && token) {
      loadAndPlay(token, track.path, track.name, idx);
    }
  }

  // ---- 状态同步 ----

  var _saveTimer = null;
  var _pendingState = null;

  function flushState() {
    if (_pendingState) {
      __amiba__.storage.set('player_state', _pendingState);
      _pendingState = null;
    }
    _saveTimer = null;
  }

  function notifyFront(type) {
    var state = {
      type: type,
      playing: playState.playing,
      currentName: playState.currentName,
      position: playState.position,
      duration: playState.duration,
      index: currentIndex,
      mode: playMode
    };
    // 前台可能未加载（仅悬浮块使用时），忽略推送失败
    __amiba__.background.postMessage(state).catch(function(){});
    // 写入 storage（300ms 合并写入，不清除已有定时器避免 timeupdate 高频重置导致永不写入）
    _pendingState = state;
    if (_saveTimer === null) {
      _saveTimer = setTimeout(flushState, 300);
    }
  }

  // ---- 初始状态 ----

  __amiba__.storage.get('music_token').then(function(t) { if (t) token = t; });
  __amiba__.storage.get('music_tracks').then(function(t) { if (t) tracks = t; });
  __amiba__.storage.get('music_mode').then(function(m) { if (m) playMode = m; });
  __amiba__.storage.get('music_volume').then(function(v) {
    if (v !== null && v !== undefined) audio.volume = v;
    else audio.volume = 0.8;
  });
})();
