import { getPlayerVisionOrigin, isCircleVisible, isPointVisible, VISION_HALF_ANGLE } from './VisionModel.js';
import { PLAYER_RADIUS } from './MovementModel.js';
import {
  isPlayerFlashBlinded,
  SPY_CAMERA_ID,
  TROPHY_SYSTEM_ID,
  VINE_TRAP_ID,
} from './GadgetModel.js';

export function collectBotPerception(bot, match, weaponState, enemies, now, visionObjects) {
  const visionAngle = bot.visionAngle ?? weaponState.aimAngle ?? 0;
  const origin = getPlayerVisionOrigin(bot, match.map.objects);
  const vision = { origin, angle: visionAngle, halfAngle: VISION_HALF_ANGLE };
  const blinded = isPlayerFlashBlinded(bot, now);
  const visibleEnemies = blinded ? [] : enemies.filter((enemy) =>
    isCircleVisible(enemy, enemy.radius ?? PLAYER_RADIUS, vision, visionObjects));
  const visibleEnemyMines = blinded ? [] : (match.gadgetEffects ?? []).filter((effect) =>
    (effect.type === 'mine' ||
      effect.type === VINE_TRAP_ID && !effect.latchedEnemyId) &&
    ['red', 'blue'].includes(effect.team) && effect.team !== bot.team &&
    effect.expiresAt > now &&
    isPointVisible(effect, vision, visionObjects))
    .sort((left, right) => distance(bot, left) - distance(bot, right) ||
      String(left.id).localeCompare(String(right.id)));
  const visibleEnemyDeployables = blinded ? [] : (match.gadgetEffects ?? []).filter((effect) =>
    [SPY_CAMERA_ID, TROPHY_SYSTEM_ID].includes(effect.type) &&
    ['red', 'blue'].includes(effect.team) && effect.team !== bot.team &&
    effect.expiresAt > now && effect.health > 0 &&
    isPointVisible(effect, vision, visionObjects))
    .sort((left, right) => distance(bot, left) - distance(bot, right) ||
      String(left.id).localeCompare(String(right.id)));

  return { visionAngle, vision, visibleEnemies, visibleEnemyMines, visibleEnemyDeployables };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
