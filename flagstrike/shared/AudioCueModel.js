import { getInventoryEffects } from './InventoryModel.js';
import { getPlayerMovementScale, MAX_PLAYER_SPEED } from './MovementModel.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from './ProjectileModel.js';
import { getPlayerVisionOrigin, isPointVisible, VISION_HALF_ANGLE } from './VisionModel.js';
import { isGadgetJammed, isPlayerJammed } from './GadgetModel.js';

export const FOOTSTEP_HEARING_RADIUS = 300;
const FOOTSTEP_MIN_SPEED_RATIO = 0.8;
const FOOTSTEP_CUE_INTERVAL_MS = 450;
const FOOTSTEP_CUE_LIFETIME_MS = 650;

export function isAudioSourceVisibleToPlayer(observer, source, visionObjects, weapons, now = Date.now()) {
  if (!observer?.alive || observer.health <= 0 ||
      (Number.isFinite(observer.flashUntil) && observer.flashUntil > now)) return false;
  const weapon = getWeaponDefinition(weapons, observer.selectedWeaponId);
  const angle = observer.visionAngle ?? observer.weaponStats?.[weapon.id]?.aimAngle ?? 0;
  const origin = getPlayerVisionOrigin(observer, visionObjects);
  return isPointVisible(source, { origin, angle, halfAngle: VISION_HALF_ANGLE }, visionObjects);
}

export function isAudioSourceVisibleToTeam(players, team, source, visionObjects, weapons, now = Date.now()) {
  return players.some((observer) => {
    if (observer.team !== team ||
        isPlayerJammed(observer, now) ||
        !observer.alive || observer.health <= 0) return false;
    return isAudioSourceVisibleToPlayer(observer, source, visionObjects, weapons, now);
  });
}

export function findSonarListener(players, source, sourceTeam, gadgetEffects, now = Date.now()) {
  const playerById = new Map((players ?? []).map((player) => [player.id, player]));
  let closest = null;
  for (const sonar of gadgetEffects ?? []) {
    if (sonar.type !== 'sonar-projectile' || sonar.team === sourceTeam || sonar.expiresAt <= now ||
        isGadgetJammed(sonar, now)) continue;
    const owner = playerById.get(sonar.ownerId);
    if (!owner || !owner.alive || owner.health <= 0 || isPlayerJammed(owner, now)) continue;
    const distanceSquared = (source.x - sonar.x) ** 2 + (source.y - sonar.y) ** 2;
    const radius = sonar.listeningRadius ?? 300;
    if (distanceSquared > radius * radius ||
        (closest && distanceSquared >= closest.distanceSquared)) continue;
    closest = { team: sonar.team, ownerId: sonar.ownerId, sonarId: sonar.id, distanceSquared };
  }
  return closest;
}

