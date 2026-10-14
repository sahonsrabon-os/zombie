function registryModelCount(provider) { return Array.isArray(provider.models) ? provider.models.length : 0; }

export function parseProviderBootConfig(raw = '') {
  if (!raw?.trim()) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('PROVIDER_CONFIG_JSON_must_be_array');
  return value;
}

export async function bootstrapProviders({ registry, config, logger, bootConfig = undefined } = {}) {
  const boot = Array.isArray(bootConfig) ? bootConfig : parseProviderBootConfig(process.env.PROVIDER_CONFIG_JSON ?? '');
  const registered = [];
  for (const item of boot) {
    const provider = await registry.register({...item, source: item.source ?? 'env-bootstrap'});
    registered.push({ id: provider.id, source: 'env', enabled: provider.enabled !== false, driver: provider.driver, baseUrl: provider.baseUrl, defaultModel: provider.defaultModel || null });
  }
  let modelRefresh = [];
  if (config.providerModelsRefreshOnStart) {
    for (const item of await registry.list()) {
      try {
        if (item.enabled === false) { modelRefresh.push({providerId:item.id,ok:false,skipped:'disabled'}); continue; }
        const refreshed = await registry.refreshModels(item.id);
        modelRefresh.push({providerId:item.id,ok:true,modelCount:refreshed.models?.length ?? 0,defaultModel:refreshed.defaultModel || null});
        await logger.info('provider.models.refreshed_on_start',{providerId:item.id,modelCount:refreshed.models?.length ?? 0,defaultModel:refreshed.defaultModel || null});
      } catch (error) {
        modelRefresh.push({providerId:item.id,ok:false,error:String(error?.message ?? error)});
        await logger.warn('provider.models.refresh_failed_on_start',{providerId:item.id,error:String(error?.message ?? error)});
      }
    }
  }
  let sync = null;
  if (config.providerCatalogSyncUrl && config.providerCatalogSyncOnStart) {
    try {
      sync = await registry.syncAll({ syncUrl: config.providerCatalogSyncUrl, apiKey: config.providerCatalogApiKey, timeoutMs: config.providerSyncTimeoutMs });
      await logger.info('provider.catalog_synced', { providerCount: sync.providerCount, modelCount: sync.modelCount });
    } catch (error) {
      await logger.warn('provider.catalog_sync_failed', { error: String(error?.message ?? error) });
      sync = { ok: false, error: String(error?.message ?? error) };
    }
  }
  await logger.info('provider.bootstrap.completed',{registeredCount:registered.length,registered:registered.map(p=>({id:p.id,enabled:p.enabled,driver:p.driver,modelCount:registryModelCount(p)})),modelRefresh,sync:sync?{ok:sync.ok!==false,providerCount:sync.providerCount??null,modelCount:sync.modelCount??null}:null});
  return { registered, sync, modelRefresh };
}
