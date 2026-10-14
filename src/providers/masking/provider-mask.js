export const ZOMBIE_PROVIDER_NAME = 'ZombieCoder';

export function maskProviderName() { return ZOMBIE_PROVIDER_NAME; }

export function maskModelName({agentId='code-guru', configuredName='' }={}) {
  const safeAgent = String(agentId || 'code-guru').replace(/[^a-zA-Z0-9._-]/g, '-');
  return String(configuredName || '').trim() || `zombiecoder/${safeAgent}`;
}

export function createAgentProviderIdentity({agentId='code-guru', configuredModel='', capabilities=[]}={}) {
  return {
    provider: ZOMBIE_PROVIDER_NAME,
    model: maskModelName({agentId, configuredName:configuredModel}),
    capabilities: [...new Set((Array.isArray(capabilities) ? capabilities : []).map(String))]
  };
}

export function maskCanonicalResponse(response, {agentId='code-guru', configuredModel='', capabilities=[]}={}) {
  if (!response || typeof response !== 'object') throw new Error('canonical_response_invalid');
  const identity = createAgentProviderIdentity({agentId, configuredModel, capabilities});
  const copy = structuredClone(response);
  delete copy.provider;
  // The agent-facing envelope gets the masked identity; provider infrastructure never leaks through.
  copy.model = identity.model;
  return { ...copy, provider: identity.provider };
}