export function collectFootstepAudioCues(match, now, {
  lastCueAt,
  random = Math.random,
  projectileDefinitions = DEFAULT_PROJECTILE_DEFINITIONS,
  mapObjects = match?.map?.objects ?? [],
} = {}) {
  if (!match || !Array.isArray(match.players) || !Array.isArray(mapObjects) ||
      !(lastCueAt instanceof Map) || typeof random !== 'function') return [];
  const players = match.players;
  const visionObjects = [...mapObjects, ...(match.smokes ?? []).filter((smoke) => smoke.expiresAt > now)];
  const activeSonars = (match.gadgetEffects ?? []).filter((effect) =>
    effect.type === 'sonar-projectile' && effect.expiresAt > now && !isGadgetJammed(effect, now) &&
    players.some((player) => player.id === effect.ownerId && player.alive && player.health > 0 &&
      !isPlayerJammed(player, now)));
  const cues = [];
  for (const source of players) {
    if (!source.alive || source.health <= 0) continue;
    const weapon = getWeaponDefinition(projectileDefinitions, source.selectedWeaponId);
    const normalSpeedCap = MAX_PLAYER_SPEED * getPlayerMovementScale(
      match.flag?.heldBy === source.id,
      weapon.movementScale,
      getInventoryEffects(source.inventory).movementBonus,
    );
    if (Math.hypot(source.vx ?? 0, source.vy ?? 0) < normalSpeedCap * FOOTSTEP_MIN_SPEED_RATIO) continue;

    const closestByTeam = new Map();
    for (const listener of players) {
      if (!listener.alive || listener.health <= 0 || listener.team === source.team ||
          isPlayerJammed(listener, now) ||
          (Number.isFinite(listener.flashUntil) && listener.flashUntil > now)) continue;
      const dx = source.x - listener.x;
      const dy = source.y - listener.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > FOOTSTEP_HEARING_RADIUS * FOOTSTEP_HEARING_RADIUS) continue;
      const previous = closestByTeam.get(listener.team);
      if (!previous || distanceSquared < previous.distanceSquared) {
        closestByTeam.set(listener.team, { distanceSquared, listenerId: listener.id });
      }
    }

    const sonarByTeam = new Map();
    for (const sonar of activeSonars) {
      if (sonar.team === source.team) continue;
      const dx = source.x - sonar.x;
      const dy = source.y - sonar.y;
      const distanceSquared = dx * dx + dy * dy;
      const radius = sonar.listeningRadius ?? FOOTSTEP_HEARING_RADIUS;
      if (distanceSquared > radius * radius) continue;
      const previous = sonarByTeam.get(sonar.team);
      if (!previous || distanceSquared < previous.distanceSquared) {
        sonarByTeam.set(sonar.team, {
          distanceSquared,
          listenerId: sonar.ownerId,
          sonarId: sonar.id,
        });
      }
    }
    for (const [team, sonar] of sonarByTeam) {
      const previous = closestByTeam.get(team);
      if (!previous || sonar.distanceSquared < previous.distanceSquared) closestByTeam.set(team, sonar);
    }

    for (const [team, { distanceSquared, listenerId, sonarId }] of closestByTeam) {
      if (!sonarId && isAudioSourceVisibleToTeam(
        players, team, source, visionObjects, projectileDefinitions, now,
      )) continue;
      const cueKey = `${source.id}:${team}`;
      if (now - (lastCueAt.get(cueKey) ?? -Infinity) < FOOTSTEP_CUE_INTERVAL_MS) continue;
      lastCueAt.set(cueKey, now);
      const distance = Math.sqrt(distanceSquared);
      const radius = Math.max(8, distance * 0.2);
      const offsetAngle = random() * Math.PI * 2;
      const offsetDistance = random() * radius * 0.5;
      cues.push({
        id: `${match.startedAt}:footstep:${source.id}:${team}:${now}`.slice(0, 96),
        kind: 'footstep',
        team,
        heardById: listenerId,
        ...(sonarId ? { sonarId } : {}),
        x: source.x + Math.cos(offsetAngle) * offsetDistance,
        y: source.y + Math.sin(offsetAngle) * offsetDistance,
        radius,
        expiresAt: now + FOOTSTEP_CUE_LIFETIME_MS,
      });
    }

    for (const listener of players) {
      if (!listener.alive || listener.health <= 0 || listener.team === source.team ||
          !isPlayerJammed(listener, now) ||
          (Number.isFinite(listener.flashUntil) && listener.flashUntil > now)) continue;
      const dx = source.x - listener.x;
      const dy = source.y - listener.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > FOOTSTEP_HEARING_RADIUS * FOOTSTEP_HEARING_RADIUS ||
          isAudioSourceVisibleToPlayer(listener, source, visionObjects, projectileDefinitions, now)) continue;
      const cueKey = `private:${source.id}:${listener.id}`;
      if (now - (lastCueAt.get(cueKey) ?? -Infinity) < FOOTSTEP_CUE_INTERVAL_MS) continue;
      lastCueAt.set(cueKey, now);
      const distance = Math.sqrt(distanceSquared);
      const radius = Math.max(8, distance * 0.2);
      const offsetAngle = random() * Math.PI * 2;
      const offsetDistance = random() * radius * 0.5;
      cues.push({
        id: `${match.startedAt}:footstep:${source.id}:${listener.id}:${now}`.slice(0, 96),
        kind: 'footstep',
        team: listener.team,
        heardById: listener.id,
        audiencePlayerId: listener.controlledById ?? listener.id,
        x: source.x + Math.cos(offsetAngle) * offsetDistance,
        y: source.y + Math.sin(offsetAngle) * offsetDistance,
        radius,
        expiresAt: now + FOOTSTEP_CUE_LIFETIME_MS,
      });
    }
  }
  return cues;
}

function getWeaponDefinition(weapons, weaponId) {
  if (weapons instanceof Map) {
    return weapons.get(weaponId) ?? DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
  }
  return Object.values(weapons ?? {}).find((weapon) => weapon.id === weaponId) ??
    DEFAULT_PROJECTILE_DEFINITIONS.assaultRifle;
}
