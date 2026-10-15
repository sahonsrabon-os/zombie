import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config/env.js';
import { createStore } from './storage/storage.js';
import { createApiKey, hashSecret, authenticateApiKey } from './auth/application-auth.js';
import { isAdminAuthorized } from './auth/admin-auth.js';
import { id } from './core/ids.js';
import { McpRegistry } from './mcp/registry.js';
import { ProviderRegistry } from './providers/registry.js';
import { ContextResolver } from './context/resolver.js';
import { McpPermissions } from './mcp/permissions.js';
import { McpAudit } from './mcp/audit.js';
import { callMcpTool } from './mcp/client.js';
import { validateToolArguments } from './mcp/schema.js';
import { AppLimits } from './mcp/limits.js';
import { McpConnections } from './mcp/connections.js';
import { McpReconciliation } from './mcp/reconciliation.js';
import { ProjectContextStore } from './context/project-context.js';
import { EntityDoor } from './entities/entity-door.js';
import { CanonicalResponseNormalizer } from './providers/normalizer/canonical-response.js';
import { PersonaRegistry } from './agents/persona-registry.js';
import { AdminService } from './admin/admin-service.js';
import { CORE_CONSTITUTION } from './policy/constitution.js';
import { send, body, bearer } from './http/json.js';
import { ExecutionOrchestrator } from './execution/orchestrator.js';
import { ToolRegistry } from './tools/registry.js';
import { SkillRegistry } from './skills/registry.js';
import { AgentRegistry } from './agents/registry.js';
import { TransportRegistry } from './transport/registry.js';
import { ExtensionResolver } from './registry/resolver.js';
import { ProviderExecutionAdapter } from './execution/provider-adapter.js';
import { ToolExecutionAdapter } from './execution/tool-adapter.js';
import { McpExecutionAdapter } from './execution/mcp-adapter.js';
import { ExecutionAdapter } from './execution/execution-adapter.js';
import { EvidenceGate } from './evidence/gate.js';
import { SessionService } from './session/service.js';
import { SessionClient } from './session/client.js';
import { AgentRunner } from './agents/runner.js';
import { buildSystemMessage } from './agents/system-prompt.js';
import { SessionStateStore } from './session/state.js';
import { ToolLoopExecutor } from './execution/tool-loop.js';
import { SystemLogger } from './core/logger.js';
import { envLoadResult } from './config/env.js';
import { legacyFeatureReport } from './compatibility/legacy/feature-registry.js';
import { reconciliationReport } from './compatibility/legacy/reconciliation.js';
import { buildTaskPolicy } from './execution/task-policy.js';
import { routeMapReport } from './compatibility/route-map.js';
import { startTransportServers, stopTransportServers } from './transport/server.js';
import { normalizeUdsSocketPath } from './transport/socket-path.js';
import { SSOTService } from './context/ssot.js';
import { SyllabusService } from './context/syllabus.js';
import { ProjectMemoryService } from './context/memory.js';
import { AutoSetupService } from './context/auto-setup.js';
import { SmartRouter } from './providers/router/smart-router.js';
import { maskCanonicalResponse } from './providers/masking/provider-mask.js';
import { completionToStreamChunk } from './providers/normalizer/stream-chunk.js';
import { createRuntimeIdentity, acquireRuntimeLock } from './runtime/identity.js';
import { createExecutionContext } from './execution/context.js';
import { ToolPolicy } from './tools/policy.js';
import { sanitizeSessionMetadata } from './session/metadata.js';
import { ExecutionLifecycle } from './execution/lifecycle.js';
import { bootstrapProviders } from './startup/provider-bootstrap.js';
import { startLocalMcpFallback } from './startup/local-mcp-fallback.js';
import { buildBoundedContext } from './context/context-budget.js';
import { compileContext } from './context/compiler.js';
import { CapabilityConfigResolver } from './registry/config-resolver.js';
import { ExternalMcpRegistry } from './registry/external-mcp.js';
import { ECOMMERCE_AGENT_TOOL_BOUNDARIES, getAgentToolBoundary } from './agents/ecommerce-tool-boundaries.js';
import { configureOutboundCircuitLogger, configureOutboundCircuitBreaker, sharedOutboundCircuitBreaker } from './network/circuit-breaker.js';
import { RUNTIME_VERSION, RUNTIME_PHASE } from './runtime/version.js';
import { auditAgentRuntime } from './agents/runtime-audit.js';
import { legacyModelList, legacyProviderModelList, legacyNormalizeList, legacyDomain, legacyPusherConfig } from './compatibility/legacy/frontend-contract.js';
import { toolParityReport } from './compatibility/legacy/tool-parity.js';

function isLoopbackAddress(address='') {
  const value=String(address).toLowerCase().replace(/^::ffff:/,'');
  return value==='127.0.0.1' || value==='::1' || value==='localhost';
}
function isLocalDevelopmentRequest(req) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) return false;
  let hostname;
  try { hostname = new URL(`http://${req.headers.host ?? ''}`).hostname.toLowerCase(); } catch { return false; }
  if (!['127.0.0.1','localhost','[::1]','::1'].includes(hostname)) return false;
  const proxyHeaders=['forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto','x-real-ip','cf-connecting-ip','cf-ray','true-client-ip','cdn-loop'];
  return !proxyHeaders.some(name => req.headers[name] !== undefined);
}
const localAuthBypassActive = config.localAuthBypass && !config.adminToken && ['127.0.0.1','localhost','::1'].includes(config.host);
if (config.localAuthBypass && !localAuthBypassActive) throw new Error('local_auth_bypass_requires_empty_admin_token_and_loopback_bind');

const logger = new SystemLogger({dir:config.logDir,file:config.logFile,level:config.logLevel,stdout:config.logToStdout,maxBytes:config.logMaxBytes,maxFiles:config.logMaxFiles,allowPayloads:config.logPayloads});
configureOutboundCircuitLogger(logger);
configureOutboundCircuitBreaker(config.circuitBreaker);
await mkdir(config.dataDir, {recursive:true});
const runtimeIdentity = createRuntimeIdentity(config);
const releaseRuntimeLock = await acquireRuntimeLock(config.dataDir, runtimeIdentity);
process.env.RUNTIME_ID = runtimeIdentity.runtimeId;
process.env.INSTANCE_ID = runtimeIdentity.instanceId;
if (config.uds.enabled && (!process.env.UDS_PATH || process.env.UDS_PATH === './data/runtime.sock')) config.uds.path = normalizeUdsSocketPath(path.resolve(config.dataDir, `runtime-${runtimeIdentity.runtimeId.replace(/[^a-zA-Z0-9._-]/g,'_')}.sock`), runtimeIdentity.runtimeId);
await logger.info('runtime.env_loaded', {path:envLoadResult.path,loaded:envLoadResult.loaded,keys:envLoadResult.keys,totalKeys:envLoadResult.totalKeys,skipped:envLoadResult.skipped});
const store = await createStore(config);
const mcp = new McpRegistry(store, {networkPolicy:config.mcpNetworkPolicy});
const externalMcp = new ExternalMcpRegistry({store, mcpRegistry:mcp, root:path.resolve('external-mcp'), logger});
const localMcpFallback = await startLocalMcpFallback({root:process.cwd(),env:process.env,logger,enabled:config.localMcpFallbackEnabled,existingEndpoints:await mcp.list()});
const providers = new ProviderRegistry(store, config);
const providerBootstrap = await bootstrapProviders({ registry: providers, config, logger });
const externalMcpBootstrap = await externalMcp.sync();
const contexts = new ContextResolver(store);
const projectAllowedRoots = config.projectRoots.length ? config.projectRoots : [process.cwd(), config.dataDir];
const projectContext = new ProjectContextStore({defaultRoot:config.dataDir, allowedRoots:projectAllowedRoots});
const ssot = new SSOTService({contextStore:projectContext});
const syllabus = new SyllabusService({contextStore:projectContext});
const memory = new ProjectMemoryService({contextStore:projectContext, maxEntries:config.memoryMaxEntries ?? 500});
const autoSetup = new AutoSetupService({contextStore:projectContext, ssot, syllabus, memory});
await autoSetup.ensure(config.dataDir, {refreshSSOT:false});
const entityDoor = new EntityDoor();
const normalizer = new CanonicalResponseNormalizer();
const personas = new PersonaRegistry(store, logger);
await personas.ensureDefaults();
const admin = new AdminService(store);
const toolsRegistry = new ToolRegistry(store);
const skillsRegistry = new SkillRegistry(store);
const agentsRegistry = new AgentRegistry(store);
const transportsRegistry = new TransportRegistry(store);
const extensionResolver = new ExtensionResolver({agents: agentsRegistry, skills: skillsRegistry, tools: toolsRegistry, transports: transportsRegistry});
const permissions = new McpPermissions(store);
for (const fallback of localMcpFallback.results.filter(item=>item.status==='ready')) {
  try {
    const endpoint=(await mcp.list()).find(item=>item.id===fallback.id);
    if (!endpoint) continue;
    if (endpoint.url!==fallback.url) {
      await logger.warn('local_mcp_fallback.identity_conflict',{endpointId:fallback.id});
      continue;
    }
    const discovered=endpoint.tools?.length ? endpoint : await mcp.discover(endpoint.id);
    if (localAuthBypassActive) {
      for (const tool of discovered.tools ?? []) {
        await permissions.grant({applicationId:'local-development',qualifiedName:tool.qualifiedName});
      }
    }
    await logger.info('local_mcp_fallback.discovered',{endpointId:endpoint.id,toolCount:discovered.tools?.length??0,localPermissionsGranted:localAuthBypassActive});
  } catch (error) {
    await logger.warn('local_mcp_fallback.discovery_failed',{endpointId:fallback.id,code:String(error?.code??error?.message??'mcp_discovery_failed')});
  }
}
const mcpAudit = new McpAudit(store);
const connections = new McpConnections(store, {leaseMs:Number(process.env.MCP_CONNECTION_LEASE_MS ?? 300000)});
const reconciliation = new McpReconciliation(mcpAudit, {graceMs:Number(process.env.MCP_RECONCILIATION_GRACE_MS ?? 30000)});
await connections.cleanupExpired();
if (process.env.MCP_RECONCILE_ON_START === 'true') await reconciliation.reconcile();
const limits = new AppLimits({maxRequests:Number(process.env.APP_RATE_LIMIT ?? 60), maxConcurrent:Number(process.env.APP_CONCURRENCY ?? 4)});
const smartRouter = new SmartRouter({providers, logger});
const capabilityConfig = new CapabilityConfigResolver({store});
const toolPolicy = new ToolPolicy(store, {configResolver:capabilityConfig});
const toolExecution = new ToolExecutionAdapter({registry:toolsRegistry, toolRoot:config.toolRoot, logger, policy:toolPolicy});
const mcpExecution = new McpExecutionAdapter({registry:mcp, permissions, audit:mcpAudit, connections, limits, logger});
const evidenceGate = new EvidenceGate({store, logger});
const sessions = new SessionService(store);
const executionLifecycle = new ExecutionLifecycle({sessions, evidenceGate, normalizer, logger, requireSystemPrompt:true});
const providerExecution = new ProviderExecutionAdapter({providers, normalizer, logger, router: smartRouter, lifecycle: executionLifecycle});
const sessionClient = new SessionClient({service:sessions});
const sessionState = new SessionStateStore({store, sessions, maxMessages:config.sessionMaxMessages});
const executionAdapter = new ExecutionAdapter({provider:providerExecution, tool:toolExecution, mcp:mcpExecution});
const toolLoop = new ToolLoopExecutor({providers, executionAdapter, normalizer, evidenceGate, sessionState, logger, router:smartRouter, lifecycle:executionLifecycle, maxRounds:config.toolLoopMaxRounds, maxToolCallsPerRound:config.toolLoopMaxToolCallsPerRound, maxRepeatedCalls:config.toolLoopMaxRepeatedCalls});
executionAdapter.loop = toolLoop;
const agentRunner = new AgentRunner({registry:agentsRegistry, personas, evidenceGate, logger});
async function routeForAgent(input = {}, agentId = input.agent ?? input.persona ?? 'code-guru') {
  const agent = (await agentsRegistry.list()).find(item => item.id === String(agentId));
  const mapping = agent?.modelMapping ?? agent?.metadata?.modelMapping ?? null;
  const requestedModel = String(input.model ?? '').trim();
  const publicModel = String(mapping?.publicModel ?? '').trim();
  const mappedModel = String(mapping?.model ?? '').trim();
  const useMapping = mapping?.enabled !== false && mapping?.providerId && mappedModel && (!requestedModel || requestedModel === publicModel || requestedModel === mappedModel);
  const routeInput = useMapping ? {...input, provider:String(mapping.providerId), model:mappedModel} : input;
  const route = await smartRouter.route(routeInput);
  if (useMapping) {
    route.publicModel = publicModel || route.publicModel || '';
    route.agentMapping = {agentId:String(agentId),publicModel:publicModel || null,providerId:String(mapping.providerId),model:mappedModel,enabled:true};
    await logger.info('agent.model_mapping.applied',{agentId:String(agentId),publicModel:publicModel || null,providerId:String(mapping.providerId),model:mappedModel,routeId:route.routeId});
  }
  return route;
}
const execution = new ExecutionOrchestrator({extensionResolver, executor:executionAdapter});
const adminOk = (req) => isAdminAuthorized(bearer(req), config.adminToken) || (localAuthBypassActive && isLocalDevelopmentRequest(req));
const applications = async () => store.read('applications', []);
async function authenticateRequest(req, requestLog, requestState) {
  const app = localAuthBypassActive && isLocalDevelopmentRequest(req)
    ? {id:'local-development',name:'Local Development Session',status:'active',localDevelopment:true}
    : authenticateApiKey(bearer(req), await applications());
  if (!app) {
    requestState.outcome = 'unauthorized';
    await requestLog.warn('application.auth.failed', {reason:'missing_or_invalid_or_expired_key'});
    return null;
  }
  requestState.applicationId = app.id;
  requestState.outcome = 'accepted';
  await requestLog.info(localAuthBypassActive && app.localDevelopment ? 'application.auth.local_bypass' : 'application.auth.succeeded', {applicationId:app.id,mode:app.localDevelopment?'local-development':'api-key'});
  return app;
}
const legacyAudit = legacyFeatureReport();
const legacyReconciliation = reconciliationReport();

