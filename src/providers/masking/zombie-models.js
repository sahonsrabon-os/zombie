import { config } from '../../config/env.js';

/** Public aliases are stable client names, not claims about upstream model quality. */
export const DEFAULT_ZOMBIECODER_MODELS = Object.freeze([
  Object.freeze({ id: 'zombie-mini', name: 'ZombieMini', description: 'Default lightweight routing profile' }),
  Object.freeze({ id: 'zombie-lite', name: 'ZombieLite', description: 'Balanced routing profile' }),
  Object.freeze({ id: 'zombie-classic', name: 'ZombieClassic', description: 'General-purpose routing profile' })
]);

export function parseZombieCoderModels(raw, defaults=DEFAULT_ZOMBIECODER_MODELS) {
  const models=new Map(defaults.map(model=>[model.id,{...model}]));
  if(String(raw??'').trim()){
    let configured;
    try{configured=JSON.parse(raw);}catch{throw new Error('ZOMBIECODER_MODELS_JSON_invalid_json');}
    if(!Array.isArray(configured)||configured.length>50)throw new Error('ZOMBIECODER_MODELS_JSON_expected_array_max_50');
    for(const item of configured){
      const id=String(item?.id??'').trim().toLowerCase();
      if(!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id))throw new Error('ZOMBIECODER_MODELS_JSON_invalid_id');
      const providerId=String(item.providerId??'').trim();
      const model=String(item.model??'').trim();
      if(Boolean(providerId)!==Boolean(model))throw new Error('ZOMBIECODER_MODELS_JSON_provider_and_model_required_together');
      const value={id,name:String(item.name??id).trim().slice(0,120)||id,description:String(item.description??'').trim().slice(0,500)};
      if(providerId){value.providerId=providerId.slice(0,128);value.model=model.slice(0,256);}
      models.set(id,value);
    }
  }
  if(!models.size)throw new Error('ZOMBIECODER_MODELS_JSON_empty');
  return Object.freeze([...models.values()].map(model=>Object.freeze(model)));
}

export const ZOMBIECODER_MODELS=parseZombieCoderModels(config.zombieCoderModelsJson);

export function resolveZombieModelAlias(value, modelList=ZOMBIECODER_MODELS) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/^zombiecoder\//, '');
  return modelList.find(model=>model.id===normalized)??null;
}
