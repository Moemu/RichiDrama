import test from 'node:test'
import assert from 'node:assert/strict'
import { loadAllProjects } from '../src/utils/projectList.js'

test('project relationship and search filters receive records beyond the first fifty', async () => {
  const projects = Array.from({ length: 123 }, (_, i) => ({ id: i + 1, title: `项目 ${i + 1}`, permissions: { role: i < 50 ? 'owner' : 'editor' } }))
  const pages = []
  const result = await loadAllProjects(async ({ page, page_size }) => {
    pages.push(page)
    return { items: projects.slice((page - 1) * page_size, page * page_size), pagination: { total: projects.length } }
  })
  assert.deepEqual(pages, [1, 2, 3])
  assert.equal(result.items.filter(item => item.permissions.role === 'editor').length, 73)
  assert.equal(result.items.find(item => item.title === '项目 123').id, 123)
})

test('a removed last page terminates loading and page failures remain visible', async () => {
  let calls = 0
  const result = await loadAllProjects(async () => ({ items: calls++ ? [] : [{ id: 1 }], pagination: { total: 51 } }))
  assert.equal(calls, 2)
  assert.equal(result.items.length, 1)
  await assert.rejects(loadAllProjects(async () => { throw new Error('network') }), /network/)
})
