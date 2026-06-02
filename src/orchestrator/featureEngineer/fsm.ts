import { fsmLog } from './logging.js';
import type { AgentState } from './types.js';

const ALLOWED_TRANSITIONS: Record<AgentState, AgentState[]> = {
  IDLE: ['READING_CONTEXT', 'FAILED'],
  READING_CONTEXT: ['INJECTING_CODE', 'FAILED'],
  INJECTING_CODE: ['COMPILING', 'FAILED'],
  COMPILING: ['GENERATING_TESTS', 'DEBUGGING', 'REPORTING', 'FAILED'],
  GENERATING_TESTS: ['TESTING', 'FAILED'],
  TESTING: ['REPORTING', 'DEBUGGING', 'FAILED'],
  DEBUGGING: ['INJECTING_CODE', 'COMPILING', 'GENERATING_TESTS', 'REPORTING', 'FAILED'],
  REPORTING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

export class FeatureEngineerFsm {
  private state: AgentState = 'IDLE';

  get current(): AgentState {
    return this.state;
  }

  transition(next: AgentState, reason: string): void {
    const allowed = ALLOWED_TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      fsmLog(this.state, `Illegal transition to ${next}: ${reason}`);
      throw new Error(`FSM: cannot transition ${this.state} → ${next}`);
    }
    this.state = next;
    fsmLog(next, reason);
  }

  forceFailed(reason: string): void {
    this.state = 'FAILED';
    fsmLog('FAILED', reason);
  }

  forceCompleted(reason: string): void {
    this.state = 'COMPLETED';
    fsmLog('COMPLETED', reason);
  }
}
