import path from 'node:path';

export class WorkspaceRegistry {
  constructor({store,contextStore,staticRoots=[]}={}){if(!store||!contextStore)throw new Error('workspace_registry_configuration_required');this.store=store;this.contextStore=contextStore;this.staticRoots=staticRoots.map(root=>contextStore.root(root));}
  async list(){return this.store.read('workspace-roots',[]);}
  async initialize(){
    const entries=await this.list();const usable=[];
    for(const entry of entries){try{const projectRoot=await this.contextStore.addAllowedRoot(entry.projectRoot);usable.push({...entry,projectRoot});}catch{}}
    if(usable.length!==entries.length)await this.store.write('workspace-roots',usable);
    return usable;
  }
  async set(applicationId,projectRoot){
    const owner=String(applicationId||'*');
    const actual=await this.contextStore.addAllowedRoot(projectRoot);
    const entries=await this.list();
    const item={id:owner==='*'?'workspace-runtime-default':`workspace-app-${owner}`,applicationId:owner,projectRoot:actual,updatedAt:new Date().toISOString()};
    await this.store.write('workspace-roots',[...entries.filter(entry=>entry.applicationId!==owner),item]);
    return item;
  }
  async resolve(applicationId,requestedRoot=null,fallback=null){
    const entries=await this.list();
    if(requestedRoot){
      const root=this.contextStore.root(requestedRoot);
      const isWithin=(base,value)=>value===base||value.startsWith(`${base}${path.sep}`);
      const staticallyApproved=this.staticRoots.some(base=>isWithin(base,root));
      const assigned=entries.some(entry=>(entry.applicationId===String(applicationId)||entry.applicationId==='*')&&isWithin(entry.projectRoot,root));
      if(!staticallyApproved&&!assigned)throw new Error('project_root_not_allowed');
      return root;
    }
    const assigned=entries.find(entry=>entry.applicationId===String(applicationId))??entries.find(entry=>entry.applicationId==='*');
    return this.contextStore.root(assigned?.projectRoot??fallback);
  }
}