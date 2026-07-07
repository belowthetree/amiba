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

    switch (action) {
      case 'play':
        loadAndPlay(data.token, data.path, data.name, data.index);
        break;
      case 'pause':
        audio.pause();
        break;
      case 'resume':
        audio.play().catch(function() {});
        break;
      case 'volume':
        audio.volume = data.volume || 0.8;
        break;
      case 'prev':
        playPrev();
        break;
      case 'next':
        playNext();
        break;
    }
  });

  // ---- 播放逻辑 ----

  async function loadAndPlay(newToken, trackPath, trackName, index) {
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
      notifyFront('state', playState);
    } catch(e) {
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
  function notifyFront(type, data) {
    var state = { type: type, playing: playState.playing, currentName: playState.currentName, position: playState.position, duration: playState.duration, index: currentIndex };
    __amiba__.background.postMessage(state);
    // 写入 storage（300ms 防抖，避免 timeupdate 频繁写入）
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function() {
      __amiba__.storage.set('player_state', state);
    }, 300);
  }

  // ---- 初始状态 ----

  __amiba__.storage.get('music_token').then(function(t) { if (t) token = t; });
  __amiba__.storage.get('music_tracks').then(function(t) { if (t) tracks = t; });
})();