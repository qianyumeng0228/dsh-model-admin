/**
 * Host-module stubs for the integration check.
 *
 * The vendored channel pack imports four host-provided modules
 * (`@deepseek-ai/dsh-llm`, `dsh-credentials`, `cordis`, `schemastery`).
 * Inside the real DSH process the host supplies them; a standalone check
 * cannot. These stubs cover exactly the surface the pack touches at mount
 * time, so the integration check can run `pack.apply` for real instead of
 * trusting a mock.
 *
 * The stubs are deliberately dumb: they record calls and answer benign
 * empties. What the check verifies is the SEAM — the pack mounts, registers
 * its RPC, and answers in the vocabulary dsh-model-admin decodes — not the
 * upstream network, which needs real credentials.
 */

/** cordis `Service`: a disposable plugin base class. */
export class Service {
  constructor(...args) {
    this.args = args
    this.disposables = []
  }
  effect(fn, label) {
    const dispose = typeof fn === 'function' ? fn() : undefined
    this.disposables.push({ label, dispose })
    return dispose
  }
  provide(name, value) {
    this[name] = value
  }
  get(name) {
    return this[name]
  }
  set(name, value) {
    this[name] = value
  }
  dispose() {
    for (const entry of this.disposables) {
      try {
        entry.dispose?.()
      } catch { /* a stub never blocks teardown */ }
    }
    this.disposables = []
  }
}

/** dsh-llm error classes: the pack catches them by instanceof. */
export class LlmError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'LlmError'
    this.code = code
  }
}
for (let i = 2; i <= 18; i += 1) {
  const name = `LlmError${i}`
  const cls = class extends LlmError {}
  Object.defineProperty(cls, 'name', { value: name })
  // Exported under the mangled name the bundle expects.
  Object.defineProperty(globalThis, `__stub_${name}`, { value: cls, configurable: true })
}
export {
  LlmError as LlmError2, LlmError as LlmError3, LlmError as LlmError4, LlmError as LlmError5,
  LlmError as LlmError6, LlmError as LlmError7, LlmError as LlmError8, LlmError as LlmError9,
  LlmError as LlmError10, LlmError as LlmError11, LlmError as LlmError12, LlmError as LlmError13,
  LlmError as LlmError14, LlmError as LlmError15, LlmError as LlmError16, LlmError as LlmError17,
  LlmError as LlmError18,
}

/** `LlmAdapter` and its mangled siblings: a no-op base the pack extends. */
export class LlmAdapter {
  constructor(...args) {
    this.args = args
  }
  async listModels() { return [] }
  async *stream() { /* no tokens from a stub */ }
}
for (let i = 2; i <= 10; i += 1) {
  const name = `LlmAdapter${i}`
  const cls = class extends LlmAdapter {}
  Object.defineProperty(cls, 'name', { value: name })
}
export {
  LlmAdapter as LlmAdapter2, LlmAdapter as LlmAdapter3, LlmAdapter as LlmAdapter4,
  LlmAdapter as LlmAdapter5, LlmAdapter as LlmAdapter6, LlmAdapter as LlmAdapter7,
  LlmAdapter as LlmAdapter8, LlmAdapter as LlmAdapter9, LlmAdapter as LlmAdapter10,
}

export const CONTEXT_WINDOW_EXCEEDED_CODE = 'context_window_exceeded'
export const EMPTY_RESPONSE_CODE = 'empty_response'
export const EMPTY_RESPONSE_CODE2 = 'empty_response_2'

/** The pack builds user messages for probes; a stub message is enough. */
export function createUserMessage(content) {
  return { role: 'user', content, source: { kind: 'user' } }
}
export { createUserMessage as createUserMessage2 }

/** Type-only imports resolve to nothing at runtime. */
export const ReasoningEffortId = 'high'
export const ToolCallId = 'tool-call'
for (const suffix of ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']) {
  // Declared for the mangled import sites; values are placeholders.
}
export const ReasoningEffortId2 = 'high'
export const ReasoningEffortId3 = 'high'
export const ReasoningEffortId4 = 'high'
export const ReasoningEffortId5 = 'high'
export const ReasoningEffortId6 = 'high'
export const ReasoningEffortId7 = 'high'
export const ReasoningEffortId8 = 'high'
export const ReasoningEffortId9 = 'high'
export const ReasoningEffortId10 = 'high'
export const ReasoningEffortId11 = 'high'
export const ReasoningEffortId12 = 'high'
export const ReasoningEffortId13 = 'high'
export const ToolCallId2 = 'tool-call'
export const ToolCallId3 = 'tool-call'

/** Context-window predicate the pack calls on caught errors. */
export function isContextWindowExceededError(error) {
  return error?.code === CONTEXT_WINDOW_EXCEEDED_CODE
}

