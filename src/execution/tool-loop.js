import { extractToolCalls, toolCallSignature, createToolResultMessage, createToolErrorMessage } from './tool-call.js';
import { SmartRouter } from '../providers/router/smart-router.js';
import { maskCanonicalResponse } from '../providers/masking/provider-mask.js';
import { buildTaskPolicy } from './task-policy.js';
import { ExecutionLifecycle } from './lifecycle.js';
import { completionToStreamChunk } from '../providers/normalizer/stream-chunk.js';

const DEFAULT_MAX_ROUNDS = 8;
const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 8;
const DEFAULT_MAX_REPEATED_CALLS = 2;

function normalizeBindings(bindings = {}) {
  if (Array.isArray(bindings)) {
    return Object.fromEntries(bindings.map(item => [String(item.name ?? ''), item]).filter(([name]) => name));
  }
  return bindings && typeof bindings === 'object' ? bindings : {};
}

function bindingFor(call, bindings) {
  const binding = bindings[call.name];
  if (!binding) throw new Error(`tool_call_not_bound:${call.name}`);
  if (binding.toolId) return {toolId: String(binding.toolId)};
  if (binding.qualifiedName) return {qualifiedName: String(binding.qualifiedName), executionTarget: 'mcp'};
  throw new Error(`tool_call_binding_invalid:${call.name}`);
}

export class ToolLoopExecutor {
  constructor({providers, executionAdapter, normalizer, evidenceGate, sessionState = null, logger = null, router = null, lifecycle = null, maxRounds = DEFAULT_MAX_ROUNDS, maxToolCallsPerRound = DEFAULT_MAX_TOOL_CALLS_PER_ROUND, maxRepeatedCalls = DEFAULT_MAX_REPEATED_CALLS} = {}) {
    this.providers = providers;
    this.router = router ?? new SmartRouter({providers, logger});
    this.executionAdapter = executionAdapter;
    this.normalizer = normalizer;
    this.evidenceGate = evidenceGate;
    this.sessionState = sessionState;
    this.logger = logger;
    this.lifecycle = lifecycle ?? new ExecutionLifecycle({evidenceGate, normalizer, logger});
    this.maxRounds = Math.max(1, Number(maxRounds) || DEFAULT_MAX_ROUNDS);
    this.maxToolCallsPerRound = Math.max(1, Number(maxToolCallsPerRound) || DEFAULT_MAX_TOOL_CALLS_PER_ROUND);
    this.maxRepeatedCalls = Math.max(1, Number(maxRepeatedCalls) || DEFAULT_MAX_REPEATED_CALLS);
  }

  async _messages(input, applicationId) {
    const sessionId = input.sessionId ?? null;
    if (!sessionId || !this.sessionState) return Array.isArray(input.messages) ? structuredClone(input.messages) : [];
    const history = await this.sessionState.list(sessionId, applicationId);
    const incoming = Array.isArray(input.messages) ? structuredClone(input.messages) : [];
    return [...history, ...incoming];
  }

  async _persist(sessionId, applicationId, messages, kind) {
    if (!sessionId || !this.sessionState) return;
    await this.sessionState.appendMany(sessionId, applicationId, messages, {kind});
  }

