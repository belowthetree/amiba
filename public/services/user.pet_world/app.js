// ============================================================
// 宠物世界 — 中央控制器
// ============================================================

;(function() {

var SERVICE_KEY = 'pet_world'
var app = window.app = {}

app.state = { pet: null, inventory: null, settings: {} }
app.sessions = []

// -----------------------------------------------------------
// 初始化入口
// -----------------------------------------------------------

app.init = async function() {
  console.log('[PetWorld] === 初始化 ===')

  // 加载存档
  var saved = await PetWorldStorage.loadFull()
  if (saved && saved.pet) {
    app.state.pet = saved.pet
    app.state.inventory = saved.inventory || app.defaultInventory()
    app.state.settings = saved.settings || {}
    document.getElementById('main-app').style.display = 'block'
    app.renderMainUI()
    app.startIdleTimer()
    console.log('[PetWorld] ✓ 加载存档: ' + saved.pet.name)
  } else {
    // 新用户：显示物种选择
    app.state.inventory = app.defaultInventory()
    PetView.renderSpeciesSelection(app)
    console.log('[PetWorld] ✗ 无存档，显示物种选择')
  }

  // 初始化 P2P
  await app.initP2P()

  // 刷新设备列表
  if (window.PlayerList) {
    PlayerList.refresh(app)
    PlayerList.startDiscovery()
  }
}

// -----------------------------------------------------------
// 默认背包
// -----------------------------------------------------------

app.defaultInventory = function() {
  return {
    gold: GameData.INITIAL_GOLD,
    items: GameData.INITIAL_ITEMS.map(function(ii) {
      return { id: ii.id, quantity: ii.quantity }
    })
  }
}

// -----------------------------------------------------------
// 宠物创建回调（来自物种选择）
// -----------------------------------------------------------

app.onPetCreated = function(speciesId, name) {
  console.log('[PetWorld] === 创建宠物 ===')
  app.state.pet = GameData.createPet(speciesId, name)
  app.state.inventory = app.defaultInventory()

  document.getElementById('select-overlay').style.display = 'none'
  document.getElementById('main-app').style.display = 'block'

  app.renderMainUI()
  app.save()
  app.startIdleTimer()
  app.showToast('🎉 ' + name + ' 诞生了！好好照顾它吧！')
  console.log('[PetWorld] ✓ 宠物 ' + name + ' (' + speciesId + ') 已创建')
}

// -----------------------------------------------------------
// 渲染主 UI
// -----------------------------------------------------------

app.renderMainUI = function() {
  app.updateGold()
  app.renderCurrentTab()
  app.setupTabs()
}

app.renderCurrentTab = function() {
  var activeTab = document.querySelector('.tab.active')
  if (!activeTab) return
  var tabId = activeTab.dataset.tab
  app.renderTab(tabId)
}

app.renderTab = function(tabId) {
  if (tabId === 'pet' && window.PetView) {
    PetView.render(app.state, app)
  } else if (tabId === 'battle') {
    if (window.Battle) Battle.renderArena(app)
  } else if (tabId === 'trade') {
    if (window.Trade) Trade.renderTradeUI(app)
  }
}

// -----------------------------------------------------------
// Tab 切换
// -----------------------------------------------------------

app.setupTabs = function() {
  var tabs = document.querySelectorAll('.tab')
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function() {
      var prev = document.querySelector('.tab.active')
      if (prev) prev.classList.remove('active')
      this.classList.add('active')

      var prevContent = document.querySelector('.tab-content.active')
      if (prevContent) prevContent.classList.remove('active')

      var tabId = this.dataset.tab
      var content = document.getElementById('tab-' + tabId)
      if (content) content.classList.add('active')

      app.renderTab(tabId)
    })
  }
}

// -----------------------------------------------------------
// 金币更新
// -----------------------------------------------------------

app.updateGold = function() {
  var el = document.getElementById('gold-display')
  if (el && app.state.inventory) {
    el.textContent = '💰 ' + app.state.inventory.gold
  }
}

// -----------------------------------------------------------
// 查找道具
// -----------------------------------------------------------

app.findItem = function(itemId) {
  if (!app.state.inventory || !app.state.inventory.items) return null
  for (var i = 0; i < app.state.inventory.items.length; i++) {
    if (app.state.inventory.items[i].id === itemId) return app.state.inventory.items[i]
  }
  return null
}

// -----------------------------------------------------------
// 保存
// -----------------------------------------------------------

app.save = function() {
  PetWorldStorage.debouncedSave(app.state.pet, app.state.inventory, app.state.settings)
}

// -----------------------------------------------------------
// 确认对话框（替代 confirm）
// -----------------------------------------------------------

