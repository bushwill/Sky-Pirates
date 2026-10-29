export function getDeathFeedbackType(attribution, viewerId) {
  if (attribution?.killerId === viewerId) return 'kill';
  if (Array.isArray(attribution?.assisterIds) && attribution.assisterIds.includes(viewerId)) return 'assist';
  return 'other';
}

export function getDeathFeedbackStyle(feedbackType, killStreak = 0) {
  const streakStep = feedbackType === 'kill'
    ? Math.max(0, Math.min(6, Math.floor(killStreak) - 1))
    : 0;
  return {
    radius: 12 + streakStep * 1.75,
    lineWidth: 3 + streakStep * 0.75,
    scale: 1 + streakStep * 0.08,
    glowAlpha: 0.14 + streakStep * 0.05,
    vibration: feedbackType === 'kill' ? 1 + streakStep * 0.8 : 0,
    vibrationCount: feedbackType === 'kill' ? Math.min(2 + streakStep, 8) : 0,
  };
}