// 文本阅读器 - 书架 + 阅读进度
(function() {
  var SHELF_KEY = 'bookshelf';
  var PROGRESS_PREFIX = 'progress_';
  var PAGE_SIZE = 1500;      // 每页字符数
  var FONT_SIZES = [14, 16, 19, 22];
  var FONT_KEY = 'font_size_idx';

  var token = null;          // fileAccess token（重启失效）
  var books = [];            // [{ name, path, size }]
  var current = null;        // 当前书籍
  var pages = [];
  var pageIndex = 0;
  var fontIdx = 1;

  var el = function(id) { return document.getElementById(id); };

  var isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

  // ---- 授权与扫描 ----

  el('btn-pick').onclick = async function() {
    var btn = el('btn-pick');
    btn.disabled = true;
    btn.textContent = '选择中...';
    try {
      var grant = await __amiba__.fileAccess.requestAccess({
        pattern: isAndroid ? '**/{*.txt,*.md}' : '{*.txt,*.md}',
        purpose: '读取文本文件用于阅读'
      });
      token = grant.token;
      el('folder-path').textContent = grant.path;
      await scanShelf();
    } catch (e) {
      if (e && e.message) __amiba__.showToast(e.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = '📁 选择文件夹';
  };

  async function scanShelf() {
    try {
      var files = await __amiba__.fileAccess.listFiles(token);
      books = files.filter(function(f) { return !f.isDir; });
      await __amiba__.storage.set(SHELF_KEY, books);
      renderShelf();
    } catch (e) {
      __amiba__.showToast('扫描失败: ' + (e.message || e), 'error');
    }
  }

  // ---- 书架 ----

  async function renderShelf() {
    el('book-count').textContent = books.length + ' 本书';
    el('empty-tip').style.display = books.length === 0 ? 'block' : 'none';

    var html = '';
    for (var i = 0; i < books.length; i++) {
      var b = books[i];
      var prog = await __amiba__.storage.get(PROGRESS_PREFIX + b.path);
      var progText = prog && prog.page > 0 ? '读到 ' + (prog.page + 1) + ' 页' : '';
      html += '<div class="book-item" data-path="' + _esc(b.path) + '">';
      html += '  <span class="book-icon">' + (/\.md$/i.test(b.name) ? '📝' : '📄') + '</span>';
      html += '  <div class="book-info">';
      html += '    <div class="book-name">' + _esc(b.name) + '</div>';
      html += '    <div class="book-meta">' + _formatSize(b.size) + '</div>';
      html += '  </div>';
      html += '  <span class="book-progress">' + progText + '</span>';
      html += '</div>';
    }
    el('book-list').innerHTML = html;

    var items = document.querySelectorAll('.book-item');
    for (var j = 0; j < items.length; j++) {
      items[j].onclick = function() { openBook(this.getAttribute('data-path')); };
    }
  }

  // ---- 阅读 ----

  async function openBook(path) {
    // token 仅本次生命周期有效，重启后需重新授权
    if (!token) {
      el('auth-hint').textContent = '⚠️ 授权已过期，请重新选择文件夹';
      __amiba__.showToast('请重新选择文件夹授权', 'none');
      return;
    }
    var book = null;
    for (var i = 0; i < books.length; i++) {
      if (books[i].path === path) { book = books[i]; break; }
    }
    if (!book) return;

    var text;
    try {
      text = await __amiba__.fileAccess.readText(token, path);
    } catch (e) {
      __amiba__.showToast('读取失败: ' + (e.message || e), 'error');
      return;
    }

    current = book;
    pages = splitPages(String(text || ''));
    pageIndex = 0;

    var prog = await __amiba__.storage.get(PROGRESS_PREFIX + path);
    if (prog && prog.page > 0 && prog.page < pages.length) pageIndex = prog.page;

    el('shelf-view').style.display = 'none';
    el('read-view').style.display = 'block';
    renderPage();
  }

  function splitPages(text) {
    if (!text) return ['（空文件）'];
    var result = [];
    // 优先按段落边界分页，避免截断句子
    var paragraphs = text.split('\n');
    var buf = '';
    for (var i = 0; i < paragraphs.length; i++) {
      if (buf.length + paragraphs[i].length > PAGE_SIZE && buf.length > 0) {
        result.push(buf);
        buf = '';
      }
      buf += paragraphs[i] + '\n';
    }
    if (buf) result.push(buf);
    return result.length ? result : ['（空文件）'];
  }

  function renderPage() {
    el('read-title').textContent = current ? current.name : '';
    el('read-content').textContent = pages[pageIndex];
    el('read-page').textContent = (pageIndex + 1) + ' / ' + pages.length;
    el('btn-prev-page').disabled = pageIndex === 0;
    el('btn-next-page').disabled = pageIndex === pages.length - 1;
    saveProgress();
    window.scrollTo(0, 0);
  }

  async function saveProgress() {
    if (!current) return;
    await __amiba__.storage.set(PROGRESS_PREFIX + current.path, { page: pageIndex, total: pages.length });
  }

  el('btn-back').onclick = function() {
    el('read-view').style.display = 'none';
    el('shelf-view').style.display = 'block';
    renderShelf();
  };

  el('btn-prev-page').onclick = function() {
    if (pageIndex > 0) { pageIndex--; renderPage(); }
  };

  el('btn-next-page').onclick = function() {
    if (pageIndex < pages.length - 1) { pageIndex++; renderPage(); }
  };

  el('btn-font').onclick = async function() {
    fontIdx = (fontIdx + 1) % FONT_SIZES.length;
    el('read-content').style.fontSize = FONT_SIZES[fontIdx] + 'px';
    await __amiba__.storage.set(FONT_KEY, fontIdx);
  };

  // ---- 工具 ----

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function _formatSize(bytes) {
    if (!bytes) return '';
    var mb = bytes / 1048576;
    return mb >= 1 ? mb.toFixed(1) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
  }

  // ---- 初始化 ----

  async function init() {
    var savedShelf = await __amiba__.storage.get(SHELF_KEY);
    if (Array.isArray(savedShelf) && savedShelf.length > 0) {
      books = savedShelf;
      el('auth-hint').textContent = '书架已缓存；打开书籍需重新授权文件夹';
      renderShelf();
    }
    var savedFont = await __amiba__.storage.get(FONT_KEY);
    if (typeof savedFont === 'number' && FONT_SIZES[savedFont]) {
      fontIdx = savedFont;
      el('read-content').style.fontSize = FONT_SIZES[fontIdx] + 'px';
    }
  }

  init();
})();
