import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directory to store player state files
const SAVE_DIR = path.join(__dirname, 'player_saves');

// Ensure save directory exists
if (!fs.existsSync(SAVE_DIR)) {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
}

/**
 * Generate a unique player ID
 */
export function generatePlayerId() {
  return crypto.randomUUID();
}

/**
 * Save player state to disk
 * @param {string} playerId - Unique player ID
 * @param {Object} player - Player object to save
 */
export function savePlayerState(playerId, player) {
  try {
    const state = {
      playerId,
      username: player.username,
      r: player.r,
      g: player.g,
      b: player.b,
      x: player.x,
      y: player.y,
      money: player.money,
      biome: player.biome,
      selectedGun: player.selectedGun,
      lastRecoveryZone: player.lastRecoveryZone,
      // Serialize components
      chassis: serializeComponent(player.chassis),
      engine: serializeComponent(player.engine),
      wings: serializeComponent(player.wings),
      gun1: serializeComponent(player.gun1),
      gun2: serializeComponent(player.gun2),
      // Serialize inventory
      inventory: player.inventory.map(item => serializeComponent(item)),
      // Timestamp
      savedAt: Date.now()
    };

    const filePath = path.join(SAVE_DIR, `${playerId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    console.log(`Saved player state for ${player.username} (ID: ${playerId})`);
    return true;
  } catch (error) {
    console.error(`Error saving player state for ID ${playerId}:`, error);
    return false;
  }
}

/**
 * Load player state from disk
 * @param {string} playerId - Unique player ID
 * @returns {Object|null} Player state or null if not found
 */
export function loadPlayerState(playerId) {
  try {
    const filePath = path.join(SAVE_DIR, `${playerId}.json`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const data = fs.readFileSync(filePath, 'utf8');
    const state = JSON.parse(data);
    
    console.log(`Loaded player state for ${state.username} (ID: ${playerId})`);
    return state;
  } catch (error) {
    console.error(`Error loading player state for ID ${playerId}:`, error);
    return null;
  }
}

/**
 * Delete player state from disk
 * @param {string} playerId - Unique player ID
 */
export function deletePlayerState(playerId) {
  try {
    const filePath = path.join(SAVE_DIR, `${playerId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted player state for ID: ${playerId}`);
    }
  } catch (error) {
    console.error(`Error deleting player state for ID ${playerId}:`, error);
  }
}

/**
 * Serialize a component (engine, chassis, wings, gun) to plain object
 */
function serializeComponent(component) {
  if (!component) return null;
  
  // Create a plain object with all properties
  const serialized = {
    type: component.type,
    name: component.name,
    weight: component.weight,
    value: component.value
  };

  // Add type-specific properties
  if (component.type === 'engine') {
    serialized.maxPower = component.maxPower;
    serialized.minPower = component.minPower;
    serialized.heatEfficiency = component.heatEfficiency;
    serialized.maxHeat = component.maxHeat;
  } else if (component.type === 'chassis') {
    serialized.topSpeed = component.topSpeed;
    serialized.maxHull = component.maxHull;
    serialized.heatDispersion = component.heatDispersion;
    serialized.buoyancy = component.buoyancy;
  } else if (component.type === 'wings') {
    serialized.baseTurnSpeed = component.baseTurnSpeed;
    serialized.minTurnSpeed = component.minTurnSpeed;
    serialized.maxSpeed = component.maxSpeed;
    serialized.liftEfficiency = component.liftEfficiency;
    serialized.minLiftSpeed = component.minLiftSpeed;
    serialized.liftAngle = component.liftAngle;
    serialized.airBrake = component.airBrake;
    serialized.airBrakeStrength = component.airBrakeStrength;
  } else if (component.type === 'gun') {
    serialized.maxHeat = component.maxHeat;
    serialized.heatEfficiency = component.heatEfficiency;
    serialized.damage = component.damage;
    serialized.cooldownTime = component.cooldownTime;
    serialized.projectileSpeed = component.projectileSpeed;
    serialized.projectileSize = component.projectileSize;
    serialized.maxAngle = component.maxAngle;
    serialized.heatDispersion = component.heatDispersion;
    serialized.projectileRange = component.projectileRange;
  }

  return serialized;
}
