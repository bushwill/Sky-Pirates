import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deletePlayerState, getAllSaveIds } from './PlayerStateManager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENTS_DIR = path.join(__dirname, 'database', 'client_list', 'clients');
const ACCOUNTS_DIR = path.join(__dirname, 'database', 'client_list', 'accounts');

class ClientManager {
    constructor() {
        this.clients = {};
        this.accounts = {};
        this.loadAll();
    }

    /**
     * Normalizes a username to a consistent safe key (lowercase).
     */
    normalizeKey(username) {
        return username ? username.toLowerCase() : '';
    }

    loadAll() {
        // Ensure directories exist
        if (!fs.existsSync(CLIENTS_DIR)) fs.mkdirSync(CLIENTS_DIR, { recursive: true });
        if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });

        // Load Clients
        try {
            const clientFiles = fs.readdirSync(CLIENTS_DIR);
            clientFiles.forEach(file => {
                if (file.endsWith('.json')) {
                    const id = file.replace('.json', '');
                    const data = JSON.parse(fs.readFileSync(path.join(CLIENTS_DIR, file), 'utf8'));
                    this.clients[id] = data;
                }
            });
        } catch (err) {
            console.error("Error loading clients:", err);
        }

        // Load Accounts
        try {
            const accountFiles = fs.readdirSync(ACCOUNTS_DIR);
            accountFiles.forEach(file => {
                if (file.endsWith('.json')) {
                    const originalFilename = file.replace('.json', '');
                    const key = this.normalizeKey(originalFilename);
                    
                    try {
                        const data = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, file), 'utf8'));
                        
                        // Ensure original display name is preserved if missing
                        if (!data.username) {
                            data.username = originalFilename;
                        }
                        
                        this.accounts[key] = data;
                    } catch (readErr) {
                         console.error(`Error reading account file ${file}:`, readErr);
                    }
                }
            });
        } catch (err) {
            console.error("Error loading accounts:", err);
        }
    }
    
    // Obsolete single-file save
    save() {
        // No-op for legacy calls, now we save individually
    }
    
    saveClient(clientId) {
        if (!this.clients[clientId]) return;
        const filePath = path.join(CLIENTS_DIR, `${clientId}.json`);
        const data = JSON.stringify(this.clients[clientId], null, 2);
        
        fs.writeFile(filePath, data, 'utf8', (err) => {
            if (err) console.error(`Error saving client ${clientId}:`, err);
        });
    }
    
    saveAccount(usernameOrKey) {
        const key = this.normalizeKey(usernameOrKey);
        const account = this.accounts[key];
        if (!account) return;
        
        // Use normalized key for filename to ensure case consistency on disk
        const safeName = key.replace(/[^a-z0-9]/g, '_'); 
        const filePath = path.join(ACCOUNTS_DIR, `${safeName}.json`);
        const data = JSON.stringify(account, null, 2);
        
        fs.writeFile(filePath, data, 'utf8', (err) => {
            if (err) console.error(`Error saving account ${account.username}:`, err);
        });
    }

    /**
     * Gets or creates a client entry for a given device ID.
     * @param {string} clientId - The unique ID from the client's cookie.
     * @param {string} [defaultGameSaveId] - The existing game save ID if known (for migration/initialization).
     * @returns {Object} The client object.
     */
    getClient(clientId, defaultGameSaveId = null) {
        if (!this.clients[clientId]) {
            // Create new guest client
            this.clients[clientId] = {
                type: 'guest',
                accountName: null,
                gameSaveId: defaultGameSaveId, // Link to game save
                created: Date.now(),
                lastSeen: Date.now(),
                achievements: {} // Guest achievements
            };
            this.saveClient(clientId);
        } else {
            // Update last seen
            this.clients[clientId].lastSeen = Date.now();
            
            // If we have a defaultGameSaveId but the client record has none, update it (only for guests)
            if (defaultGameSaveId && !this.clients[clientId].gameSaveId && this.clients[clientId].type === 'guest') {
                this.clients[clientId].gameSaveId = defaultGameSaveId;
            }
            
            // Ensure achievements object exists
            if (!this.clients[clientId].achievements) {
                this.clients[clientId].achievements = {};
            }
            
            this.saveClient(clientId);
        }
        return this.clients[clientId];
    }

    getAccount(username) {
        const key = this.normalizeKey(username);
        const account = this.accounts[key];
        if (account && !account.achievements) {
            account.achievements = {};
        }
        return account;
    }

    /**
     * Retrieves achievement data for a client (delegates to Account if linked)
     */
    getAchievementsForClient(clientId) {
        const client = this.clients[clientId];
        if (!client) return {};

        if (client.type === 'account' && client.accountName) {
            const account = this.getAccount(client.accountName);
            return account ? (account.achievements || {}) : {};
        }
        return client.achievements || {};
    }

    /**
     * Updates an achievement for a client (delegates to Account if linked)
     */
    updateAchievement(clientId, achievementId, achievementData) {
        const client = this.clients[clientId];
        if (!client) return; 

        let target = client;
        let isAccount = false;
        let saveKey = clientId;

        if (client.type === 'account' && client.accountName) {
            const account = this.getAccount(client.accountName);
            if (account) {
                 target = account;
                 isAccount = true;
                 saveKey = client.accountName;
            }
        }

        if (!target.achievements) target.achievements = {};
        
        target.achievements[achievementId] = achievementData;

        if (isAccount) {
            this.saveAccount(saveKey);
        } else {
            this.saveClient(saveKey);
        }
    }
    
    getAccountForClient(clientId) {
        const client = this.clients[clientId];
        if (client && client.type === 'account' && client.accountName) {
             const account = this.accounts[client.accountName];
             if (account) {
                 return account;
             }
        }
        return null;
    }
    
    updateAccountGameSaveId(username, newGameSaveId) {
        const key = this.normalizeKey(username);
        if (this.accounts[key]) {
            this.accounts[key].gameSaveId = newGameSaveId;
            this.saveAccount(key);
            return true;
        }
        return false;
    }

    /**
     * Updates the saved game save ID for a specific client (guest only).
     * @param {string} clientId 
     * @param {string} newGameSaveId 
     */
    updateClientGameSaveId(clientId, newGameSaveId) {
        if (this.clients[clientId]) {
            this.clients[clientId].gameSaveId = newGameSaveId;
            this.saveClient(clientId);
            return true;
        }
        return false;
    }

    createAccount(username, password, gameSaveId) {
        const key = this.normalizeKey(username);
        if (this.accounts[key]) {
            return { success: false, message: "Username already taken." };
        }

        this.accounts[key] = {
            username: username, // Store original display name
            password: password, // Case-sensitive
            gameSaveId: gameSaveId,
            created: Date.now(),
            achievements: {}
        };
        this.saveAccount(key);
        return { success: true, message: "Account created." };
    }

    /**
     * Verifies account credentials.
     * @param {string} username 
     * @param {string} password 
     * @returns {string|null} The gameSaveId if successful, or null.
     */
    verifyAccount(username, password) {
        const key = this.normalizeKey(username);
        const account = this.accounts[key];
        // Checks account existence (normalized) and password match (case sensitive)
        if (account && account.password === password) {
            return account.gameSaveId;
        }
        return null;
    }

    /**
     * Links a client device to an account.
     * @param {string} clientId 
     * @param {string} username 
     */
    assignClientToAccount(clientId, username) {
        const key = this.normalizeKey(username);
        if (this.clients[clientId] && this.accounts[key]) {
            this.clients[clientId].type = 'account';
            this.clients[clientId].accountName = key;
            // When assigned, the client link to 'gameSaveId' is ignored in favor of Account's
            this.saveClient(clientId);
            
            // Clean up stale clients for this account (prevents duplicate build-up from resets)
            this.cleanupStaleClients(key, clientId);
            
            return true;
        }
        return false;
    }

    /**
     * Removes other client records for the same account that haven't been seen recently.
     * Prevents "zombie" clients from accumulating if cookies are cleared.
     * @param {string} username 
     * @param {string} currentClientId - The ID of the client currently logging in (don't delete this!)
     */
    cleanupStaleClients(username, currentClientId) {
        const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
        const now = Date.now();

        Object.keys(this.clients).forEach(otherClientId => {
            if (otherClientId === currentClientId) return; // Skip self

            const client = this.clients[otherClientId];
            if (client.accountName === username) {
                // It's a match. Check if it's stale.
                if ((now - client.lastSeen) > STALE_THRESHOLD) {
                    console.log(`Cleaning up stale client ${otherClientId} for account ${username}`);
                    // Note: We do NOT delete the game save here because it belongs to the Account now (or is preserved).
                    
                    // Delete from memory
                    delete this.clients[otherClientId];
                    // Delete from disk
                    try {
                        const filePath = path.join(CLIENTS_DIR, `${otherClientId}.json`);
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (err) {
                        console.error(`Failed to delete stale client file ${otherClientId}:`, err);
                    }
                }
            }
        });
    }
    
    /**
     * Resolves the Game Save ID for a given Client ID.
     * Checks if client is guest (uses stored gameSaveId) or account (uses account's gameSaveId).
     */
    getGameSaveIdForClient(clientId) {
        const client = this.clients[clientId];
        if (!client) return null;

        if (client.type === 'account' && client.accountName) {
             const account = this.accounts[client.accountName];
             if (account) return account.gameSaveId;
        }
        
        return client.gameSaveId;
    }

    /**
     * Performs a full cleanup of databases.
     * 1. Removes Guest clients inactive for > 30 days.
     * 2. Identifies all Game Saves referenced by remaining Clients or Accounts.
     * 3. Deletes any Game Save file that is NOT referenced (orphaned).
     */
    performDatabaseCleanup() {
        console.log("Starting database cleanup...");
        const STALE_GUEST_THRESHOLD = 30 * 24 * 60 * 60 * 1000; // 30 Days
        const now = Date.now();
        let clientsRemoved = 0;
        let savesRemoved = 0;

        // 1. Cleanup Stale Guests
        Object.keys(this.clients).forEach(clientId => {
            const client = this.clients[clientId];
            // Only prune "guest" types. Account-linked clients are kept to remember the link (unless we want to prune them too, assuming they can re-login)
            // But let's stick to guests for safety.
            if (client.type === 'guest' && (now - client.lastSeen) > STALE_GUEST_THRESHOLD) {
                // Delete file
                try {
                    const filePath = path.join(CLIENTS_DIR, `${clientId}.json`);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    delete this.clients[clientId];
                    clientsRemoved++;
                } catch (err) {
                    console.error(`Failed to delete stale client ${clientId}:`, err);
                }
            }
        });
        
        if (clientsRemoved > 0) console.log(`Cleanup: Removed ${clientsRemoved} stale guest clients.`);

        // 2. Collection Referenced Game IDs
        const referencedSaveIds = new Set();
        
        // From Clients (Guests)
        Object.values(this.clients).forEach(c => {
            if (c.gameSaveId) referencedSaveIds.add(c.gameSaveId);
        });
        
        // From Accounts
        Object.values(this.accounts).forEach(a => {
            if (a.gameSaveId) referencedSaveIds.add(a.gameSaveId);
        });
        
        // 3. Delete Orphans
        const existingSaveIds = getAllSaveIds();
        existingSaveIds.forEach(id => {
            if (!referencedSaveIds.has(id)) {
                // It's an orphan
                deletePlayerState(id);
                savesRemoved++;
            }
        });

        if (savesRemoved > 0) console.log(`Cleanup: Removed ${savesRemoved} orphaned game saves.`);
        console.log("Database cleanup completed.");
    }
}

export const clientManager = new ClientManager();
