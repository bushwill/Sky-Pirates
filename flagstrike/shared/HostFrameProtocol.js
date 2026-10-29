export const HOST_FRAME_PROTOCOL_VERSION = 1;
// Maps are included in the first host frame; all later frames remain small.
export const MAX_HOST_FRAME_BYTES = 768 * 1024;
export const MAX_HOST_FRAME_ACTORS = 64;
export const MAX_HOST_FRAME_OBJECTIVES = 32;
export const MAX_HOST_FRAME_EVENTS = 256;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasId(value, maxLength = 96) {
  return isRecord(value) && typeof value.id === 'string' &&
    value.id.length > 0 && value.id.length <= maxLength;
}

/**
 * Validates the transport envelope only. State and event meaning remain opaque:
 * the server must relay host-produced gameplay results, not adjudicate them.
 */
export function validateHostFrame(frame, { maxBytes = MAX_HOST_FRAME_BYTES } = {}) {
  if (!isRecord(frame) || frame.protocolVersion !== HOST_FRAME_PROTOCOL_VERSION ||
      !(typeof frame.matchId === 'string' && frame.matchId.length > 0 && frame.matchId.length <= 96) &&
      !Number.isSafeInteger(frame.matchId) ||
      !Number.isSafeInteger(frame.authorityEpoch) || frame.authorityEpoch < 1 ||
      !Number.isSafeInteger(frame.revision) || frame.revision < 1 ||
      !Number.isSafeInteger(frame.tick) || frame.tick < 1 ||
      !Number.isFinite(frame.simulationTimeMs) || frame.simulationTimeMs < 0 ||
      !Array.isArray(frame.actors) || frame.actors.length > MAX_HOST_FRAME_ACTORS ||
      !Array.isArray(frame.objectives) || frame.objectives.length > MAX_HOST_FRAME_OBJECTIVES ||
      !Array.isArray(frame.events) || frame.events.length > MAX_HOST_FRAME_EVENTS ||
      !Array.isArray(frame.acknowledgements) || frame.acknowledgements.length > MAX_HOST_FRAME_ACTORS) {
    return { valid: false, reason: 'Host frame metadata or collection limits are invalid.' };
  }

  const byteLength = new TextEncoder().encode(JSON.stringify(frame)).byteLength;
  if (byteLength > maxBytes) {
    return { valid: false, reason: 'Host frame exceeds the maximum frame size.' };
  }

  const actorIds = new Set();
  for (const actor of frame.actors) {
    if (!hasId(actor) || !isRecord(actor.state) || actorIds.has(actor.id) ||
        !Number.isFinite(actor.state.x) || !Number.isFinite(actor.state.y)) {
      return { valid: false, reason: 'Host frame contains an invalid or duplicate actor.' };
    }
    actorIds.add(actor.id);
  }

  const objectiveIds = new Set();
  for (const objective of frame.objectives) {
    if (!hasId(objective) || !isRecord(objective.state) || objectiveIds.has(objective.id)) {
      return { valid: false, reason: 'Host frame contains an invalid or duplicate objective.' };
    }
    objectiveIds.add(objective.id);
  }

  const eventIds = new Set();
  for (const event of frame.events) {
    if (!hasId(event) || typeof event.type !== 'string' || event.type.length < 1 ||
        event.type.length > 96 || (event.data !== undefined && !isRecord(event.data)) ||
        (event.audiencePlayerId !== undefined &&
          (typeof event.audiencePlayerId !== 'string' || event.audiencePlayerId.length < 1 ||
            event.audiencePlayerId.length > 96)) ||
        eventIds.has(event.id)) {
      return { valid: false, reason: 'Host frame contains an invalid or duplicate event.' };
    }
    eventIds.add(event.id);
  }

  const acknowledgedActors = new Set();
  for (const acknowledgement of frame.acknowledgements) {
    if (!hasId(acknowledgement) || acknowledgedActors.has(acknowledgement.id) ||
        !Number.isSafeInteger(acknowledgement.inputSequence) || acknowledgement.inputSequence < 0 ||
        !Number.isSafeInteger(acknowledgement.actionSequence) || acknowledgement.actionSequence < 0) {
      return { valid: false, reason: 'Host frame contains an invalid or duplicate acknowledgement.' };
    }
    acknowledgedActors.add(acknowledgement.id);
  }

  if (frame.snapshot !== undefined) {
    const snapshot = frame.snapshot;
    if (!isRecord(snapshot) || snapshot.startedAt !== frame.matchId ||
        !Number.isFinite(snapshot.gameplayStartsAt) || !Number.isFinite(snapshot.endsAt) ||
        !Number.isFinite(snapshot.updatedAt) || !Array.isArray(snapshot.smokes) ||
        snapshot.smokes.length > MAX_HOST_FRAME_EVENTS || !Array.isArray(snapshot.gadgetEffects) ||
        snapshot.gadgetEffects.length > MAX_HOST_FRAME_EVENTS ||
        (snapshot.pendingGadgetEffects !== undefined && (!Array.isArray(snapshot.pendingGadgetEffects) ||
          snapshot.pendingGadgetEffects.length > MAX_HOST_FRAME_EVENTS)) ||
        !(snapshot.victory === null || isRecord(snapshot.victory)) ||
        !(snapshot.postGame === null || isRecord(snapshot.postGame)) ||
        !(snapshot.quickPlayState === null || isRecord(snapshot.quickPlayState))) {
      return { valid: false, reason: 'Host frame contains an invalid gameplay snapshot.' };
    }
    if (frame.objectives.length !== 1 || frame.objectives[0].id !== 'flag') {
      return { valid: false, reason: 'Host frame snapshot must include the flag objective.' };
    }
    for (const actor of frame.actors) {
      if (actor.state.id !== actor.id) {
        return { valid: false, reason: 'Host frame actor state identity does not match its envelope.' };
      }
    }
  }

  return { valid: true, byteLength };
}