app.confirm = function(text) {
  return new Promise(function(resolve) {
    var overlay = document.getElementById('confirm-overlay')
    var textEl = document.getElementById('confirm-text')
    var yesBtn = document.getElementById('confirm-yes')
    var noBtn = document.getElementById('confirm-no')

    textEl.textContent = text
    overlay.style.display = 'flex'

    function cleanup() {
      overlay.style.display = 'none'
      yesBtn.onclick = null
      noBtn.onclick = null
    }

    yesBtn.onclick = function() { cleanup(); resolve(true) }
    noBtn.onclick = function() { cleanup(); resolve(false) }
  })
}

// -----------------------------------------------------------
// Toast 通知
// -----------------------------------------------------------

app.showToast = function(text) {
  var existing = document.querySelector('.toast')
  if (existing) existing.remove()

  var el = document.createElement('div')
  el.className = 'toast'
  el.textContent = text
  document.body.appendChild(el)

  setTimeout(function() { if (el.parentNode) el.remove() }, 2500)
}

// -----------------------------------------------------------
// 挂机定时器（每 60 秒更新一次状态）
// -----------------------------------------------------------

app._idleTimer = null
app._idleTicks = 0

app.startIdleTimer = function() {
  if (app._idleTimer) clearInterval(app._idleTimer)
  app._idleTicks = 0
  app._idleTimer = setInterval(app.idleTick, 60000)
}

app.idleTick = function() {
  var pet = app.state.pet
  if (!pet) return
  app._idleTicks++

  var changed = false

  // 饥饿度每 5 分钟 -1
  if (app._idleTicks % 5 === 0) {
    if (pet.hunger > 0) { pet.hunger = Math.max(0, pet.hunger - 1); changed = true }
  }

  // 快乐度每 10 分钟 -1
  if (app._idleTicks % 10 === 0) {
    if (pet.happiness > 0) { pet.happiness = Math.max(0, pet.happiness - 1); changed = true }
  }

  // 体力每 2 分钟 +1
  if (app._idleTicks % 2 === 0) {
    if (pet.energy < 100) { pet.energy = Math.min(100, pet.energy + 1); changed = true }
  }

  // 饥饿=0 时 HP 每分钟 -2
  if (pet.hunger <= 0 && app._idleTicks % 1 === 0) {
    pet.currentHp = Math.max(0, pet.currentHp - 2)
    changed = true
  }

  if (changed) {
    app.save()
    // 只刷新宠物 tab 如果可见
    var activeTab = document.querySelector('.tab.active')
    if (activeTab && activeTab.dataset.tab === 'pet' && window.PetView) {
      PetView.render(app.state, app)
    }
  }
}

// -----------------------------------------------------------
// 升级 & 进化检查
// -----------------------------------------------------------

app.checkLevelUp = function() {
  var pet = app.state.pet
  if (!pet) return
  var leveledUp = false

  while (pet.level < GameData.MAX_LEVEL) {
    var needed = GameData.expToNextLevel(pet.level)
    if (pet.exp >= needed) {
      pet.exp -= needed
      pet.level++
      leveledUp = true
      pet.currentHp = Math.min(pet.baseStats.hp, pet.currentHp + 10)
      app.showToast('🎉 ' + pet.name + ' 升级到 Lv.' + pet.level + '！')

      // 检查进化
      var newStage = GameData.getStageForLevel(pet.level)
      if (newStage > pet.currentStage) {
        pet.currentStage = newStage
        app.showEvolution(pet)
        var stageInfo = GameData.getStageInfo(newStage)
        var species = GameData.SPECIES[pet.species]
        pet.baseStats.hp = Math.round(species.baseStats.hp * stageInfo.statMultiplier)
        pet.baseStats.atk = Math.round(species.baseStats.atk * stageInfo.statMultiplier)
        pet.baseStats.def = Math.round(species.baseStats.def * stageInfo.statMultiplier)
        pet.baseStats.spd = Math.round(species.baseStats.spd * stageInfo.statMultiplier)
        pet.currentHp = pet.baseStats.hp
      }

      // 检查新技能解锁
      var newSkills = GameData.getUnlockedSkills(pet.species, pet.level)
      if (newSkills.length > pet.learnedSkills.length) {
        for (var i = pet.learnedSkills.length; i < newSkills.length; i++) {
          app.showToast('🎯 学会新技能: ' + newSkills[i].name + '！')
        }
        pet.learnedSkills = newSkills.map(function(_, idx) { return idx })
      }
    } else {
      break
    }
  }

  if (leveledUp) {
    PetView.render(app.state, app)
    app.save()
  }
}

