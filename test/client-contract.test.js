import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The browser half's contract, exercised the way the shell loads it: through
 * `window.__ModuleLoader__.load({ id, factory })`, with a stub `require` that
 * serves `react` and the page modules. What this proves is the part the host
 * depends on — the slot registration (name, id, order, label), the injected
 * services, and the API path — not the React rendering itself, which needs a
 * real DOM.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const clientSource = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

/** Run client.js inside a stub ModuleLoader world; returns what it registered. */
function loadClient() {
  const registrations = []
  const injected = []
  const loaded = {}

  const document_ = {
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
  }
  const window_ = {
    __ModuleLoader__: {
      load: descriptor => {
        loaded.id = descriptor.id
        const module = { exports: {} }
        const require_ = name => {
          if (name === 'react') return reactStub
          if (name === './src/client/page.js') return { ModelAdminPage: function ModelAdminPage() {} }
          throw new Error(`unstubbed require: ${name}`)
        }
        const result = descriptor.factory(require_)
        loaded.exports = result ?? module.exports
      },
    },
  }

  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
  }

  const fn = new Function('window', 'document', 'module', 'exports', clientSource)
  fn(window_, document_, { exports: {} }, {})

  // Replay the recorded registration against a cordis-shaped client ctx.
  const slots = {
    inject: (slotName, body) => {
      injected.push(slotName)
      // `register` is provided by the slots service; capture descriptor AND
      // component — the host renders the second argument.
      slots.register = (descriptor, component) => {
        registrations.push({ ...descriptor, component })
        return () => {}
      }
      return body()
    },
  }
  const ctx = {
    slots,
    connection: null,
    locale: { bind: () => key => (key === 'nav' ? 'Model Admin' : key) },
    effect: () => {},
    get: () => undefined,
  }
  loaded.exports.apply(ctx)

  return { loaded, registrations, injected }
}

test('the bundle registers itself under the plugin id', () => {
  const { loaded } = loadClient()
  assert.equal(loaded.id, 'dsh-model-admin')
  assert.equal(loaded.exports.name, 'dsh-model-admin')
  assert.deepEqual(loaded.exports.inject, ['slots', 'locale', 'connection'])
  assert.equal(loaded.exports.__test.API_PATH, '/api/dsh-model-admin')
})

test('the page mounts into the settings.section slot (left navigation)', () => {
  const { registrations, injected } = loadClient()
  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registrations.length, 1)
  const descriptor = registrations[0]
  assert.equal(descriptor.name, 'settings.section')
  assert.equal(descriptor.id, 'dsh-model-admin')
  assert.equal(typeof descriptor.order, 'number')
  // The label is a function so a locale switch re-reads it.
  assert.equal(typeof descriptor.label, 'function')
  assert.equal(descriptor.label(), 'Model Admin')
  assert.equal(descriptor.locale, 'modelAdmin')
})

test('the section component is produced by the registered factory', () => {
  const { registrations } = loadClient()
  const component = registrations[0].component
  assert.equal(typeof component, 'function')
  // The host renders it with props; our wrapper spreads them onto the page.
  const element = component({ title: 'Model Admin' })
  assert.equal(element.type.name, 'ModelAdminPage')
  assert.equal(element.props.client !== undefined, true)
  assert.equal(typeof element.props.t, 'function')
})

test('styles are injected once, with the theme tokens', () => {
  const appended = []
  const document_ = {
    head: { appendChild: style => appended.push(style) },
    getElementById: id => (id === 'dsh-model-admin-styles' && appended.length > 0 ? {} : null),
    createElement: () => ({ id: '', textContent: '' }),
  }
  const window_ = {
    __ModuleLoader__: {
      load: descriptor => {
        const require_ = name => (name === 'react' ? {
          createElement: () => ({}), useState: i => [i, () => {}], useEffect: () => {}, useCallback: f => f,
        } : { ModelAdminPage: function ModelAdminPage() {} })
        const exports_ = descriptor.factory(require_)
        // apply() injects the styles; the ctx needs the slots service.
        // The body receives nothing useful — `register` lives on the slots
        // service itself, matching the real contract.
        const slots = { register: () => () => {} }
        slots.inject = (_slot, body) => body()
        exports_.apply({
          slots,
          locale: { bind: () => key => key },
          effect: () => {},
          get: () => undefined,
        })
      },
    },
  }
  const fn = new Function('window', 'document', 'module', 'exports', clientSource)
  fn(window_, document_, { exports: {} }, {})
  assert.equal(appended.length, 1)
  assert.equal(appended[0].id, 'dsh-model-admin-styles')
  // Colour must come from the shell's tokens, not hard-coded values.
  assert.match(appended[0].textContent, /--dsw-alias-label-primary/)
  assert.match(appended[0].textContent, /--dsw-alias-bg-layer-1/)
})
