// 音乐播放器 - 后台播放引擎
(function() {
  var audio = new Audio();
  var token = null;
  var tracks = [];
  var currentIndex = -1;
  var playState = { playing: false, currentName: '', position: 0, duration: 0 };
  var stateTimer = null;

  // ---- 音频事件 ----

  audio.addEventListener('timeupdate', function() {
    playState.position = audio.currentTime;
    playState.duration = audio.duration || 0;
    notifyFront('state', playState);
  });

  audio.addEventListener('ended', function() {
    playNext();
  });

  audio.addEventListener('error', function() {
    playState.playing = false;
    notifyFront('state', playState);
  });

  audio.addEventListener('play', function() {
    playState.playing = true;
    notifyFront('state', playState);
  });

  audio.addEventListener('pause', function() {
    playState.playing = false;
    notifyFront('state', playState);
  });

  audio.volume = 0.8;

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
        console.log('[BgWorker] resume: audio.src=' + (audio.src ? audio.src.slice(0,50) : '(空)'));
        if (audio.src) {
          audio.play().catch(function(e) { console.error('[BgWorker] audio.play() 失败:', e); });
        } else {
          console.log('[BgWorker] 无已加载曲目，调用 autoPlayFirst()');
          autoPlayFirst();
        }
        break;
      case 'volume':
        audio.volume = data.volume || 0.8;
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
    console.log('[BgWorker] ensureTracksLoaded: token=' + !!token + ' tracks.length=' + (tracks ? tracks.length : 0));
    if (!token) {
      token = await __amiba__.storage.get('music_token');
      console.log('[BgWorker] 读取 music_token:', token ? '有值' : '(空)');
    }
    if (!tracks || tracks.length === 0) {
      var saved = await __amiba__.storage.get('music_tracks');
      if (saved) tracks = saved;
      console.log('[BgWorker] 读取 music_tracks:', tracks ? tracks.length + ' 首' : '(空)');
    }
  }

  async function autoPlayFirst() {
    console.log('[BgWorker] autoPlayFirst: 开始');
    await ensureTracksLoaded();
    console.log('[BgWorker] autoPlayFirst: token=' + !!token + ' tracks.length=' + (tracks ? tracks.length : 0));
    if (tracks.length > 0 && token) {
      console.log('[BgWorker] autoPlayFirst: 加载第一首:', tracks[0].name);
      loadAndPlay(token, tracks[0].path, tracks[0].name, 0);
    } else {
      console.warn('[BgWorker] autoPlayFirst: 无曲目或无 token，无法播放');
    }
  }

  async function loadAndPlay(newToken, trackPath, trackName, index) {
    console.log('[BgWorker] loadAndPlay: path=' + trackPath + ' name=' + trackName + ' index=' + index);
    try {
      token = newToken;
      currentIndex = index;
      playState.currentName = trackName;
      playState.playing = true;
      notifyFront('track-change', { index: index });

      // 从 storage 获取缓存曲目列表
      var saved = await __amiba__.storage.get('music_tracks');
      if (saved) tracks = saved;

      // 读取音频数据
      console.log('[BgWorker] 读取音频二进制...');
      var b64 = await __amiba__.fileAccess.readBinary(token, trackPath);
      console.log('[BgWorker] 读取完成, base64 长度:', b64 ? b64.length : 0);

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
      console.log('[BgWorker] 调用 audio.play()...');
      await audio.play();
      console.log('[BgWorker] ✓ audio.play() 成功');
      notifyFront('state', playState);
    } catch(e) {
      console.error('[BgWorker] ✗ loadAndPlay 失败:', e.message || e);
      playState.playing = false;
      notifyFront('state', playState);
    }
  }

  function playNext() {
    if (tracks.length === 0) return;
    var idx = currentIndex + 1;
    if (idx >= tracks.length) idx = 0;
    var track = tracks[idx];
    if (track && token) {
      loadAndPlay(token, track.path, track.name, idx);
    }
  }

  function playPrev() {
    if (tracks.length === 0) return;
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
      console.log('[BgWorker] flushState → storage.set player_state, playing=' + _pendingState.playing + ' name=' + _pendingState.currentName);
      __amiba__.storage.set('player_state', _pendingState);
      _pendingState = null;
    }
    _saveTimer = null;
  }

  function notifyFront(type, data) {
    var state = { type: type, playing: playState.playing, currentName: playState.currentName, position: playState.position, duration: playState.duration, index: currentIndex };
    console.log('[BgWorker] notifyFront type=' + type + ' playing=' + playState.playing + ' name=' + playState.currentName);
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
})();