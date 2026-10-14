import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, chmod } from 'node:fs/promises';
import { normalizeUdsSocketPath } from './socket-path.js';

export async function startTransportServers({handler,config,logger,runtimeIdentity}){
  const servers={http:null,https:null,uds:null};
  servers.http=createServer(handler);
  await new Promise((resolve,reject)=>{servers.http.once('error',reject);servers.http.listen(config.port,config.host,resolve)});
  await logger?.info?.('runtime.transport.started',{transport:'http',host:config.host,port:config.port,runtimeId:runtimeIdentity?.runtimeId,instanceId:runtimeIdentity?.instanceId});
  if(config.https.enabled){try{const server=createHttpsServer({key:await readFile(config.https.key),cert:await readFile(config.https.cert)},handler);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.https.port,config.https.host,resolve)});servers.https=server;await logger?.info?.('runtime.transport.started',{transport:'https',host:config.https.host,port:config.https.port,runtimeId:runtimeIdentity?.runtimeId})}catch(error){await logger?.error?.('runtime.transport.failed',{transport:'https',error:error.message});if(config.https.required)throw error}}
  if(config.uds.enabled){try{
    const socketPath=normalizeUdsSocketPath(config.uds.path, runtimeIdentity?.runtimeId || 'runtime');
    // Never unlink a socket that belongs to another runtime. A stale socket must fail closed.
    if(process.platform !== 'win32'){
      try{const {stat}=await import('node:fs/promises');const info=await stat(socketPath);if(info.isSocket())throw new Error('uds_path_already_exists');}catch(error){if(error.code!=='ENOENT')throw error}
    }
    const server=createServer(handler);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve)});if(process.platform !== 'win32'){try{await chmod(socketPath,0o600)}catch{}}servers.uds=server;await logger?.info?.('runtime.transport.started',{transport:'uds',path:socketPath,runtimeId:runtimeIdentity?.runtimeId})
  }catch(error){await logger?.error?.('runtime.transport.failed',{transport:'uds',path:config.uds.path,error:error.message});if(config.uds.required)throw error}}
  return servers;
}
export async function stopTransportServers(servers){await Promise.all(Object.values(servers).filter(Boolean).map(server=>new Promise(resolve=>{if(!server.listening)return resolve();server.close(()=>resolve())})))}
