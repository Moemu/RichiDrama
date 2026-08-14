import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const theme = read('../src/styles/theme.css')
const index = read('../index.html')
const themeComposable = read('../src/composables/useTheme.js')
const plan = read('../../docs/plans/2026-08-13-light-dark-ui-full-adaptation.md')

test('light and dark modes expose the same semantic UI contract', () => {
  for (const token of [
    '--bg-page', '--bg-surface', '--bg-raised', '--bg-elevated',
    '--text-primary', '--text-regular', '--text-muted', '--text-faint',
    '--border-color', '--border-strong', '--focus-ring', '--accent',
    '--text-on-accent', '--status-success', '--status-warning',
    '--status-danger', '--status-info', '--stage-bg', '--overlay-scrim',
  ]) {
    assert.match(theme, new RegExp(`${token}:`), `missing ${token}`)
  }
  assert.match(theme, /:root,\s*\nhtml\.dark\s*\{/)
  assert.match(theme, /html\.light\s*\{/)
  assert.match(theme, /html\.dark\s*\{\s*color-scheme:\s*dark\s*!important/)
  assert.match(theme, /html\.light\s*\{\s*color-scheme:\s*light\s*!important/)
})

test('native loading surfaces and browser chrome follow the selected theme', () => {
  assert.match(index, /<meta name="color-scheme" content="light dark"\s*\/?>/)
  assert.match(index, /<meta name="theme-color" content="#080b12"\s*\/?>/)
  assert.match(themeComposable, /querySelector\('meta\[name="theme-color"\]'\)/)
  assert.match(themeComposable, /documentElement\.style\.backgroundColor/)
})

test('interaction and display preferences remain accessible', () => {
  assert.match(theme, /:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--focus-ring\)/s)
  assert.match(theme, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(theme, /@media \(prefers-contrast: more\)/)
  assert.match(theme, /@media \(forced-colors: active\)/)
})

test('the compatibility layer covers every high-impact product surface', () => {
  for (const selector of [
    '.tools-page', '.media-library-page', '.drama-canvas-page',
    '.canvas-sb-node', '.canvas-floating-toolbar', '.omni-page',
    '.video-stage', '.el-table__body',
  ]) {
    assert.ok(theme.includes(selector), `missing route coverage for ${selector}`)
  }
  assert.match(plan, /Apple-like/)
  assert.match(plan, /\/film\/:id\/canvas/)
  assert.match(plan, /\/media-library/)
  assert.match(plan, /\/ai-tools/)
})
