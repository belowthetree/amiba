// ============================================================
// 宠物世界 — 宠物面板 + 物种选择 + 养成 + 商店
// ============================================================

;(function() {

var PetView = window.PetView = {}

// -----------------------------------------------------------
// 物种选择渲染
// -----------------------------------------------------------

PetView.renderSpeciesSelection = function(app) {
  var overlay = document.getElementById('select-overlay')
  var grid = document.getElementById('species-grid')
  var form = document.getElementById('select-form')
  overlay.style.display = 'flex'
  form.style.display = 'none'

  var selectedSpecies = null

  grid.innerHTML = ''
  for (var id in GameData.SPECIES) {
    var s = GameData.SPECIES[id]
    var card = document.createElement('div')
    card.className = 'species-card'
    card.dataset.species = id
    card.innerHTML =
      '<span class="s-emoji">' + s.emoji + '</span>' +
      '<span class="s-name">' + s.name + '</span>' +
      '<span class="s-desc">' + s.description + '</span>'
    card.addEventListener('click', function() {
      var prev = grid.querySelector('.selected')
      if (prev) prev.classList.remove('selected')
      this.classList.add('selected')
      selectedSpecies = this.dataset.species
      PetView.renderSpeciesPreview(grid, selectedSpecies, form)
    })
    grid.appendChild(card)
  }
}

PetView.renderSpeciesPreview = function(grid, speciesId, form) {
  var existing = grid.parentNode.querySelector('.species-preview')
  if (existing) existing.remove()

  var s = GameData.SPECIES[speciesId]
  var base = s.baseStats
  var skills = GameData.getSkillsForSpecies(speciesId)
  var emojiChain = s.emojiStages.slice(0, 5).join(' ')

  var preview = document.createElement('div')
  preview.className = 'species-preview'
  preview.innerHTML =
    '<div class="stat-row"><span>基础属性</span></div>' +
    '<div class="stat-row"><span>❤️ HP</span><span>' + base.hp + '</span></div>' +
    '<div class="stat-row"><span>⚔️ 攻击</span><span>' + base.atk + '</span></div>' +
    '<div class="stat-row"><span>🛡️ 防御</span><span>' + base.def + '</span></div>' +
    '<div class="stat-row"><span>💨 速度</span><span>' + base.spd + '</span></div>' +
    '<div class="stat-row" style="margin-top:6px"><span>进化形态</span></div>' +
    '<div class="stat-row" style="font-size:20px"><span>' + emojiChain + '</span></div>' +
    '<div class="stat-row" style="margin-top:6px"><span>初始技能: <strong>' + skills[0].name + '</strong></span></div>'
  grid.parentNode.insertBefore(preview, form)
  form.style.display = 'flex'

  document.getElementById('confirm-pet-btn').onclick = function() {
    var name = document.getElementById('pet-name-input').value.trim()
    if (!name) { PetView.showToast('请为你的宠物起个名字！'); return }
    app.onPetCreated(speciesId, name)
  }
}

// -----------------------------------------------------------
// 宠物面板渲染
// -----------------------------------------------------------

PetView.render = function(state, app) {
  var el = document.getElementById('tab-pet')
  var pet = state.pet
  if (!pet) { el.innerHTML = '<p class="hint-text">还没有宠物</p>'; return }

  var species = GameData.SPECIES[pet.species]
  var stageInfo = GameData.getStageInfo(pet.currentStage)
  var stageEmoji = species.emojiStages[pet.currentStage] || species.emoji
  var totalHp = pet.baseStats.hp
  var expNext = GameData.expToNextLevel(pet.level)
  var skills = GameData.getUnlockedSkills(pet.species, pet.level)

  var hpPct = Math.round(pet.currentHp / totalHp * 100)
  var hungerPct = Math.round(pet.hunger)
  var happyPct = Math.round(pet.happiness)
  var energyPct = Math.round(pet.energy)
  var expPct = Math.round(pet.exp / expNext * 100)

  var skillHtml = ''
  skills.forEach(function(sk, i) {
    skillHtml += '<span class="skill-badge">' + sk.name + '</span>'
  })

  var inventory = state.inventory
  var shopHtml = ''
  for (var itemId in GameData.ITEMS) {
    var item = GameData.ITEMS[itemId]
    var qty = 0
    inventory.items.forEach(function(ii) { if (ii.id === itemId) qty = ii.quantity })
    shopHtml +=
      '<div class="shop-item">' +
        '<div class="si-info">' +
          '<div class="si-name">' + item.name + ' <span class="si-desc">(' + qty + ')</span></div>' +
          '<div class="si-desc">' + item.desc + '</div>' +
        '</div>' +
        '<div>' +
          '<span class="si-price">💰' + item.price + '</span>' +
          '<button class="btn small" onclick="PetView.buyItem(\'' + itemId + '\', app)">购买</button>' +
          '<button class="btn small success" onclick="PetView.useItem(\'' + itemId + '\', app)" ' + (qty < 1 ? 'disabled' : '') + '>使用</button>' +
        '</div>' +
      '</div>'
  }

  el.innerHTML =
    '<div class="pet-header">' +
      '<span class="pet-emoji">' + stageEmoji + '</span>' +
      '<div class="pet-name-level">' + escapeHtml(pet.name) + ' <span style="color:#667eea">Lv.' + pet.level + '</span></div>' +
      '<div class="pet-species-label">' + species.name + ' · 阶段' + (pet.currentStage + 1) + '/' + GameData.EVOLUTION_STAGES.length + '</div>' +
    '</div>' +

    '<div class="stat-bar bar-hp">' +
      '<div class="bar-label"><span>❤️ HP</span><span>' + pet.currentHp + '/' + totalHp + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + hpPct + '%"></div></div>' +
    '</div>' +
    '<div class="stat-bar bar-hunger">' +
      '<div class="bar-label"><span>🍞 饥饿度</span><span>' + Math.round(pet.hunger) + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + hungerPct + '%"></div></div>' +
    '</div>' +
    '<div class="stat-bar bar-happy">' +
      '<div class="bar-label"><span>🎾 快乐度</span><span>' + Math.round(pet.happiness) + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + happyPct + '%"></div></div>' +
    '</div>' +
    '<div class="stat-bar bar-energy">' +
      '<div class="bar-label"><span>⚡ 体力</span><span>' + Math.round(pet.energy) + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + energyPct + '%"></div></div>' +
    '</div>' +
    '<div class="stat-bar bar-exp">' +
      '<div class="bar-label"><span>⭐ EXP</span><span>' + pet.exp + '/' + expNext + '</span></div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + expPct + '%"></div></div>' +
    '</div>' +

    '<div class="action-row">' +
      '<button class="btn primary small" onclick="PetView.doFeed(app)">🍞 喂食</button>' +
      '<button class="btn success small" onclick="PetView.doPlay(app)">🎾 玩耍</button>' +
      '<button class="btn small" onclick="PetView.doRest(app)" style="background:#2196f3;color:#fff">😴 休息</button>' +
      '<button class="btn danger small" onclick="PetView.doHeal(app)">🏥 治疗</button>' +
    '</div>' +

    '<div class="stats-grid">' +
      '<div class="stat-item"><span>⚔️ 攻击</span><span class="stat-val stat-att">' + pet.baseStats.atk + '</span></div>' +
      '<div class="stat-item"><span>🛡️ 防御</span><span class="stat-val stat-def">' + pet.baseStats.def + '</span></div>' +
      '<div class="stat-item"><span>💨 速度</span><span class="stat-val stat-spd">' + pet.baseStats.spd + '</span></div>' +
      '<div class="stat-item"><span>🏆 胜/败</span><span class="stat-val">' + pet.wins + '/' + pet.losses + '</span></div>' +
    '</div>' +

    '<div class="skill-section">' +
      '<h4>🎯 已掌握技能</h4>' +
      '<div class="skill-grid">' + skillHtml + '</div>' +
    '</div>' +

    '<div class="shop-section">' +
      '<h4>🏪 道具商店</h4>' +
      shopHtml +
    '</div>'
}

// -----------------------------------------------------------
// 养成操作
// -----------------------------------------------------------

PetView.doFeed = function(app) {
  var pet = app.state.pet
  var item = app.findItem('bread')
  if (!item || item.quantity < 1) { app.showToast('你没有面包了！'); return }
  if (pet.hunger >= 100) { app.showToast('宠物已经很饱了！'); return }
  item.quantity--
  pet.hunger = Math.min(100, pet.hunger + 20)
  app.showToast('🍞 喂食成功！饥饿度 +20')
  PetView.render(app.state, app)
  app.save()
}

PetView.doPlay = function(app) {
  var pet = app.state.pet
  if (pet.energy < 10) { app.showToast('宠物太累了，先休息一下吧！'); return }
  if (pet.happiness >= 100) { app.showToast('宠物已经很开心了！'); return }
  pet.energy = Math.max(0, pet.energy - 10)
  pet.happiness = Math.min(100, pet.happiness + 20)
  app.showToast('🎾 玩耍成功！快乐度 +20，体力 -10')
  PetView.render(app.state, app)
  app.save()
}

PetView.doRest = function(app) {
  var pet = app.state.pet
  if (pet.energy >= 100) { app.showToast('宠物精力充沛！'); return }
  pet.energy = Math.min(100, pet.energy + 30)
  app.showToast('😴 休息成功！体力 +30')
  PetView.render(app.state, app)
  app.save()
}

PetView.doHeal = function(app) {
  var pet = app.state.pet
  var item = app.findItem('potion')
  if (!item || item.quantity < 1) { app.showToast('你没有伤药了！'); return }
  if (pet.currentHp >= pet.baseStats.hp) { app.showToast('宠物 HP 已满！'); return }
  item.quantity--
  pet.currentHp = Math.min(pet.baseStats.hp, pet.currentHp + 30)
  app.showToast('🏥 治疗成功！HP +30')
  PetView.render(app.state, app)
  app.save()
}

// -----------------------------------------------------------
// 商店操作
// -----------------------------------------------------------

PetView.buyItem = function(itemId, app) {
  var itemDef = GameData.ITEMS[itemId]
  if (app.state.inventory.gold < itemDef.price) { app.showToast('金币不足！'); return }
  app.state.inventory.gold -= itemDef.price
  var existing = app.findItem(itemId)
  if (existing) { existing.quantity++ }
  else { app.state.inventory.items.push({ id: itemId, quantity: 1 }) }
  app.showToast('购买了 ' + itemDef.name + '！')
  PetView.render(app.state, app)
  app.updateGold()
  app.save()
}

PetView.useItem = function(itemId, app) {
  var item = app.findItem(itemId)
  if (!item || item.quantity < 1) return
  var itemDef = GameData.ITEMS[itemId]
  var pet = app.state.pet
  var used = false

  if (itemDef.effect.hp) {
    pet.currentHp = Math.min(pet.baseStats.hp, pet.currentHp + itemDef.effect.hp)
    used = true
  }
  if (itemDef.effect.hunger) {
    pet.hunger = Math.min(100, pet.hunger + itemDef.effect.hunger)
    used = true
  }
  if (itemDef.effect.happiness) {
    pet.happiness = Math.min(100, pet.happiness + itemDef.effect.happiness)
    used = true
  }
  if (itemDef.effect.energy) {
    pet.energy = Math.min(100, pet.energy + itemDef.effect.energy)
    used = true
  }

  if (used) {
    item.quantity--
    app.showToast('使用了 ' + itemDef.name + '！')
    PetView.render(app.state, app)
    app.save()
  }
}

function escapeHtml(s) {
  var d = document.createElement('span')
  d.textContent = s
  return d.innerHTML
}

})()
