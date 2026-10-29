export const SIMULATION_STEP_MS = 1000 / 60;
export const MAX_SIMULATION_STEPS_PER_FRAME = 8;

export function consumeFixedSteps(accumulatorMs, elapsedMs, stepMs = SIMULATION_STEP_MS,
  maxSteps = MAX_SIMULATION_STEPS_PER_FRAME) {
  if (![accumulatorMs, elapsedMs, stepMs, maxSteps].every(Number.isFinite) ||
      accumulatorMs < 0 || elapsedMs < 0 || stepMs <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError('Fixed-step clock values must be finite and non-negative.');
  }
  const availableMs = accumulatorMs + elapsedMs;
  const steps = Math.min(maxSteps, Math.floor((availableMs + 1e-9) / stepMs));
  return { steps, accumulatorMs: Math.max(0, availableMs - steps * stepMs) };
}