function boundedConversation(inputMessages, recentSession, archiveSession, userInput) {
  const incoming = Array.isArray(inputMessages) ? inputMessages.filter(m => m?.role !== 'system') : [];
  const archive = Array.isArray(archiveSession) ? archiveSession : [];
  const recent = Array.isArray(recentSession) ? recentSession.slice(-config.contextRecentMessages) : archive.slice(-config.contextRecentMessages);
  const bounded = buildBoundedContext({userInput, recent, archive, maxBytes:config.contextBudgetBytes, recentLimit:config.contextRecentMessages});
  const seen = new Set();
  const messages = [];
  for (const m of [...bounded.recent, ...incoming]) {
    const key = JSON.stringify(m);
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push(m);
  }
  let out = messages;
  while (Buffer.byteLength(JSON.stringify(out)) > config.contextBudgetBytes && out.length > 1) out = out.slice(1);
  return {messages:out, archiveSelected:bounded.archive.length, bytes:Buffer.byteLength(JSON.stringify(out)), maxBytes:config.contextBudgetBytes};
}

function latestUserMessage(messages = [], fallback = '') {
  const user = Array.isArray(messages) ? messages.filter(m => m?.role === 'user').at(-1) : null;
  return user ? {role:'user', content:user.content ?? ''} : {role:'user', content:fallback};
}

function compileRuntimeContext({goal, input, projectRoot, project, syllabusDoc, memoryDoc, session, taskPolicy}) {
  const archive = session ? session._compiledArchive ?? [] : [];
  return compileContext({
    goal,
    userInput: input.messages?.filter?.(m => m?.role === 'user').at(-1)?.content ?? goal,
    recent: Array.isArray(input.messages) ? input.messages.slice(-config.contextRecentMessages) : [],
    memory: memoryDoc ?? [],
    ssot: project,
    syllabus: syllabusDoc,
    projectRoot,
    workingDirectory: input.workingDirectory ?? projectRoot,
    sessionId: session?.id ?? input.sessionId ?? null,
    taskPolicy,
    maxBytes: config.compiledContextBytes,
    recentLimit: config.contextRecentMessages
  });
}

