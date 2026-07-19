// 番茄钟 - 前台逻辑
(function() {
  var STATE_KEY = 'pomodoro_state';
  var STATS_KEY = 'pomodoro_stats';
  var WIDGET_ID = 'pomodoro-timer';
  var DURATIONS = { work: 25 * 60, break: 5 * 60 };

  var mode = 'work';
  var state = { mode: 'work', running: false, remaining: DURATIONS.work };
  var bgReady = false;
  var widgetShown = false;

  var el = function(id) { return document.getElementById(id); };

  // ---- 后台通信（参照 music_player 模式：先确保启动再发消息）----

  async function ensureBg() {
    if (bgReady) return true;
    try {
      var s = await __amiba__.background.getState();
      if (!s.running) {
        await __amiba__.background.start();
        var s2 = await __amiba__.background.getState();
        if (!s2.running) throw new Error('后台启动失败');
      }
      bgReady = true;
      return true;
    } catch (e) {
      bgReady = false;
      __amiba__.showToast('后台服务: ' + (e.message || '启动失败'), 'error');
      return false;
    }
  }

  async function postBg(action, data) {
    if (!(await ensureBg())) return;
    __amiba__.background.postMessage({ action: action, data: data || {} });
  }

  // ---- UI ----

  function render() {
    var sec = state.running || state.remaining > 0 ? state.remaining : DURATIONS[mode];
    el('timer-display').textContent = _fmt(sec);
    el('timer-status').textContent =
      state.running ? (state.mode === 'work' ? '🍅 专注中...' : '☕ 休息中...') :
      (state.remaining > 0 && state.remaining < DURATIONS[state.mode] ? '已暂停' : '准备开始');
    el('btn-start').textContent = state.running ? '⏸ 暂停' : (state.remaining > 0 && state.remaining < DURATIONS[state.mode] ? '▶️ 继续' : '▶️ 开始');

    el('tab-work').className = 'mode-tab' + (state.mode === 'work' ? ' active' : '');
    el('tab-break').className = 'mode-tab' + (state.mode === 'break' ? ' active' : '');
  }

  el('btn-start').onclick = function() {
    if (state.running) {
      postBg('pause');
    } else if (state.remaining > 0 && state.remaining < DURATIONS[state.mode]) {
      postBg('resume');
    } else {
      postBg('start', { mode: mode, duration: DURATIONS[mode] });
    }
  };

  el('btn-reset').onclick = function() { postBg('reset'); };

  el('tab-work').onclick = function() { switchMode('work'); };
  el('tab-break').onclick = function() { switchMode('break'); };

  function switchMode(m) {
    mode = m;
    if (!state.running) {
      state.mode = m;
      state.remaining = DURATIONS[m];
      render();
    }
  }

  el('btn-toggle-widget').onclick = async function() {
    try {
      if (widgetShown) {
        await __amiba__.widgets.hide(WIDGET_ID);
        widgetShown = false;
      } else {
        await __amiba__.widgets.show(WIDGET_ID);
        widgetShown = true;
      }
    } catch (e) {
      __amiba__.showToast('悬浮块: ' + (e.message || e), 'error');
    }
  };

  // ---- 状态轮询（与后台/悬浮块同步）----

  function poll() {
    __amiba__.storage.get(STATE_KEY).then(function(s) {
      if (s) {
        state = s;
        mode = s.mode;
        render();
      }
    }).catch(function() {});
  }

  async function renderStats() {
    var today = new Date().toDateString();
    var stats = await __amiba__.storage.get(STATS_KEY);
    var count = stats && stats.date === today ? stats.count : 0;
    el('today-count').textContent = '今日完成 ' + count + ' 个';
  }

  function _fmt(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
  }

  setInterval(poll, 500);
  setInterval(renderStats, 3000);
  poll();
  renderStats();
  render();
})();
