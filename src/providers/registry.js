import { createProviderAdapter } from './adapters/factory.js';
import { extractModelIds } from './model-catalog.js';
import { fetchProviderCatalog, mergeProviderCatalog, providerModelKey } from './sync.js';

function defaultProvider(config) {
  return {
    id: 'ollama-local',
    name: 'Ollama Local Compatible Endpoint',
    baseUrl: config?.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1',
    defaultModel: '',
    models: [],
    enabled: true,
    createdAt: new Date().toISOString(),
    source: 'configured-ollama-endpoint',
    driver: 'ollama',
    protocol: 'openai-compatible',
    capabilities: ['chat-completions','streaming','function-calling','model-catalog'],
    priority: 10
  };
}

export class ProviderRegistry {
  constructor(store, config) { this.store = store; this.config = config; this.cache = new Map(); }

  async list() {
    let providers = await this.store.read('providers', []);
    if (providers.length) {
      // One-time compatibility migration: older releases stored priorities such as 100/110/200.
      // Convert those legacy values to free slots in 1..10 and persist the normalized column.
      if (providers.some(p => !Number.isFinite(Number(p.priority)) || Number(p.priority) > 10 || Number(p.priority) < 1)) {
        const occupied = new Set(providers.map(p => Number(p.priority)).filter(value => Number.isInteger(value) && value >= 1 && value <= 10));
        const legacyValues = [...new Set(providers.map(p => Number(p.priority)).filter(value => Number.isFinite(value) && (value > 10 || value < 1)))].sort((a,b)=>a-b);
        const freeSlots = Array.from({length:10},(_,index)=>index+1).filter(value=>!occupied.has(value));
        const legacyMap = new Map(legacyValues.map((value,index)=>[value,freeSlots[index] ?? 10]));
        providers = providers.map(p => {
          const raw = Number(p.priority);
          const priority = Number.isInteger(raw) && raw >= 1 && raw <= 10 ? raw : (legacyMap.get(raw) ?? 10);
          return {...p, priority};
        });
        await this.store.write('providers', providers);
      }
      return providers;
    }
    const provider = defaultProvider(this.config);
    await this.store.write('providers', [provider]);
    return [provider];
  }

  async register(input) {
    if (!input?.baseUrl) throw new Error('provider_baseUrl_required');
    const item = {
      id: input.id ?? `provider_${Date.now()}`,
      name: String(input.name ?? input.id ?? 'provider').slice(0, 120),
      baseUrl: String(input.baseUrl).replace(/\/(models|chat\/completions)\/?$/, ''),
      defaultModel: String(input.defaultModel ?? ''),
      models: Array.isArray(input.models) ? [...new Set(input.models.map(String))] : [],
      enabled: input.enabled !== false,
      createdAt: new Date().toISOString(),
      source: input.source ?? 'admin-configured',
      driver: input.driver ?? 'openai-compatible',
      protocol: input.protocol ?? 'openai-compatible',
      capabilities: Array.isArray(input.capabilities) ? [...new Set(input.capabilities.map(String))] : [],
      priority: Number.isFinite(Number(input.priority)) ? Math.min(10, Math.max(1, Math.trunc(Number(input.priority)))) : 10,
      modelAliases: input.modelAliases && typeof input.modelAliases === 'object' && !Array.isArray(input.modelAliases) ? Object.fromEntries(Object.entries(input.modelAliases).map(([k,v]) => [String(k).toLowerCase(), String(v)])) : {},
      modelMetadata: input.modelMetadata && typeof input.modelMetadata === 'object' && !Array.isArray(input.modelMetadata) ? input.modelMetadata : {},
      syncUrl: input.syncUrl ? String(input.syncUrl) : undefined,
      modelsUpdatedAt: input.modelsUpdatedAt ?? null
    };
    const list = await this.list();
    const next = list.filter((p) => p.id !== item.id); next.push(item);
    await this.store.write('providers', next);
    this.cache.delete(item.id);
    return item;
  }