const requestHandler = async (req,res) => {
  const requestId = String(req.headers['x-request-id'] || id('req'));
  const traceId = String(req.headers['x-trace-id'] || id('trace'));
  const startedAt = Date.now();
  const requestState = {applicationId:null, operation:null, outcome:'unknown'};
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-trace-id', traceId);
  const parsedRequestUrl = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const requestLog = logger.child({requestId, traceId, runtimeId:runtimeIdentity.runtimeId, instanceId:runtimeIdentity.instanceId, method:req.method, path:parsedRequestUrl.pathname, peerAddress:req.socket?.remoteAddress ?? null, peerPort:req.socket?.remotePort ?? null, localAddress:req.socket?.localAddress ?? null, localPort:req.socket?.localPort ?? null, hostHeader:req.headers.host ?? null});
  const originalEnd = res.end.bind(res);
  res.end = (...args) => {
    requestLog.info('http.response', {statusCode:res.statusCode, durationMs:Date.now()-startedAt, applicationId:requestState.applicationId, operation:requestState.operation, outcome:requestState.outcome});
    return originalEnd(...args);
  };
  requestState.operation = `${req.method} ${parsedRequestUrl.pathname}`;
  requestLog.info('http.request', {operation:requestState.operation});
  try {
    const url = parsedRequestUrl;
    if (req.method==='GET' && url.pathname==='/health') {
      const coreModules = {
        ssot: typeof ssot?.read === 'function', memory: typeof memory?.recent === 'function', entityDoor: typeof entityDoor?.resolve === 'function', normalizer: typeof normalizer?.normalize === 'function',
        adminApi: typeof admin?.applications === 'function', personas: typeof personas?.resolve === 'function', executionBoundary: typeof execution?.prepare === 'function', registries: Boolean(agentsRegistry && toolsRegistry && skillsRegistry && transportsRegistry),
        extensionResolution: typeof extensionResolver?.resolve === 'function', providerExecution: typeof providerExecution?.execute === 'function', toolExecution: typeof toolExecution?.execute === 'function', mcpExecutionBoundary: typeof mcpExecution?.execute === 'function',
        providerAdapters: Boolean(providers), evidenceGate: typeof evidenceGate?.canClaimSuccess === 'function', sessionClient: typeof sessionClient?.resolve === 'function', agentBoundary: typeof agentRunner?.prepare === 'function', transportLayer: Boolean(transportServers),
        toolLoop: typeof toolLoop?.execute === 'function', sessionState: typeof sessionState?.list === 'function', envLoader: Boolean(envLoadResult), systemLogger: typeof logger?.info === 'function', ssotService: typeof ssot?.read === 'function',
        syllabusService: typeof syllabus?.read === 'function', memoryService: typeof memory?.recent === 'function', autoSetup: typeof autoSetup?.ensure === 'function', smartRouter: typeof smartRouter?.route === 'function', providerMasking: typeof maskCanonicalResponse === 'function',
        toolParser: true, verificationGate: typeof evidenceGate?.canClaimSuccess === 'function', systemPrompt: typeof buildSystemMessage === 'function', capabilityConfig: typeof capabilityConfig?.snapshot === 'function', externalMcpRegistry: typeof externalMcp?.sync === 'function',
        commonTools: typeof toolsRegistry?.list === 'function', agentToolBoundaries: Object.keys(ECOMMERCE_AGENT_TOOL_BOUNDARIES).length > 0, sessionMetadata: typeof sanitizeSessionMetadata === 'function', circuitBreaker: Boolean(sharedOutboundCircuitBreaker)
      };
      const agentAudit = await auditAgentRuntime({registry:agentsRegistry,personas,boundaryResolver:getAgentToolBoundary});
      requestState.outcome = 'success';
      return send(res,200,{ok:true,service:'zombiecoder-runtime',version:RUNTIME_VERSION,phase:RUNTIME_PHASE,runtime:runtimeIdentity,executionMode:config.executionMode,providerMode:'configured-compatible-endpoint',providerBootstrap:{registered:providerBootstrap.registered.length,sync:providerBootstrap.sync ? {ok:providerBootstrap.sync.ok !== false,providerCount:providerBootstrap.sync.providerCount ?? null,modelCount:providerBootstrap.sync.modelCount ?? null} : null,modelRefresh:providerBootstrap.modelRefresh??[]},host:config.host,port:config.port,authMode:localAuthBypassActive?'local-no-token':'token-required',externalMcp:{folderCount:externalMcpBootstrap.folderCount,environmentCount:externalMcpBootstrap.environmentCount,registered:externalMcpBootstrap.definitions.filter(x=>x.status==='registered').length},legacyFeatureAudit:{source:legacyAudit.source,behaviorParityVerified:legacyAudit.behaviorParityVerified,counts:legacyAudit.counts,warnings:legacyAudit.warnings.length},legacyPurposeReconciliation:{behaviorParityVerified:legacyReconciliation.behaviorParityVerified,counts:legacyReconciliation.counts},coreModules,agentRuntime:agentAudit,circuitBreaker:{failureThreshold:sharedOutboundCircuitBreaker.failureThreshold,resetTimeoutMs:sharedOutboundCircuitBreaker.resetTimeoutMs,halfOpenMaxCalls:sharedOutboundCircuitBreaker.halfOpenMaxCalls}});
    }
    // Legacy frontend read contracts. These are compatibility envelopes, not provider disclosure.
    if (req.method==='GET' && url.pathname==='/v1/models') {
      return send(res,200,legacyModelList({agents:await agentsRegistry.list(),providers:await providers.list()}));
    }
    if (req.method==='GET' && (url.pathname==='/api/v0/models' || url.pathname==='/api/v1/models')) {
      return send(res,200,legacyProviderModelList(await providers.list()));
    }
    if (req.method==='GET' && url.pathname==='/api/agents') {
      const agents=await agentsRegistry.list();
      return send(res,200,{count:agents.length,source:'runtime-agent-registry',agents:agents.map(a=>({id:a.id,name:a.name,role:a.role,model:'masked',provider:'ZombieCoder'}))});
    }
    if (req.method==='GET' && url.pathname==='/api/domain') return send(res,200,legacyDomain({requestHost:req.headers.host||'localhost',version:RUNTIME_VERSION,projectRoot:config.dataDir}));
    if (req.method==='GET' && url.pathname==='/api/pusher-config') return send(res,200,legacyPusherConfig());
    if (req.method==='GET' && url.pathname==='/api/normalize-list') return send(res,200,legacyNormalizeList({providers:await providers.list(),models:(await providers.list()).flatMap(p=>p.models||[])}));
    if (req.method==='GET' && url.pathname==='/api/ssot') {
      const root=url.searchParams.get('projectRoot')||config.dataDir;
      await autoSetup.ensure(root);
      const doc=await ssot.read(root);
      return send(res,doc?200:404,doc?{success:true,source:'runtime',project_root:root,ssot_path:path.join(root,'.zombiecoder','SSOT.md'),length:doc.content?.length??0,content:doc.content,note:'Runtime SSOT compatibility view'}:{success:false,message:'No SSOT found'});
    }
    if (req.method==='GET' && url.pathname==='/api/config') {
      return send(res,200,{success:true,config:{version:RUNTIME_VERSION,phase:RUNTIME_PHASE,projectRoot:config.dataDir,toolRoot:config.toolRoot},domain:legacyDomain({requestHost:req.headers.host||'localhost',version:RUNTIME_VERSION,projectRoot:config.dataDir})});
    }
    if (req.method==='GET' && url.pathname==='/api/config/mcp') {
      const publicUrl=`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host||`localhost:${config.port}`}`;
      return send(res,200,{name:'ZombieCoder Runtime',transport:{type:'runtime-rest',url:`${publicUrl}/v1/mcp/tools/call`},endpoints:{http:publicUrl,mcpServer:null,toolCatalog:`${publicUrl}/v1/admin/mcp/tools`,toolCall:`${publicUrl}/v1/mcp/tools/call`,endpointRegistry:`${publicUrl}/v1/admin/mcp/endpoints`},mcpServerAvailable:false,tools:(await mcp.tools()).map(t=>t.qualifiedName),timeout:300000});
    }
    if (req.method==='GET' && url.pathname==='/api/mcp-clients') {
      return send(res,200,{domain:req.headers.host||'localhost',serverType:'runtime',version:RUNTIME_VERSION,total_requests:null,active_connections:null,connected_clients:await connections.list(),tools:(await mcp.tools()).length,server_url:`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host||`localhost:${config.port}`}/mcp`,protocol:'JSON-RPC 2.0',protocol_version:'2025-06-18'});
    }
    if (req.method==='GET' && url.pathname==='/api/clients') return send(res,200,{clients:await connections.list(),count:(await connections.list()).length});

    if (req.method==='POST' && url.pathname==='/v1/admin/applications') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,201,{...await admin.createApplication(await body(req, config.maxBodyBytes)),warning:'Store this key now; it will not be shown again.'});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/applications') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{applications:await admin.applications() .then(xs=>xs.map(({apiKeyHash,...x})=>x))});
    }
    if (req.method==='POST' && url.pathname.match(/^\/v1\/admin\/applications\/[^/]+\/rotate-key$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const appId=url.pathname.split('/')[4]; return send(res,200,{...await admin.rotateKey(appId),warning:'Store this key now; it will not be shown again.'});
    }
    if (req.method==='POST' && url.pathname.match(/^\/v1\/admin\/applications\/[^/]+\/(revoke|extend)$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const appId=url.pathname.split('/')[4], action=url.pathname.split('/')[5], input=await body(req, config.maxBodyBytes);
      const patch=action==='revoke'?{status:'revoked'}:{expiresAt:input.expiresAt??null};
      return send(res,200,{application:await admin.updateApplication(appId,patch)});
    }
    if (req.method==='POST' && url.pathname==='/v1/sessions') {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      requestState.outcome = 'accepted';
      const input = await body(req, config.maxBodyBytes);
      return send(res,201,{session:await sessions.create({applicationId:app.id,userId:input.userId ?? null,metadata:sanitizeSessionMetadata(input.metadata ?? {})})});
    }
    if (req.method==='GET' && url.pathname.match(/^\/v1\/sessions\/[^/]+$/)) {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const session=await sessions.get(url.pathname.split('/')[3],app.id);
      return session ? send(res,200,{session}) : send(res,404,{error:'session_not_found'});
    }
    if (req.method==='PATCH' && url.pathname.match(/^\/v1\/sessions\/[^/]+\/metadata$/)) {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const sessionId=url.pathname.split('/')[3];
      const input=await body(req, config.maxBodyBytes);
      const session=await sessions.updateMetadata(sessionId,app.id,input.metadata ?? input);
      if (!session) return send(res,404,{error:'session_not_found'});
      return send(res,200,{session});
    }
    if (req.method==='GET' && url.pathname.match(/^\/v1\/sessions\/[^/]+\/messages$/)) {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const sessionId=url.pathname.split('/')[3];
      try { return send(res,200,{sessionId,messages:await sessionState.list(sessionId,app.id)}); }
      catch (e) { if (e?.message === 'session_not_found') return send(res,404,{error:'session_not_found'}); throw e; }
    }
    if (req.method==='POST' && url.pathname.match(/^\/v1\/sessions\/[^/]+\/close$/)) {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const session=await sessions.close(url.pathname.split('/')[3],app.id);
      return session ? send(res,200,{session}) : send(res,404,{error:'session_not_found'});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/compatibility/tools') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,toolParityReport(await toolsRegistry.list()));
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/compatibility/features') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,legacyFeatureReport());
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/task-profiles') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{profiles:(await import('./execution/task-policy.js')).getTaskProfiles()});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/compatibility/reconciliation') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,legacyReconciliation);
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/compatibility/routes') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,routeMapReport());
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/evidence') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{evidence:await store.read('evidence',[])});
    }
    if (req.method==='POST' && url.pathname==='/v1/context/setup') {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input=await body(req, config.maxBodyBytes);
      return send(res,200,{applicationId:app.id, setup:await autoSetup.ensure(input.projectRoot || config.dataDir,{refreshSSOT:input.refreshSSOT === true})});
    }
    if (req.method==='GET' && url.pathname==='/v1/context') {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const root=url.searchParams.get('projectRoot') || config.dataDir;
      await autoSetup.ensure(root);
      const [project,syllabusDoc,memoryDoc]=await Promise.all([ssot.read(root),syllabus.read(root),memory.read(root)]);
      return send(res,200,{applicationId:app.id,project,syllabus:syllabusDoc,memory:memoryDoc});
    }
    if (req.method==='POST' && url.pathname==='/v1/context/ssot/refresh') {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input=await body(req, config.maxBodyBytes);
      return send(res,200,{applicationId:app.id,ssot:await ssot.refresh(input.projectRoot || config.dataDir,{reason:input.reason || 'api_refresh'})});
    }
    if (req.method==='POST' && url.pathname==='/v1/context/syllabus') {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input=await body(req, config.maxBodyBytes);
      return send(res,201,{applicationId:app.id,entry:await syllabus.append(input.projectRoot || config.dataDir,input)});
    }
    if (req.method==='POST' && url.pathname==='/v1/context/memory') {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input=await body(req, config.maxBodyBytes);
      return send(res,201,{applicationId:app.id,entry:await memory.append(input.projectRoot || config.dataDir,{...input,applicationId:app.id})});
    }
    if (req.method==='GET' && url.pathname==='/v1/context/memory/recent') {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const root=url.searchParams.get('projectRoot') || config.dataDir;
      return send(res,200,{applicationId:app.id,entries:await memory.recent(root,url.searchParams.get('limit') || 10)});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/tools/permissions') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{permissions:await toolPolicy.list()});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/tools/permissions') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,201,{permission:await toolPolicy.grant(await body(req,config.maxBodyBytes))});
    }
    if (req.method==='DELETE' && url.pathname==='/v1/admin/tools/permissions') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const input=await body(req,config.maxBodyBytes); return send(res,200,{revoked:await toolPolicy.revoke(input.applicationId,input.toolId)});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/registry/external-mcp') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{servers:await externalMcp.status(),endpoints:await mcp.list()});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/registry/external-mcp/sync') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{sync:await externalMcp.sync(),servers:await externalMcp.status()});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/applications/capabilities') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const applicationId=String(url.searchParams.get('applicationId') ?? '');
      if (!applicationId) return send(res,400,{error:'application_id_required'});
      const tools=await toolsRegistry.list();
      return send(res,200,{applicationId,tools:await capabilityConfig.snapshot(applicationId,tools.map(x=>x.id))});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/applications/capabilities/tools') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const input=await body(req,config.maxBodyBytes);
      const setting=await capabilityConfig.setToolSetting(input.applicationId,input.toolId,input.enabled);
      return send(res,200,{setting,decision:await toolPolicy.decision(input.applicationId,input.toolId)});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/registry/tools') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{components:await toolsRegistry.list()});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/registry/tools') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,201,{component:await toolsRegistry.register(await body(req, config.maxBodyBytes))});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/registry/skills') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{components:await skillsRegistry.list()});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/registry/skills') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,201,{component:await skillsRegistry.register(await body(req, config.maxBodyBytes))});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/registry/agents/tool-boundaries') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{boundaries:ECOMMERCE_AGENT_TOOL_BOUNDARIES});
    }
    if (req.method==='GET' && url.pathname.match(/^\/v1\/admin\/registry\/agents\/[^/]+\/tool-boundary$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const agentId=url.pathname.split('/')[5];
      const boundary=getAgentToolBoundary(agentId);
      if (!boundary) return send(res,404,{error:'agent_tool_boundary_not_found'});
      return send(res,200,{agentId,boundary});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/registry/agents') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{components:await agentsRegistry.list()});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/registry/agents/runtime-audit') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,await auditAgentRuntime({registry:agentsRegistry,personas,boundaryResolver:getAgentToolBoundary}));
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/registry/agents') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const component=await agentsRegistry.register(await body(req,config.maxBodyBytes));
      await requestLog.info('admin.agent.created',{agentId:component.id,status:component.status,enabled:component.enabled!==false});
      return send(res,201,{component});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/registry/transports') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{components:await transportsRegistry.list()});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/registry/transports') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,201,{component:await transportsRegistry.register(await body(req, config.maxBodyBytes))});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/providers') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{providers:await providers.list()});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/providers/route') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const input=await body(req, config.maxBodyBytes);
      return send(res,200,{route:await smartRouter.route(input)});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/providers') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const provider=await providers.register(await body(req,config.maxBodyBytes));
      await requestLog.info('admin.provider.created',{providerId:provider.id,enabled:provider.enabled!==false,priority:provider.priority,modelCount:provider.models?.length??0,driver:provider.driver});
      return send(res,201,{provider});
    }
    if (req.method==='PUT' && url.pathname.match(/^\/v1\/admin\/providers\/[^/]+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const providerId=decodeURIComponent(url.pathname.split('/')[4]);
      const provider=await providers.update(providerId,await body(req,config.maxBodyBytes));
      await requestLog.info('admin.provider.updated',{providerId,enabled:provider.enabled!==false,priority:provider.priority,modelCount:provider.models?.length??0});
      return send(res,200,{provider});
    }
    if (req.method==='DELETE' && url.pathname.match(/^\/v1\/admin\/providers\/[^/]+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const providerId=decodeURIComponent(url.pathname.split('/')[4]);
      const deleted=await providers.remove(providerId);
      await requestLog.info('admin.provider.deleted',{providerId,deleted});
      return send(res,200,{deleted,providerId});
    }
    if (req.method==='GET' && url.pathname.match(/^\/v1\/admin\/providers\/[^/]+\/models$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const providerId=decodeURIComponent(url.pathname.split('/')[4]);
      const provider=(await providers.list()).find(item=>item.id===providerId);
      if(!provider) return send(res,404,{error:'provider_not_found'});
      const models=(provider.models??[]).map(name=>({id:name,name,enabled:provider.modelMetadata?.[name]?.enabled!==false,priority:provider.modelMetadata?.[name]?.priority??100,alias:provider.modelMetadata?.[name]?.alias??null,isDefault:provider.defaultModel===name}));
      return send(res,200,{providerId,models});
    }
    if (req.method==='POST' && url.pathname.match(/^\/v1\/admin\/providers\/[^/]+\/models$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const providerId=decodeURIComponent(url.pathname.split('/')[4]); const input=await body(req,config.maxBodyBytes); const modelId=String(input.id??input.name??'').trim();
      if(!modelId) return send(res,400,{error:'provider_model_required'});
      const updated=await providers.updateModel(providerId,modelId,{...input,create:true});
      await requestLog.info('admin.provider.model.created',{providerId,modelId,enabled:updated.modelMetadata?.[modelId]?.enabled!==false,priority:updated.modelMetadata?.[modelId]?.priority??100});
      return send(res,201,{provider:updated,model:{id:modelId,enabled:updated.modelMetadata?.[modelId]?.enabled!==false,priority:updated.modelMetadata?.[modelId]?.priority??100}});
    }
    if (req.method==='PUT' && url.pathname.match(/^\/v1\/admin\/providers\/[^/]+\/models\/.+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const parts=url.pathname.split('/'); const providerId=decodeURIComponent(parts[4]); const modelId=decodeURIComponent(parts.slice(6).join('/')); const input=await body(req,config.maxBodyBytes);
      const provider=await providers.updateModel(providerId,modelId,input);
      await requestLog.info('admin.provider.model.updated',{providerId,modelId,enabled:provider.modelMetadata?.[modelId]?.enabled!==false,priority:provider.modelMetadata?.[modelId]?.priority??100,isDefault:provider.defaultModel===modelId});
      return send(res,200,{provider});
    }
    if (req.method==='DELETE' && url.pathname.match(/^\/v1\/admin\/providers\/[^/]+\/models\/.+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const parts=url.pathname.split('/'); const providerId=decodeURIComponent(parts[4]); const modelId=decodeURIComponent(parts.slice(6).join('/'));
      const provider=await providers.updateModel(providerId,modelId,{delete:true});
      await requestLog.info('admin.provider.model.deleted',{providerId,modelId,remainingModels:provider.models?.length??0});
      return send(res,200,{provider,modelId});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/providers/sync-all') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const input=await body(req,config.maxBodyBytes);
      const sync=await providers.syncAll({syncUrl:input.syncUrl||config.providerCatalogSyncUrl,apiKey:input.apiKey||config.providerCatalogApiKey,timeoutMs:input.timeoutMs||config.providerSyncTimeoutMs});
      await requestLog.info('provider.catalog.sync_all.completed',{providerCount:sync.providerCount,modelCount:sync.modelCount});
      return send(res,200,{sync});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/models/sync-all') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const list=await providers.list(); const results=[];
      for(const item of list){ if(item.enabled===false) {results.push({providerId:item.id,ok:false,skipped:'disabled'});continue;} try {const updated=await providers.refreshModels(item.id);results.push({providerId:item.id,ok:true,modelCount:updated.models?.length??0,defaultModel:updated.defaultModel||null});await requestLog.info('provider.models.sync_all.success',{providerId:item.id,modelCount:updated.models?.length??0});}catch(error){results.push({providerId:item.id,ok:false,error:String(error?.message??error)});await requestLog.warn('provider.models.sync_all.failed',{providerId:item.id,error:String(error?.message??error)});} }
      return send(res,200,{results,summary:{total:results.length,succeeded:results.filter(x=>x.ok).length,failed:results.filter(x=>x.ok===false&&!x.skipped).length}});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/providers/sync') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const input=await body(req, config.maxBodyBytes);
      const sync=await providers.syncAll({syncUrl:input.syncUrl || config.providerCatalogSyncUrl, apiKey:input.apiKey || config.providerCatalogApiKey, timeoutMs:input.timeoutMs || config.providerSyncTimeoutMs});
      await requestLog.info('provider.catalog.sync.completed',{providerCount:sync.providerCount,modelCount:sync.modelCount});
      return send(res,200,{sync});
    }
    if (req.method==='POST' && url.pathname.match(/^\/v1\/admin\/providers\/[^/]+\/sync$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const providerId=url.pathname.split('/')[5];
      const input=await body(req, config.maxBodyBytes);
      const sync=await providers.syncProvider(providerId,{syncUrl:input.syncUrl,timeoutMs:input.timeoutMs || config.providerSyncTimeoutMs});
      await requestLog.info('provider.sync.completed',{providerId,modelCount:sync.modelKeys?.length??sync.provider?.models?.length??0,source:sync.source});
      return send(res,200,{sync});
    }
    if (req.method==='POST' && url.pathname.match(/^\/v1\/admin\/providers\/[^/]+\/models\/refresh$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{provider:await providers.refreshModels(url.pathname.split('/')[4])});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/personas') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{personas:await personas.list()});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/personas') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const persona=await personas.register(await body(req,config.maxBodyBytes));
      await requestLog.info('admin.persona.created',{personaId:persona.id,enabled:persona.enabled!==false,priority:persona.priority});
      return send(res,201,{persona});
    }
    if (req.method==='PUT' && url.pathname.match(/^\/v1\/admin\/personas\/[^/]+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const personaId=decodeURIComponent(url.pathname.split('/')[4]);
      const persona=await personas.update(personaId,await body(req,config.maxBodyBytes));
      await requestLog.info('admin.persona.updated',{personaId,enabled:persona.enabled!==false,priority:persona.priority});
      return send(res,200,{persona});
    }
    if (req.method==='DELETE' && url.pathname.match(/^\/v1\/admin\/personas\/[^/]+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const personaId=decodeURIComponent(url.pathname.split('/')[4]);
      const deleted=await personas.remove(personaId);
      await requestLog.info('admin.persona.disabled_or_deleted',{personaId,changed:deleted});
      return send(res,200,{deleted,personaId});
    }
    if (req.method==='GET' && url.pathname.match(/^\/v1\/admin\/registry\/agents\/[^/]+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const agentId=decodeURIComponent(url.pathname.split('/')[5]); const agent=(await agentsRegistry.list()).find(item=>item.id===agentId);
      return agent?send(res,200,{agent}):send(res,404,{error:'agent_not_found'});
    }
    if (req.method==='PUT' && url.pathname.match(/^\/v1\/admin\/registry\/agents\/[^/]+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const agentId=decodeURIComponent(url.pathname.split('/')[5]);
      const agent=await agentsRegistry.update(agentId,await body(req,config.maxBodyBytes));
      await requestLog.info('admin.agent.updated',{agentId,status:agent.status,enabled:agent.enabled!==false,mapped:Boolean(agent.modelMapping)});
      return send(res,200,{agent});
    }
    if (req.method==='DELETE' && url.pathname.match(/^\/v1\/admin\/registry\/agents\/[^/]+$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const agentId=decodeURIComponent(url.pathname.split('/')[5]);
      const deleted=await agentsRegistry.remove(agentId);
      await requestLog.info('admin.agent.deleted',{agentId,deleted});
      return send(res,200,{deleted,agentId});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/agents/model-mappings') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{mappings:(await agentsRegistry.list()).map(agent=>({agentId:agent.id,agentName:agent.name,mapping:agent.modelMapping??agent.metadata?.modelMapping??null}))});
    }
    if ((req.method==='PUT'||req.method==='POST') && url.pathname.match(/^\/v1\/admin\/agents\/[^/]+\/model-mapping$/)) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const agentId=decodeURIComponent(url.pathname.split('/')[4]); const input=await body(req,config.maxBodyBytes);
      if(input.enabled!==false && (!input.providerId || !input.model)) return send(res,400,{error:'mapping_provider_and_model_required'});
      const agent=(await agentsRegistry.list()).find(item=>item.id===agentId); if(!agent) return send(res,404,{error:'agent_not_found'});
      const provider=(await providers.list()).find(item=>item.id===String(input.providerId));
      if(input.enabled!==false && (!provider || provider.enabled===false)) return send(res,400,{error:'mapping_provider_not_found_or_disabled'});
      if(input.enabled!==false && Array.isArray(provider.models) && provider.models.length && !provider.models.includes(String(input.model))) return send(res,400,{error:'mapping_model_not_found'});
      if(input.enabled!==false && provider.modelMetadata?.[String(input.model)]?.enabled===false) return send(res,400,{error:'mapping_model_disabled'});
      const mapping={publicModel:String(input.publicModel??'zombie-mini'),providerId:String(input.providerId??''),model:String(input.model??''),enabled:input.enabled!==false,updatedAt:new Date().toISOString()};
      const updated=await agentsRegistry.update(agentId,{modelMapping:mapping});
      await logger.info('agent.model_mapping.updated',{agentId,publicModel:mapping.publicModel,providerId:mapping.providerId,model:mapping.model,enabled:mapping.enabled});
      return send(res,200,{agentId,mapping:updated.modelMapping});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/metrics') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const [providerList,agentList,personaList,toolList,applicationList,sessionList,evidenceList]=await Promise.all([providers.list(),agentsRegistry.list(),personas.list(),toolsRegistry.list(),admin.applications(),store.read('sessions',[]),store.read('evidence',[])]);
      return send(res,200,{createdAt:new Date().toISOString(),uptimeSeconds:Math.floor(process.uptime()),memory:process.memoryUsage(),nodeVersion:process.versions.node,platform:process.platform,executionMode:config.executionMode,authMode:localAuthBypassActive?'local-no-token':'token-required',providers:{total:providerList.length,enabled:providerList.filter(x=>x.enabled!==false).length,models:providerList.reduce((n,x)=>n+(x.models?.length??0),0)},agents:{total:agentList.length,mapped:agentList.filter(x=>(x.modelMapping??x.metadata?.modelMapping)?.enabled!==false&&Boolean(x.modelMapping??x.metadata?.modelMapping)).length},personas:personaList.length,tools:toolList.length,applications:applicationList.length,sessions:sessionList.length,evidence:evidenceList.length});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/constitution') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{constitution:CORE_CONSTITUTION});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/mcp/endpoints') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,201,{endpoint:await mcp.register(await body(req, config.maxBodyBytes))});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/mcp/endpoints') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{endpoints:await mcp.list()});
    }
    if (req.method==='POST' && url.pathname.startsWith('/v1/admin/mcp/endpoints/') && url.pathname.endsWith('/discover')) {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const endpointId = url.pathname.split('/')[5];
      const input = await body(req, config.maxBodyBytes);
      const endpoint = await mcp.discover(endpointId);
      let connection = null;
      if (input.runtimeId || input.clientId) connection = await connections.upsert({ ...input, endpointId, sessionId:endpoint.sessionId });
      return send(res,200,{endpoint,connection});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/mcp/permissions') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,201,{permission:await permissions.grant(await body(req, config.maxBodyBytes))});
    }
    if (req.method==='DELETE' && url.pathname==='/v1/admin/mcp/permissions') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const input=await body(req, config.maxBodyBytes);
      return send(res,200,{revoked:await permissions.revoke(input.applicationId,input.qualifiedName)});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/mcp/permissions') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{permissions:await permissions.list()});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/mcp/connections') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{connections:await connections.list()});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/mcp/connections') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{connection:await connections.upsert(await body(req, config.maxBodyBytes))});
    }
    if (req.method==='POST' && url.pathname==='/v1/admin/mcp/reconcile') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,await reconciliation.reconcile());
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/mcp/incomplete') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{incomplete:await reconciliation.findIncomplete()});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/mcp/audit') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{events:await mcpAudit.list(url.searchParams.get('limit'))});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/mcp/tools') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,{tools:await mcp.tools()});
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/providers/models') {
      if (!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      const input = Object.fromEntries(url.searchParams.entries());
      if (!input.provider) return send(res,400,{error:'provider_required'});
      const provider = await providers.resolve(String(input.provider));
      return send(res,200,{providerId:input.provider,models:await provider.listModels()});
    }
    if (req.method==='POST' && url.pathname==='/v1/mcp/tools/call') {
      if (config.executionMode !== 'tools-enabled') return send(res,503,{error:'tool_execution_not_verified',executionMode:config.executionMode,required:'tools-enabled',message:'Tool execution is disabled until the local verification loop passes.'});
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input=await body(req, config.maxBodyBytes);
      const requestId=String(input.requestId || id('req'));
      const qualifiedName=String(input.qualifiedName ?? '');
      if (!qualifiedName) return send(res,400,{error:'qualified_tool_required'});
      let release;
      try { release=limits.acquire(app.id); } catch(e) { const code=String(e?.message ?? 'application_limit'); return send(res,429,{error:code==='application_rate_limited'||code==='application_concurrency_limited'?code:'application_limit'}); }
      const allowed=await permissions.allowed(app.id,qualifiedName);
      if (!allowed) { release();
        await mcpAudit.append({requestId,applicationId:app.id,qualifiedName,action:'tool_call',stage:'permission',outcome:'denied'});
        return send(res,403,{error:'mcp_tool_not_permitted',qualifiedName,requestId});
      }
      let endpoint;
      try {
        const resolved=await mcp.resolveTool(qualifiedName); endpoint=resolved.endpoint; const tool=resolved.tool;
        validateToolArguments(tool,input.arguments ?? {});
        const connection=await connections.resolve({connectionId:input.connectionId,sessionId:input.sessionId,runtimeId:input.runtimeId,clientId:input.clientId});
        const sessionId=connection?.sessionId || input.sessionId || endpoint.sessionId;
        await mcpAudit.append({requestId,applicationId:app.id,endpointId:endpoint.id,qualifiedName,action:'tool_call',stage:'request',outcome:'started',connectionId:connection?.connectionId??null,sessionId:sessionId??null});
        const result=await callMcpTool(endpoint,tool.name,input.arguments ?? {},{sessionId});
        if(connection) await connections.touch(connection.connectionId,{sessionId});
        await mcpAudit.append({requestId,applicationId:app.id,endpointId:endpoint.id,qualifiedName,action:'tool_call',stage:'result',outcome:'success',connectionId:connection?.connectionId??null,sessionId:sessionId??null});
        release(); return send(res,200,{result,applicationId:app.id,endpointId:endpoint.id,qualifiedName,requestId,connectionId:connection?.connectionId??null,sessionId:sessionId??null});
      } catch (e) {
        await mcpAudit.append({requestId,applicationId:app.id,endpointId:endpoint?.id,qualifiedName,action:'tool_call',stage:'result',outcome:'error',error:e.message});
        release(); throw e;
      }
    }
    if (req.method==='POST' && url.pathname==='/v1/execution/prepare') {
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input = await body(req, config.maxBodyBytes);
      const taskPolicy = buildTaskPolicy(input);
      return send(res,200,{applicationId:app.id, taskPolicy, ...await execution.prepare({...input, toolIds:taskPolicy.effectiveToolIds})});
    }
    if (req.method==='POST' && url.pathname==='/v1/execution/run') {
      if (config.executionMode !== 'tools-enabled') return send(res,503,{error:'tool_execution_not_verified',executionMode:config.executionMode,required:'tools-enabled',message:'Execution is disabled until the local verification loop passes.'});
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      let input=await body(req, config.maxBodyBytes);
      const taskPolicy=buildTaskPolicy(input);
      input={...input,toolIds:taskPolicy.effectiveToolIds,allowedToolIds:taskPolicy.effectiveToolIds};
      const registeredNativeTools=(await toolsRegistry.list()).filter(t=>input.toolIds.includes(t.id)&&t.entry&&['ENABLED','VERIFIED'].includes(t.status));
      const generatedToolBindings=Object.fromEntries(registeredNativeTools.map(t=>[t.id,{toolId:t.id}]));
      input={...input,tools:registeredNativeTools.map(t=>({type:'function',function:{name:t.id,description:t.description??t.name,parameters:t.metadata?.toolSchema??{type:'object',properties:{}}}})),toolBindings:{...(input.toolBindings??{}),...generatedToolBindings},allowJsonToolFallback:true};
      const session=input.sessionId ? await sessionClient.resolve({sessionId:input.sessionId,applicationId:app.id}) : (input.createSession ? await sessionClient.resolve({applicationId:app.id,createIfMissing:true,userId:input.userId}) : null);
      const executionMetadata={sessionSource:input.sessionSource ?? req.headers['x-session-source'] ?? 'execution',clientId:input.clientId ?? req.headers['x-client-id'] ?? null,editor:input.editor ?? req.headers['x-editor'] ?? null,editorVersion:input.editorVersion ?? req.headers['x-editor-version'] ?? null,clientVersion:input.clientVersion ?? req.headers['x-client-version'] ?? null,osPlatform:input.osPlatform ?? req.headers['x-os-platform'] ?? null,deviceInfo:input.deviceInfo ?? req.headers['x-device-info'] ?? null};
      if(session) await sessions.updateMetadata(session.id,app.id,Object.fromEntries(Object.entries(executionMetadata).filter(([,v])=>v != null && String(v).trim())));
      const currentSession=session ? await sessions.get(session.id,app.id) : null;
      const executionEvidence=currentSession ? (await store.read('evidence',[])).filter(item=>item.contextId===currentSession.id).slice(-8) : [];
      const executionProjectRoot=input.projectRoot ? projectContext.root(input.projectRoot) : null;
      if(executionProjectRoot) await autoSetup.ensure(executionProjectRoot);
      const executionProject=executionProjectRoot ? await ssot.read(executionProjectRoot) : null;
      const executionMemory=executionProjectRoot ? await memory.recent(executionProjectRoot,10) : [];
      const executionSyllabus=executionProjectRoot ? await syllabus.read(executionProjectRoot) : null;
      const executionAgentId=String(input.agent ?? input.persona ?? 'code-guru');
      const executionGoal=String(input.goal ?? 'execution');
      const executionAgent=await agentRunner.prepare({agentId:executionAgentId,personaId:executionAgentId,goal:executionGoal,expectedOutcome:input.expectedOutcome,tools:input.toolIds});
      const executionRoute=await routeForAgent(input, executionAgentId);
      const executionCompiledContext=compileContext({goal:executionGoal,userInput:input.messages?.filter?.(m=>m?.role==='user').at(-1)?.content ?? executionGoal,recent:input.messages ?? [],memory:executionMemory ?? [],ssot:executionProject,syllabus:executionSyllabus,projectRoot:executionProjectRoot,workingDirectory:input.workingDirectory ?? executionProjectRoot,sessionId:currentSession?.id ?? input.sessionId ?? null,taskPolicy,evidence:executionEvidence,maxBytes:config.compiledContextBytes,recentLimit:config.contextRecentMessages});
      const executionSystem=buildSystemMessage({constitution:CORE_CONSTITUTION,agent:executionAgent.agent,persona:executionAgent.persona,goal:executionGoal,expectedOutcome:input.expectedOutcome,projectRoot:executionProjectRoot,ssot:executionProject,syllabus:executionSyllabus,memory:executionMemory,session:currentSession,route:executionRoute,tools:input.toolIds,toolCatalog:registeredNativeTools,compiledContext:executionCompiledContext});
      const executionArchive=session ? await sessionState.archive(session.id,app.id) : [];
      const boundedExecution=boundedConversation(input.messages,[...(executionMemory ?? [])],executionArchive,executionGoal);
      const incomingMessages=boundedExecution.messages.length ? boundedExecution.messages : [{role:'user',content:executionGoal}];
      input={...input,messages:[executionSystem,...incomingMessages],sessionId:currentSession?.id ?? input.sessionId};
      const prepared=await execution.prepare(input);
      const executionContext=createExecutionContext({...input,applicationId:app.id,sessionId:session?.id ?? input.sessionId,requestId,projectRoot:executionProjectRoot,workingDirectory:input.workingDirectory ?? executionProjectRoot,agentId:executionAgentId,goal:executionGoal,expectedOutcome:input.expectedOutcome,providerId:executionRoute.providerId,model:executionRoute.model,publicModel:executionRoute.publicModel,modelMapping:executionRoute.agentMapping,transport:'http'},runtimeIdentity);
      const result=await execution.execute(prepared,{...input,sessionId:session?.id ?? input.sessionId,requestId,workingDirectory:executionContext.workingDirectory,applicationId:app.id},app.id,executionContext);
      requestState.outcome = result?.status === 'completed' && result?.verified === true ? 'verified' : (result?.status ?? 'completed');
      await requestLog.info('execution.completed', {applicationId:app.id,agentId:input.agent ?? input.persona ?? 'code-guru',personaId:input.persona ?? input.agent ?? 'code-guru',providerId:result?.providerId ?? null,model:result?.model ?? null,status:result?.status ?? null,stoppedReason:result?.stoppedReason ?? null,verified:result?.verified ?? false});
      const evidence=Array.isArray(result?.evidence)?result.evidence:[];
      const evidenceState=evidence.length ? evidenceGate.validate(evidence) : [];
      const verified=evidenceGate.canClaimSuccess(evidenceState);
      const safeResult={...result,verified};
      if (!verified) { safeResult.response=null; safeResult.status='awaiting_verification'; }
      if (input.projectRoot) {
        await autoSetup.ensure(input.projectRoot);
        await syllabus.append(input.projectRoot,{topic:String(input.goal ?? 'execution').slice(0,120),source:'runtime.phase-22',summary:verified?'Execution produced verified evidence':'Execution observed a provider/tool result but verification evidence is still required',status:verified?'verified':'unverified',evidence:evidence.map(x=>x.summary ?? x.source).join('; ')});
      }
      return send(res,200,{applicationId:app.id,session,taskPolicy,prepared,result:safeResult,evidence:evidenceState,verified});
    }
    if (req.method==='POST' && url.pathname==='/v1/execution/stream') {
      if (config.executionMode !== 'tools-enabled') return send(res,503,{error:'tool_execution_not_verified',executionMode:config.executionMode,required:'tools-enabled',message:'Execution is disabled until the local verification loop passes.'});
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      let input=await body(req, config.maxBodyBytes);
      const taskPolicy=buildTaskPolicy(input);
      input={...input,stream:true,toolIds:taskPolicy.effectiveToolIds,allowedToolIds:taskPolicy.effectiveToolIds};
      const registeredNativeTools=(await toolsRegistry.list()).filter(t=>input.toolIds.includes(t.id)&&t.entry&&['ENABLED','VERIFIED'].includes(t.status));
      const generatedToolBindings=Object.fromEntries(registeredNativeTools.map(t=>[t.id,{toolId:t.id}]));
      input={...input,tools:registeredNativeTools.map(t=>({type:'function',function:{name:t.id,description:t.description??t.name,parameters:t.metadata?.toolSchema??{type:'object',properties:{}}}})),toolBindings:{...(input.toolBindings??{}),...generatedToolBindings},allowJsonToolFallback:true};
      const session=input.sessionId ? await sessionClient.resolve({sessionId:input.sessionId,applicationId:app.id}) : (input.createSession ? await sessionClient.resolve({applicationId:app.id,createIfMissing:true,userId:input.userId}) : null);
      const streamMetadata={sessionSource:input.sessionSource ?? req.headers['x-session-source'] ?? 'execution-stream',clientId:input.clientId ?? req.headers['x-client-id'] ?? null,editor:input.editor ?? req.headers['x-editor'] ?? null,editorVersion:input.editorVersion ?? req.headers['x-editor-version'] ?? null,clientVersion:input.clientVersion ?? req.headers['x-client-version'] ?? null,osPlatform:input.osPlatform ?? req.headers['x-os-platform'] ?? null,deviceInfo:input.deviceInfo ?? req.headers['x-device-info'] ?? null};
      if(session) await sessions.updateMetadata(session.id,app.id,Object.fromEntries(Object.entries(streamMetadata).filter(([,v])=>v != null && String(v).trim())));
      const currentSession=session ? await sessions.get(session.id,app.id) : null;
      const streamProjectRoot=input.projectRoot ? projectContext.root(input.projectRoot) : null;
      if(streamProjectRoot) await autoSetup.ensure(streamProjectRoot);
      const streamProject=streamProjectRoot ? await ssot.read(streamProjectRoot) : null;
      const streamMemory=streamProjectRoot ? await memory.recent(streamProjectRoot,10) : [];
      const streamSyllabus=streamProjectRoot ? await syllabus.read(streamProjectRoot) : null;
      const streamEvidence=session ? (await store.read('evidence',[])).filter(item=>item.contextId===session.id).slice(-8) : [];
      const streamAgentId=String(input.agent ?? input.persona ?? 'code-guru');
      const streamGoal=String(input.goal ?? 'execution stream');
      const streamAgent=await agentRunner.prepare({agentId:streamAgentId,personaId:streamAgentId,goal:streamGoal,expectedOutcome:input.expectedOutcome,tools:input.toolIds});
      const streamRoute=await routeForAgent(input, streamAgentId);
      const streamCompiledContext=compileContext({goal:streamGoal,userInput:input.messages?.filter?.(m=>m?.role==='user').at(-1)?.content ?? streamGoal,recent:input.messages ?? [],memory:streamMemory ?? [],ssot:streamProject,syllabus:streamSyllabus,projectRoot:streamProjectRoot,workingDirectory:input.workingDirectory ?? streamProjectRoot,sessionId:currentSession?.id ?? input.sessionId ?? null,taskPolicy,evidence:streamEvidence,maxBytes:config.compiledContextBytes,recentLimit:config.contextRecentMessages});
      const streamSystem=buildSystemMessage({constitution:CORE_CONSTITUTION,agent:streamAgent.agent,persona:streamAgent.persona,goal:streamGoal,expectedOutcome:input.expectedOutcome,projectRoot:streamProjectRoot,ssot:streamProject,syllabus:streamSyllabus,memory:streamMemory,session:currentSession,route:streamRoute,tools:input.toolIds,toolCatalog:registeredNativeTools});
      const streamArchive=session ? await sessionState.archive(session.id,app.id) : [];
      const boundedStream=boundedConversation(input.messages,[...(streamMemory ?? [])],streamArchive,streamGoal);
      const streamMessages=boundedStream.messages.length ? boundedStream.messages : [{role:'user',content:streamGoal}];
      input={...input,messages:[streamSystem,...streamMessages],sessionId:currentSession?.id ?? input.sessionId};
      const prepared=await execution.prepare(input);
      if (!prepared.consent.allowed) return send(res,409,{error:'execution_consent_required',prepared});
      res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','connection':'keep-alive'});
      const streamExecutionContext=createExecutionContext({...input,applicationId:app.id,sessionId:session?.id ?? input.sessionId,requestId,projectRoot:streamProjectRoot,workingDirectory:input.workingDirectory ?? streamProjectRoot,agentId:streamAgentId,goal:streamGoal,expectedOutcome:input.expectedOutcome,providerId:streamRoute.providerId,model:streamRoute.model,publicModel:streamRoute.publicModel,modelMapping:streamRoute.agentMapping,transport:'http-stream'},runtimeIdentity);
      const streamInput={...input,sessionId:session?.id ?? input.sessionId,executionContext:streamExecutionContext};
      if (input.autoToolLoop === true && config.executionMode !== 'tools-enabled') {
        res.write(`event: error\ndata: ${JSON.stringify({error:'tool_execution_not_verified',executionMode:config.executionMode,requestId})}\n\n`); res.end(); return;
      }
      if (input.autoToolLoop === true) {
        const result=await toolLoop.stream({prepared,input:streamInput,applicationId:app.id,onChunk:chunk=>res.write(`data: ${JSON.stringify(chunk)}\n\n`),onEvent:event=>res.write(`event: runtime\ndata: ${JSON.stringify(event)}\n\n`)});
        res.write(`event: runtime\ndata: ${JSON.stringify({type:'complete',status:result.status,stoppedReason:result.stoppedReason,verified:result.verified})}\n\n`);
      } else {
        await providerExecution.stream({prepared,input:streamInput,onChunk:chunk=>res.write(`data: ${JSON.stringify(chunk)}\n\n`)});
      }
      res.write('data: [DONE]\n\n'); res.end(); return;
    }
    if (req.method==='POST' && url.pathname==='/v1/chat/completions') {
      let input=await body(req, config.maxBodyBytes);
      if (input.autoToolLoop === true && config.executionMode !== 'tools-enabled') return send(res,503,{error:'tool_execution_not_verified',executionMode:config.executionMode,required:'tools-enabled'});
      const app=await authenticateRequest(req, requestLog, requestState);
      if (!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const requestedChatTools=Array.isArray(input.toolIds)?input.toolIds.map(String):(Array.isArray(input.tools)?input.tools.map(t=>String(t?.function?.name??t?.name??'')).filter(Boolean):[]);
      const chatGoal=String(input.goal??input.messages?.filter?.(m=>m?.role==='user').at(-1)?.content??'chat request');
      const taskPolicy=buildTaskPolicy({...input,goal:chatGoal,toolIds:requestedChatTools});
      input={...input,goal:chatGoal,toolIds:taskPolicy.effectiveToolIds,allowedToolIds:taskPolicy.effectiveToolIds};
      if (input.autoToolLoop === true) {
        if (config.executionMode !== 'tools-enabled') return send(res,503,{error:'tool_execution_not_verified',executionMode:config.executionMode,required:'tools-enabled'});
        const registeredNativeTools=(await toolsRegistry.list()).filter(t=>input.toolIds.includes(t.id)&&t.entry&&['ENABLED','VERIFIED'].includes(t.status));
        if (!registeredNativeTools.length) return send(res,400,{error:'no_registered_tool_allowed_for_task',taskProfile:taskPolicy.profileId,requestedToolIds:requestedChatTools});
        const toolDefinitions=registeredNativeTools.map(t=>({type:'function',function:{name:t.id,description:t.description??t.name,parameters:t.metadata?.toolSchema??{type:'object',properties:{}}}}));
        const toolBindings={...(input.toolBindings??{}),...Object.fromEntries(registeredNativeTools.map(t=>[t.id,{toolId:t.id}]))};
        const projectRoot=input.projectRoot?projectContext.root(input.projectRoot):null;
        const agentId=String(input.agent??input.persona??'code-guru');
        const agentPrepared=await agentRunner.prepare({agentId,personaId:agentId,goal:chatGoal,expectedOutcome:input.expectedOutcome,tools:input.toolIds});
        const route=await routeForAgent({...input,tools:toolDefinitions,allowJsonToolFallback:true},agentId);
        const systemMessage=buildSystemMessage({constitution:CORE_CONSTITUTION,agent:agentPrepared.agent,persona:agentPrepared.persona,goal:chatGoal,expectedOutcome:input.expectedOutcome,projectRoot,route,tools:input.toolIds,toolCatalog:registeredNativeTools});
        const prepared=await execution.prepare({...input,goal:chatGoal,toolIds:input.toolIds,allowedToolIds:input.allowedToolIds,consent:input.consent===true});
        if (!prepared.consent.allowed) return send(res,409,{error:'execution_consent_required',prepared});
        const executionContext=createExecutionContext({...input,applicationId:app.id,projectRoot,workingDirectory:input.workingDirectory??projectRoot,goal:chatGoal,expectedOutcome:input.expectedOutcome,providerId:route.providerId,model:route.model,publicModel:route.publicModel,modelMapping:route.agentMapping,transport:'http-chat'},runtimeIdentity);
        const loopInput={...input,tools:toolDefinitions,toolBindings,allowJsonToolFallback:true,executionContext,messages:[systemMessage,...(Array.isArray(input.messages)?input.messages:[])],stream:input.stream===true};
        if (input.stream===true) {
          res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
          const result=await toolLoop.stream({prepared,input:loopInput,applicationId:app.id,onChunk:chunk=>res.write(`data: ${JSON.stringify(chunk)}\n\n`),onEvent:event=>res.write(`event: runtime\ndata: ${JSON.stringify(event)}\n\n`)});
          res.write(`event: runtime\ndata: ${JSON.stringify({type:'complete',status:result.status,stoppedReason:result.stoppedReason,verified:result.verified})}\n\n`);res.write('data: [DONE]\n\n');res.end();return;
        }
        const result=await toolLoop.execute({prepared,input:loopInput,applicationId:app.id});
        requestState.outcome=result.status==='completed'?'observed_unverified':'incomplete';
        return send(res,200,{...(result.response??{choices:[{index:0,message:{role:'assistant',content:null},finish_reason:'tool_calls'}]}),meta:{runtime:'ZombieCoder',executionMode:config.executionMode,toolLoop:{status:result.status,stoppedReason:result.stoppedReason,rounds:result.rounds,verified:result.verified},taskPolicy}});
      }
      if (input.stream === true) {
        const streamContext = await contexts.resolve(input);
        const streamProjectRoot = input.projectRoot ? projectContext.root(input.projectRoot) : null;
        if (streamProjectRoot) await autoSetup.ensure(streamProjectRoot);
        const streamProject = streamProjectRoot ? await ssot.read(streamProjectRoot) : null;
        const streamMemory = streamProjectRoot ? await memory.recent(streamProjectRoot,10) : null;
        const streamSyllabus = streamProjectRoot ? await syllabus.read(streamProjectRoot) : null;
        const streamAgentId = String(input.agent ?? input.persona ?? 'code-guru');
        const streamGoal = String(input.goal ?? input.messages?.filter?.(m=>m?.role==='user').at(-1)?.content ?? 'chat request');
        const streamAgent = await agentRunner.prepare({agentId:streamAgentId,personaId:streamAgentId,goal:streamGoal,expectedOutcome:input.expectedOutcome,tools:input.toolIds});
        const streamSession = input.sessionId ? await sessionClient.resolve({sessionId:input.sessionId,applicationId:app.id}) : (input.createSession ? await sessionClient.resolve({applicationId:app.id,createIfMissing:true,userId:input.userId}) : null);
        const streamMetadata = {sessionSource:input.sessionSource ?? req.headers['x-session-source'] ?? 'api-stream',clientId:input.clientId ?? req.headers['x-client-id'] ?? null,editor:input.editor ?? req.headers['x-editor'] ?? null,editorVersion:input.editorVersion ?? req.headers['x-editor-version'] ?? null,clientVersion:input.clientVersion ?? req.headers['x-client-version'] ?? null,osPlatform:input.osPlatform ?? req.headers['x-os-platform'] ?? null,deviceInfo:input.deviceInfo ?? req.headers['x-device-info'] ?? null};
        if (streamSession) await sessions.updateMetadata(streamSession.id,app.id,Object.fromEntries(Object.entries(streamMetadata).filter(([,v])=>v != null && String(v).trim())));
        const currentStreamSession = streamSession ? await sessions.get(streamSession.id,app.id) : null;
        const route = await routeForAgent(input, streamAgentId);
        let providerId = route.providerId;
        let provider = await providers.resolve(providerId);
        let model = await providers.resolveModel(providerId, route.model || input.model);
        const streamArchiveForChat=streamSession ? await sessionState.archive(streamSession.id,app.id) : [];
        const streamEvidence=streamSession ? (await store.read('evidence',[])).filter(item=>item.contextId===streamSession.id).slice(-8) : [];
        const boundedChatStream=boundedConversation(input.messages,streamArchiveForChat,streamArchiveForChat,streamGoal);
        const streamUserMessage=latestUserMessage(input.messages,streamGoal);
        const userMessages = boundedChatStream.messages.length ? boundedChatStream.messages : [streamUserMessage];
        const streamCompiledContext=compileContext({goal:streamGoal,userInput:streamUserMessage.content,recent:userMessages,memory:streamMemory ?? [],ssot:streamProject,syllabus:streamSyllabus,projectRoot:streamProjectRoot,workingDirectory:input.workingDirectory ?? streamProjectRoot,sessionId:currentStreamSession?.id ?? input.sessionId ?? null,taskPolicy,evidence:streamEvidence,maxBytes:config.compiledContextBytes,recentLimit:config.contextRecentMessages});
        const systemMessage = buildSystemMessage({constitution:CORE_CONSTITUTION,agent:streamAgent.agent,persona:streamAgent.persona,goal:streamGoal,expectedOutcome:input.expectedOutcome,projectRoot:streamProjectRoot,ssot:streamProject,syllabus:streamSyllabus,memory:streamMemory,session:currentStreamSession,route,tools:input.toolIds,compiledContext:streamCompiledContext});
        input = {...input,provider:undefined,model,messages:[systemMessage,...userMessages],stream:true,sessionId:currentStreamSession?.id ?? input.sessionId};
        res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
        let streamText='';
        let streamToolCalls=[];
        let streamChunkCount=0;
        try {
          let streamSucceeded = false;
          let streamLastError = null;
          for (const candidate of route.candidates) {
            const beforeCandidateChunks = streamChunkCount;
            try {
              providerId = candidate.providerId;
              provider = await providers.resolve(providerId);
              model = await providers.resolveModel(providerId, route.publicModel ? candidate.model : (input.model || candidate.model));
              if (typeof provider.streamChat !== 'function') throw new Error('provider_streaming_not_supported');
              await provider.streamChat({...input, model, stream:true}, raw => {
                if (raw?.done === true && !raw?.choices) return;
                const canonicalInput = typeof provider.streamChunk === 'function' ? provider.streamChunk(raw) : raw;
                const chunk = canonicalInput?.choices ? normalizer.normalize(canonicalInput,{model,providerId:provider.id}) : null;
                if (chunk) {
                  streamChunkCount += 1;
                  const masked = maskCanonicalResponse(chunk,{agentId:streamAgent.agent?.id ?? streamAgentId,configuredModel:route.publicModel || '',capabilities:Object.keys(provider.capabilities ?? {}).filter(k=>provider.capabilities[k])});
                  const delta=masked?.choices?.[0]?.delta;
                  if (typeof delta?.content === 'string') streamText += delta.content;
                  if (Array.isArray(delta?.tool_calls)) streamToolCalls.push(...delta.tool_calls);
                  res.write(`data: ${JSON.stringify(masked)}\n\n`);
                }
              });
              if (streamChunkCount === beforeCandidateChunks) {
                // A 200 response without chunks is not a completed answer: retry via non-streaming.
                const fallbackRaw = await provider.chatCompletions({...input, model, stream:false});
                const fallbackInput = typeof provider.toCanonical === 'function' ? provider.toCanonical(fallbackRaw) : fallbackRaw;
                const fallbackCompletion = normalizer.normalize(fallbackInput,{model,providerId:provider.id});
                const fallbackChunk = normalizer.normalize(completionToStreamChunk(fallbackCompletion),{model,providerId:provider.id});
                const maskedFallback = maskCanonicalResponse(fallbackChunk,{agentId:streamAgent.agent?.id ?? streamAgentId,configuredModel:route.publicModel || '',capabilities:Object.keys(provider.capabilities ?? {}).filter(k=>provider.capabilities[k])});
                const delta = maskedFallback?.choices?.[0]?.delta;
                if (typeof delta?.content === 'string') streamText += delta.content;
                if (Array.isArray(delta?.tool_calls)) streamToolCalls.push(...delta.tool_calls);
                res.write(`data: ${JSON.stringify(maskedFallback)}\n\n`);
                streamChunkCount += 1;
              }
              streamSucceeded = true;
              break;
            } catch (error) {
              streamLastError = error;
              if (streamChunkCount > beforeCandidateChunks) throw error; // No replay after partial output.
              await requestLog.warn('provider.stream_candidate_failed',{routeId:route.routeId,providerId:candidate.providerId,model:candidate.model,error:String(error?.message ?? error)});
            }
          }
          if (!streamSucceeded) throw streamLastError ?? new Error('provider_stream_route_failed');
          if (currentStreamSession) {
            await evidenceGate.record({contextId:currentStreamSession.id,source:'provider:ZombieCoder',status:'observed',confidence:'direct-response',observedAt:new Date().toISOString(),summary:'Provider returned a streaming response; this is not execution verification'});
            await sessionState.append(currentStreamSession.id,app.id,streamUserMessage,{kind:'request'});
            await sessionState.append(currentStreamSession.id,app.id,{role:'assistant',content:streamText,...(streamToolCalls.length ? {tool_calls:streamToolCalls} : {})},{kind:'provider_response'});
          }
          res.write('data: [DONE]\n\n');
        } catch (e) {
          res.write(`event: error\ndata: ${JSON.stringify({error:'stream_failed',requestId})}\n\n`);
        } finally { res.end(); }
        return;
      }
      const context = await contexts.resolve(input);
      const projectRoot = input.projectRoot ? projectContext.root(input.projectRoot) : null;
      if (projectRoot) await autoSetup.ensure(projectRoot);
      const project = projectRoot ? await ssot.read(projectRoot) : null;
      const memoryDoc = projectRoot ? await memory.recent(projectRoot, 10) : null;
      const syllabusDoc = projectRoot ? await syllabus.read(projectRoot) : null;
      const entities = entityDoor.resolve(input);
      const personaId = String(input.agent ?? input.persona ?? 'code-guru');
      const goal = String(input.goal ?? input.messages?.filter?.(m=>m?.role==='user').at(-1)?.content ?? 'chat request');
      await requestLog.debug('agent.resolve.request', {applicationId:app.id,agentId:personaId,personaId,goalPresent:Boolean(input.goal),toolCount:Array.isArray(input.toolIds)?input.toolIds.length:0});
      const agentPrepared = await agentRunner.prepare({agentId:personaId,personaId,goal,expectedOutcome:input.expectedOutcome,tools:input.toolIds});
      const session = input.sessionId ? await sessionClient.resolve({sessionId:input.sessionId,applicationId:app.id}) : (input.createSession ? await sessionClient.resolve({applicationId:app.id,createIfMissing:true,userId:input.userId}) : null);
      const incomingMetadata = {
        sessionSource: input.sessionSource ?? req.headers['x-session-source'] ?? 'api',
        clientId: input.clientId ?? req.headers['x-client-id'] ?? null,
        editor: input.editor ?? req.headers['x-editor'] ?? null,
        editorVersion: input.editorVersion ?? req.headers['x-editor-version'] ?? null,
        clientVersion: input.clientVersion ?? req.headers['x-client-version'] ?? null,
        osPlatform: input.osPlatform ?? req.headers['x-os-platform'] ?? null,
        deviceInfo: input.deviceInfo ?? req.headers['x-device-info'] ?? null
      };
      if (session) await sessions.updateMetadata(session.id,app.id,Object.fromEntries(Object.entries(incomingMetadata).filter(([,v])=>v != null && String(v).trim())));
      const currentSession = session ? await sessions.get(session.id,app.id) : null;
      const route = await routeForAgent(input, personaId);
      let providerId = route.providerId;
      let provider = await providers.resolve(providerId);
      let model = await providers.resolveModel(providerId, route.model || input.model);
      const chatArchive=session ? await sessionState.archive(session.id,app.id) : [];
      const chatEvidence=session ? (await store.read('evidence',[])).filter(item=>item.contextId===session.id).slice(-8) : [];
      const boundedChat=boundedConversation(input.messages,chatArchive,chatArchive,goal);
      const sessionMessages = boundedChat.messages.length ? boundedChat.messages : [latestUserMessage(input.messages,goal)];
      const currentUserMessage = latestUserMessage(input.messages,goal);
      const compiledContext = compileContext({goal,userInput:currentUserMessage.content,recent:sessionMessages,memory:memoryDoc ?? [],ssot:project,syllabus:syllabusDoc,projectRoot,workingDirectory:input.workingDirectory ?? projectRoot,sessionId:currentSession?.id ?? input.sessionId ?? null,taskPolicy,maxBytes:config.compiledContextBytes,recentLimit:config.contextRecentMessages});
      await requestLog.debug('context.compiled',{applicationId:app.id,sessionId:currentSession?.id ?? null,projectRoot,workingDirectory:input.workingDirectory ?? projectRoot,ssotSections:compiledContext.ssot.sections.length,syllabusEntries:compiledContext.syllabus.length,memoryEntries:compiledContext.memory.length,recentMessages:compiledContext.recent.length,sessionMessages:sessionMessages.length,archiveSelected:boundedChat.archiveSelected,bytes:Buffer.byteLength(JSON.stringify(compiledContext))});
      const requestedToolIds = Array.isArray(input.toolIds) ? input.toolIds.map(String) : [];
      const allToolDefinitions = await toolsRegistry.list();
      const toolCatalog = allToolDefinitions.filter(tool => requestedToolIds.includes(String(tool.id)));
      const systemMessage = buildSystemMessage({constitution:CORE_CONSTITUTION,agent:agentPrepared.agent,persona:agentPrepared.persona,goal,expectedOutcome:input.expectedOutcome,projectRoot,ssot:project,syllabus:syllabusDoc,memory:memoryDoc,session:currentSession,route,tools:requestedToolIds,toolCatalog,compiledContext});
      const userMessages = sessionMessages;
      const providerMessages = [systemMessage,...userMessages];
      let result = null;
      let providerLastError = null;
      for (const candidate of route.candidates) {
        try {
          providerId = candidate.providerId;
          provider = await providers.resolve(providerId);
          model = await providers.resolveModel(providerId, route.publicModel ? candidate.model : (input.model || candidate.model));
          result = await provider.chatCompletions({...input,provider:undefined,model,messages:providerMessages,stream:false});
          break;
        } catch (error) {
          providerLastError = error;
          await requestLog.warn('provider.chat_candidate_failed',{routeId:route.routeId,providerId:candidate.providerId,model:candidate.model,error:String(error?.message ?? error)});
        }
      }
      if (result === null) throw providerLastError ?? new Error('provider_route_failed');
      const canonicalInput = typeof provider.toCanonical === 'function' ? provider.toCanonical(result) : result;
      const canonical = normalizer.normalize(canonicalInput,{model,providerId:provider.id});
      const masked = maskCanonicalResponse(canonical,{agentId:agentPrepared.agent?.id ?? personaId,configuredModel:route.publicModel || '',capabilities:Object.keys(provider.capabilities ?? {}).filter(k=>provider.capabilities[k])});
      const evidence=[{source:`provider:${provider.id}`,status:'observed',confidence:'direct-response',observedAt:new Date().toISOString(),summary:'Provider returned a response; this is not execution verification'}];
      if (currentSession) await evidenceGate.record({contextId:currentSession.id,...evidence[0]});
      const verificationRequired=Boolean(input.goal || input.projectRoot || input.toolIds || input.autoToolLoop);
      if (currentSession) {
        await sessionState.append(currentSession.id,app.id,currentUserMessage,{kind:'request'});
        const assistantMessage=masked?.choices?.[0]?.message ?? {role:'assistant',content:''};
        await sessionState.append(currentSession.id,app.id,{role:'assistant',content:assistantMessage.content ?? '',...(assistantMessage.tool_calls ? {tool_calls:assistantMessage.tool_calls} : {})},{kind:'provider_response'});
      }
      requestState.outcome = 'observed_unverified';
      await requestLog.info('chat.completed',{applicationId:app.id,agentId:agentPrepared.agent?.id,personaId:agentPrepared.persona?.id,providerId:provider.id,model,sessionId:currentSession?.id ?? null,evidenceStatus:'observed',verified:false,routeId:route.routeId,systemPromptInjected:true});
      return send(res,200,{...masked,applicationId:app.id,meta:{phase:RUNTIME_PHASE,taskPolicy,route:{routeId:route.routeId,providerId:'masked',model:route.publicModel || masked.model,publicModel:route.publicModel || masked.model,requiredCapabilities:route.requiredCapabilities,candidateCount:route.candidates.length,reason:route.reason,status:route.status},provider:{name:'ZombieCoder',id:'masked'},model:masked.model,session:currentSession,context,project,syllabus:syllabusDoc,memory:memoryDoc,entities,agent:agentPrepared.agent,persona:agentPrepared.persona,constitution:CORE_CONSTITUTION,sessionMetadata:currentSession?.metadata ?? incomingMetadata,systemPrompt:{injected:true,visibleToClient:false,contextCompiled:true},receivedMessages:Array.isArray(input.messages)?input.messages.length:0,evidence,verified:false,verificationRequired}});
    }
    if (req.method==='GET' && url.pathname==='/api/syllabus') {
      const root=url.searchParams.get('projectRoot')||config.dataDir; await autoSetup.ensure(root); const doc=await syllabus.read(root);
      return send(res,200,{ok:true,syllabus:doc?.content??'',path:path.join(root,'.zombiecoder','syllabus.md')});
    }
    if (req.method==='GET' && url.pathname==='/api/memory') {
      const root=url.searchParams.get('projectRoot')||config.dataDir; await autoSetup.ensure(root); const doc=await memory.read(root);
      return send(res,200,{ok:true,memory:doc,path:path.join(root,'.zombiecoder','memory.json')});
    }
    if (req.method==='POST' && url.pathname==='/api/workspace') {
      const app=await authenticateRequest(req,requestLog,requestState); if(!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input=await body(req,config.maxBodyBytes); const root=input.projectRoot||input.path||config.dataDir;
      return send(res,200,{success:true,applicationId:app.id,working_dir:root,setup:await autoSetup.ensure(root,{refreshSSOT:true}),ssot:await ssot.read(root)});
    }
    if (req.method==='POST' && url.pathname==='/api/syllabus') {
      const app=await authenticateRequest(req,requestLog,requestState); if(!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input=await body(req,config.maxBodyBytes); const root=input.projectRoot||config.dataDir;
      return send(res,201,{applicationId:app.id,entry:await syllabus.append(root,input)});
    }
    if (req.method==='POST' && url.pathname==='/api/input') {
      const app=await authenticateRequest(req,requestLog,requestState); if(!app) return send(res,401,{error:'application_unauthorized_or_expired'});
      const input=await body(req,config.maxBodyBytes);
      const goal=String(input.input||input.prompt||input.goal||input.messages?.filter?.(m=>m?.role==='user').at(-1)?.content||'chat request');
      const messages=Array.isArray(input.messages)?input.messages:[{role:'user',content:goal}];
      const result=await providerExecution.execute({prepared:{contract:{goal,expectedOutcome:input.expectedOutcome||'legacy chat response'},consent:{allowed:true}},input:{...input,applicationId:app.id,messages,sessionId:input.sessionId||null}});
      const canonical=result.response;
      return send(res,200,{status:'ok',response:canonical,content:canonical?.choices?.[0]?.message?.content??null,model:canonical?.model??result.model,session_id:input.sessionId||null,evidence:result.evidence,verified:false,legacyCompatibility:true});
    }
    if (req.method==='GET' && (url.pathname==='/admin' || url.pathname==='/admin/')) {
      const html=await readFile(path.resolve('public/admin/index.html'),'utf8');
      res.setHeader('content-security-policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
      res.setHeader('x-content-type-options','nosniff');
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",'x-content-type-options':'nosniff'});
      res.end(html);
      return;
    }
    if (req.method==='GET' && url.pathname==='/v1/admin/routes') {
      if(!adminOk(req)) return send(res,401,{error:'admin_unauthorized'});
      return send(res,200,routeMapReport());
    }
    return send(res,404,{error:'not_found'});
  } catch (e) {
    const publicErrors = new Set(['runtime_instance_already_locked','uds_path_already_exists','tool_not_permitted','tool_entry_outside_tool_root','tool_entry_symlink_escape','execution_path_outside_project_root','execution_working_directory_outside_project_root','execution_path_symlink_escape','project_root_required','invalid_json_body','request_body_too_large','application_unauthorized_or_expired','admin_unauthorized','provider_not_found_or_disabled','provider_model_required','provider_model_disabled','provider_model_not_found','mapping_provider_and_model_required','mapping_provider_not_found_or_disabled','mapping_model_not_found','mapping_model_disabled','provider_catalog_sync_url_required','agent_not_found','persona_not_found','persona_not_found_or_disabled','no_provider_route_available','provider_streaming_not_supported','execution_consent_required','execution_contract_required','qualified_tool_required','mcp_tool_not_permitted','mcp_https_url_required','mcp_endpoint_not_found','mcp_tool_not_found','mcp_tool_arguments_must_be_object','mcp_response_too_large','mcp_invalid_response','mcp_timeout','project_root_not_allowed','project_root_not_found','application_id_required','application_not_found','application_id_and_tool_required','tool_disabled_by_configuration','outbound_circuit_open']);
    const message = String(e?.message ?? 'request_failed');
    await requestLog.error('http.error', {error:message,name:e?.name ?? 'Error',statusCode:e?.statusCode ?? null,retryAfterMs:e?.retryAfterMs ?? null});
    const statusCode = message === 'outbound_circuit_open' ? 503 : (Number(e?.statusCode) || 400);
    const headers = message === 'outbound_circuit_open' ? {'retry-after': String(Math.max(1, Math.ceil((Number(e?.retryAfterMs) || 0) / 1000)))} : {};
    return send(res, statusCode, {error: publicErrors.has(message) ? message : 'request_failed', requestId, ...(message === 'outbound_circuit_open' ? {retryAfterMs:e.retryAfterMs} : {})}, headers);
  }
};

const transportServers = await startTransportServers({handler:requestHandler, config, logger, runtimeIdentity});
await logger.info('runtime.started', {version:RUNTIME_VERSION,phase:RUNTIME_PHASE,nodeVersion:process.versions.node,host:config.host,port:config.port,runtimeId:runtimeIdentity.runtimeId,instanceId:runtimeIdentity.instanceId,executionMode:config.executionMode,authMode:localAuthBypassActive?'local-no-token':'token-required',adminAuthConfigured:Boolean(config.adminToken),providerCount:(await providers.list()).length,providers:(await providers.list()).map(p=>({id:p.id,enabled:p.enabled!==false,priority:p.priority,modelCount:Array.isArray(p.models)?p.models.length:0,defaultModel:p.defaultModel||null})),localMcpFallback:localMcpFallback.results,transports:Object.fromEntries(Object.entries(transportServers).map(([key,server])=>[key,Boolean(server)])),sse:'http-response-mode'});

process.on('SIGINT', async () => { await stopTransportServers(transportServers); await localMcpFallback.stop(); await releaseRuntimeLock(); process.exit(0); });
process.on('SIGTERM', async () => { await stopTransportServers(transportServers); await localMcpFallback.stop(); await releaseRuntimeLock(); process.exit(0); });
