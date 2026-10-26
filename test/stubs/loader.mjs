/**
 * Resolve hook: map the four host-provided modules to the stubs, so the
 * vendored channel pack can be imported outside the DSH host process.
 *
 * Registered with `module.register` from an `--import` preload; it runs in
 * a worker thread, so it only redirects resolution and never executes
 * plugin code.
 */

const STUB_URL = new URL('./host-modules.mjs', import.meta.url).href

const HOST_MODULES = new Set([
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale',
])

export async function resolve(specifier, context, nextResolve) {
  if (HOST_MODULES.has(specifier) || specifier.startsWith('@deepseek-ai/dsh-')) {
    return { url: STUB_URL, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
