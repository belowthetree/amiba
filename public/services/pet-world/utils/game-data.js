// ============================================================
// 宠物世界 — 游戏常量数据
// ============================================================

var GameData = {}

// -----------------------------------------------------------
// 物种定义
// -----------------------------------------------------------

GameData.SPECIES = {
  fire: {
    id: 'fire',
    name: '火系',
    emoji: '🔥',
    description: '高攻击、低防御',
    baseStats: { hp: 110, atk: 55, def: 25, spd: 40 },
    emojiStages: ['🔥', '🌋', '🐉', '👹', '🌞', '☀️', '💥', '🌟', '🔆', '✨']
  },
  water: {
    id: 'water',
    name: '水系',
    emoji: '💧',
    description: '均衡型',
    baseStats: { hp: 120, atk: 40, def: 40, spd: 35 },
    emojiStages: ['💧', '🌊', '🐬', '🐋', '🌀', '🌪️', '💦', '🌎', '🌊', '🌌']
  },
  grass: {
    id: 'grass',
    name: '草系',
    emoji: '🌿',
    description: '高防御、低速度',
    baseStats: { hp: 130, atk: 35, def: 55, spd: 20 },
    emojiStages: ['🌿', '🌱', '🌲', '🌸', '🌳', '🌴', '🌵', '🍀', '🌺', '🌻']
  },
  normal: {
    id: 'normal',
    name: '普通',
    emoji: '⭐',
    description: '高速、平衡',
    baseStats: { hp: 115, atk: 45, def: 35, spd: 55 },
    emojiStages: ['⭐', '💫', '🦊', '🐺', '🦁', '🐯', '🦅', '🐉', '⚡', '💎']
  }
}

// -----------------------------------------------------------
// 技能定义
// -----------------------------------------------------------

GameData.SKILLS = {
  // ===== 火系 =====
  fire_ember: { name: '火花', species: 'fire', unlockLevel: 1, type: 'attack', power: 30, cooldown: 0, desc: '基础火焰攻击' },
  fire_fang: { name: '火焰牙', species: 'fire', unlockLevel: 5, type: 'attack', power: 45, cooldown: 1, desc: '灼热的利齿' },
  fire_storm: { name: '烈焰风暴', species: 'fire', unlockLevel: 10, type: 'attack', power: 65, cooldown: 2, desc: '召唤火焰风暴' },
  fire_burn: { name: '灼烧', species: 'fire', unlockLevel: 15, type: 'debuff', power: 40, cooldown: 2, desc: '攻击并灼烧对手 3 回合' },
  fire_inferno: { name: '炼狱', species: 'fire', unlockLevel: 20, type: 'attack', power: 90, cooldown: 2, desc: '炼狱之火' },
  fire_eruption: { name: '火山爆发', species: 'fire', unlockLevel: 30, type: 'attack', power: 110, cooldown: 3, desc: '终极火焰' },

  // ===== 水系 =====
  water_gun: { name: '水枪', species: 'water', unlockLevel: 1, type: 'attack', power: 30, cooldown: 0, desc: '基础水系攻击' },
  water_bubble: { name: '泡沫光线', species: 'water', unlockLevel: 5, type: 'attack', power: 45, cooldown: 1, desc: '泡沫攻击' },
  water_surf: { name: '冲浪', species: 'water', unlockLevel: 10, type: 'attack', power: 65, cooldown: 2, desc: '乘浪冲击' },
  water_heal: { name: '治愈之雨', species: 'water', unlockLevel: 15, type: 'heal', power: 40, cooldown: 2, desc: '回复 40 HP' },
  water_hydro: { name: '水炮', species: 'water', unlockLevel: 20, type: 'attack', power: 90, cooldown: 2, desc: '高压水炮' },
  water_storm: { name: '暴风雨', species: 'water', unlockLevel: 30, type: 'attack', power: 110, cooldown: 3, desc: '终极水系' },

  // ===== 草系 =====
  grass_vine: { name: '藤鞭', species: 'grass', unlockLevel: 1, type: 'attack', power: 30, cooldown: 0, desc: '基础草系攻击' },
  grass_razor: { name: '飞叶快刀', species: 'grass', unlockLevel: 5, type: 'attack', power: 45, cooldown: 1, desc: '锐利叶片' },
  grass_solar: { name: '阳光烈焰', species: 'grass', unlockLevel: 10, type: 'attack', power: 65, cooldown: 2, desc: '阳光聚焦攻击' },
  grass_synthesis: { name: '光合作用', species: 'grass', unlockLevel: 15, type: 'heal', power: 50, cooldown: 2, desc: '回复 50 HP' },
  grass_petal: { name: '花瓣舞', species: 'grass', unlockLevel: 20, type: 'attack', power: 90, cooldown: 2, desc: '花瓣风暴' },
  grass_nature: { name: '自然之力', species: 'grass', unlockLevel: 30, type: 'attack', power: 110, cooldown: 3, desc: '终极草系' },

  // ===== 普通 =====
  normal_tackle: { name: '撞击', species: 'normal', unlockLevel: 1, type: 'attack', power: 30, cooldown: 0, desc: '基础攻击' },
  normal_headbutt: { name: '头锤', species: 'normal', unlockLevel: 5, type: 'attack', power: 45, cooldown: 1, desc: '猛烈头槌' },
  normal_bodyslam: { name: '猛撞', species: 'normal', unlockLevel: 10, type: 'attack', power: 65, cooldown: 2, desc: '全力冲撞' },
  normal_roar: { name: '吼叫', species: 'normal', unlockLevel: 15, type: 'debuff', power: 0, cooldown: 2, desc: '降低对手 20% 攻击 3 回合' },
  normal_hyper: { name: '破坏光线', species: 'normal', unlockLevel: 20, type: 'attack', power: 90, cooldown: 2, desc: '毁灭光线' },
  normal_giga: { name: '终极冲击', species: 'normal', unlockLevel: 30, type: 'attack', power: 110, cooldown: 3, desc: '终极力量' }
}

