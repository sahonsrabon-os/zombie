export function extractModelIds(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('provider_models_invalid');
  const data = Array.isArray(raw.data) ? raw.data : Array.isArray(raw.models) ? raw.models : [];
  const ids = data.map(item => typeof item === 'string' ? item : item?.id ?? item?.name).filter(Boolean).map(String);
  if (!ids.length) throw new Error('provider_models_empty');
  return [...new Set(ids)];
}
