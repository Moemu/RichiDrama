import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

test('ToolWorkbench mobile layout returns panels to normal document flow', async () => {
  const source = await fs.readFile(path.join(here, '../src/views/ToolWorkbench.vue'), 'utf8')

  assert.match(source, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.tool-workbench\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/)
  assert.match(source, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.tool-layout\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/)
  assert.match(source, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.tool-form,[\s\S]*?\.run-history,[\s\S]*?\.result\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*visible;/)
  assert.match(source, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.result pre\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow:\s*auto;/)
})
