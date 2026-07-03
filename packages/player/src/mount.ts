import { createApp, type Component } from 'vue'

export function mountPlayerApp(rootComponent: Component, selector = '#app') {
  return createApp(rootComponent).mount(selector)
}
