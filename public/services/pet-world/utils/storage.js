// ============================================================
// 宠物世界 — 存档/读档引擎
// ============================================================

;(function() {

var SAVE_KEY = 'pet_world_save'
var SAVE_DEBOUNCE_MS = 500
var saveTimer = null

window.PetWorldStorage = {

  async saveFull(pet, inventory, settings) {
    if (!window.__amiba__) return
    var data = { pet: pet, inventory: inventory, settings: settings || {} }
    await __amiba__.storage.set(SAVE_KEY, data)
  },

  async loadFull() {
    if (!window.__amiba__) return null
    var data = await __amiba__.storage.get(SAVE_KEY)
    if (!data) return null
    return data
  },

  async deleteAll() {
    if (!window.__amiba__) return
    await __amiba__.storage.remove(SAVE_KEY)
  },

  debouncedSave(pet, inventory, settings) {
    if (saveTimer) clearTimeout(saveTimer)
    var p = pet, i = inventory, s = settings
    saveTimer = setTimeout(function() {
      PetWorldStorage.saveFull(p, i, s)
    }, SAVE_DEBOUNCE_MS)
  }
}

})()
