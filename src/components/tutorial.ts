import type { ReplayDecision } from '../game/replay.js'

const memory = new Map<string, string>()
const PREFERENCE_KEY = 'project-l-tutorial-auto'
const gameKey = (gameId: string, playerId: string) => `project-l-tutorial:${encodeURIComponent(gameId)}:${encodeURIComponent(playerId)}`
function read(key: string): string | null {
  try { return localStorage.getItem(key) ?? memory.get(key) ?? null } catch { return memory.get(key) ?? null }
}
function write(key: string, value: string): void {
  memory.set(key, value)
  try { localStorage.setItem(key, value) } catch { /* Keep this tab usable when storage is blocked. */ }
}
export const tutorialAutoDisabled = () => read(PREFERENCE_KEY) === 'off'
export const setTutorialAutoDisabled = (disabled: boolean) => write(PREFERENCE_KEY, disabled ? 'off' : 'on')
export const dismissTutorial = (gameId: string, playerId: string) => write(gameKey(gameId, playerId), 'dismissed')
export function shouldOpenTutorial(gameId: string, playerId: string, freshGame: boolean): boolean {
  return freshGame && !tutorialAutoDisabled() && read(gameKey(gameId, playerId)) !== 'dismissed'
}

export type TutorialEvent = 'take' | 'place' | 'complete'
export interface ConfirmedTutorialEvent { readonly id: number; readonly event: TutorialEvent }
/** Only server-acknowledged, locally submitted moves reach the coach. */
export function tutorialEventForDecision(decision: ReplayDecision): TutorialEvent | null {
  if (decision.type === 'completion-reward') return 'complete'
  if (decision.type !== 'action') return null
  if (decision.action.type === 'take') return 'take'
  if (decision.action.type === 'place' || decision.action.type === 'master' && decision.action.placements.length > 0) return 'place'
  return null
}
export function advanceTutorialStep(step: number, event: TutorialEvent): number {
  if (step === 1 && event === 'take' || step === 2 && event === 'place' || step === 3 && event === 'complete') return step + 1
  return step
}