// -----------------------------------------------------------
// 进化动画
// -----------------------------------------------------------

app.showEvolution = function(pet) {
  var overlay = document.getElementById('evo-overlay')
  var species = GameData.SPECIES[pet.species]
  var emoji = species.emojiStages[pet.currentStage] || '✨'

  document.getElementById('evo-emoji').textContent = emoji
  document.getElementById('evo-title').textContent = '🌟 进化！'
  document.getElementById('evo-desc').textContent =
    pet.name + ' 进化到了第 ' + (pet.currentStage + 1) + ' 阶段！属性大幅提升！'

  overlay.style.display = 'flex'

  document.getElementById('evo-ok-btn').onclick = function() {
    overlay.style.display = 'none'
  }
}

// -----------------------------------------------------------
// P2P 初始化
// -----------------------------------------------------------

app.initP2P = async function() {
  if (!window.__amiba__) {
    console.log('[PetWorld] ✗ 非 Tauri 环境，P2P 不可用')
    return
  }

  try {
    await __amiba__.network.setVisibility({ lan: true })
    await __amiba__.network.startListening(SERVICE_KEY)
    console.log('[PetWorld] ✓ P2P 初始化完成')

    // 监听外来会话
    __amiba__.network.onSession(function(session) {
      console.log('[PetWorld] === 收到外来连接: ' + (session.peerId || 'unknown'))
      app.sessions.push(session)

      session.on('message', function(raw) {
        app.handleMessage(raw, session)
      })

      session.on('close', function() {
        console.log('[PetWorld] === 会话关闭: ' + (session.peerId || 'unknown'))
        app.removeSession(session.peerId)
        // 如果该会话是战斗会话，重置战斗状态
        if (window.Battle && Battle.session && Battle.session.peerId === session.peerId) {
          Battle.reset()
          app.renderCurrentTab()
          app.showToast('连接断开，战斗结束')
        }
        // 如果该会话是交易会话，重置交易状态
        if (window.Trade && Trade.session && Trade.session.peerId === session.peerId) {
          Trade.reset()
          app.renderCurrentTab()
          app.showToast('连接断开，交易已取消')
        }
      })
    })

    // 监听新设备
    __amiba__.network.onPeerDiscovered(function() {
      PlayerList.refresh(app)
    })

    // 定时刷新设备列表（4 秒间隔）
    setInterval(function() { PlayerList.refresh(app) }, 4000)

  } catch (e) {
    console.log('[PetWorld] ✗ P2P 初始化失败:', e.message)
  }
}

// -----------------------------------------------------------
// 消息分发
// -----------------------------------------------------------

app.handleMessage = function(raw, session) {
  var msg
  try { msg = JSON.parse(raw) } catch (e) { return }

  if (!msg.type) return

  console.log('[PetWorld] ← 收到消息: ' + msg.type + ' from ' + (session.peerId || '?'))

  switch (msg.type) {

    // 对战
    case 'battle_request':
      if (window.Battle) Battle.handleRequest(msg, session, app)
      break
    case 'battle_accept':
      if (window.Battle) Battle.handleAccept(msg, app)
      break
    case 'battle_decline':
      if (window.Battle) Battle.handleDecline(app)
      break
    case 'battle_action':
      if (window.Battle) Battle.handleAction(msg, app)
      break
    case 'battle_result':
      // 对方已结束战斗，不用额外处理
      break
    case 'battle_sync':
      if (window.Battle) Battle.handleSync(msg, app)
      break

    // 交易
    case 'trade_request':
      if (window.Trade) Trade.handleRequest(msg, session, app)
      break
    case 'trade_accept':
      if (window.Trade) Trade.handleAccept(app)
      break
    case 'trade_decline':
      if (window.Trade) Trade.handleDecline(app)
      break
    case 'trade_offer':
      if (window.Trade) Trade.handleOffer(msg, app)
      break
    case 'trade_confirm':
      if (window.Trade) Trade.handleConfirm(app)
      break
    case 'trade_complete':
      if (window.Trade) Trade.handleComplete(msg, app)
      break
    case 'trade_cancel':
      if (window.Trade) Trade.handleCancel(app)
      break
  }
}

// -----------------------------------------------------------
// 会话管理
// -----------------------------------------------------------

app.removeSession = function(peerId) {
  for (var i = 0; i < app.sessions.length; i++) {
    if (app.sessions[i].peerId === peerId) {
      app.sessions.splice(i, 1)
      break
    }
  }
}

// -----------------------------------------------------------
// 启动
// -----------------------------------------------------------

document.addEventListener('DOMContentLoaded', function() {
  app.init()
})

})()
