// ============================================================
// 宠物世界 — 交易系统
// ============================================================

;(function() {

var Trade = window.Trade = {}

// ---- 状态 ----
Trade.state = 'idle'  // idle | requesting | trading | confirming
Trade.opponentName = ''
Trade.session = null
Trade.myOffer = { gold: 0, items: [] }
Trade.theirOffer = { gold: 0, items: [] }
Trade.myConfirmed = false
Trade.theirConfirmed = false

// -----------------------------------------------------------
// 发起交易
// -----------------------------------------------------------

Trade.requestTrade = function(peerId, peerName, app) {
  if (Trade.state !== 'idle') { app.showToast('交易进行中！'); return }
  Trade.state = 'requesting'
  Trade.opponentName = peerName
  Trade.myOffer = { gold: 0, items: [] }
  Trade.theirOffer = { gold: 0, items: [] }
  Trade.myConfirmed = false
  Trade.theirConfirmed = false

  for (var i = 0; i < app.sessions.length; i++) {
    if (app.sessions[i].peerId === peerId) {
      app.sessions[i].send(JSON.stringify({ type: 'trade_request' }))
      Trade.session = app.sessions[i]
      break
    }
  }
  app.showToast('已发送交易请求...')
}

// -----------------------------------------------------------
// 接收交易请求
// -----------------------------------------------------------

Trade.handleRequest = async function(msg, session, app) {
  if (Trade.state !== 'idle') {
    session.send(JSON.stringify({ type: 'trade_decline' }))
    return
  }

  var confirmed = await app.confirm('💰 ' + (session.peerName || '对方') + ' 想与你进行交易，是否接受？')
  if (!confirmed) {
    session.send(JSON.stringify({ type: 'trade_decline' }))
    return
  }

  Trade.state = 'trading'
  Trade.opponentName = session.peerName || '对方'
  Trade.session = session
  Trade.myOffer = { gold: 0, items: [] }
  Trade.theirOffer = { gold: 0, items: [] }
  Trade.myConfirmed = false
  Trade.theirConfirmed = false

  session.send(JSON.stringify({ type: 'trade_accept' }))
  app.showToast('交易开始！')
  Trade.renderTradeUI(app)
}

Trade.handleAccept = function(app) {
  Trade.state = 'trading'
  Trade.myOffer = { gold: 0, items: [] }
  Trade.theirOffer = { gold: 0, items: [] }
  Trade.myConfirmed = false
  Trade.theirConfirmed = false
  app.showToast('交易开始！')
  Trade.renderTradeUI(app)
}

Trade.handleDecline = function(app) {
  Trade.state = 'idle'
  Trade.session = null
  app.showToast('对方拒绝了交易')
  Trade.renderTradeUI(app)
  Trade.renderPlayerList(app)
}

// -----------------------------------------------------------
// 修改报价
// -----------------------------------------------------------

Trade.toggleGold = function(amount, app) {
  if (Trade.state !== 'trading') return
  Trade.myOffer.gold = Math.max(0, Math.min(app.state.inventory.gold, Trade.myOffer.gold + amount))
  Trade.myConfirmed = false
  Trade.sendOffer(app)
  Trade.renderTradeUI(app)
}

Trade.toggleItem = function(itemId, app) {
  if (Trade.state !== 'trading') return
  var item = app.findItem(itemId)
  if (!item || item.quantity < 1) return

  var idx = -1
  for (var i = 0; i < Trade.myOffer.items.length; i++) {
    if (Trade.myOffer.items[i].id === itemId) { idx = i; break }
  }

  if (idx >= 0) {
    Trade.myOffer.items.splice(idx, 1)
  } else {
    Trade.myOffer.items.push({ id: itemId, quantity: 1 })
  }
  Trade.myConfirmed = false
  Trade.sendOffer(app)
  Trade.renderTradeUI(app)
}

Trade.sendOffer = function(app) {
  if (!Trade.session) return
  Trade.session.send(JSON.stringify({
    type: 'trade_offer',
    offer: Trade.myOffer
  }))
}

Trade.handleOffer = function(msg, app) {
  Trade.theirOffer = msg.offer || { gold: 0, items: [] }
  Trade.theirConfirmed = false
  Trade.renderTradeUI(app)
}

// -----------------------------------------------------------
// 确认交易
// -----------------------------------------------------------

Trade.doConfirm = function(app) {
  if (Trade.state !== 'trading') return
  Trade.myConfirmed = true
  if (!Trade.session) return
  Trade.session.send(JSON.stringify({ type: 'trade_confirm' }))
  Trade.renderTradeUI(app)
  Trade.tryComplete(app)
}

Trade.handleConfirm = function(app) {
  Trade.theirConfirmed = true
  Trade.renderTradeUI(app)
  Trade.tryComplete(app)
}

Trade.tryComplete = function(app) {
  if (!Trade.myConfirmed || !Trade.theirConfirmed) return
  if (Trade.state !== 'trading') return
  Trade.state = 'confirming'

  Trade.executeExchange(app)

  if (Trade.session) {
    Trade.session.send(JSON.stringify({ type: 'trade_complete' }))
  }

  Trade.finishTrade(app)
}

Trade.handleComplete = function(msg, app) {
  if (Trade.state !== 'trading' && Trade.state !== 'confirming') return
  Trade.state = 'confirming'
  Trade.executeExchange(app)
  Trade.finishTrade(app)
}

Trade.executeExchange = function(app) {
  var myInv = app.state.inventory
  var theirOffer = Trade.theirOffer
  var myOffer = Trade.myOffer

  // 我方获得对方报价
  if (theirOffer.gold > 0) myInv.gold += theirOffer.gold
  theirOffer.items.forEach(function(ti) {
    var existing = app.findItem(ti.id)
    if (existing) existing.quantity += ti.quantity
    else myInv.items.push({ id: ti.id, quantity: ti.quantity })
  })

  // 我方付出我方报价
  if (myOffer.gold > 0) myInv.gold = Math.max(0, myInv.gold - myOffer.gold)
  myOffer.items.forEach(function(mi) {
    var existing = app.findItem(mi.id)
    if (existing) existing.quantity = Math.max(0, existing.quantity - mi.quantity)
  })
}

Trade.finishTrade = function(app) {
  app.showToast('✅ 交易完成！')
  app.updateGold()
  Trade.reset()
  Trade.renderTradeUI(app)
  Trade.renderPlayerList(app)
  if (window.PetView) PetView.render(app.state, app)
  app.save()
}

// -----------------------------------------------------------
// 渲染
// -----------------------------------------------------------

Trade.renderTradeUI = function(app) {
  var el = document.getElementById('tab-trade')
  var listArea = el.querySelector('.player-list-area')
  if (!listArea) {
    listArea = document.createElement('div')
    listArea.className = 'player-list-area'
    el.appendChild(listArea)
  }

  var arena = el.querySelector('.trade-arena')
  if (Trade.state !== 'trading' && Trade.state !== 'confirming') {
    if (arena) arena.classList.remove('active')
    listArea.classList.remove('hidden')
    Trade.renderPlayerList(app)
    return
  }

  listArea.classList.add('hidden')
  if (!arena) {
    arena = document.createElement('div')
    arena.className = 'trade-arena'
    el.appendChild(arena)
  }
  arena.classList.add('active')

  var myInv = app.state.inventory
  var itemRows = ''
  var i
  for (i = 0; i < myInv.items.length; i++) {
    var it = myInv.items[i]
    var itemDef = GameData.ITEMS[it.id]
    var inOffer = false
    for (var j = 0; j < Trade.myOffer.items.length; j++) {
      if (Trade.myOffer.items[j].id === it.id) { inOffer = true; break }
    }
    itemRows +=
      '<div class="trade-offer-row">' +
        '<span>' + itemDef.name + ' <span style="color:#999">x' + it.quantity + '</span></span>' +
        '<span class="to-actions">' +
          '<button class="btn small ' + (inOffer ? 'danger' : 'ghost') + '" onclick="Trade.toggleItem(\'' + it.id + '\', app)">' +
            (inOffer ? '取消' : '放入') +
          '</button>' +
        '</span>' +
      '</div>'
  }

  var theirItemRows = ''
  for (i = 0; i < Trade.theirOffer.items.length; i++) {
    var ti = Trade.theirOffer.items[i]
    var tDef = GameData.ITEMS[ti.id]
    theirItemRows += '<div class="trade-offer-row"><span>' + tDef.name + ' x' + ti.quantity + '</span></div>'
  }
  if (Trade.theirOffer.items.length === 0 && Trade.theirOffer.gold === 0) {
    theirItemRows = '<div class="hint-text" style="padding:4px 0">对方尚未放入物品</div>'
  }

  arena.innerHTML =
    '<div class="trade-panel">' +
      '<div class="trade-side">' +
        '<h4>📤 你的报价 <span style="float:right;font-size:13px;color:#999">(与 ' + escapeHtml(Trade.opponentName) + ' 交易)</span></h4>' +
        '<div class="trade-offer-row">' +
          '<span>💰 金币</span>' +
          '<span class="to-actions">' +
            '<button class="btn small" onclick="Trade.toggleGold(10, app)" ' + (Trade.myConfirmed ? 'disabled' : '') + '>+10</button>' +
            '<button class="btn small" onclick="Trade.toggleGold(-10, app)" ' + (Trade.myConfirmed ? 'disabled' : '') + '>-10</button>' +
            '<span style="font-weight:600;margin-left:6px">' + Trade.myOffer.gold + '</span>' +
          '</span>' +
        '</div>' +
        itemRows +
      '</div>' +
      '<div class="trade-side">' +
        '<h4>📥 对方报价</h4>' +
        '<div class="trade-offer-row"><span>💰 金币: ' + Trade.theirOffer.gold + '</span></div>' +
        theirItemRows +
      '</div>' +
      '<div class="trade-status">' +
        '<span>' + (Trade.myConfirmed ? '✅ 你已确认' : '⏳ 等待你确认') + '</span>' +
        ' | ' +
        '<span class="ts-confirmed">' + (Trade.theirConfirmed ? '✅ 对方已确认' : '⏳ 等待对方确认') + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="btn primary block" onclick="Trade.doConfirm(app)" ' + (Trade.myConfirmed ? 'disabled' : '') + '>✅ 确认交易</button>' +
        '<button class="btn danger block" onclick="Trade.cancel(app)">❌ 取消交易</button>' +
      '</div>' +
    '</div>'
}

Trade.cancel = function(app) {
  if (Trade.session) {
    Trade.session.send(JSON.stringify({ type: 'trade_cancel' }))
  }
  app.showToast('交易已取消')
  Trade.reset()
  Trade.renderTradeUI(app)
  Trade.renderPlayerList(app)
  if (window.PetView) PetView.render(app.state, app)
}

Trade.handleCancel = function(app) {
  Trade.state = 'idle'
  app.showToast('对方取消了交易')
  Trade.renderTradeUI(app)
  Trade.renderPlayerList(app)
}

// -----------------------------------------------------------
// 玩家列表
// -----------------------------------------------------------

Trade.renderPlayerList = function(app) {
  var el = document.getElementById('tab-trade')
  if (Trade.state === 'trading' || Trade.state === 'confirming') return
  var area = el.querySelector('.player-list-area')
  if (!area) return

  if (window.PlayerList) {
    area.innerHTML =
      '<div class="player-section">' +
        '<h3>💰 周围玩家 <button class="btn small ghost" onclick="PlayerList.refresh(app)" style="float:right">🔄 刷新</button></h3>' +
        '<div class="player-list" id="trade-player-list"></div>' +
      '</div>'
    PlayerList.setActionHandler(function(peerId, peerName) {
      Trade.requestTrade(peerId, peerName, app)
    })
    PlayerList.renderInContainer('trade-player-list', app, '💰 交易')
  }
}

// -----------------------------------------------------------
// 重置
// -----------------------------------------------------------

Trade.reset = function() {
  Trade.state = 'idle'
  Trade.opponentName = ''
  Trade.session = null
  Trade.myOffer = { gold: 0, items: [] }
  Trade.theirOffer = { gold: 0, items: [] }
  Trade.myConfirmed = false
  Trade.theirConfirmed = false
}

function escapeHtml(s) {
  var d = document.createElement('span')
  d.textContent = s
  return d.innerHTML
}

})()
