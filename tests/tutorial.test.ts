import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceTutorialStep, dismissTutorial, setTutorialAutoDisabled, shouldOpenTutorial, tutorialEventForDecision } from '../src/components/tutorial.js'

test('tutorial dismissal is scoped to a game and player; opt-out affects future automatic openings', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } })
    setTutorialAutoDisabled(false)
    assert.equal(shouldOpenTutorial('game-a', 'player-a', true), true)
    dismissTutorial('game-a', 'player-a')
    assert.equal(shouldOpenTutorial('game-a', 'player-a', true), false)
    assert.equal(shouldOpenTutorial('game-a', 'player-b', true), true)
    assert.equal(shouldOpenTutorial('game-b', 'player-a', true), true)
    assert.equal(shouldOpenTutorial('underway-game', 'player-a', false), false)
    setTutorialAutoDisabled(true)
    assert.equal(shouldOpenTutorial('game-b', 'player-a', true), false)
    setTutorialAutoDisabled(false)
    assert.equal(shouldOpenTutorial('game-b', 'player-a', true), true)
    assert.equal(shouldOpenTutorial('game-a', 'player-a', true), false)

    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('Storage blocked') } })
    assert.doesNotThrow(() => dismissTutorial('blocked-storage', 'player-a'))
    assert.equal(shouldOpenTutorial('blocked-storage', 'player-a', true), false)
    assert.equal(shouldOpenTutorial('blocked-storage', 'player-b', true), true)
    setTutorialAutoDisabled(true)
    assert.equal(shouldOpenTutorial('another-game', 'player-a', true), false)
  } finally {
    setTutorialAutoDisabled(false)
    if (prior) Object.defineProperty(globalThis, 'localStorage', prior)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('the coach advances only for the matching acknowledged move and lesson', () => {
  assert.equal(advanceTutorialStep(1, 'take'), 2)
  assert.equal(advanceTutorialStep(2, 'place'), 3)
  assert.equal(advanceTutorialStep(3, 'complete'), 4)
  assert.equal(advanceTutorialStep(0, 'take'), 0)
  assert.equal(advanceTutorialStep(1, 'place'), 1)
  assert.equal(advanceTutorialStep(2, 'complete'), 2)
  assert.equal(advanceTutorialStep(6, 'place'), 6)
  assert.equal(advanceTutorialStep(7, 'complete'), 7)
})

test('confirmed decisions identify real take, placement and completion events only', () => {
  assert.equal(tutorialEventForDecision({ type: 'action', action: { type: 'take', source: 'deck', deck: 'white' } }), 'take')
  assert.equal(tutorialEventForDecision({ type: 'action', action: { type: 'place', puzzleId: 'base-01', placement: { piece: 'single', orientation: 0, origin: { x: 0, y: 0 } } } }), 'place')
  assert.equal(tutorialEventForDecision({ type: 'completion-reward', piece: null }), 'complete')
  assert.equal(tutorialEventForDecision({ type: 'action', action: { type: 'upgrade', kind: 'new', piece: 'single' } }), null)
  assert.equal(tutorialEventForDecision({ type: 'action', action: { type: 'recycle', deck: 'white', bottomOrder: [] } }), null)
  assert.equal(tutorialEventForDecision({ type: 'action', action: { type: 'master', placements: [] } }), null)
  assert.equal(tutorialEventForDecision({ type: 'completion-order', order: ['base-01'] }), null)
  assert.equal(tutorialEventForDecision({ type: 'finish-touches', placements: [] }), null)
})