  async execute({prepared, input = {}, applicationId, onEvent} = {}) {
    if (!prepared?.consent?.allowed) throw new Error('execution_consent_required');
    if (!prepared?.contract?.goal) throw new Error('execution_contract_required');
    if (!applicationId) throw new Error('application_id_required');

    const mapping=input.executionContext?.modelMapping;
    const routeInput=mapping?.enabled?{...input,provider:mapping.providerId,model:mapping.model}:input;
    const route = await this.router.route({...routeInput, allowJsonToolFallback:input.allowJsonToolFallback !== false});
    if(mapping?.enabled) route.publicModel=mapping.publicModel||'';
    const candidates = route.candidates;
    let candidateIndex = 0;
    let providerId = candidates[0].providerId;
    let provider = await this.providers.resolve(providerId);
    let model = await this.providers.resolveModel(providerId, route.publicModel ? candidates[0].model : (input.model || candidates[0].model));
    const messages = await this._messages(input, applicationId);
    await this.lifecycle.begin({sessionId:input.sessionId ?? null, applicationId, messages});
    await this.logger?.info?.('tool_loop.started', {applicationId,providerId:provider.id,model,maxRounds:this.maxRounds,maxToolCallsPerRound:this.maxToolCallsPerRound,maxRepeatedCalls:this.maxRepeatedCalls,agentId:input.agent ?? input.persona ?? 'code-guru',personaId:input.persona ?? input.agent ?? 'code-guru',sessionId:input.sessionId ?? null});
    const incoming = Array.isArray(input.messages) ? structuredClone(input.messages) : [];
    if (input.sessionId && this.sessionState && incoming.length) {
      await this._persist(input.sessionId, applicationId, incoming, 'user');
    }
    if (!messages.length) messages.push({role:'user', content:prepared.contract.goal});

    const bindings = normalizeBindings(input.toolBindings);
    const taskPolicy = buildTaskPolicy(input);
    const allowedToolIds = new Set(Array.isArray(input.allowedToolIds) ? input.allowedToolIds.map(String) : taskPolicy.effectiveToolIds.map(String));
    const enforceTaskSurface = Array.isArray(input.allowedToolIds) || Array.isArray(input.toolIds);
    const repeated = new Map();
    const rounds = [];
    const evidence = [];
    let finalResponse = null;
    let stoppedReason = null;

    for (let round = 1; round <= this.maxRounds; round += 1) {
      const request = {
        ...input,
        messages,
        model,
        stream: false,
        tools: provider.capabilities?.functionCalling === true && input.forceJsonToolCalls !== true ? input.tools : undefined,
      };
      await this.logger?.info?.('tool_loop.round.started', {round,providerId:provider.id,model,messageCount:messages.length});
      let canonicalInput;
      let raw;
      while (true) {
        try {
          raw = await provider.chatCompletions(request);
          canonicalInput = typeof provider.toCanonical === 'function' ? provider.toCanonical(raw) : raw;
          break;
        } catch (error) {
          if (candidateIndex >= candidates.length - 1) throw error;
          await this.lifecycle.providerFailure({sessionId:input.sessionId ?? null,applicationId,providerId:provider.id,model,error,attempt:candidateIndex+1,remainingCandidates:candidates.length-candidateIndex-1});
          candidateIndex += 1;
          providerId = candidates[candidateIndex].providerId;
          provider = await this.providers.resolve(providerId);
          model = await this.providers.resolveModel(providerId, route.publicModel ? candidates[candidateIndex].model : (input.model || candidates[candidateIndex].model));
          request.model = model;
          request.tools = provider.capabilities?.functionCalling === true && input.forceJsonToolCalls !== true ? input.tools : undefined;
        }
      }
      const response = this.normalizer.normalize(canonicalInput, {model, providerId:provider.id});
      const maskedResponse = maskCanonicalResponse(response,{agentId:input.agent ?? input.persona ?? 'code-guru',configuredModel:route.publicModel || '',capabilities:Object.keys(provider.capabilities ?? {}).filter(k=>provider.capabilities[k])});
      finalResponse = maskedResponse;
      const assistantMessage = response?.choices?.[0]?.message ?? null;
      if (!assistantMessage) throw new Error('provider_assistant_message_missing');
      await this._persist(input.sessionId, applicationId, [assistantMessage], 'assistant');
      onEvent?.({type:'assistant', round, response:maskedResponse});

      const calls = extractToolCalls(response);
      rounds.push({round, toolCalls: calls.map(call => ({id:call.id,name:call.name,arguments:call.arguments}))});
      await this.logger?.info?.('tool_loop.round.provider_result', {round,toolCallCount:calls.length,finishReason:assistantMessage.finish_reason ?? null});
      if (!calls.length) break;
      if (!input.autoToolLoop) { stoppedReason = 'tool_calls_present_auto_loop_disabled'; break; }
      if (calls.length > this.maxToolCallsPerRound) { stoppedReason = 'max_tool_calls_per_round'; break; }

      messages.push(assistantMessage);
      for (const call of calls) {
        const signature = toolCallSignature(call);
        const count = (repeated.get(signature) ?? 0) + 1;
        repeated.set(signature, count);
        if (count > this.maxRepeatedCalls) {
          stoppedReason = 'repeated_tool_call_limit';
          break;
        }

        let resultMessage;
        await this.logger?.info?.('tool_loop.tool_call.started', {round,toolCallId:call.id,toolName:call.name,signature});
        try {
          const target = bindingFor(call, bindings);
          if (enforceTaskSurface) {
            const targetId = target.toolId ?? target.qualifiedName;
            if (!allowedToolIds.has(String(targetId))) throw new Error(`tool_call_outside_task_surface:${String(targetId)}`);
          }
          const result = await this.executionAdapter.execute({prepared, input:{...target, arguments:call.arguments, requestId:`tool-loop-${round}-${call.id}`, sessionId:input.sessionId, runtimeId:input.runtimeId, clientId:input.clientId, connectionId:input.connectionId}, applicationId,context:input.executionContext});
          const item = await this.lifecycle.toolObserved({sessionId:input.sessionId ?? null,applicationId,toolId:call.name});
          evidence.push(item);
          resultMessage = createToolResultMessage(call, result.result ?? result);
          onEvent?.({type:'tool_result', round, toolCall:call, result});
          await this.logger?.info?.('tool_loop.tool_call.completed', {round,toolCallId:call.id,toolName:call.name,resultStatus:result?.status ?? null,evidenceStatus:'observed'});
        } catch (error) {
          const item = {source:`tool:${call.name}`,status:'observed',confidence:'execution-error',observedAt:new Date().toISOString(),summary:`Tool execution error: ${String(error?.message ?? error)}`};
          evidence.push(item);
          if (this.evidenceGate) await this.evidenceGate.record(item);
          resultMessage = createToolErrorMessage(call, error);
          onEvent?.({type:'tool_error', round, toolCall:call, error:String(error?.message ?? error)});
          await this.logger?.error?.('tool_loop.tool_call.failed', {round,toolCallId:call.id,toolName:call.name,error:String(error?.message ?? error)});
        }
        messages.push(resultMessage);
        await this._persist(input.sessionId, applicationId, [resultMessage], 'tool');
      }
      if (stoppedReason) break;
    }

    if (!stoppedReason && finalResponse?.choices?.[0]?.message?.tool_calls?.length) stoppedReason = 'max_rounds';
    const verified = this.evidenceGate ? this.evidenceGate.canClaimSuccess(evidence) : false;
    await this.logger?.info?.('tool_loop.completed', {applicationId,providerId:provider.id,model,status:stoppedReason ? 'incomplete' : 'completed',stoppedReason,rounds:rounds.length,evidenceCount:evidence.length,verified});
    return {
      status: stoppedReason ? 'incomplete' : 'completed',
      stoppedReason,
      providerId: provider.id,
      model,
      response: finalResponse,
      rounds,
      evidence,
      verified,
    };
  }

