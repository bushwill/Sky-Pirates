import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'clients.json');

class ClientManager {
    constructor() {
        this.clients = {};
        this.accounts = {};
        this.load();
    }

    load() {
        if (fs.existsSync(DATA_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                this.clients = data.clients || {};
                this.accounts = data.accounts || {};
            } catch (err) {
                console.error("Error loading clients.json:", err);
                this.clients = {};
                this.accounts = {};
            }
        }
    }

    save() {
        try {
            const data = {
                clients: this.clients,
                accounts: this.accounts
            };
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        } catch (err) {
            console.error("Error saving clients.json:", err);
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
            this.save();
        } else {
            // Update last seen
            this.clients[clientId].lastSeen = Date.now();
            
            // If we have a defaultPlayerId but the client record has none, update it
            if (defaultPlayerId && !this.clients[clientId].playerId && this.clients[clientId].type === 'guest') {
                this.clients[clientId].playerId = defaultPlayerId;
            }
            this.save();
        }
        return this.clients[clientId];
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
            this.save();
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
            this.save();
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
        this.save();
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
            this.save();
            return true;
        }
        return false;
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
