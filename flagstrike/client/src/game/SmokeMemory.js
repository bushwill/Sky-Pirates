export function rememberSmokeObservation(memoryById, smoke, visibleSamples, observedAt) {
  if (!(memoryById instanceof Map) || typeof smoke?.id !== 'string' ||
      !Array.isArray(visibleSamples) || visibleSamples.length === 0 || !Number.isFinite(observedAt)) return null;

  let memory = memoryById.get(smoke.id);
  if (!memory) {
    memory = {
      smoke: { ...smoke },
      known: false,
      lastSeenAt: null,
      status: 'unseen',
    };
  }

  const currentlyVisible = visibleSamples.some(Boolean);
  if (currentlyVisible) {
    memory.smoke = { ...smoke };
    memory.known = true;
    memory.lastSeenAt = observedAt;
    memory.status = 'visible';
  } else if (memory.status === 'visible') {
    memory.status = 'remembered';
  }

  memoryById.set(smoke.id, memory);
  return memory;
}

export function pruneSmokeMemory(memoryById, activeSmokeIds) {
  if (!(memoryById instanceof Map) || !(activeSmokeIds instanceof Set)) return;
  for (const smokeId of memoryById.keys()) {
    if (!activeSmokeIds.has(smokeId)) memoryById.delete(smokeId);
  }
}
