// 快速笔记 - 前台逻辑
(function() {
  var STORAGE_KEY = 'notes';
  var notes = [];
  var keyword = '';

  var el = function(id) { return document.getElementById(id); };

  // ---- 数据 ----

  async function loadNotes() {
    var saved = await __amiba__.storage.get(STORAGE_KEY);
    notes = Array.isArray(saved) ? saved : [];
    render();
  }

  async function saveNotes() {
    await __amiba__.storage.set(STORAGE_KEY, notes);
  }

  function addNote(text) {
    text = (text || '').trim();
    if (!text) return false;
    notes.unshift({ id: 'n' + Date.now(), text: text, at: Date.now() });
    saveNotes();
    return true;
  }

  function deleteNote(id) {
    notes = notes.filter(function(n) { return n.id !== id; });
    saveNotes();
  }

  // ---- 渲染 ----

  function render() {
    el('note-count').textContent = notes.length + ' 条笔记';

    var list = notes;
    if (keyword) {
      list = notes.filter(function(n) { return n.text.toLowerCase().indexOf(keyword) >= 0; });
    }

    el('empty-tip').style.display = list.length === 0 ? 'block' : 'none';

    var html = '';
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      html += '<div class="note-item" data-id="' + n.id + '">';
      html += '  <div class="note-text">' + _esc(n.text) + '</div>';
      html += '  <div class="note-meta">';
      html += '    <span class="note-time">' + _formatTime(n.at) + '</span>';
      html += '    <span class="note-actions">';
      html += '      <button class="btn btn-sm btn-copy">📋 复制</button>';
      html += '      <button class="btn btn-sm btn-danger btn-del">🗑 删除</button>';
      html += '    </span>';
      html += '  </div>';
      html += '</div>';
    }
    el('note-list').innerHTML = html;

    var items = document.querySelectorAll('.note-item');
    for (var j = 0; j < items.length; j++) {
      (function(item) {
        var id = item.getAttribute('data-id');
        item.querySelector('.btn-del').onclick = function() {
          deleteNote(id);
          render();
          __amiba__.showToast('已删除', 'success');
        };
        item.querySelector('.btn-copy').onclick = function() {
          var note = notes.find(function(n) { return n.id === id; });
          if (!note) return;
          // sandbox 内无 clipboard API 权限提示兼容处理
          var ta = document.createElement('textarea');
          ta.value = note.text;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); __amiba__.showToast('已复制', 'success'); }
          catch (e) { __amiba__.showToast('复制失败', 'error'); }
          document.body.removeChild(ta);
        };
      })(items[j]);
    }
  }

  // ---- 事件 ----

  el('btn-add').onclick = function() {
    var text = el('new-note').value;
    if (addNote(text)) {
      el('new-note').value = '';
      render();
      __amiba__.showToast('已保存', 'success');
    }
  };

  el('search-input').oninput = function() {
    keyword = this.value.trim().toLowerCase();
    render();
  };

  // ---- 工具 ----

  function _esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function _formatTime(ts) {
    var d = new Date(ts);
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var hm = _pad(d.getHours()) + ':' + _pad(d.getMinutes());
    if (sameDay) return '今天 ' + hm;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  }

  function _pad(n) { return n < 10 ? '0' + n : '' + n; }

  loadNotes();
})();