  async stream({prepared, input = {}, applicationId, onChunk, onEvent} = {}) {
    if (!prepared?.consent?.allowed) throw new Error('execution_consent_required');
    if (!prepared?.contract?.goal) throw new Error('execution_contract_required');
    if (!applicationId) throw new Error('application_id_required');

    const mapping=input.executionContext?.modelMapping;
    const routeInput=mapping?.enabled?{...input,provider:mapping.providerId,model:mapping.model}:input;
    const route = await this.router.route({...routeInput, allowJsonToolFallback:input.allowJsonToolFallback !== false});
    if(mapping?.enabled) route.publicModel=mapping.publicModel||'';
    const providerId = route.providerId;
    const provider = await this.providers.resolve(providerId);
    const model = await this.providers.resolveModel(providerId, route.publicModel ? route.model : (input.model || route.model));
    const messages = await this._messages(input, applicationId);
    await this.logger?.info?.('tool_loop.stream.started', {applicationId,providerId:provider.id,model,maxRounds:this.maxRounds,agentId:input.agent ?? input.persona ?? 'code-guru',personaId:input.persona ?? input.agent ?? 'code-guru',sessionId:input.sessionId ?? null});
    const incoming = Array.isArray(input.messages) ? structuredClone(input.messages) : [];
    if (input.sessionId && this.sessionState && incoming.length) {
      await this._persist(input.sessionId, applicationId, incoming, 'user');
    }
    if (!messages.length) messages.push({role:'user', content:prepared.contract.goal});

    const bindings = normalizeBindings(input.toolBindings);
    const taskPolicy = buildTaskPolicy(input);
    const allowedToolIds = new Set(Array.isArray(input.allowedToolIds) ? input.allowedToolIds.map(String) : taskPolicy.effectiveToolIds.map(String));
    const enforceTaskSurface = Array.isArray(input.allowedToolIds) || Array.isArray(input.toolIds);
    const repeated = new Map();
    const rounds = [];
    const evidence = [];
    let finalResponse = null;
    let stoppedReason = null;

    for (let round = 1; round <= this.maxRounds; round += 1) {
      if (typeof provider.streamChat !== 'function') throw new Error('provider_streaming_not_supported');
      const chunks = [];
      await this.logger?.info?.('tool_loop.stream.round.started', {round,providerId:provider.id,model});
      await provider.streamChat({...input, tools:provider.capabilities?.functionCalling === true && input.forceJsonToolCalls !== true ? input.tools : undefined, messages, model, stream:true}, raw => {
        if (raw?.done === true && !raw?.choices) return;
        const canonicalInput = typeof provider.streamChunk === 'function' ? provider.streamChunk(raw) : raw;
        if (!canonicalInput?.choices) return;
        const chunk = this.normalizer.normalize(canonicalInput, {model, providerId:provider.id});
        const maskedChunk = maskCanonicalResponse(chunk,{agentId:input.agent ?? input.persona ?? 'code-guru',configuredModel:route.publicModel || '',capabilities:Object.keys(provider.capabilities ?? {}).filter(k=>provider.capabilities[k])});
        chunks.push(chunk);
        onChunk?.(maskedChunk);
        onEvent?.({type:'stream_chunk', round, chunk:maskedChunk});
      });
      if (!chunks.length) {
        const raw = await provider.chatCompletions({...input, tools:provider.capabilities?.functionCalling === true && input.forceJsonToolCalls !== true ? input.tools : undefined, messages, model, stream:false});
        const canonicalInput = typeof provider.toCanonical === 'function' ? provider.toCanonical(raw) : raw;
        const completion = this.normalizer.normalize(canonicalInput, {model, providerId:provider.id});
        const fallback = this.normalizer.normalize(completionToStreamChunk(completion), {model, providerId:provider.id});
        chunks.push(fallback);
        const maskedChunk = maskCanonicalResponse(fallback,{agentId:input.agent ?? input.persona ?? 'code-guru',configuredModel:route.publicModel || '',capabilities:Object.keys(provider.capabilities ?? {}).filter(k=>provider.capabilities[k])});
        onChunk?.(maskedChunk);
        onEvent?.({type:'stream_chunk',round,chunk:maskedChunk,fallback:'non-streaming-provider-response'});
      }

      const assistantMessage = assembleStreamAssistant(chunks);
      const rawFinalResponse = {
        id: chunks[0]?.id ?? `stream_${Date.now()}`,
        object: 'chat.completion',
        model,
        provider: provider.id,
        choices: [{index:0,message:assistantMessage,finish_reason:assistantMessage.finish_reason ?? null}]
      };
      finalResponse = maskCanonicalResponse(rawFinalResponse,{agentId:input.agent ?? input.persona ?? 'code-guru',configuredModel:route.publicModel || '',capabilities:Object.keys(provider.capabilities ?? {}).filter(k=>provider.capabilities[k])});
      await this._persist(input.sessionId, applicationId, [assistantMessage], 'assistant');
      const calls = extractToolCalls(finalResponse);
      await this.logger?.info?.('tool_loop.stream.round.provider_result', {round,toolCallCount:calls.length});
      rounds.push({round, toolCalls:calls.map(call => ({id:call.id,name:call.name,arguments:call.arguments}))});
      if (!calls.length) break;
      if (!input.autoToolLoop) { stoppedReason='tool_calls_present_auto_loop_disabled'; break; }
      if (calls.length > this.maxToolCallsPerRound) { stoppedReason='max_tool_calls_per_round'; break; }

      messages.push(assistantMessage);
      for (const call of calls) {
        const signature = toolCallSignature(call);
        const count=(repeated.get(signature) ?? 0)+1;
        repeated.set(signature,count);
        if (count > this.maxRepeatedCalls) { stoppedReason='repeated_tool_call_limit'; break; }
        let resultMessage;
        try {
          const target=bindingFor(call,bindings);
          if(enforceTaskSurface){const targetId=target.toolId??target.qualifiedName;if(!allowedToolIds.has(String(targetId)))throw new Error(`tool_call_outside_task_surface:${String(targetId)}`)}
          const result=await this.executionAdapter.execute({prepared,input:{...target,arguments:call.arguments,requestId:`tool-stream-loop-${round}-${call.id}`,sessionId:input.sessionId,runtimeId:input.runtimeId,clientId:input.clientId,connectionId:input.connectionId},applicationId,context:input.executionContext});
          const item={source:`tool:${call.name}`,status:'observed',confidence:'direct-execution-return',observedAt:new Date().toISOString(),summary:'Tool execution returned a result'};
          evidence.push(item);
          if(this.evidenceGate) await this.evidenceGate.record(item);
          resultMessage=createToolResultMessage(call,result.result ?? result);
          onEvent?.({type:'tool_result',round,toolCall:call,result});
        } catch(error) {
          const item={source:`tool:${call.name}`,status:'observed',confidence:'execution-error',observedAt:new Date().toISOString(),summary:`Tool execution error: ${String(error?.message ?? error)}`};
          evidence.push(item);
          if(this.evidenceGate) await this.evidenceGate.record(item);
          resultMessage=createToolErrorMessage(call,error);
          onEvent?.({type:'tool_error',round,toolCall:call,error:String(error?.message ?? error)});
        }
        messages.push(resultMessage);
        await this._persist(input.sessionId,applicationId,[resultMessage],'tool');
      }
      if(stoppedReason) break;
    }
    if(!stoppedReason && finalResponse?.choices?.[0]?.message?.tool_calls?.length) stoppedReason='max_rounds';
    const verified=this.evidenceGate ? this.evidenceGate.canClaimSuccess(evidence) : false;
    await this.logger?.info?.('tool_loop.stream.completed', {applicationId,providerId:provider.id,model,status:stoppedReason?'incomplete':'completed',stoppedReason,rounds:rounds.length,evidenceCount:evidence.length,verified});
    return {status:stoppedReason?'incomplete':'completed',stoppedReason,providerId:provider.id,model,response:finalResponse,rounds,evidence,verified};
  }

}

