import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deletePlayerState } from './PlayerStateManager.mjs';

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
                    const username = file.replace('.json', '');
                    const data = JSON.parse(fs.readFileSync(path.join(ACCOUNTS_DIR, file), 'utf8'));
                    this.accounts[username] = data;
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
        try {
            const filePath = path.join(CLIENTS_DIR, `${clientId}.json`);
            fs.writeFileSync(filePath, JSON.stringify(this.clients[clientId], null, 2), 'utf8');
        } catch (err) {
            console.error(`Error saving client ${clientId}:`, err);
        }
    }
    
    saveAccount(username) {
        if (!this.accounts[username]) return;
        try {
            // Sanitize username for filename if needed, but assuming simple alphanumeric for now
            const safeName = username.replace(/[^a-z0-9]/gi, '_'); 
            const filePath = path.join(ACCOUNTS_DIR, `${safeName}.json`);
            fs.writeFileSync(filePath, JSON.stringify(this.accounts[username], null, 2), 'utf8');
        } catch (err) {
            console.error(`Error saving account ${username}:`, err);
        }
    }

    /**
     * Gets or creates a client entry for a given device ID.
     * @param {string} clientId - The unique ID from the client's cookie.
     * @param {string} [defaultPlayerId] - The existing player ID if known (for migration/initialization).
     * @returns {Object} The client object.
     */
    getClient(clientId, defaultPlayerId = null) {
        if (!this.clients[clientId]) {
            // Create new guest client
            this.clients[clientId] = {
                type: 'guest',
                accountName: null,
                playerId: defaultPlayerId, // If migrating, link to existing save
                created: Date.now(),
                lastSeen: Date.now()
            };
            this.saveClient(clientId);
        } else {
            // Update last seen
            this.clients[clientId].lastSeen = Date.now();
            
            // If we have a defaultPlayerId but the client record has none, update it
            if (defaultPlayerId && !this.clients[clientId].playerId && this.clients[clientId].type === 'guest') {
                this.clients[clientId].playerId = defaultPlayerId;
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
        if (!this.accounts[username]) return null;
        if (!this.accounts[username].achievements) {
            this.accounts[username].achievements = {};
        }
        return this.accounts[username];
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

    /**
     * Registers a new account.
     * @param {string} username 
     * @param {string} password 
     * @param {string} playerId 
     * @returns {object} { success: boolean, message: string }
     */
    getAccount(username) {
        return this.accounts[username];
    }
    
    getAccountForClient(clientId) {
        const client = this.clients[clientId];
        if (client && client.type === 'account' && client.accountName) {
             const account = this.accounts[client.accountName];
             // Return the account object structure expected by App.js
             if (account) {
                 return { username: client.accountName, ...account };
             }
        }
        return null;
    }
    
    updateAccountSaveId(username, newPlayerId) {
        if (this.accounts[username]) {
            this.accounts[username].playerId = newPlayerId;
            this.saveAccount(username);
            return true;
        }
        return false;
    }

    /**
     * Updates the saved player ID for a specific client (guest or account linked).
     * @param {string} clientId 
     * @param {string} newPlayerId 
     */
    updateClientSaveId(clientId, newPlayerId) {
        if (this.clients[clientId]) {
            this.clients[clientId].playerId = newPlayerId;
            this.saveClient(clientId);
            return true;
        }
        return false;
    }

    createAccount(username, password, playerId) {
        if (this.accounts[username]) {
            return { success: false, message: "Username already taken." };
        }

        this.accounts[username] = {
            password: password, // In production, hash this!
            playerId: playerId,
            created: Date.now()
        };
        this.saveAccount(username);
        return { success: true, message: "Account created." };
    }

    /**
     * Verifies account credentials.
     * @param {string} username 
     * @param {string} password 
     * @returns {string|null} The playerId if successful, or null.
     */
    verifyAccount(username, password) {
        const account = this.accounts[username];
        if (account && account.password === password) {
            return account.playerId;
        }
        return null;
    }

    /**
     * Links a client device to an account.
     * @param {string} clientId 
     * @param {string} username 
     */
    assignClientToAccount(clientId, username) {
        if (this.clients[clientId] && this.accounts[username]) {
            this.clients[clientId].type = 'account';
            this.clients[clientId].accountName = username;
            // When assigned, the client uses the account's player ID usually,
            // but we might keep the local playerId ref for fallback or history.
            this.saveClient(clientId);
            
            // Clean up stale clients for this account (prevents duplicate build-up from resets)
            this.cleanupStaleClients(username, clientId);
            
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
                    
                    // Cleanup linked save file if it exists and is distinct from the account's current save logic
                    // (NOTE: In 'account' mode, the save is usually linked to the account's playerID, so we shouldn't delete the save unless it's an orphan)
                    // But if this was a transient guest session that got linked, it might have its own ID.
                    // For safety, ONLY delete the save if it is DIFFERENT from the account's active player ID
                    // to avoid deleting the user's actual progress.
                    
                    const accountPlayerId = this.accounts[username].playerId;
                    if (client.playerId && client.playerId !== accountPlayerId) {
                        console.log(`Deleting orphaned save ${client.playerId} from stale client`);
                        deletePlayerState(client.playerId);
                    }

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
     * Resolves the Game Player ID for a given Client ID.
     * Checks if client is guest (uses stored playerId) or account (uses account's playerId).
     */
    getPlayerIdForClient(clientId) {
        const client = this.clients[clientId];
        if (!client) return null;

        if (client.type === 'account' && client.accountName) {
             const account = this.accounts[client.accountName];
             if (account) return account.playerId;
        }
        
        return client.playerId;
    }
}

export const clientManager = new ClientManager();
