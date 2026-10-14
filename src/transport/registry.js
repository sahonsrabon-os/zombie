import { ComponentRegistry } from '../registry/catalog.js';

const DEFAULT_TRANSPORTS = [
  {id:'http', name:'HTTP', version:'1.0.0', capabilities:['request-response'], status:'VERIFIED', source:'runtime-contract'},
  {id:'https', name:'HTTPS', version:'1.0.0', capabilities:['request-response','encrypted-transport'], status:'UNVERIFIED', source:'runtime-contract'},
  {id:'uds', name:'Unix Domain Socket', version:'1.0.0', capabilities:['local-ipc'], status:'VERIFIED', source:'runtime-contract'},
  {id:'sse', name:'Server-Sent Events', version:'1.0.0', capabilities:['streaming'], status:'VERIFIED', source:'runtime-contract'},
  {id:'websocket', name:'WebSocket', version:'1.0.0', capabilities:['bidirectional-streaming'], status:'NOT_IMPLEMENTED', source:'legacy-api-feature-inventory'}
];

export class TransportRegistry extends ComponentRegistry {
  constructor(store) {
    super(store, {collection:'transports', type:'transport', defaults:DEFAULT_TRANSPORTS});
  }
}