export function assembleStreamToolCalls(chunks = []) {
  const calls = new Map();
  for (const chunk of chunks) {
    for (const delta of chunk?.choices?.[0]?.delta?.tool_calls ?? []) {
      const index = Number(delta.index ?? 0);
      const current = calls.get(index) ?? {id:'',type:'function',function:{name:'',arguments:''}};
      if (delta.id) current.id = String(delta.id);
      if (delta.type) current.type = delta.type;
      if (delta.function?.name) current.function.name += String(delta.function.name);
      if (delta.function?.arguments) current.function.arguments += String(delta.function.arguments);
      calls.set(index, current);
    }
  }
  return [...calls.entries()].sort((a,b)=>a[0]-b[0]).map(([,call])=>call);
}

export function assembleStreamAssistant(chunks = []) {
  const first = chunks.find(Boolean)?.choices?.[0] ?? {};
  const last = [...chunks].reverse().find(Boolean)?.choices?.[0] ?? {};
  const content = chunks.map(chunk => chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content ?? '').filter(Boolean).join('');
  const toolCalls = assembleStreamToolCalls(chunks);
  return {
    role: 'assistant',
    content: content || null,
    ...(toolCalls.length ? {tool_calls: toolCalls} : {}),
    ...(last.finish_reason != null ? {finish_reason:last.finish_reason} : {}),
    index: first.index ?? 0,
  };
}
