import { ComponentRegistry } from '../registry/catalog.js';
import { DEFAULT_AGENTS } from './index.js';
import { getAgentToolBoundary } from './ecommerce-tool-boundaries.js';

function mergeAgentMetadata(saved, defaults) {
  const byId = new Map(defaults.map(item => [item.id, item]));
  for (const item of saved) byId.set(item.id, item);
  let changed = false;
  for (const item of defaults) {
    const current = byId.get(item.id);
    const boundary = getAgentToolBoundary(item.id);
    if (!boundary || !current) continue;
    const metadata = current.metadata && typeof current.metadata === 'object' ? current.metadata : {};
    if (metadata.toolBoundaryProfile === undefined) {
      byId.set(item.id, {...current, metadata: {...metadata, toolBoundaryProfile: boundary}});
      changed = true;
    }
  }
  return {items:[...byId.values()], changed};
}

export class AgentRegistry extends ComponentRegistry {
  constructor(store) {
    super(store, { collection: 'agents', type: 'agent', defaults: DEFAULT_AGENTS });
  }

  async update(id, patch = {}) {
    const list = await this.list();
    const current = list.find(item => item.id === String(id));
    if (!current) throw new Error('agent_not_found');
    const next = {...current, ...patch, id:current.id, updatedAt:new Date().toISOString()};
    await this.store.write(this.collection, list.map(item => item.id === current.id ? next : item));
    return next;
  }

  async remove(id) {
    const list = await this.list();
    const next = list.filter(item => item.id !== String(id));
    if (next.length === list.length) return false;
    await this.store.write(this.collection, next);
    return true;
  }

  async list() {
    const saved = await this.store.read(this.collection, []);
    const defaults = this.defaults;
    const merged = saved.length ? saved : defaults;
    if (!saved.length && defaults.length) await this.store.write(this.collection, defaults);
    const upgraded = mergeAgentMetadata(merged, defaults);
    if (upgraded.changed) await this.store.write(this.collection, upgraded.items);
    return upgraded.items;
  }
}
