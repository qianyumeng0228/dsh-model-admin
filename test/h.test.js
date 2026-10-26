import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * The panel's `h()` factory is tested against a minimal DOM stub rather than
 * jsdom: the factory only uses createElement / setAttribute / addEventListener /
 * appendChild / createTextNode, so a stub keeps the plugin dependency-free
 * while still catching the real failure modes (a dropped attribute, a child
 * appended as `[object Object]`, a listener wired to the wrong event).
 */
const listeners = new Map()

class StubNode {
  constructor(tag) {
    this.tag = tag
    this.attributes = {}
    // Declared up front so property assignment is observable, mirroring how
    // real DOM form controls expose checked/value/hidden/disabled.
    this.checked = undefined
    this.value = undefined
    this.hidden = undefined
    this.disabled = undefined
    this.children = []
    this.text = ''
    this.className = ''
  }
  setAttribute(name, value) { this.attributes[name] = String(value) }
  getAttribute(name) { return this.attributes[name] ?? null }
  addEventListener(type, fn) { listeners.set(type, fn) }
  appendChild(child) { this.children.push(child); return child }
  replaceChildren() { this.children = [] }
  querySelectorAll() { return [] }
}

globalThis.document = {
  createElement: tag => new StubNode(tag),
  createTextNode: text => ({ text }),
}

const { h } = await import('../src/client/panel.js')

test('h builds an element with attributes and text', () => {
  const node = h('p', { class: 'ma-status' }, 'hello')
  assert.equal(node.tag, 'p')
  assert.equal(node.getAttribute('class'), 'ma-status')
  assert.deepEqual(node.children, [{ text: 'hello' }])
})

test('h sets form-control properties, not attributes', () => {
  const box = h('input', { type: 'checkbox', checked: true })
  assert.equal(box.getAttribute('type'), 'checkbox')
  assert.equal(box.checked, true)
  assert.equal(box.getAttribute('checked'), null)
})

test('h wires on* keys to listeners, not attributes', () => {
  const fired = []
  const button = h('button', { onclick: () => fired.push(1) }, 'run')
  listeners.get('click')()
  assert.deepEqual(fired, [1])
  assert.equal(button.getAttribute('onclick'), null)
})

test('h skips null, undefined and false attribute values', () => {
  const node = h('div', { id: null, hidden: false, 'data-x': 'ok' })
  assert.equal(node.getAttribute('id'), null)
  assert.equal(node.hidden, undefined)
  assert.equal(node.getAttribute('data-x'), 'ok')
})

test('h appends nested element children and flattens arrays', () => {
  const parent = h('div', null, h('span', null, 'a'), [h('span', null, 'b'), 'c'])
  assert.equal(parent.children.length, 3)
  assert.equal(parent.children[0].tag, 'span')
  assert.deepEqual(parent.children[2], { text: 'c' })
})

test('h drops false children but keeps zero', () => {
  const node = h('div', null, 'x', false, null, undefined, 0)
  assert.deepEqual(node.children, [{ text: 'x' }, { text: '0' }])
})

test('h tolerates being called without attrs', () => {
  const node = h('td', undefined, 'cell')
  assert.equal(node.tag, 'td')
  assert.deepEqual(node.children, [{ text: 'cell' }])
})