GameData.getSkillsForSpecies = function(speciesId) {
  var skills = []
  for (var key in GameData.SKILLS) {
    var s = GameData.SKILLS[key]
    if (s.species === speciesId) skills.push(s)
  }
  skills.sort(function(a, b) { return a.unlockLevel - b.unlockLevel })
  return skills
}

GameData.getUnlockedSkills = function(speciesId, level) {
  return GameData.getSkillsForSpecies(speciesId).filter(function(s) {
    return s.unlockLevel <= level
  })
}

// -----------------------------------------------------------
// 进化链
// -----------------------------------------------------------

GameData.EVOLUTION_STAGES = []
for (var i = 0; i <= 9; i++) {
  var lvl = i === 0 ? 1 : i * 10
  var mult = 1.0 + i * 0.3
  GameData.EVOLUTION_STAGES.push({ stage: i, level: lvl, statMultiplier: mult })
}

GameData.MAX_LEVEL = 100

GameData.getStageForLevel = function(level) {
  for (var i = GameData.EVOLUTION_STAGES.length - 1; i >= 0; i--) {
    if (level >= GameData.EVOLUTION_STAGES[i].level) return GameData.EVOLUTION_STAGES[i].stage
  }
  return 0
}

GameData.getStageInfo = function(stage) {
  return GameData.EVOLUTION_STAGES[Math.min(stage, GameData.EVOLUTION_STAGES.length - 1)]
}

// -----------------------------------------------------------
// EXP 曲线
// -----------------------------------------------------------

GameData.expToNextLevel = function(level) {
  return level * 50 + 100
}

// -----------------------------------------------------------
// 道具
// -----------------------------------------------------------

GameData.ITEMS = {
  bread: { name: '面包', price: 10, effect: { hunger: 20 }, desc: '+20 饥饿度' },
  potion: { name: '伤药', price: 20, effect: { hp: 30 }, desc: '+30 HP' },
  energy: { name: '能量饮料', price: 15, effect: { energy: 30 }, desc: '+30 体力' },
  toy: { name: '玩具球', price: 25, effect: { happiness: 20 }, desc: '+20 快乐度' },
  revive: { name: '复活药', price: 100, effect: { hp: 100, hunger: 30, happiness: 20, energy: 30 }, desc: '全面恢复' }
}

GameData.INITIAL_ITEMS = [
  { id: 'bread', quantity: 3 },
  { id: 'potion', quantity: 2 },
  { id: 'energy', quantity: 2 },
  { id: 'toy', quantity: 1 }
]

GameData.INITIAL_GOLD = 200

// -----------------------------------------------------------
// 战斗公式
// -----------------------------------------------------------

GameData.calcDamage = function(atkStat, defStat, power) {
  var raw = (atkStat * power / 30 - defStat * 0.3)
  var variance = 0.85 + Math.random() * 0.3
  return Math.max(1, Math.round(raw * variance))
}

GameData.calcBattleExp = function(opponentLevel) {
  return 30 + opponentLevel * 3
}

GameData.calcBattleGold = function(opponentLevel) {
  return 10 + opponentLevel * 2
}

// -----------------------------------------------------------
// 初始宠物工厂
// -----------------------------------------------------------

GameData.createPet = function(speciesId, name) {
  var species = GameData.SPECIES[speciesId]
  var stage = 0
  var stageInfo = GameData.getStageInfo(stage)
  var mult = stageInfo.statMultiplier

  return {
    id: 'pet_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
    name: name,
    species: speciesId,
    currentStage: stage,
    level: 1,
    exp: 0,
    baseStats: {
      hp: Math.round(species.baseStats.hp * mult),
      atk: Math.round(species.baseStats.atk * mult),
      def: Math.round(species.baseStats.def * mult),
      spd: Math.round(species.baseStats.spd * mult)
    },
    currentHp: Math.round(species.baseStats.hp * mult),
    hunger: 80,
    happiness: 80,
    energy: 80,
    learnedSkills: [0],
    equippedSkills: [0],
    wins: 0,
    losses: 0,
    createdAt: new Date().toISOString()
  }
}
