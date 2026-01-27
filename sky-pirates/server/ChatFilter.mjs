// ChatFilter.mjs

// Slurs and hate speech only - General profanity (swearing) is allowed.
// This list focuses on terms used to demean or incite hate against protected groups.
const BANNED_WORDS = [
    // --- Racial & Ethnic Slurs ---
    // Anti-Black
    "nigger", "nigg3r", "n1gger", "nigga", "niggah", "negro", "nnegro",
    "coon", "c00n", "jigaboo", "jiggaboo", "jigger", 
    "porchmonkey", "tarbaby", "sambo", "pickaninny",
    "bluegum", "boong", "kaffir", "kaffer", "moulino", "mouliny",
    
    // Anti-Asian
    "chink", "ch1nk", "gook", "jap", 
    "zipperhead",
    "paki", // Slur in UK context
    
    // Anti-Latino/Hispanic
    "spic", "spick", "wetback", "beaner", "greaser", "sudaca",
    
    // Anti-Semitic (Jewish)
    "kike", "kyke", "yid", "hebe", "hymie", "sheeny", "shylock",
    
    // Anti-Middle Eastern / Muslim / Arab
    "raghead", "towelhead", "sandnigger", "dunecoon", "cameljockey", "haji",
    
    // Anti-White (severe only)
    "cracker", "honky", "peckerwood", "whitey", 
    "wop", "dago", "guinea", "polack", "kraut", "mick", 
    
    // Indigenous
    "squaw", "redskin", "prairienigger", "abl", // abos/boong

    // Roma / Traveller
    "gypsy", "pikey", "gypo",

    // --- LGBTQ+ Slurs ---
    // Homophobic
    "faggot", "fag", "f4g", "fagg", "faghag", 
    "dyke", "d1ke", "lesbo", "rugmuncher", "carpetmuncher",
    "sodomite", "battyboy", "battyman", "poofter",
    
    // Transphobic
    "tranny", "trannie", "shemale", "she-male", "he-she", "heshe", 
    "shim", "genderbender", "t-girl", "dickgirl", "ladyboy",
    
    // --- Ableist Slurs (Severe) ---
    "retard", "r3tard", "retarded", "tard", "libtard",
    "mongoloid", "windowlicker",
    
    // --- Other/General Hate ---
    "subhuman", "untermensch"
];

/**
 * Checks if a message contains inappropriate content (slurs/hate speech).
 * @param {string} message - The message to check
 * @returns {boolean} - True if message is clean, False if it contains banned words
 */
export function isMessageAppropriate(message) {
    if (!message) return true;
    const lowerMsg = message.toLowerCase();
    
    // Normalize substitutions: 0->o, 1->i, 3->e, 4->a, 5->s, 7->t, 8->b
    const normalizedMsg = lowerMsg
        .replace(/0/g, 'o')
        .replace(/1/g, 'i') 
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/8/g, 'b');

    // Check for banned words in both the original and normalized strings
    // checking "lowerMsg" catches exact matches if they are in the list
    // checking "normalizedMsg" catches variations not in the list
    const targets = [lowerMsg, normalizedMsg];
    
    // Check for banned words
    for (const word of BANNED_WORDS) {
        // Use regex for word boundaries to avoid false positives
        // but handle non-boundary cases for obvious bypasses if needed
        
        // Escape special regex chars if any in the list
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Match word boundary OR start/end of string
        const regex = new RegExp(`(?:^|\\s|[^a-z0-9])${escapedWord}(?:$|\\s|[^a-z0-9])`, 'i');
        
        for (const target of targets) {
            if (regex.test(target)) {
                return false;
            }
        }
    }
    
    return true;
}
