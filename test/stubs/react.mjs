/**
 * React stub for standalone checks — the shell supplies the real one.
 *
 * Mirrors the two `createElement` behaviours component code actually relies
 * on: children land in `props.children` (a single child is not wrapped in an
 * array), and a null/undefined/false child is dropped. Hooks are inert
 * pass-throughs; rendering itself is NOT simulated, so a check can inspect
 * the element tree but cannot observe effects or state changes.
 */

export function createElement(type, props, ...children) {
  const flat = children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false)
  return {
    type: typeof type === 'string' ? type : (type.name ?? 'Component'),
    props: {
      ...(props ?? {}),
      children: flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat,
    },
    children: flat,
  }
}

export const Fragment = 'Fragment'

export function useState(initial) {
  return [typeof initial === 'function' ? initial() : initial, () => {}]
}

export function useEffect() { /* no render loop in a check */ }
export function useCallback(fn) { return fn }
export function useRef(value) { return { current: value } }
export function useMemo(fn) { return fn() }

export default {
  createElement, Fragment, useState, useEffect, useCallback, useRef, useMemo,
}
