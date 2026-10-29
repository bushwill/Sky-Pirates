export function validateAccuracySettings(settings = {}) {
  const result = {
    maxSpreadDegrees: 16,
    recoilPerShot: 0.08,
    recoveryPerSecond: 0.45,
    movementPenaltyAtMaxSpeed: 0.35,
    ...settings,
  };
  for (const field of ['maxSpreadDegrees', 'recoilPerShot', 'recoveryPerSecond', 'movementPenaltyAtMaxSpeed']) {
    if (!Number.isFinite(result[field]) || result[field] < 0) {
      throw new RangeError(`Weapon accuracy ${field} must be a non-negative number.`);
    }
  }
  if (result.recoilPerShot > 1 || result.movementPenaltyAtMaxSpeed > 1) {
    throw new RangeError('Weapon accuracy penalties must not exceed 1.');
  }
  result.maxAccuracy ??= 1;
  result.startingAccuracy ??= result.maxAccuracy;
  if (!Number.isFinite(result.maxAccuracy) || result.maxAccuracy < 0 || result.maxAccuracy > 1 ||
      !Number.isFinite(result.startingAccuracy) || result.startingAccuracy < 0 || result.startingAccuracy > result.maxAccuracy) {
    throw new RangeError('Weapon accuracy maximum and starting values must be between 0 and 1, with starting accuracy at or below maximum.');
  }
  return Object.freeze(result);
}

export function recoverAccuracy(accuracy, elapsedSeconds, recoveryPerSecond, maximumAccuracy = 1) {
  const boundedAccuracy = clamp(accuracy, 0, 1);
  return clamp(boundedAccuracy + Math.max(0, elapsedSeconds) * recoveryPerSecond, 0, maximumAccuracy);
}

export function getEffectiveAccuracy(accuracy, speed, maximumSpeed, movementPenaltyAtMaxSpeed) {
  const speedRatio = maximumSpeed > 0 ? clamp(speed / maximumSpeed, 0, 1) : 0;
  return clamp(accuracy - speedRatio * movementPenaltyAtMaxSpeed, 0, 1);
}

export function applyAccuracyRecoil(accuracy, recoilPerShot) {
  return clamp(accuracy - recoilPerShot, 0, 1);
}

export function getMaximumSpreadRadians(accuracy, maxSpreadDegrees) {
  const boundedAccuracy = clamp(accuracy, 0, 1);
  return maxSpreadDegrees * Math.PI / 180 * (1 - boundedAccuracy);
}

export function getMaximumRotationRadiansPerSecond(rotationTimeMs) {
  return Math.PI * 1000 / rotationTimeMs;
}

export function rotateAngleTowards(currentAngle, targetAngle, maximumChange) {
  const difference = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
  const change = Math.max(-maximumChange, Math.min(maximumChange, difference));
  return Math.atan2(Math.sin(currentAngle + change), Math.cos(currentAngle + change));
}

export function getGaussianSpreadRadians(accuracy, maxSpreadDegrees, random = Math.random) {
  const maximumSpread = getMaximumSpreadRadians(accuracy, maxSpreadDegrees);
  if (maximumSpread <= 0) return 0;

  const first = Math.max(random(), Number.EPSILON);
  const second = random();
  const standardNormal = Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  const standardDeviation = maximumSpread / 3;
  return clamp(standardNormal * standardDeviation, -maximumSpread, maximumSpread);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}