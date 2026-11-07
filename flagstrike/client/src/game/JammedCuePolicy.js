export function isPersonalAudioCueForViewer(cue, activePlayerId, viewerId) {
  return cue?.heardById === activePlayerId &&
    (!cue.audiencePlayerId || cue.audiencePlayerId === viewerId);
}

export function isPersonalDamageCueForViewer(cue, activePlayerId, viewerId) {
  return cue?.victimId === activePlayerId &&
    (!cue.audiencePlayerId || cue.audiencePlayerId === viewerId);
}

export function isHostBotCueEvent(event, hostId, playerId) {
  if (hostId !== playerId || !['audio-cue', 'damage-cue'].includes(event?.type)) return false;
  if (!event.audiencePlayerId) return true;
  return event.type === 'audio-cue'
    ? event.data?.heardById === event.audiencePlayerId
    : event.data?.victimId === event.audiencePlayerId;
}
