export function isPersonalAudioCueForViewer(cue, activePlayerId, viewerId) {
  return cue?.heardById === activePlayerId &&
    (!cue.audiencePlayerId || cue.audiencePlayerId === viewerId);
}

export function isPersonalDamageCueForViewer(cue, activePlayerId, viewerId) {
  return cue?.victimId === activePlayerId &&
    (!cue.audiencePlayerId || cue.audiencePlayerId === viewerId);
}
