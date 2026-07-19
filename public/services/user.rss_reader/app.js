// RSS 阅读器 - fetch 模块示例
(function() {
  var FEEDS_KEY = 'rss_feeds';     // [{ url, title }]
  var CACHE_PREFIX = 'rss_cache_'; // url -> { articles, fetchedAt }
  var MAX_ARTICLES = 30;

  var feeds = [];
  var activeFeed = null; // null = 全部
  var allArticles = [];  // [{ feedTitle, title, link, summary, pubDate }]

  var el = function(id) { return document.getElementById(id); };

  // ---- 订阅管理 ----

  el('btn-add').onclick = async function() {
    var url = el('feed-url').value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      __amiba__.showToast('请输入 http(s) 地址', 'error');
      return;
    }
    for (var i = 0; i < feeds.length; i++) {
      if (feeds[i].url === url) {
        __amiba__.showToast('已订阅过该源', 'none');
        return;
      }
    }
    var btn = el('btn-add');
    btn.disabled = true;
    btn.textContent = '验证中...';
    try {
      var articles = await fetchFeed(url);
      var title = articles.feedTitle || url;
      feeds.push({ url: url, title: title });
      await __amiba__.storage.set(FEEDS_KEY, feeds);
      await cacheArticles(url, title, articles.items);
      el('feed-url').value = '';
      renderTabs();
      reloadArticles();
      __amiba__.showToast('订阅成功: ' + title, 'success');
    } catch (e) {
      __amiba__.showToast('订阅失败: ' + (e.message || e), 'error');
    }
    btn.disabled = false;
    btn.textContent = '订阅';
  };

  async function removeFeed(url) {
    feeds = feeds.filter(function(f) { return f.url !== url; });
    if (activeFeed === url) activeFeed = null;
    await __amiba__.storage.set(FEEDS_KEY, feeds);
    await __amiba__.storage.remove(CACHE_PREFIX + url);
    renderTabs();
    reloadArticles();
  }

  // ---- 抓取与解析 ----

  async function fetchFeed(url) {
    var resp = await __amiba__.fetch.request({ url: url });
    if (!resp || resp.status !== 200) {
      throw new Error('HTTP ' + (resp ? resp.status : '无响应'));
    }
    return parseFeed(resp.body);
  }

  function parseFeed(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML 解析失败');

    // RSS 2.0: <channel><title> + <item>；Atom: <feed><title> + <entry>
    var feedTitle = '';
    var items = [];
    var i, title, link, summary, date;

    var channelTitle = doc.querySelector('channel > title, feed > title');
    if (channelTitle) feedTitle = channelTitle.textContent.trim();

    var entries = doc.querySelectorAll('item, entry');
    for (i = 0; i < entries.length && i < MAX_ARTICLES; i++) {
      var node = entries[i];
      var titleNode = node.querySelector('title');
      title = titleNode ? titleNode.textContent.trim() : '(无标题)';

      // RSS: <link>文本；Atom: <link href="...">
      var linkNode = node.querySelector('link');
      link = linkNode ? (linkNode.getAttribute('href') || linkNode.textContent.trim()) : '';

      var sumNode = node.querySelector('description, summary, content');
      summary = sumNode ? _stripTags(sumNode.textContent) : '';

      var dateNode = node.querySelector('pubDate, published, updated, date');
      date = dateNode ? dateNode.textContent.trim() : '';

      items.push({ title: title, link: link, summary: summary, pubDate: date });
    }

    if (items.length === 0) throw new Error('未找到文章');
    return { feedTitle: feedTitle, items: items };
  }

  // ---- 缓存 ----

  async function cacheArticles(url, feedTitle, items) {
    await __amiba__.storage.set(CACHE_PREFIX + url, {
      feedTitle: feedTitle,
      articles: items,
      fetchedAt: Date.now()
    });
  }

  async function reloadArticles() {
    allArticles = [];
    for (var i = 0; i < feeds.length; i++) {
      var cache = await __amiba__.storage.get(CACHE_PREFIX + feeds[i].url);
      if (cache && Array.isArray(cache.articles)) {
        for (var j = 0; j < cache.articles.length; j++) {
          var a = cache.articles[j];
          a.feedTitle = cache.feedTitle;
          a.feedUrl = feeds[i].url;
          allArticles.push(a);
        }
      }
    }
    renderArticles();
  }

  // ---- 刷新 ----

  el('btn-refresh-all').onclick = async function() {
    var btn = el('btn-refresh-all');
    btn.disabled = true;
    btn.textContent = '刷新中...';
    var ok = 0, fail = 0;
    for (var i = 0; i < feeds.length; i++) {
      try {
        var result = await fetchFeed(feeds[i].url);
        var title = result.feedTitle || feeds[i].title;
        feeds[i].title = title;
        await cacheArticles(feeds[i].url, title, result.items);
        ok++;
      } catch (e) {
        fail++;
        console.log('[RSS] 刷新失败:', feeds[i].url, e.message);
      }
    }
    await __amiba__.storage.set(FEEDS_KEY, feeds);
    renderTabs();
    reloadArticles();
    __amiba__.showToast('刷新完成: ' + ok + ' 成功' + (fail ? ', ' + fail + ' 失败' : ''), fail ? 'error' : 'success');
    btn.disabled = false;
    btn.textContent = '🔄 全部刷新';
  };

  // ---- 渲染 ----

  function renderTabs() {
    var html = '<button class="feed-tab' + (activeFeed === null ? ' active' : '') + '" data-url="">全部</button>';
    for (var i = 0; i < feeds.length; i++) {
      var f = feeds[i];
      html += '<button class="feed-tab' + (activeFeed === f.url ? ' active' : '') + '" data-url="' + _esc(f.url) + '">';
      html += _esc(f.title) + ' <span class="del" data-del="' + _esc(f.url) + '">✕</span>';
      html += '</button>';
    }
    el('feed-tabs').innerHTML = html;

    var tabs = el('feed-tabs').querySelectorAll('.feed-tab');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].onclick = function(e) {
        var delUrl = e.target.getAttribute && e.target.getAttribute('data-del');
        if (delUrl) {
          removeFeed(delUrl);
          return;
        }
        activeFeed = this.getAttribute('data-url') || null;
        renderTabs();
        renderArticles();
      };
    }
  }

  function renderArticles() {
    var list = activeFeed
      ? allArticles.filter(function(a) { return a.feedUrl === activeFeed; })
      : allArticles;

    el('empty-tip').style.display = list.length === 0 ? 'block' : 'none';
    el('empty-tip').textContent = feeds.length === 0 ? '暂无内容，先添加一个订阅源' : '暂无文章，点击右上角刷新';

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      html += '<div class="article-item">';
      html += '  <div class="article-title">' + _esc(a.title) + '</div>';
      html += '  <div class="article-meta">' + _esc(a.feedTitle || '') + (a.pubDate ? ' · ' + _esc(_formatDate(a.pubDate)) : '') + '</div>';
      if (a.summary) html += '  <div class="article-summary">' + _esc(a.summary) + '</div>';
      html += '</div>';
    }
    el('article-list').innerHTML = html;
  }

  // ---- 工具 ----

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function _stripTags(html) {
    var d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || '').trim();
  }

  function _formatDate(s) {
    var d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // ---- 初始化 ----

  async function init() {
    var saved = await __amiba__.storage.get(FEEDS_KEY);
    feeds = Array.isArray(saved) ? saved : [];
    renderTabs();
    reloadArticles();
  }

  init();
})();
