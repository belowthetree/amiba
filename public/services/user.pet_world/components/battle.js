// ============================================================
// 宠物世界 — 对战系统
// ============================================================

;(function() {

var Battle = window.Battle = {}

// ---- 状态 ----
Battle.state = 'idle'  // idle | requesting | battling
Battle.opponentName = ''
Battle.opponentPet = null
Battle.petSnapshot = null
Battle.session = null
Battle.turnCount = 0
Battle.isMyTurn = false
Battle.cooldowns = {}  // skillIndex -> remaining turns
Battle.opponentCooldowns = {}
Battle.myDebuffs = {}  // atkDebuff:{turns}, defDebuff:{turns}
Battle.opponentDebuffs = {}

// -----------------------------------------------------------
// 发起对战请求
// -----------------------------------------------------------

Battle.requestBattle = function(peerId, peerName, app) {
  if (Battle.state !== 'idle') { app.showToast('已在战斗中！', 'error'); return }
  var pet = app.state.pet
  Battle.state = 'requesting'
  Battle.opponentName = peerName
  Battle.petSnapshot = Battle.clonePet(pet)

  var msg = {
    type: 'battle_request',
    challengerName: '我',
    pet: {
      name: pet.name,
      level: pet.level,
      species: pet.species,
      stage: pet.currentStage,
      hp: pet.currentHp,
      maxHp: pet.baseStats.hp,
      atk: pet.baseStats.atk,
      def: pet.baseStats.def,
      spd: pet.baseStats.spd,
      equippedSkills: Battle.getSkillList(pet)
    }
  }

  for (var i = 0; i < app.sessions.length; i++) {
    if (app.sessions[i].peerId === peerId) {
      app.sessions[i].send(JSON.stringify(msg))
      break
    }
  }
  app.showToast('已发送对战请求...', 'success')
}

// -----------------------------------------------------------
// 接收对战请求
// -----------------------------------------------------------

Battle.handleRequest = async function(msg, session, app) {
  if (Battle.state !== 'idle') {
    session.send(JSON.stringify({ type: 'battle_decline', reason: '对方正在战斗中' }))
    return
  }

  var confirmed = await app.confirm('⚔️ ' + msg.challengerName + ' 向你发起对战挑战！\n对方宠物: ' + msg.pet.name + ' Lv.' + msg.pet.level + '\n是否接受？')
  if (!confirmed) {
    session.send(JSON.stringify({ type: 'battle_decline' }))
    return
  }

  var pet = app.state.pet
  Battle.state = 'battling'
  Battle.opponentName = msg.challengerName
  Battle.opponentPet = msg.pet
  Battle.petSnapshot = Battle.clonePet(pet)
  Battle.session = session
  Battle.turnCount = 0
  Battle.cooldowns = {}
  Battle.opponentCooldowns = {}
  Battle.myDebuffs = {}
  Battle.opponentDebuffs = {}
  Battle.isMyTurn = Battle.calcFirstTurn(pet, msg.pet)

  var firstTurn = Battle.calcFirstTurn(pet, msg.pet)

  session.send(JSON.stringify({
    type: 'battle_accept',
    defenderName: '我',
    firstTurn: firstTurn ? 'defender' : 'challenger',
    pet: {
      name: pet.name,
      level: pet.level,
      species: pet.species,
      stage: pet.currentStage,
      hp: pet.currentHp,
      maxHp: pet.baseStats.hp,
      atk: pet.baseStats.atk,
      def: pet.baseStats.def,
      spd: pet.baseStats.spd,
      equippedSkills: Battle.getSkillList(pet)
    }
  }))

  app.showToast('⚔️ 战斗开始！', 'success')
  Battle.renderArena(app)
}

// -----------------------------------------------------------
// 接受对战
// -----------------------------------------------------------

Battle.handleAccept = function(msg, app) {
  Battle.state = 'battling'
  Battle.opponentPet = msg.pet
  Battle.turnCount = 0
  Battle.cooldowns = {}
  Battle.opponentCooldowns = {}
  Battle.myDebuffs = {}
  Battle.opponentDebuffs = {}

  Battle.isMyTurn = (msg.firstTurn === 'challenger')

  app.showToast('⚔️ 战斗开始！', 'success')
  Battle.renderArena(app)
}

// -----------------------------------------------------------
// 拒绝
// -----------------------------------------------------------

Battle.handleDecline = function(app) {
  Battle.state = 'idle'
  app.showToast('对方拒绝了挑战', 'error')
  Battle.renderArena(app)
  Battle.renderPlayerList(app)
}

// -----------------------------------------------------------
// 执行动作
// -----------------------------------------------------------

Battle.performAction = function(actionType, skillIndex, app) {
  if (!Battle.isMyTurn) { app.showToast('现在是对手的回合！'); return }
  if (Battle.state !== 'battling') return
  if (!Battle.session) return

  if (actionType === 'skill' && skillIndex !== undefined) {
    var pet = app.state.pet
    var skillList = GameData.getUnlockedSkills(pet.species, pet.level)
    var sk = skillList[skillIndex]
    if (!sk) return
    if (Battle.cooldowns[skillIndex] && Battle.cooldowns[skillIndex] > 0) {
      app.showToast('技能冷却中！剩余 ' + Battle.cooldowns[skillIndex] + ' 回合')
      return
    }
  }

  Battle.isMyTurn = false

  var msg = { type: 'battle_action', actionType: actionType }
  if (actionType === 'skill') msg.skillIndex = skillIndex
  Battle.session.send(JSON.stringify(msg))

  Battle.resolveAction(actionType, skillIndex, 'me', app)
}

// -----------------------------------------------------------
// 处理对方动作
// -----------------------------------------------------------

Battle.handleAction = function(msg, app) {
  if (Battle.state !== 'battling') return
  Battle.resolveAction(msg.actionType, msg.skillIndex, 'opponent', app)
}

// -----------------------------------------------------------
// 解析动作
// -----------------------------------------------------------

Battle.resolveAction = function(actionType, skillIndex, who, app) {
  var pet = app.state.pet
  var snap = Battle.petSnapshot
  var opp = Battle.opponentPet

  if (!pet || !opp) return

  var isMe = (who === 'me')
  var attacker = isMe ? snap : opp
  var defender = isMe ? opp : snap
  var attackerDebuffs = isMe ? Battle.myDebuffs : Battle.opponentDebuffs
  var defenderDebuffs = isMe ? Battle.opponentDebuffs : Battle.myDebuffs

  var logLine = ''
  var dmg = 0
  var killed = false

  if (actionType === 'flee') {
    if (isMe) {
      var success = Math.random() < 0.5
      if (success) {
        Battle.addLog('🏃 你成功逃跑了！', 'info')
        Battle.endBattle(false, app)
        return
      } else {
        Battle.addLog('🏃 逃跑失败！', 'info')
        Battle.isMyTurn = true
        Battle.renderArena(app)
        return
      }
    } else {
      Battle.addLog('🏃 对方逃跑了！', 'info')
      Battle.endBattle(true, app)
      return
    }
  }

  if (actionType === 'defend') {
    var whoName = isMe ? '你' : Battle.opponentName
    Battle.addLog('🛡️ ' + whoName + ' 进入防御姿态！', 'info')
    if (defenderDebuffs) defenderDebuffs.defending = 2
    if (!isMe) Battle.isMyTurn = true
    Battle.turnCount++
    Battle.tickCooldowns(isMe ? Battle.cooldowns : Battle.opponentCooldowns)
    Battle.renderArena(app)
    return
  }

  if (actionType === 'item') {
    // opponent uses item — skip
    Battle.addLog('💊 ' + (isMe ? '你' : Battle.opponentName) + ' 使用了道具', 'heal')
    if (!isMe) {
      opp.hp = Math.min(opp.maxHp, opp.hp + 30)
    }
    if (!isMe) Battle.isMyTurn = true
    Battle.turnCount++
    Battle.tickCooldowns(isMe ? Battle.cooldowns : Battle.opponentCooldowns)
    Battle.renderArena(app)
    return
  }

  if (actionType === 'attack') {
    dmg = Battle.calcDamage(attacker, defender, null, attackerDebuffs, defenderDebuffs)
    defender.hp = Math.max(0, defender.hp - dmg)
    var an = isMe ? '你' : Battle.opponentName
    var dn = isMe ? Battle.opponentName : '你'
    Battle.addLog('⚔️ ' + an + ' 攻击 ' + dn + ' 造成 ' + dmg + ' 点伤害', 'dmg')
    logLine = '攻击'
  }

  if (actionType === 'skill' && skillIndex !== undefined) {
    var skillList = GameData.getUnlockedSkills(
      isMe ? pet.species : (opp.species || pet.species),
      isMe ? pet.level : (opp.level || pet.level)
    )
    var sk = skillList[skillIndex]
    if (!sk) {
      if (!isMe) Battle.isMyTurn = true
      Battle.renderArena(app)
      return
    }

    if (isMe) Battle.cooldowns[skillIndex] = sk.cooldown

    var skName = sk.name

    if (sk.type === 'attack') {
      dmg = Battle.calcDamage(attacker, defender, sk, attackerDebuffs, defenderDebuffs)
      defender.hp = Math.max(0, defender.hp - dmg)
      var an2 = isMe ? '你' : Battle.opponentName
      var dn2 = isMe ? Battle.opponentName : '你'
      Battle.addLog('🎯 ' + an2 + ' 使用 ' + skName + ' 对 ' + dn2 + ' 造成 ' + dmg + ' 点伤害', 'dmg')
      logLine = '技能'
    } else if (sk.type === 'heal') {
      attacker.hp = Math.min(attacker.maxHp || attacker.hp, attacker.hp + sk.power)
      var an3 = isMe ? '你' : Battle.opponentName
      Battle.addLog('💚 ' + an3 + ' 使用 ' + skName + ' 回复了 ' + sk.power + ' HP', 'heal')
    } else if (sk.type === 'debuff') {
      if (sk.name.indexOf('灼烧') >= 0 || sk.name.indexOf('吼叫') >= 0) {
        if (!isMe) {
          if (Battle.myDebuffs) Battle.myDebuffs.dotTurns = 3; Battle.myDebuffs.dotDmg = 15
        } else {
          if (Battle.opponentDebuffs) Battle.opponentDebuffs.dotTurns = 3; Battle.opponentDebuffs.dotDmg = 15
        }
        dmg = Battle.calcDamage(attacker, defender, sk, attackerDebuffs, defenderDebuffs)
        defender.hp = Math.max(0, defender.hp - dmg)
        var an4 = isMe ? '你' : Battle.opponentName
        var dn4 = isMe ? Battle.opponentName : '你'
        Battle.addLog('🎯 ' + an4 + ' 使用 ' + skName + ' 对 ' + dn4 + ' 造成 ' + dmg + ' 点伤害并附加减益', 'dmg')
      }
    }
  }

  // 检查是否死亡
  if (defender.hp <= 0) {
    killed = true
    Battle.addLog((isMe ? Battle.opponentName : '你') + ' 的宠物倒下了！', 'system')
    Battle.endBattle(isMe, app)
    return
  }

  Battle.turnCount++
  Battle.tickCooldowns(isMe ? Battle.cooldowns : Battle.opponentCooldowns)
  Battle.isMyTurn = !isMe
  Battle.renderArena(app)
  Battle.checkSync(app)
}

// -----------------------------------------------------------
// 检查同步（回合结束后发送当前状态给对方）
// -----------------------------------------------------------

Battle.checkSync = function(app) {
  if (!Battle.session) return
  var pet = app.state.pet
  var snap = Battle.petSnapshot
  var opp = Battle.opponentPet
  if (!snap || !opp) return
  Battle.session.send(JSON.stringify({
    type: 'battle_sync',
    myHp: snap.hp,
    oppHp: opp.hp,
    cooldowns: Battle.cooldowns,
    oppCooldowns: Battle.opponentCooldowns
  }))
}

Battle.handleSync = function(msg, app) {
  if (Battle.state !== 'battling') return
  var opp = Battle.opponentPet
  if (opp) {
    if (msg.oppHp !== undefined) opp.hp = msg.oppHp
  }
  var snap = Battle.petSnapshot
  if (snap && msg.myHp !== undefined) snap.hp = msg.myHp
}

// -----------------------------------------------------------
// 计算先手
// -----------------------------------------------------------

Battle.calcFirstTurn = function(myPet, oppPet) {
  var mySpd = myPet.baseStats.spd
  var oppSpd = oppPet.spd || oppPet.baseStats.spd || 20
  if (mySpd === oppSpd) return myPet.id > oppPet.id
  return mySpd > oppSpd
}

// -----------------------------------------------------------
// 伤害计算
// -----------------------------------------------------------

Battle.calcDamage = function(attacker, defender, skill, atkDebuffs, defDebuffs) {
  var atk = attacker.atk
  var def = defender.def
  if (atkDebuffs && atkDebuffs.atkDebuffTurns && atkDebuffs.atkDebuffTurns > 0) atk = Math.round(atk * 0.8)
  if (defDebuffs && defDebuffs.defDebuffTurns && defDebuffs.defDebuffTurns > 0) def = Math.round(def * 0.8)
  if (defDebuffs && defDebuffs.defending && defDebuffs.defending > 0) def = Math.round(def * 1.5)
  var power = skill ? skill.power : 30
  return GameData.calcDamage(atk, def, power)
}

// -----------------------------------------------------------
// 冷却处理
// -----------------------------------------------------------

Battle.tickCooldowns = function(cds) {
  for (var k in cds) {
    if (cds[k] > 0) cds[k]--
  }
}

// -----------------------------------------------------------
// 战斗结束
// -----------------------------------------------------------

Battle.endBattle = function(iWon, app) {
  var pet = app.state.pet
  var opp = Battle.opponentPet
  if (!pet || !opp) { Battle.reset(); return }

  var exp, gold
  if (iWon) {
    exp = GameData.calcBattleExp(opp.level)
    gold = GameData.calcBattleGold(opp.level)
    pet.wins++
    Battle.addLog('🏆 战斗胜利！获得 ' + exp + ' EXP, ' + gold + ' 金币', 'system')
  } else {
    exp = Math.round(GameData.calcBattleExp(opp.level) / 2)
    pet.losses++
    Battle.addLog('💀 战斗失败... 获得 ' + exp + ' EXP', 'system')
  }

  pet.exp += exp
  app.state.inventory.gold += gold

  if (Battle.session) {
    Battle.session.send(JSON.stringify({
      type: 'battle_result', winner: iWon ? 'me' : 'opponent',
      exp: iWon ? 0 : Math.round(GameData.calcBattleExp(pet.level) / 2),
      gold: iWon ? 0 : 0
    }))
  }

  // 检查升级
  app.checkLevelUp()
  app.updateGold()

  setTimeout(function() {
    Battle.reset()
    app.renderCurrentTab()
    app.save()
  }, 3000)
}

// -----------------------------------------------------------
// 渲染对战 UI
// -----------------------------------------------------------

Battle.renderArena = function(app) {
  Battle.renderBattleUI(app)
  Battle.renderPlayerList(app)
}

Battle.renderBattleUI = function(app) {
  var el = document.getElementById('tab-battle')
  var pet = app.state.pet
  var snap = Battle.petSnapshot
  var opp = Battle.opponentPet

  if (Battle.state !== 'battling' || !snap || !opp) {
    var listArea = el.querySelector('.player-list-area')
    if (listArea) listArea.classList.remove('hidden')
    var arena = el.querySelector('.battle-arena')
    if (arena) arena.classList.remove('active')
    return
  }

  var listArea = el.querySelector('.player-list-area')
  if (listArea) listArea.classList.add('hidden')

  var arena = el.querySelector('.battle-arena')
  if (!arena) {
    arena = document.createElement('div')
    arena.className = 'battle-arena'
    el.appendChild(arena)
  }
  arena.classList.add('active')

  var myHpPct = Math.round(snap.hp / snap.maxHp * 100)
  var oppHpPct = Math.round(opp.hp / opp.maxHp * 100)
  var mySpecies = GameData.SPECIES[pet.species]
  var oppSpecies = GameData.SPECIES[opp.species] || GameData.SPECIES.normal
  var myEmoji = mySpecies.emojiStages[snap.stage || pet.currentStage] || mySpecies.emoji
  var oppEmoji = oppSpecies.emojiStages[opp.stage || 0] || oppSpecies.emoji
  var myHpClass = myHpPct < 25 ? 'low' : ''
  var oppHpClass = oppHpPct < 25 ? 'low' : ''

  var skillButtonsHtml = ''
  if (Battle.isMyTurn) {
    var skillList = GameData.getUnlockedSkills(pet.species, pet.level)
    skillList.forEach(function(sk, i) {
      var cd = Battle.cooldowns[i] || 0
      var disabled = cd > 0 ? 'disabled' : ''
      var cdLabel = cd > 0 ? ' (' + cd + ')' : ''
      skillButtonsHtml +=
        '<button class="btn small" ' + disabled + ' onclick="Battle.performAction(\'skill\', ' + i + ', app)">' +
          sk.name + cdLabel +
        '</button>'
    })
  }

  arena.innerHTML =
    '<div class="battle-top"><div class="battle-title">⚔️ 对战 ' + escapeHtml(Battle.opponentName) + '</div></div>' +
    '<div class="battle-field">' +
      '<div class="battle-pet">' +
        '<span class="bp-emoji">' + myEmoji + '</span>' +
        '<div class="bp-name">' + escapeHtml(pet.name) + ' Lv.' + pet.level + '</div>' +
        '<div class="bp-hp-bar"><div class="bp-hp-fill ' + myHpClass + '" style="width:' + myHpPct + '%"></div></div>' +
        '<div class="bp-hp-text">' + snap.hp + '/' + snap.maxHp + '</div>' +
      '</div>' +
      '<div class="battle-vs">VS</div>' +
      '<div class="battle-pet">' +
        '<span class="bp-emoji">' + oppEmoji + '</span>' +
        '<div class="bp-name">' + escapeHtml(opp.name) + ' Lv.' + opp.level + '</div>' +
        '<div class="bp-hp-bar"><div class="bp-hp-fill ' + oppHpClass + '" style="width:' + oppHpPct + '%"></div></div>' +
        '<div class="bp-hp-text">' + opp.hp + '/' + opp.maxHp + '</div>' +
      '</div>' +
    '</div>' +

    '<div class="battle-log" id="battle-log"></div>' +

    '<div class="battle-actions">' +
      '<button class="btn" onclick="Battle.performAction(\'attack\', undefined, app)" ' + (!Battle.isMyTurn ? 'disabled' : '') + '>⚔️ 攻击</button>' +
      skillButtonsHtml +
      '<button class="btn" onclick="Battle.performAction(\'defend\', undefined, app)" ' + (!Battle.isMyTurn ? 'disabled' : '') + '>🛡️ 防御</button>' +
      '<button class="btn danger" onclick="Battle.performAction(\'flee\', undefined, app)" ' + (!Battle.isMyTurn ? 'disabled' : '') + '>🏃 逃跑</button>' +
    '</div>' +

    '<div style="text-align:center;margin-top:6px;font-size:12px;color:#9CA3AF">' +
      (Battle.isMyTurn ? '🎯 你的回合' : '⏳ 等待对方行动...') +
      ' | 回合 ' + Battle.turnCount +
    '</div>'

  Battle.logContainer = document.getElementById('battle-log')
  if (Battle._logLines) {
    Battle._logLines.forEach(function(l) {
      Battle.renderLogLine(l)
    })
    if (Battle.logContainer) Battle.logContainer.scrollTop = Battle.logContainer.scrollHeight
  }
}

// -----------------------------------------------------------
// 战斗日志
// -----------------------------------------------------------

Battle._logLines = []

Battle.addLog = function(text, cls) {
  if (!Battle._logLines) Battle._logLines = []
  Battle._logLines.push({ text: text, cls: cls || 'info' })
  Battle.renderLogLine({ text: text, cls: cls || 'info' })
  if (Battle.logContainer) Battle.logContainer.scrollTop = Battle.logContainer.scrollHeight
}

Battle.renderLogLine = function(entry) {
  if (!Battle.logContainer) return
  var div = document.createElement('div')
  div.className = 'log-entry log-' + entry.cls
  div.textContent = entry.text
  Battle.logContainer.appendChild(div)
}

// -----------------------------------------------------------
// 玩家列表整合（在 battle tab 中嵌入）
// -----------------------------------------------------------

Battle.renderPlayerList = function(app) {
  var el = document.getElementById('tab-battle')
  if (Battle.state === 'battling') return

  var area = el.querySelector('.player-list-area')
  if (!area) {
    area = document.createElement('div')
    area.className = 'player-list-area'
    el.appendChild(area)
  }

  if (window.PlayerList) {
    area.innerHTML =
      '<div class="player-section">' +
        '<h3>⚔️ 周围玩家 <button class="btn small ghost" onclick="PlayerList.refresh(app)" style="float:right">🔄 刷新</button></h3>' +
        '<div class="player-list" id="battle-player-list"></div>' +
      '</div>'
    PlayerList.setActionHandler(function(peerId, peerName) {
      Battle.requestBattle(peerId, peerName, app)
    })
    PlayerList.renderInContainer('battle-player-list', app, '⚔️ 挑战')
  }
}

// -----------------------------------------------------------
// 工具
// -----------------------------------------------------------

Battle.getSkillList = function(pet) {
  var skills = GameData.getUnlockedSkills(pet.species, pet.level)
  return skills.map(function(s) { return { name: s.name, type: s.type, power: s.power, cooldown: s.cooldown } })
}

Battle.clonePet = function(pet) {
  return JSON.parse(JSON.stringify(pet))
}

Battle.reset = function() {
  Battle.state = 'idle'
  Battle.opponentName = ''
  Battle.opponentPet = null
  Battle.petSnapshot = null
  Battle.session = null
  Battle.turnCount = 0
  Battle.isMyTurn = false
  Battle.cooldowns = {}
  Battle.opponentCooldowns = {}
  Battle.myDebuffs = {}
  Battle.opponentDebuffs = {}
  Battle._logLines = []
  Battle.logContainer = null
}

function escapeHtml(s) {
  var d = document.createElement('span')
  d.textContent = s
  return d.innerHTML
}

})()
