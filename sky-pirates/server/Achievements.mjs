
import { clientManager } from './ClientManager.mjs';
import { sendNoticeMessage, sendPlayerAchievements } from './App.mjs';

export class Achievement {
    constructor(id, title, description) {
        this.id = id;
        this.title = title;
        this.description = description;
        this.completed = false;
        this.unlockedAt = null;
        
        // Progress tracking
        this.progress = 0;
        this.milestones = []; // Object array: { target: 10, rewardMsg: "..." }
        // If no milestones allow manual complete() for single-step achievements
    }

    complete(player) {
         if (this.completed) return false;
         
         this.completed = true;
         this.progress = 1; // Treat boolean complete as 1/1
         this.unlockedAt = Date.now();
         
         this.save(player);
         this.reward(player);
         sendPlayerAchievements(player);
         return true;
    }

    increment(player, amount = 1) {
        if (this.completed) return;
        
        this.progress += amount;
        
        // Check milestones
        let justUnlocked = false;
        
        // Sort milestones by target
        // (Assuming they are defined in order, but good to be safe if dynamic)
        
        let allMet = true;
        let lastMetIndex = -1;

        for (let i = 0; i < this.milestones.length; i++) {
            if (this.progress >= this.milestones[i].target && !this.milestones[i].unlocked) {
                // New milestone reached!
                this.milestones[i].unlocked = true;
                this.milestones[i].unlockedAt = Date.now();
                this.onMilestoneReached(player, this.milestones[i]);
                justUnlocked = true;
            }
            if (!this.milestones[i].unlocked) allMet = false;
        }

        // If simple achievement without milestones, progress usually doesn't apply unless subclassed logic
        // But if we have milestones, check if ALL are done
        if (this.milestones.length > 0 && allMet) {
             this.completed = true;
             this.unlockedAt = Date.now();
        }

        // Optimization: Don't save continuous stats on every frame unless a milestone was reached or completed
        if (justUnlocked || this.completed || (this.id !== 'distance_flown' && this.id !== 'top_speed')) {
             this.save(player);
        }
        
        if (this.id !== 'distance_flown') {
            sendPlayerAchievements(player);
        }
        return justUnlocked;
    }
    
    save(player) {
         if (player.clientId) {
            clientManager.updateAchievement(player.clientId, this.id, {
                completed: this.completed,
                unlockedAt: this.unlockedAt,
                progress: this.progress,
                // Save target to allow smart matching on load if definitions change
                milestones: this.milestones.map(m => ({ 
                    unlocked: m.unlocked, 
                    unlockedAt: m.unlockedAt,
                    target: m.target 
                }))
            });
         }
    }

    reward(player) {
        // Base implementation does nothing
    }
    
    onMilestoneReached(player, milestone) {
        // Default notification
        sendNoticeMessage(player.username, `Milestone Reached: ${milestone.title}!`, 'game');
    }
}

export class EnemyKillerAchievement extends Achievement {
    constructor() {
        super('enemy_killer', 'Ace Pilot', 'Destroy enemy planes.');
        this.milestones = [
            { target: 10, title: 'Fighter' },
            { target: 50, title: 'Ace' },
            { target: 500, title: 'Legend' },
            { target: 1500, title: 'Mythic' }
        ].map(m => ({ ...m, unlocked: false, unlockedAt: null }));
    }

    onMilestoneReached(player, milestone) {
        sendNoticeMessage(player.username, `Milestone: ${milestone.title} (${this.progress} Kills)`, 'game');
    }
}

export class PlayerKillerAchievement extends Achievement {
    constructor() {
        super('player_killer', 'Sky Pirate', 'Destroy other players.');
        this.milestones = [
            { target: 10, title: 'Bandit' },
            { target: 50, title: 'Corsair' },
            { target: 500, title: 'Dread Pirate' },
            { target: 1500, title: 'Scourge' }
        ].map(m => ({ ...m, unlocked: false, unlockedAt: null }));
    }

    onMilestoneReached(player, milestone) {
        sendNoticeMessage(player.username, `Milestone: ${milestone.title} (${this.progress} Kills)`, 'game');
    }
}

export class DistanceTravelledAchievement extends Achievement {
    constructor() {
        super('distance_flown', 'Explorer', 'Distance flown in the skies.');
        this.milestones = [
            { target: 50000, title: 'Traveler' },
            { target: 250000, title: 'Voyager' },
            { target: 2500000, title: 'Nomad' },
            { target: 7500000, title: 'Cartographer' }
        ].map(m => ({ ...m, unlocked: false, unlockedAt: null }));
    }

    onMilestoneReached(player, milestone) {
        sendNoticeMessage(player.username, `Milestone: ${milestone.title} (${Math.floor(this.progress/1000)}km)`, 'game');
    }
}

export class TopSpeedAchievement extends Achievement {
    constructor() {
        super('top_speed', 'Speed Demon', 'Reach high speeds.');
        this.milestones = [
            { target: 300, title: 'Fast' },
            { target: 500, title: 'Really fast' },
            { target: 800, title: 'Insanely fast' },
            { target: 1000, title: 'How?' }
        ].map(m => ({ ...m, unlocked: false, unlockedAt: null }));
    }
    
