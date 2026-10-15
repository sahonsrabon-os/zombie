import { loadEnvFile } from './env-loader.js';

export const envLoadResult = loadEnvFile();
export function env(name, fallback = undefined) { return process.env[name] ?? fallback; }

function numberEnv(name, fallback, {min = null, max = null} = {}) {
  const raw = env(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (min !== null && value < min) return fallback;
  if (max !== null && value > max) return fallback;
  return value;
}

function portEnv() {
  const raw=String(env('PORT','')??'').trim();
  if(!raw) return 3000;
  const value=Number(raw);
  if(!Number.isInteger(value)||value<1||value>65535) throw new Error('PORT_invalid_expected_integer_1_to_65535');
  return value;
}

function listEnv(name) {
  return env(name, '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}

function pathListEnv(name) {
  return env(name, '').split(',').map(x => x.trim()).filter(Boolean);
}

export const config = {
  host: env('HOST', '127.0.0.1') || '127.0.0.1',
  port: portEnv(),
  https: {
    enabled: env('HTTPS_ENABLED', 'false') === 'true',
    required: env('HTTPS_REQUIRED', 'false') === 'true',
    host: env('HTTPS_HOST', env('HOST', '127.0.0.1')) || '127.0.0.1',
    port: numberEnv('HTTPS_PORT', 10443, {min:1,max:65535}),
    key: env('HTTPS_KEY', './certs/server.key'),
    cert: env('HTTPS_CERT', './certs/server.crt')
  },
  runtimeId: env('RUNTIME_ID', ''),
  instanceId: env('INSTANCE_ID', ''),
  uds: {
    enabled: env('UDS_ENABLED', process.platform === 'win32' ? 'false' : 'true') === 'true',
    required: env('UDS_REQUIRED', 'false') === 'true',
    path: env('UDS_PATH', './data/runtime.sock')
  },
  adminToken: env('ADMIN_TOKEN', ''),
  localAuthBypass: env('LOCAL_AUTH_BYPASS', 'false') === 'true',
  runtimeSecret: env('RUNTIME_SECRET', ''),
  dataDir: env('DATA_DIR', './data'),
  sqlitePath: env('SQLITE_PATH', './data/runtime.sqlite'),
  migrateJsonOnStart: env('MIGRATE_JSON_ON_START', 'false') === 'true',
  allowPlaintextHttp: env('ALLOW_PLAINTEXT_HTTP', 'false') === 'true',
  // Tool execution remains disabled until the local deployment verification loop passes.
  executionMode: ['tools-enabled', 'chat-only'].includes(env('ZOMBIECODER_EXECUTION_MODE', 'chat-only')) ? env('ZOMBIECODER_EXECUTION_MODE', 'chat-only') : 'chat-only',
  ollamaBaseUrl: env('OLLAMA_BASE_URL', 'http://127.0.0.1:11434/v1'),
  providerCatalogSyncUrl: env('PROVIDER_CATALOG_SYNC_URL', ''),
  providerCatalogSyncOnStart: env('PROVIDER_CATALOG_SYNC_ON_START', 'true') === 'true',
  providerModelsRefreshOnStart: env('PROVIDER_MODELS_REFRESH_ON_START', 'false') === 'true',
  providerCatalogApiKey: env('PROVIDER_CATALOG_API_KEY', ''),
  providerSyncTimeoutMs: numberEnv('PROVIDER_SYNC_TIMEOUT_MS', 30000, {min:1000,max:120000}),
  toolRoot: env('TOOL_ROOT', './tools'),
  toolLoopMaxRounds: numberEnv('TOOL_LOOP_MAX_ROUNDS', 8, {min:1,max:100}),
  toolLoopMaxToolCallsPerRound: numberEnv('TOOL_LOOP_MAX_TOOL_CALLS_PER_ROUND', 8, {min:1,max:100}),
  toolLoopMaxRepeatedCalls: numberEnv('TOOL_LOOP_MAX_REPEATED_CALLS', 2, {min:1,max:100}),
  sessionMaxMessages: numberEnv('SESSION_MAX_MESSAGES', 100, {min:1,max:10000}),
  contextBudgetBytes: numberEnv('CONTEXT_BUDGET_BYTES', 1024 * 1024, {min:64 * 1024,max:4 * 1024 * 1024}),
  compiledContextBytes: numberEnv('COMPILED_CONTEXT_BYTES', 192 * 1024, {min:32 * 1024,max:1024 * 1024}),
  contextRecentMessages: numberEnv('CONTEXT_RECENT_MESSAGES', 10, {min:1,max:50}),
  memoryMaxEntries: numberEnv('MEMORY_MAX_ENTRIES', 500, {min:1,max:100000}),
  maxBodyBytes: numberEnv('MAX_BODY_BYTES', 4 * 1024 * 1024, {min:1024,max:32 * 1024 * 1024}),
  maxProviderResponseBytes: numberEnv('MAX_PROVIDER_RESPONSE_BYTES', 4 * 1024 * 1024, {min:1024,max:32 * 1024 * 1024}),
  projectRoots: pathListEnv('PROJECT_ROOTS'),
  appRateLimit: numberEnv('APP_RATE_LIMIT', 60, {min:1,max:100000}),
  appConcurrency: numberEnv('APP_CONCURRENCY', 4, {min:1,max:1000}),
  logLevel: env('LOG_LEVEL', 'info'),
  logDir: env('LOG_DIR', './logs'),
  logFile: env('LOG_FILE', 'runtime.jsonl'),
  logToStdout: env('LOG_TO_STDOUT', 'true') !== 'false',
  logMaxBytes: numberEnv('LOG_MAX_BYTES', 10 * 1024 * 1024, {min:1024}),
  logMaxFiles: numberEnv('LOG_MAX_FILES', 7, {min:1,max:100}),
  logPayloads: env('LOG_PAYLOADS', 'false') === 'true',
  circuitBreaker: {
    failureThreshold: numberEnv('CIRCUIT_FAILURE_THRESHOLD', 3, {min:1,max:100}),
    resetTimeoutMs: numberEnv('CIRCUIT_RESET_TIMEOUT_MS', 15000, {min:100,max:3600000}),
    halfOpenMaxCalls: numberEnv('CIRCUIT_HALF_OPEN_MAX_CALLS', 1, {min:1,max:10})
  },
  mcpNetworkPolicy: {
    allowHttp: env('MCP_ALLOW_HTTP', 'false') === 'true',
    allowPrivateNetwork: env('MCP_ALLOW_PRIVATE_NETWORK', 'false') === 'true',
    allowHosts: listEnv('MCP_ALLOW_HOSTS'),
  },
  localMcpFallbackEnabled: env('LOCAL_MCP_FALLBACK_ENABLED', 'false') === 'true',
  providerNetworkPolicy: {
    allowPlaintextHttp: env('ALLOW_PLAINTEXT_HTTP', 'false') === 'true',
    allowPrivateNetwork: env('PROVIDER_ALLOW_PRIVATE_NETWORK', 'false') === 'true',
    allowPrivateHosts: listEnv('PROVIDER_ALLOW_PRIVATE_HOSTS'),
    allowHosts: listEnv('PROVIDER_ALLOW_HOSTS'),
    maxResponseBytes: numberEnv('MAX_PROVIDER_RESPONSE_BYTES', 4 * 1024 * 1024, {min:1024,max:32 * 1024 * 1024})
  },
  providerApiKeys: Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => key.startsWith('PROVIDER_KEY_'))
    .map(([key, value]) => [key.slice('PROVIDER_KEY_'.length).toLowerCase().replace(/_/g, '-'), value]))
};
