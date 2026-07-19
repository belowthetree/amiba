// 番茄钟 - 后台倒计时
// 状态通过 storage 共享（widget/前台轮询），指令通过 postMessage 接收
(function() {
  var STATE_KEY = 'pomodoro_state';
  var STATS_KEY = 'pomodoro_stats';

  var state = {
    mode: 'work',      // 'work' | 'break'
    running: false,
    remaining: 25 * 60, // 秒
    endsAt: 0
  };

  console.log('[PomodoroBG] 后台已启动');

  // ---- 指令处理 ----

  __amiba__.background.onMessage(function(msg) {
    console.log('[PomodoroBG] ←', msg.action);
    switch (msg.action) {
      case 'start':
        state.mode = (msg.data && msg.data.mode) || 'work';
        state.remaining = (msg.data && msg.data.duration) || 25 * 60;
        state.endsAt = Date.now() + state.remaining * 1000;
        state.running = true;
        break;
      case 'pause':
        if (state.running) {
          state.remaining = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));
          state.running = false;
        }
        break;
      case 'resume':
        if (!state.running && state.remaining > 0) {
          state.endsAt = Date.now() + state.remaining * 1000;
          state.running = true;
        }
        break;
      case 'reset':
        state.running = false;
        state.mode = 'work';
        state.remaining = 25 * 60;
        state.endsAt = 0;
        break;
    }
    writeState();
  });

  // ---- 每秒 tick ----

  __amiba__.background.on('tick', async function() {
    if (!state.running) return;

    state.remaining = Math.max(0, Math.round((state.endsAt - Date.now()) / 1000));

    if (state.remaining <= 0) {
      state.running = false;
      await onComplete();
    }
    writeState();
  });

  async function onComplete() {
    var finishedMode = state.mode;
    // 统计
    if (finishedMode === 'work') {
      var today = new Date().toDateString();
      var stats = await __amiba__.storage.get(STATS_KEY);
      if (!stats || stats.date !== today) stats = { date: today, count: 0 };
      stats.count++;
      await __amiba__.storage.set(STATS_KEY, stats);
    }
    __amiba__.showToast(finishedMode === 'work' ? '🍅 番茄钟完成，休息一下吧' : '☕ 休息结束，开始新的番茄钟', 'success');
    // 自动切换模式，等待用户手动开始
    state.mode = finishedMode === 'work' ? 'break' : 'work';
    state.remaining = state.mode === 'work' ? 25 * 60 : 5 * 60;
    state.endsAt = 0;
  }

  async function writeState() {
    try {
      await __amiba__.storage.set(STATE_KEY, {
        mode: state.mode,
        running: state.running,
        remaining: state.remaining
      });
    } catch (e) { /* 忽略写入失败 */ }
  }

  // 启动时写入初始状态
  writeState();
})();