    // Override increment to act as a "Total max" setter rather than adder
    increment(player, currentSpeed) {
        if (this.completed) return;
        
        // Progress tracks the MAX speed reached, not a sum
        if (currentSpeed > this.progress) {
             this.progress = Math.floor(currentSpeed);
             
             // Check milestones against new max
             let justUnlocked = false;
             let allMet = true;

             for (let i = 0; i < this.milestones.length; i++) {
                if (this.progress >= this.milestones[i].target && !this.milestones[i].unlocked) {
                    this.milestones[i].unlocked = true;
                    this.milestones[i].unlockedAt = Date.now();
                    this.onMilestoneReached(player, this.milestones[i]);
                    justUnlocked = true;
                }
                if (!this.milestones[i].unlocked) allMet = false;
             }

             if (this.milestones.length > 0 && allMet) {
                 this.completed = true;
                 this.unlockedAt = Date.now();
             }
             
             this.save(player);
             sendPlayerAchievements(player);
             return justUnlocked;
        }
        return false;
    }

    onMilestoneReached(player, milestone) {
        sendNoticeMessage(player.username, `Milestone: ${milestone.title} (${milestone.target} m/s)`, 'game');
    }
}

export class CrateHunterAchievement extends Achievement {
    constructor() {
        super('crate_hunter', 'Treasure Hunter', 'Collect and open crates.');
        this.milestones = [
            { target: 50, title: 'Scavenger' },
            { target: 250, title: 'Collector' },
            { target: 2500, title: 'Hoarder' },
            { target: 7500, title: 'Tycoon' }
        ];
    }
}

export class FishKillerAchievement extends Achievement {
    constructor() {
        super('fish_killer', 'Needless Cruelty', 'Kill fish.');
        this.milestones = [
            { target: 50, title: 'Monster' }
        ];
    }
}

// Global registry of achievement CLASSES, not instances
export const ACHIEVEMENT_CLASSES = [
    EnemyKillerAchievement,
    PlayerKillerAchievement,
    DistanceTravelledAchievement,
    TopSpeedAchievement,
    CrateHunterAchievement,
    FishKillerAchievement
];

export function syncPlayerAchievements(player, rawAchievements = {}) {
    const newAchievementsMap = {};

    ACHIEVEMENT_CLASSES.forEach(ClassRef => {
        // Create fresh instance
        const instance = new ClassRef();
        
        // Check if we have saved data for this specific achievement ID
        if (rawAchievements[instance.id]) {
            const raw = rawAchievements[instance.id];
            // Restore state
            instance.completed = !!raw.completed;
            instance.unlockedAt = raw.unlockedAt || null;
            instance.progress = raw.progress || 0;
            
            // Restore milestones
            // Improved Logic:
            // 1. Try to find matching saved state (preferring target match, falling back to index) to preserve timestamps
            // 2. ALWAYS enforce "progress >= target" rule to ensure inserted/reordered milestones unlock correctly
            if (raw.milestones && Array.isArray(raw.milestones)) {
                instance.milestones.forEach((m, i) => {
                    // Try to find a match in saved data
                    let savedM = null;
                    
                    // Priority 1: Match by target (if saved data has it)
                    const targetMatch = raw.milestones.find(rm => rm.target === m.target);
                    if (targetMatch) {
                        savedM = targetMatch;
                    } else if (raw.milestones[i] && typeof raw.milestones[i].target === 'undefined') {
                        // Priority 2: Fallback to index matching ONLY if saved data is legacy (no target saved)
                        // If saved data DOES have targets but none matched, then this is a NEW milestone (don't use index i)
                        savedM = raw.milestones[i];
                    }

                    // Apply saved state if found
                    if (savedM) {
                        m.unlocked = savedM.unlocked;
                        m.unlockedAt = savedM.unlockedAt;
                    }

                    // CRITICAL: Force unlock if progress dictates it (handles new milestones inserted between old ones)
                    if (instance.progress >= m.target) {
                        if (!m.unlocked) {
                            m.unlocked = true;
                            m.unlockedAt = Date.now(); // New unlock
                        }
                    }
                });
            } else if (instance.completed && instance.milestones.length > 0) {
                // If legacy completed but no milestones data, assume all done
                instance.milestones.forEach(m => { m.unlocked = true; m.unlockedAt = instance.unlockedAt; });
            }
        }
        
        newAchievementsMap[instance.id] = instance;
    });
    
    // Replace the player's achievement object with the Map of instances
    player.achievements = newAchievementsMap;
}

export function getAchievementDataForClient(player) {
    const data = [];
    if (player.achievements) {
        Object.values(player.achievements).forEach(ach => {
            // Calculate next target for display
            let nextTarget = 0;
            let currentTier = 0;
            if (ach.milestones.length > 0) {
                 const nextM = ach.milestones.find(m => !m.unlocked);
                 if (nextM) nextTarget = nextM.target;
                 else nextTarget = ach.milestones[ach.milestones.length-1].target;
            } else {
                 nextTarget = 1; 
            }

            data.push({
                id: ach.id,
                title: ach.title,
                description: ach.description,
                completed: ach.completed,
                unlockedAt: ach.unlockedAt,
                progress: Math.floor(ach.progress),
                maxProgress: nextTarget,
                hasMilestones: ach.milestones.length > 0,
                milestones: ach.milestones
            });
        });
    }
    // Sort: completed first
    data.sort((a, b) => {
        if (a.completed === b.completed) return 0;
        return a.completed ? -1 : 1; 
    });
    return data;
}
