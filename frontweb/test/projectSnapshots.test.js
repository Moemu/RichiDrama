import test from 'node:test'
import assert from 'node:assert/strict'
import { projectSnapshot, rememberProjectResponse } from '../src/utils/projectSnapshots.js'

test('nested project responses preserve entity identity and field baselines', () => {
  rememberProjectResponse('/dramas/700', { id: 700, description: '项目简介', episodes: [{ id: 701, title: '第一集' }] })
  rememberProjectResponse('/episodes/701/storyboards', [{ id: 702, title: '镜头', episode_id: 701 }])
  assert.equal(projectSnapshot('storyboards', 702).__projectId, 700)
  assert.equal(projectSnapshot('episodes', 702), undefined)
  rememberProjectResponse('/dramas/700/collaboration/text', { id: 700, kind: 'episodes', field: 'description', text: '分集文本' })
  rememberProjectResponse('/dramas/700/collaboration/assets', { id: 700, local_path: 'copy.png' })
  assert.equal(projectSnapshot('dramas', 700).description, '项目简介')
  assert.equal(projectSnapshot('dramas', 700).local_path, undefined)
  rememberProjectResponse('/storyboards/702', { id: 702, status: 'completed' })
  assert.equal(projectSnapshot('storyboards', 702).title, '镜头')
  assert.equal(projectSnapshot('storyboards', 702).__projectId, 700)
})
