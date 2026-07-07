// ============================================================
// 宠物世界 — 局域网玩家发现
// ============================================================

;(function() {

var PlayerList = window.PlayerList = {}

PlayerList.devices = []

// -----------------------------------------------------------
// 启动发现
// -----------------------------------------------------------

PlayerList.startDiscovery = async function() {
  try {
    if (window.__amiba__) {
      await __amiba__.network.startDiscovery('lan')
    }
  } catch (e) {
    console.log('[PetWorld] startDiscovery error:', e.message)
  }
}

// -----------------------------------------------------------
// 刷新设备列表
// -----------------------------------------------------------

PlayerList.refresh = async function(app) {
  try {
    if (!window.__amiba__) {
      PlayerList.devices = []
      PlayerList.renderAll(app)
      return
    }
    var devices = await __amiba__.network.getVisibleDevices()
    PlayerList.devices = devices || []
    PlayerList.renderAll(app)
  } catch (e) {
    console.log('[PetWorld] refreshDevices error:', e.message)
  }
}

// -----------------------------------------------------------
// 渲染到所有容器
// -----------------------------------------------------------

PlayerList.renderAll = function(app) {
  if (window.Battle) Battle.renderPlayerList(app)
  if (window.Trade) Trade.renderPlayerList(app)
}

// -----------------------------------------------------------
// 渲染到指定容器（回调由 callAction 统一调度）
// -----------------------------------------------------------

PlayerList.renderInContainer = function(containerId, app, actionLabel) {
  var container = document.getElementById(containerId)
  if (!container) return

  var devices = PlayerList.devices

  if (devices.length === 0) {
    container.innerHTML =
      '<p class="hint-text">🔍 未发现其他玩家</p>' +
      '<button class="btn block ghost" onclick="PlayerList.refresh(app)">🔄 重新扫描</button>'
    return
  }

  container.innerHTML = devices.map(function(d) {
    return '<div class="player-item">' +
      '<div class="player-info">' +
        '<span class="player-icon">' + (d.transport === 'lan' ? '🖥️' : '📶') + '</span>' +
        '<div>' +
          '<div class="player-name">' + escapeHtml(d.name) + '</div>' +
          '<div class="player-addr">' + escapeHtml(d.address || '') + '</div>' +
        '</div>' +
      '</div>' +
      '<button class="btn small" onclick="PlayerList.callAction(\'' + d.id + '\', \'' + escapeHtml(d.name || '').replace(/'/g, "\\'") + '\')">' +
        actionLabel +
      '</button>' +
    '</div>'
  }).join('')

  container.dataset.actionLabel = actionLabel
}

// -----------------------------------------------------------
// 动作调度：由 battle.js / trade.js 在渲染前注册
// -----------------------------------------------------------

PlayerList._actionHandler = null

PlayerList.setActionHandler = function(handler) {
  PlayerList._actionHandler = handler
}

PlayerList.callAction = function(peerId, peerName) {
  if (PlayerList._actionHandler) {
    PlayerList._actionHandler(peerId, peerName)
  }
}

function escapeHtml(s) {
  if (!s) return ''
  var d = document.createElement('span')
  d.textContent = s
  return d.innerHTML
}

})()