  async update(id, patch = {}) {
    const list = await this.list();
    const current = list.find(item => item.id === String(id));
    if (!current) throw new Error('provider_not_found');
    const allowed = ['name','baseUrl','defaultModel','models','enabled','driver','protocol','capabilities','priority','modelAliases','modelMetadata','syncUrl'];
    const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.includes(key)));
    const merged = {...current, ...clean, id:current.id, createdAt:current.createdAt, updatedAt:new Date().toISOString()};
    if (!String(merged.baseUrl ?? '').trim()) throw new Error('provider_baseUrl_required');
    merged.baseUrl = String(merged.baseUrl).replace(/\/(models|chat\/completions)\/?$/, '');
    if (Array.isArray(merged.models)) merged.models = [...new Set(merged.models.map(String))];
    if (Array.isArray(merged.capabilities)) merged.capabilities = [...new Set(merged.capabilities.map(String))];
    merged.priority = Number.isFinite(Number(merged.priority)) ? Math.min(10, Math.max(1, Math.trunc(Number(merged.priority)))) : 10;
    await this.store.write('providers', list.map(item => item.id === current.id ? merged : item));
    this.cache.delete(current.id);
    return merged;
  }

  async remove(id) {
    const list = await this.list();
    const next = list.filter(item => item.id !== String(id));
    if (next.length === list.length) return false;
    await this.store.write('providers', next);
    this.cache.delete(String(id));
    return true;
  }

  async updateModel(id, modelId, patch = {}) {
    const list = await this.list();
    const current = list.find(item => item.id === String(id));
    if (!current) throw new Error('provider_not_found');
    const name = String(modelId ?? '').trim();
    if (!name) throw new Error('provider_model_required');
    const models = Array.isArray(current.models) ? [...current.models] : [];
    const metadata = {...(current.modelMetadata && typeof current.modelMetadata === 'object' ? current.modelMetadata : {})};
    if (patch.delete === true) {
      const index = models.indexOf(name);
      if (index < 0) throw new Error('provider_model_not_found');
      models.splice(index, 1);
      delete metadata[name];
    } else {
      if (patch.create === true && !models.includes(name)) models.push(name);
      if (!models.includes(name)) throw new Error('provider_model_not_found');
      const old = metadata[name] && typeof metadata[name] === 'object' ? metadata[name] : {};
      metadata[name] = {...old, enabled:patch.enabled === undefined ? old.enabled !== false : patch.enabled !== false, priority:Number.isFinite(Number(patch.priority ?? old.priority)) ? Math.min(1000,Math.max(1,Math.trunc(Number(patch.priority ?? old.priority ?? 100)))) : 100, alias:patch.alias === undefined ? old.alias ?? null : (String(patch.alias).trim() || null), updatedAt:new Date().toISOString()};
    }
    let defaultModel = current.defaultModel;
    if (patch.delete === true && defaultModel === name) defaultModel = models.find(model => metadata[model]?.enabled !== false) || '';
    if (patch.default === true) defaultModel = name;
    if (defaultModel && metadata[defaultModel]?.enabled === false) defaultModel = models.find(model => metadata[model]?.enabled !== false) || '';
    const updated = {...current, models, modelMetadata:metadata, defaultModel, updatedAt:new Date().toISOString()};
    await this.store.write('providers', list.map(item => item.id === current.id ? updated : item));
    this.cache.delete(current.id);
    return updated;
  }

  async resolve(id) {
    const list = await this.list(); const item = list.find((p) => p.id === id);
    if (!item || item.enabled === false) throw new Error('provider_not_found_or_disabled');
    if (!this.cache.has(id)) this.cache.set(id, createProviderAdapter(item, this.config));
    return this.cache.get(id);
  }

  async refreshModels(id) {
    const list = await this.list();
    const item = list.find((p) => p.id === id);
    if (!item || item.enabled === false) throw new Error('provider_not_found_or_disabled');
    const provider = await this.resolve(id);
    const raw = await provider.listModels();
    const models = extractModelIds(raw);
    const defaultModel = item.defaultModel && models.includes(item.defaultModel) && item.modelMetadata?.[item.defaultModel]?.enabled !== false ? item.defaultModel : (models.find(model=>item.modelMetadata?.[model]?.enabled!==false) || '');
    const updated = {...item, models, defaultModel, modelsUpdatedAt:new Date().toISOString()};
    await this.store.write('providers', list.map(p => p.id === id ? updated : p));
    this.cache.delete(id);
    return updated;
  }


  async syncAll({ syncUrl = this.config.providerCatalogSyncUrl, apiKey = this.config.providerCatalogApiKey, timeoutMs = this.config.providerSyncTimeoutMs } = {}) {
    if (!syncUrl) throw new Error('provider_catalog_sync_url_required');
    const current = await this.list();
    const catalog = await fetchProviderCatalog(syncUrl, { apiKey, networkPolicy: this.config.providerNetworkPolicy, timeoutMs });
    const merged = mergeProviderCatalog(current, catalog);
    await this.store.write('providers', merged);
    this.cache.clear();
    return { source: syncUrl, providerCount: merged.length, modelCount: merged.reduce((n,p) => n + (Array.isArray(p.models) ? p.models.length : 0), 0), providers: merged };
  }

  async syncProvider(id, { syncUrl, timeoutMs = this.config.providerSyncTimeoutMs } = {}) {
    const current = await this.list();
    const item = current.find(p => p.id === id);
    if (!item) throw new Error('provider_not_found');
    const target = syncUrl ?? item.syncUrl;
    if (target) {
      const catalog = await fetchProviderCatalog(target, { apiKey: this.config.providerApiKeys?.[id] ?? '', networkPolicy: this.config.providerNetworkPolicy, timeoutMs });
      const merged = mergeProviderCatalog(current, catalog);
      const updated = merged.find(p => p.id === id);
      await this.store.write('providers', merged);
      this.cache.delete(id);
      return { provider: updated, modelKeys: (updated.models ?? []).map(model => providerModelKey(id, model)), source: target };
    }
    const updated = await this.refreshModels(id);
    return { provider: updated, modelKeys: (updated.models ?? []).map(model => providerModelKey(id, model)), source: 'provider-models-endpoint' };
  }

  async routeCandidates(input = {}) {
    const list = await this.list();
    const requestedProvider = String(input.provider ?? '').trim();
    const requestedModel = String(input.model ?? '').trim();
    return list
      .filter(p => p.enabled !== false && (!requestedProvider || p.id === requestedProvider))
      .filter(p => !requestedModel || p.modelMetadata?.[requestedModel]?.enabled !== false)
      .filter(p => !requestedModel || !Array.isArray(p.models) || !p.models.length || p.models.includes(requestedModel) || p.defaultModel === requestedModel)
      .sort((a,b) => (Number(a.priority ?? 999) - Number(b.priority ?? 999)) || String(a.id).localeCompare(String(b.id)));
  }

  async resolveModel(id, requestedModel = '') {
    const list = await this.list();
    const item = list.find((p) => p.id === id);
    if (!item || item.enabled === false) throw new Error('provider_not_found_or_disabled');
    const requested = String(requestedModel ?? '').trim();
    if (requested) { if (item.modelMetadata?.[requested]?.enabled === false) throw new Error('provider_model_disabled'); return requested; }
    if (item.defaultModel && item.modelMetadata?.[item.defaultModel]?.enabled !== false) return item.defaultModel;
    if (Array.isArray(item.models) && item.models.length) { const enabled = item.models.filter(model => item.modelMetadata?.[model]?.enabled !== false).sort((a,b)=>(item.modelMetadata?.[a]?.priority ?? 100)-(item.modelMetadata?.[b]?.priority ?? 100)); if (enabled.length) return enabled[0]; }
    const refreshed = await this.refreshModels(id);
    if (!refreshed.defaultModel) throw new Error('provider_model_required');
    return refreshed.defaultModel;
  }
}
