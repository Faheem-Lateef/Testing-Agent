import { logger } from '../../utils/logger.js';
import type { AgentState, LifecyclePhase } from './types.js';

export function memoryLog(message: string): void {
  console.log(`[MEMORY-BANK] ${message}`);
  logger.info({ memoryBank: true }, message);
}

export function fsmLog(state: AgentState, detail: string): void {
  console.log(`[FSM-STATE] ${state} — ${detail}`);
  logger.info({ fsmState: state }, detail);
}

export function phaseLog(phase: LifecyclePhase, message: string): void {
  const tag = phase.replace('PHASE_', 'PHASE-').replace(/_/g, '-');
  console.log(`[${tag}] ${message}`);
  logger.info({ lifecyclePhase: phase }, message);
}

export function compilerLog(message: string): void {
  console.log(`[COMPILER-SANDBOX] ${message}`);
  logger.info({ compilerSandbox: true }, message);
}

export function engineerLog(message: string): void {
  console.log(`[FEATURE-ENGINEER] ${message}`);
  logger.info({ featureEngineer: true }, message);
}

export function devLog(message: string): void {
  console.log(`[DEVELOPMENT LOG] ${message}`);
}

export function testLog(message: string): void {
  console.log(`[TEST COMPLIANCE] ${message}`);
}

export function patchLog(message: string): void {
  console.log(`[PATCH SUMMARY] ${message}`);
}
