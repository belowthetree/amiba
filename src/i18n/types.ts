// ============================================================
// 变形虫 (Amiba) — i18n 语言包类型定义
// ============================================================

export interface LocalesSchema {
  app: {
    title: string
    home: string
    settings: string
    memory: string
    service: string
    services: string
    serviceBrowse: string
    newSession: string
    delete: string
  }
  home: {
    heading: string
    subtitle: string
    sysFeatures: string
    chat: { name: string; desc: string }
    services: { name: string; desc: string }
    settings: { name: string; desc: string }
    memory: { name: string; desc: string }
    recentUse: string
    noUserServices: string
    ctaGenerate: string
  }
  chat: {
    newSession: string
    delete: string
    messageCount: string
    noSessions: string
    emptyHint: string
    emptySubHint: string
    thinking: string
    thinkingProgress: string
    placeholder: string
    send: string
    sending: string
    stop: string
    defaultSessionTitle: string
    today: string
    yesterday: string
    stats: {
      title: string
      saveMemoryHint: string
      roundsLeft: string
      nearbyDevices: string
      lanLabel: string
      bleLabel: string
      total: string
      units: string
      noPeers: string
      close: string
    }
    errorNoApiKey: string
    errorPrefix: string
  }
  settings: {
    title: string
    tabs: { general: string; skills: string; data: string }
    general: {
      apiConfig: string
      apiKey: string
      baseUrl: string
      model: string
      reasoningEffort: string
      reasoningDefault: string
      reasoningLow: string
      reasoningMedium: string
      reasoningHigh: string
      reasoningXhigh: string
      reasoningMax: string
      aiProvider: string
      providerNamePlaceholder: string
      providerIdPlaceholder: string
      providerBaseUrlPlaceholder: string
      providerApiKeyPlaceholder: string
      providerModelsPlaceholder: string
      save: string
      cancel: string
      noProviders: string
      addProvider: string
      modelCount: string
      appearance: string
      themeMode: string
      themeSystem: string
      themeLight: string
      themeDark: string
      language: string
      languageZh: string
      languageEn: string
      network: string
      lanDiscovery: string
      lanDesc: string
      lanVisible: string
      lanHidden: string
      about: string
      aboutTitle: string
      aboutSubtitle: string
      aboutStack: string
      checkUpdate: string
      checking: string
      upToDate: string
      newVersion: string
      directDownload: string
      downloading: string
      cancelDownload: string
      installing: string
      downloaded: string
      installNow: string
      reDownload: string
      downloadCancelled: string
      checkFailed: string
      noPlatformAsset: string
      downloadFailed: string
      installFailed: string
    }
    skills: {
      skillManagement: string
      skillNamePlaceholder: string
      skillDescPlaceholder: string
      skillKwsPlaceholder: string
      skillTplPlaceholder: string
      save: string
      cancel: string
      noSkills: string
      importFolder: string
      customAgent: string
      agentNamePlaceholder: string
      agentIdPlaceholder: string
      agentProviderDefault: string
      agentModelDefault: string
      agentReasoningDefault: string
      agentSystemPromptPlaceholder: string
      activate: string
      noAgents: string
      addAgent: string
      newProviderName: string
      newAgentName: string
    }
    data: {
      serviceImport: string
      scanStorage: string
      selectFile: string
      install: string
      storage: string
      exportConfig: string
      deleteSessions: string
      deleting: string
      deleteSessionsHint: string
      clearAllData: string
    }
    confirm: {
      clearAllData: string
      deleteSessions: string
      importFailed: string
      nameDescRequired: string
      providerFieldsRequired: string
      agentFieldsRequired: string
      deleteProvider: string
      deleteAgent: string
      deleteSkill: string
      installFailed: string
      saved: string
    }
    dialect: {
      installedNServices: string
      noServicesFound: string
      deletedAllSessions: string
    }
  }
  memory: {
    title: string
    subtitle: string
    memoryPlaceholder: string
    userPlaceholder: string
    save: string
    revert: string
    clear: string
    entriesPreview: string
    saved: string
    confirmClear: string
  }
  services: {
    title: string
    importFolder: string
    createNew: string
    userServices: string
    noUserServices: string
    ctaGenerate: string
    noDescription: string
    systemServices: string
    builtin: string
    demoTitle: string
    demoDesc: string
    install: string
    confirmDelete: string
    dialogTitle: string
    noManifestJson: string
    invalidManifest: string
    missingIndexHtml: string
    imported: string
    importFailed: string
  }
  host: {
    loading: string
    back: string
    close: string
  }
}