/**
 * The `llm` service surface the pack touches while registering providers.
 * Every method records its call and answers a benign empty, so the check
 * observes "the pack tried to register N providers" without a real host.
 */
export const llmServiceStub = {
  registered: [],
  registerAdapter(...args) {
    this.registered.push(args)
    return { dispose: () => {} }
  },
  register(...args) {
    this.registered.push(args)
    return { dispose: () => {} }
  },
  listConfigurableProviders() { return [] },
  listProviders() { return [] },
  get() { return undefined },
  set() { return undefined },
  declare() { return undefined },
}

/** The `credentials` service: no credential resolves in a bare check. */
export const credentialsServiceStub = {
  resolve: async () => undefined,
  describe: async () => ({ configured: false }),
  set: async () => ({ ok: true }),
}

/** The `commands` service: the pack registers none at mount time. */
export const commandsServiceStub = {
  register: () => ({ dispose: () => {} }),
}

/** The `settings` service: the pack declares sections on it. */
export const settingsServiceStub = {
  declare: () => ({ dispose: () => {} }),
  get: () => ({}),
  set: () => undefined,
  flush: () => undefined,
}

/**
 * The `connection` service stub.
 *
 * The pack registers its HTTP surface with `connection.fetch.register`
 * (`{ path, methods, fetch }`); the browser half of a plugin reaches the
 * same handlers through `connection.rpc.call('/api', <endpoint>, …)`. The
 * real host bridges the two faces; this stub reproduces that bridge so the
 * integration check exercises the same contract dsh-model-admin uses.
 */
export function createConnectionServiceStub() {
  /** @type {Map<string, {path: string, methods: string[], fetch: (r: Request) => Promise<Response>}>} */
  const httpEndpoints = new Map()
  /** @type {Map<string, Function>} */
  const rpcEndpoints = new Map()

  return {
    httpEndpoints,
    rpcEndpoints,
    fetch: {
      register: registration => {
        httpEndpoints.set(registration.path, registration)
      },
    },
    rpc: {
      register: (endpoint, handler) => { rpcEndpoints.set(endpoint, handler) },
      /**
       * The bridge: `/api/<endpoint>` resolves to the HTTP handler the pack
       * registered for that path, invoked with a synthesized Request.
       */
      call: async (path, endpoint, body, signal) => {
        const direct = rpcEndpoints.get(endpoint)
        if (direct !== undefined) return direct({ path, body, signal })
        const httpPath = `${path}/${endpoint}`
        const registration = httpEndpoints.get(httpPath)
        if (registration === undefined) {
          return { ok: false, error: { code: 'NO_HANDLER', message: `${httpPath} not registered` } }
        }
        const request = new Request(`http://127.0.0.1${httpPath}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        })
        const response = await registration.fetch(request)
        const payload = await response.json()
        // The HTTP face answers the raw result; the RPC face wraps it.
        return payload?.ok === undefined ? { ok: true, value: payload } : payload
      },
    },
  }
}

/** `credentialRef` and its mangled siblings: name carriers only. */
export function credentialRef(name) {
  return { kind: 'ref', name: String(name) }
}
for (let i = 2; i <= 14; i += 1) {
  const name = `credentialRef${i}`
  const fn = ref => credentialRef(ref)
  Object.defineProperty(fn, 'name', { value: name })
}
export {
  credentialRef as credentialRef2, credentialRef as credentialRef3, credentialRef as credentialRef4,
  credentialRef as credentialRef5, credentialRef as credentialRef6, credentialRef as credentialRef7,
  credentialRef as credentialRef8, credentialRef as credentialRef9, credentialRef as credentialRef10,
  credentialRef as credentialRef11, credentialRef as credentialRef12, credentialRef as credentialRef13,
  credentialRef as credentialRef14,
}

export const Service2 = Service
export const Service3 = Service
export const Service4 = Service
export const Service5 = Service
export const Service6 = Service
export const Service7 = Service
export const Service8 = Service
export const Service9 = Service

/** schemastery `z`: the pack builds its config schema with it. */
function schema() {
  const handler = {
    default: () => handler,
    required: () => handler,
    optional: () => handler,
    step: () => handler,
    min: () => handler,
    max: () => handler,
    role: () => handler,
    volatile: () => handler,
    description: () => handler,
    array: () => handler,
    object: () => handler,
    union: () => handler,
    intersect: () => handler,
    literal: () => handler,
    boolean: () => handler,
    number: () => handler,
    string: () => handler,
    any: () => handler,
    nullable: () => handler,
    dict: () => handler,
    record: () => handler,
    enum: () => handler,
    const: () => handler,
    lazy: () => handler,
    transform: () => handler,
    effect: () => handler,
    validate: value => ({ value }),
    parse: value => value,
    safeParse: value => ({ success: true, value }),
  }
  return handler
}
export const z = schema()
export default z
