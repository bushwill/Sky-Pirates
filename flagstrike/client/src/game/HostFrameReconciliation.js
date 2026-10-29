import { applyInventoryWeaponEffects } from '../../../shared/InventoryModel.js';
import { DEFAULT_PROJECTILE_DEFINITIONS } from '../../../shared/ProjectileModel.js';
import { reconcileWeaponStats } from './WeaponPrediction.js';

export function reconcileOwnerWeaponSnapshot(player, pendingActions, now) {
  const definitions = Object.fromEntries(Object.values(DEFAULT_PROJECTILE_DEFINITIONS).map((definition) => [
    definition.id,
    applyInventoryWeaponEffects(definition, player.inventory),
  ]));
  return reconcileWeaponStats(
    player.weaponStats ?? {},
    pendingActions,
    definitions,
    player.lastWeaponActionSequence ?? 0,
    now,
    Math.hypot(player.vx ?? 0, player.vy ?? 0),
  );
}
