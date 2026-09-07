import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const theme = read('../src/styles/theme.css')
const base = read('../src/styles/base.css')
const index = read('../index.html')
const themeComposable = read('../src/composables/useTheme.js')
const plan = read('../../docs/plans/2026-08-13-light-dark-ui-full-adaptation.md')

const palette = (selector) => Object.fromEntries(
  [...theme.match(new RegExp(`${selector}\\s*\\{([^}]+)\\}`))[1].matchAll(/(--[\w-]+):\s*(#[\da-f]{6});/gi)]
    .map(([, name, value]) => [name, value]),
)
const luminance = (hex) => hex.slice(1).match(/../g)
  .map((value) => Number.parseInt(value, 16) / 255)
  .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)]
  return (Math.max(...values) + .05) / (Math.min(...values) + .05)
}

test('both palettes keep normal text and media captions readable', () => {
  const dark = palette('html\\.dark')
  const light = { ...dark, ...palette('html\\.light') }
  for (const [mode, colors] of Object.entries({ dark, light })) {
    for (const text of ['--text-primary', '--text-regular', '--text-muted', '--text-faint']) {
      for (const surface of ['--bg-page', '--bg-surface', '--bg-raised', '--bg-inner']) {
        assert.ok(contrast(colors[text], colors[surface]) >= 4.5, `${mode}: ${text} on ${surface}`)
      }
    }
    for (const text of ['--text-on-media', '--text-on-media-muted']) {
      assert.ok(contrast(colors[text], colors['--stage-bg']) >= 4.5, `${mode}: ${text} on stage`)
    }
    for (const surface of ['--action-bg', '--action-hover-bg', '--action-gradient-end']) {
      assert.ok(contrast(colors['--accent-contrast'], colors[surface]) >= 4.5, `${mode}: button on ${surface}`)
    }
    for (const status of ['success', 'warning', 'danger', 'info']) {
      assert.ok(contrast(colors[`--status-${status}`], colors['--bg-surface']) >= 4.5, `${mode}: ${status}`)
    }
  }
})

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
  assert.doesNotMatch(theme, /input:focus-visible|textarea:focus-visible|select:focus-visible/)
  assert.match(theme, /\[tabindex\]:not\(\[tabindex="-1"\]\):not\(\.el-input__inner\):not\(\.el-textarea__inner\):not\(\.el-select__input\):focus-visible/)
  assert.match(theme, /\.el-input__wrapper\.is-focus, \.el-textarea__wrapper:focus-within, \.el-select__wrapper\.is-focused \{ box-shadow:/)
  assert.match(base, /:focus-visible:not\(\.el-input__inner\):not\(\.el-textarea__inner\):not\(\.el-select__input\)/)
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
