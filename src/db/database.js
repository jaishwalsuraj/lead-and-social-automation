import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../../growth_engine.db');

// Ensure parent dir exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(DB_PATH);

// Enable WAL mode for high performance concurrent reads/writes
db.pragma('journal_mode = WAL');

/**
 * Helper to parse post age, ISO dates, or relative time text (e.g., '4h', '2d', '1w')
 */
export function parsePostAge(postText = '', timestampStr = null) {
  const now = Date.now();

  // 1. If explicit ISO timestamp provided
  if (timestampStr) {
    const parsed = new Date(timestampStr);
    if (!isNaN(parsed.getTime())) {
      const diffMs = Math.max(0, now - parsed.getTime());
      const ageDays = diffMs / (1000 * 60 * 60 * 24);
      let text = '';
      if (ageDays < 1 / 24) {
        const mins = Math.max(1, Math.round(diffMs / (1000 * 60)));
        text = `${mins}m ago`;
      } else if (ageDays < 1) {
        const hours = Math.max(1, Math.round(ageDays * 24));
        text = `${hours}h ago`;
      } else {
        const days = Math.round(ageDays * 10) / 10;
        text = `${days}d ago`;
      }
      return {
        post_date: parsed.toISOString(),
        post_time_text: text,
        post_age_days: Math.round(ageDays * 100) / 100,
        is_within_7_days: ageDays <= 7
      };
    }
  }

  // 2. Parse relative time patterns from text header where timestamps reside
  const headerText = postText.slice(0, 250);
  const mMatch = headerText.match(/(?:^|\n|\s)(\d+)\s*(?:m|min|mins|minute|minutes)\b/i) || postText.match(/\b(\d+)\s*(?:min|mins|minutes)\b/i);
  const hMatch = headerText.match(/(?:^|\n|\s)(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i) || postText.match(/\b(\d+)\s*(?:hr|hrs|hours)\b/i);
  const dMatch = headerText.match(/(?:^|\n|\s)(\d+)\s*(?:d|day|days)\b/i) || postText.match(/\b(\d+)\s*(?:day|days)\b/i);
  const wMatch = headerText.match(/(?:^|\n|\s)(\d+)\s*(?:w|wk|wks|week|weeks)\b/i) || postText.match(/\b(\d+)\s*(?:wk|wks|weeks)\b/i);
  const moMatch = headerText.match(/(?:^|\n|\s)(\d+)\s*(?:mo|month|months)\b/i) || postText.match(/\b(\d+)\s*(?:month|months)\b/i);

  let ageDays = 0.1; // Default recent (< 3 hours)
  let text = 'Recent (< 1d)';

  if (mMatch) {
    const mins = parseInt(mMatch[1], 10);
    ageDays = mins / 1440;
    text = `${mins}m ago`;
  } else if (hMatch) {
    const hrs = parseInt(hMatch[1], 10);
    ageDays = hrs / 24;
    text = `${hrs}h ago`;
  } else if (dMatch) {
    const days = parseInt(dMatch[1], 10);
    ageDays = days;
    text = `${days}d ago`;
  } else if (wMatch) {
    const weeks = parseInt(wMatch[1], 10);
    ageDays = weeks * 7;
    text = `${weeks}w ago`;
  } else if (moMatch) {
    const mos = parseInt(moMatch[1], 10);
    ageDays = mos * 30;
    text = `${mos}mo ago`;
  }

  const postDate = new Date(now - ageDays * 24 * 60 * 60 * 1000);
  return {
    post_date: postDate.toISOString(),
    post_time_text: text,
    post_age_days: Math.round(ageDays * 100) / 100,
    is_within_7_days: ageDays <= 7
  };
}

// Initialize database schemas
export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      author_name TEXT,
      author_handle TEXT,
      author_url TEXT,
      post_url TEXT UNIQUE,
      post_text TEXT,
      intent_score INTEGER DEFAULT 0,
      intent_reason TEXT,
      keyword_matched TEXT,
      status TEXT DEFAULT 'discovered',
      ai_comment TEXT,
      last_dm TEXT,
      post_date DATETIME,
      post_time_text TEXT,
      post_age_days REAL DEFAULT 0,
      discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reached_out_at DATETIME,
      last_comment_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      content TEXT NOT NULL,
      image_path TEXT,
      status TEXT DEFAULT 'draft',
      scheduled_at DATETIME,
      published_at DATETIME,
      post_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT,
      action_type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_quotas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date_str TEXT NOT NULL,
      platform TEXT NOT NULL,
      comments_count INTEGER DEFAULT 0,
      dms_count INTEGER DEFAULT 0,
      posts_count INTEGER DEFAULT 0,
      UNIQUE(date_str, platform)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lead_learning_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_type TEXT NOT NULL,
      term_or_pattern TEXT NOT NULL,
      platform TEXT DEFAULT 'all',
      weight REAL DEFAULT 1.0,
      source_lead_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(signal_type, term_or_pattern)
    );

    CREATE TABLE IF NOT EXISTS blocked_authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_handle TEXT NOT NULL UNIQUE,
      author_name TEXT,
      platform TEXT DEFAULT 'all',
      reason TEXT,
      source_lead_id INTEGER,
      blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Automatic migration for timestamp, post link, and quality feedback columns
  try {
    const cols = db.pragma('table_info(leads)').map(c => c.name);
    if (!cols.includes('post_date')) db.exec('ALTER TABLE leads ADD COLUMN post_date DATETIME');
    if (!cols.includes('post_time_text')) db.exec('ALTER TABLE leads ADD COLUMN post_time_text TEXT');
    if (!cols.includes('post_age_days')) db.exec('ALTER TABLE leads ADD COLUMN post_age_days REAL DEFAULT 0');
    if (!cols.includes('discovered_at')) db.exec('ALTER TABLE leads ADD COLUMN discovered_at DATETIME');
    if (!cols.includes('reached_out_at')) db.exec('ALTER TABLE leads ADD COLUMN reached_out_at DATETIME');
    if (!cols.includes('last_comment_url')) db.exec('ALTER TABLE leads ADD COLUMN last_comment_url TEXT');
    if (!cols.includes('feedback')) db.exec('ALTER TABLE leads ADD COLUMN feedback TEXT');
    if (!cols.includes('feedback_at')) db.exec('ALTER TABLE leads ADD COLUMN feedback_at DATETIME');
    if (!cols.includes('feedback_notes')) db.exec('ALTER TABLE leads ADD COLUMN feedback_notes TEXT');

    // Ensure blocked_authors table is created (in case DB existed before this version)
    db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_authors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_handle TEXT NOT NULL UNIQUE,
        author_name TEXT,
        platform TEXT DEFAULT 'all',
        reason TEXT,
        source_lead_id INTEGER,
        blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS google_maps_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name TEXT NOT NULL,
        category TEXT,
        phone TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        rating REAL,
        reviews_count INTEGER DEFAULT 0,
        has_website INTEGER DEFAULT 0,
        website_url TEXT,
        maps_url TEXT UNIQUE,
        social_links TEXT,
        missing_socials TEXT,
        opportunity_score INTEGER DEFAULT 0,
        opportunity_type TEXT,
        opportunity_summary TEXT,
        ai_call_script TEXT,
        ai_whatsapp_pitch TEXT,
        ai_email_pitch TEXT,
        status TEXT DEFAULT 'discovered',
        search_query TEXT,
        location_searched TEXT,
        discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS scorecard_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name TEXT NOT NULL,
        contact_person TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        business_type TEXT,
        city TEXT,
        consultation_fee TEXT,
        work_timing TEXT,
        overall_score INTEGER DEFAULT 0,
        video_score INTEGER DEFAULT 0,
        discovery_score INTEGER DEFAULT 0,
        conversion_score INTEGER DEFAULT 0,
        answers TEXT,
        prescription_text TEXT,
        prescription_data TEXT,
        status TEXT DEFAULT 'new',
        notes TEXT,
        topmate_booked INTEGER DEFAULT 0,
        source TEXT DEFAULT 'scorecard_test',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'assigned',
        name TEXT NOT NULL,
        email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
      );
    `);

    // Verification columns on social leads table
    if (!cols.includes('verification_status')) db.exec("ALTER TABLE leads ADD COLUMN verification_status TEXT DEFAULT 'unverified'");
    if (!cols.includes('verified_at')) db.exec("ALTER TABLE leads ADD COLUMN verified_at DATETIME");
    if (!cols.includes('verification_reason')) db.exec("ALTER TABLE leads ADD COLUMN verification_reason TEXT");
    if (!cols.includes('notes')) db.exec("ALTER TABLE leads ADD COLUMN notes TEXT");

    // Contactability and verification columns on google_maps_leads table
    const mapsCols = db.prepare('PRAGMA table_info(google_maps_leads)').all().map(c => c.name);
    if (!mapsCols.includes('email')) db.exec("ALTER TABLE google_maps_leads ADD COLUMN email TEXT");
    if (!mapsCols.includes('whatsapp_url')) db.exec("ALTER TABLE google_maps_leads ADD COLUMN whatsapp_url TEXT");
    if (!mapsCols.includes('contact_status')) db.exec("ALTER TABLE google_maps_leads ADD COLUMN contact_status TEXT DEFAULT 'verified'");
    if (!mapsCols.includes('contact_methods')) db.exec("ALTER TABLE google_maps_leads ADD COLUMN contact_methods TEXT DEFAULT '[]'");
    if (!mapsCols.includes('is_medical')) db.exec("ALTER TABLE google_maps_leads ADD COLUMN is_medical INTEGER DEFAULT 0");
    if (!mapsCols.includes('doctor_prescription')) db.exec("ALTER TABLE google_maps_leads ADD COLUMN doctor_prescription TEXT");
    if (!mapsCols.includes('social_audit')) db.exec("ALTER TABLE google_maps_leads ADD COLUMN social_audit TEXT");

    // Scorecard PDF columns
    const scCols = db.prepare('PRAGMA table_info(scorecard_leads)').all().map(c => c.name);
    if (!scCols.includes('pdf_path')) db.exec("ALTER TABLE scorecard_leads ADD COLUMN pdf_path TEXT");
    if (!scCols.includes('pdf_url')) db.exec("ALTER TABLE scorecard_leads ADD COLUMN pdf_url TEXT");

    // Users password reset and recovery key columns
    const userCols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    if (!userCols.includes('reset_token')) db.exec('ALTER TABLE users ADD COLUMN reset_token TEXT');
    if (!userCols.includes('reset_expires')) db.exec('ALTER TABLE users ADD COLUMN reset_expires DATETIME');
    if (!userCols.includes('recovery_key')) db.exec('ALTER TABLE users ADD COLUMN recovery_key TEXT');

    // Populate defaults for existing records
    db.exec(`
      UPDATE leads SET discovered_at = created_at WHERE discovered_at IS NULL;
      UPDATE leads SET post_date = created_at WHERE post_date IS NULL;
      UPDATE leads SET post_time_text = 'Recent (< 1d)' WHERE post_time_text IS NULL;
      UPDATE leads SET post_age_days = 0.2 WHERE post_age_days IS NULL;
      UPDATE leads SET reached_out_at = updated_at WHERE reached_out_at IS NULL AND status IN ('engaged', 'dm_sent', 'converted');
      UPDATE leads SET last_comment_url = post_url WHERE last_comment_url IS NULL AND status IN ('engaged', 'dm_sent', 'converted');
      UPDATE leads SET verification_status = 'verified' WHERE verification_status IS NULL AND status IN ('engaged', 'dm_sent', 'converted');
      UPDATE leads SET verification_status = 'dead' WHERE status = 'disqualified' AND feedback = 'incorrect';

      // Enforce strict uniqueness: One prospect lead per author per platform
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_platform_handle 
      ON leads(platform, LOWER(TRIM(author_handle))) 
      WHERE author_handle IS NOT NULL AND TRIM(author_handle) != '';
    `);
  } catch (migErr) {
    console.warn('[DB Migration] Note on leads columns:', migErr.message);
  }

  // Seed default settings if empty
  const defaultSettings = [
    { key: 'niche_target', value: 'E-commerce, SaaS, and Digital Product Sales' },
    { key: 'gemini_api_key', value: '' },
    { key: 'daily_max_comments', value: '20' },
    { key: 'daily_max_dms', value: '10' },
    { key: 'autopilot_mode', value: 'false' },
    { key: 'topmate_url', value: 'https://topmate.io/isurajjaiswal' },
    { key: 'agency_name', value: 'The Digital Frog' },
    { key: 'founder_name', value: 'Suraj Jaiswal' },
    { key: 'agency_phone', value: '+91 98765 43210' },
    { key: 'search_keywords', value: JSON.stringify([
      "looking for saas",
      "need ecommerce store",
      "shopify developer recommendation",
      "best tool for sales",
      "recommend an automation tool",
      "looking for digital product",
      "need app for store",
      "software to automate"
    ])}
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const s of defaultSettings) {
    insertSetting.run(s.key, s.value);
  }

  // Seed sample high-intent leads if empty so dashboard is immediately rich and illustrative
  const leadCount = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
  if (leadCount === 0) {
    const seedLeads = [
      {
        platform: 'threads',
        author_name: 'Alex Rivera',
        author_handle: 'alexbuilds_commerce',
        author_url: 'https://threads.net/@alexbuilds_commerce',
        post_url: 'https://www.threads.net/@alexbuilds_commerce/post/demo1',
        post_text: 'Our Shopify store is doing $40k/mo but abandoned checkout rate just jumped to 74%. Looking for an automated SMS or WhatsApp cart recovery tool or SaaS recommendation that actually converts.',
        intent_score: 94,
        intent_reason: 'Ready to Buy: Explicitly seeking cart recovery SaaS tool with verified commercial revenue ($40k/mo). High-ticket client opportunity.',
        keyword_matched: 'looking for saas',
        status: 'discovered',
        ai_comment: 'A 74% cart abandonment rate usually indicates either unexpected shipping costs revealed at checkout or high-friction field validation on mobile. For Shopify, automated multi-channel win-back (triggered within 15 mins) recovers ~18-24% of these carts without discounting. Happy to share our workflow blueprint if you want!',
        post_date: new Date(Date.now() - 4 * 3600000).toISOString(),
        post_time_text: '4h ago',
        post_age_days: 0.17,
        discovered_at: new Date(Date.now() - 3 * 3600000).toISOString(),
        reached_out_at: null,
        last_comment_url: null
      },
      {
        platform: 'linkedin',
        author_name: 'Sarah Chen',
        author_handle: 'sarahchen_tech',
        author_url: 'https://www.linkedin.com/in/sarahchen-tech',
        post_url: 'https://www.linkedin.com/feed/update/urn:li:activity:demo2/',
        post_text: 'We are scaling our B2B SaaS platform and looking to automate our outbound client onboarding pipeline. Can anyone recommend a development agency or automation specialist experienced with API integrations and CRM routing?',
        intent_score: 96,
        intent_reason: 'Ready to Buy: Actively looking to hire automation specialist/agency for B2B SaaS onboarding pipeline.',
        keyword_matched: 'need automation tool',
        status: 'discovered',
        ai_comment: "When onboarding B2B SaaS customers, the key is event-driven webhooks rather than batch syncs so accounts activate in seconds. We've built several automated onboarding pipelines connecting Stripe to custom CRM workflows. Happy to share what worked best!",
        post_date: new Date(Date.now() - 1 * 86400000).toISOString(),
        post_time_text: '1d ago',
        post_age_days: 1.0,
        discovered_at: new Date(Date.now() - 20 * 3600000).toISOString(),
        reached_out_at: null,
        last_comment_url: null
      },
      {
        platform: 'facebook',
        author_name: 'Marcus Vance',
        author_handle: 'marcus.vance',
        author_url: 'https://www.facebook.com/marcus.vance',
        post_url: 'https://www.facebook.com/groups/ecommerce/permalink/demo3/',
        post_text: 'Need someone to build an automated product catalog sync between our WooCommerce store and multiple marketplaces (Amazon/eBay). Please drop recommendations or DM your portfolio.',
        intent_score: 91,
        intent_reason: 'Active Search: Needs developer/agency for e-commerce multi-channel inventory sync.',
        keyword_matched: 'need ecommerce store',
        status: 'engaged',
        ai_comment: 'Syncing WooCommerce across multi-marketplaces requires rate-limited queueing to avoid API throttling during peak sales. We specialize in custom catalog pipelines that keep inventory unified in real-time. Glad to chat through the architecture!',
        post_date: new Date(Date.now() - 2 * 86400000).toISOString(),
        post_time_text: '2d ago',
        post_age_days: 2.0,
        discovered_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        reached_out_at: new Date(Date.now() - 1 * 86400000).toISOString(),
        last_comment_url: 'https://www.facebook.com/groups/ecommerce/permalink/demo3/'
      },
      {
        platform: 'instagram',
        author_name: 'Elena Rostova',
        author_handle: 'elena_dtcbrands',
        author_url: 'https://www.instagram.com/elena_dtcbrands',
        post_url: 'https://www.instagram.com/p/demo4/',
        post_text: 'Any recommendations for software tools that automate customer review requests and UGC collection for direct-to-consumer skincare brands? Looking to switch tools this week.',
        intent_score: 88,
        intent_reason: 'Evaluating Options: Actively switching software tools this week for direct-to-consumer e-commerce brand.',
        keyword_matched: 'best tool for sales',
        status: 'discovered',
        ai_comment: 'Post-purchase timing is everything here—triggering review requests right after delivery confirmation (via carrier webhook) boosts response rates by 3x. Happy to share the exact trigger sequence that converts highest!',
        post_date: new Date(Date.now() - 3 * 86400000).toISOString(),
        post_time_text: '3d ago',
        post_age_days: 3.0,
        discovered_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        reached_out_at: null,
        last_comment_url: null
      }
    ];

    const insertLead = db.prepare(`
      INSERT INTO leads (
        platform, author_name, author_handle, author_url, post_url, post_text, 
        intent_score, intent_reason, keyword_matched, status, ai_comment,
        post_date, post_time_text, post_age_days, discovered_at, reached_out_at, last_comment_url
      )
      VALUES (
        @platform, @author_name, @author_handle, @author_url, @post_url, @post_text, 
        @intent_score, @intent_reason, @keyword_matched, @status, @ai_comment,
        @post_date, @post_time_text, @post_age_days, @discovered_at, @reached_out_at, @last_comment_url
      )
    `);

    for (const l of seedLeads) {
      insertLead.run(l);
    }
  }

  // Remove legacy accounts and ensure Super Admin dmsuraj3@gmail.com is established
  db.prepare("DELETE FROM users WHERE username IN ('admin', 'assigned')").run();

  const superAdmin = db.prepare("SELECT * FROM users WHERE LOWER(username) = 'dmsuraj3@gmail.com' OR LOWER(email) = 'dmsuraj3@gmail.com'").get();
  if (!superAdmin) {
    const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || 'SurajFrog2026!#';
    const recoveryKey = process.env.ADMIN_RECOVERY_KEY || 'FROG-SURAJ-9921';
    UserModel.create({
      username: 'dmsuraj3@gmail.com',
      password: initialPassword,
      role: 'admin',
      name: 'Suraj Jaiswal',
      email: 'dmsuraj3@gmail.com',
      recoveryKey: recoveryKey
    });
    console.log('👑 Super Admin account created: dmsuraj3@gmail.com');
  } else {
    if (!superAdmin.recovery_key) {
      db.prepare("UPDATE users SET recovery_key = ? WHERE id = ?").run('FROG-SURAJ-9921', superAdmin.id);
    }
  }
}

// ==================== AUTHENTICATION & USER MANAGEMENT ====================
export function hashPassword(password, salt = null) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 64).toString('hex');
  return { hash, salt: s };
}

export function verifyPassword(password, hash, salt) {
  try {
    const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
  } catch {
    return false;
  }
}

export const UserModel = {
  create: ({ username, password, role = 'assigned', name, email = null, recoveryKey = null }) => {
    const { hash, salt } = hashPassword(password);
    const recKey = recoveryKey || `FROG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash, salt, role, name, email, recovery_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(username.toLowerCase().trim(), hash, salt, role, name || username, email ? email.toLowerCase().trim() : null, recKey);
    return info.lastInsertRowid;
  },

  findByUsername: (identifier) => {
    if (!identifier) return null;
    const clean = identifier.trim().toLowerCase();
    return db.prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?').get(clean, clean);
  },

  findByEmail: (email) => {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    return db.prepare('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?').get(clean, clean);
  },

  findById: (id) => {
    return db.prepare('SELECT id, username, role, name, email, recovery_key, created_at, last_login FROM users WHERE id = ?').get(id);
  },

  getAll: () => {
    return db.prepare('SELECT id, username, role, name, email, created_at, last_login FROM users ORDER BY created_at ASC').all();
  },

  verifyPassword: (user, password) => {
    if (!user || !user.password_hash || !user.salt) return false;
    return verifyPassword(password, user.password_hash, user.salt);
  },

  updatePassword: (id, newPassword) => {
    const { hash, salt } = hashPassword(newPassword);
    return db.prepare('UPDATE users SET password_hash = ?, salt = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?').run(hash, salt, id);
  },

  setResetToken: (id, token, expiresAt) => {
    return db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expiresAt, id);
  },

  clearResetToken: (id) => {
    return db.prepare('UPDATE users SET reset_token = NULL, reset_expires = NULL WHERE id = ?').run(id);
  },

  setRecoveryKey: (id, key) => {
    return db.prepare('UPDATE users SET recovery_key = ? WHERE id = ?').run(key, id);
  },

  getRecoveryKey: (id) => {
    const row = db.prepare('SELECT recovery_key FROM users WHERE id = ?').get(id);
    return row ? row.recovery_key : null;
  },

  updateLastLogin: (id) => {
    return db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },

  delete: (id) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return { success: false, error: 'User not found' };
    if (user.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
      if (adminCount <= 1) {
        throw new Error('Cannot delete the sole Administrator account');
      }
    }
    return db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
};

// Helper methods for easy querying
export const LeadModel = {
  create: (lead) => {
    // If post_time_text or post_age_days not provided, compute it from post_text or timestamp
    if (lead.post_age_days === undefined || lead.post_time_text === undefined) {
      const parsedTime = parsePostAge(lead.post_text, lead.post_date || lead.created_at);
      lead.post_date = lead.post_date || parsedTime.post_date;
      lead.post_time_text = lead.post_time_text || parsedTime.post_time_text;
      lead.post_age_days = lead.post_age_days !== undefined ? lead.post_age_days : parsedTime.post_age_days;
    }

    lead.discovered_at = lead.discovered_at || new Date().toISOString();
    lead.reached_out_at = lead.reached_out_at || (['engaged', 'dm_sent', 'converted'].includes(lead.status) ? new Date().toISOString() : null);
    lead.last_comment_url = lead.last_comment_url || (['engaged', 'dm_sent'].includes(lead.status) ? lead.post_url : null);
    lead.last_dm = lead.last_dm || null;

    // Strict duplicate check: by author_handle on same platform, OR by post_url
    const cleanHandle = (lead.author_handle || '').trim().toLowerCase();
    const cleanPlatform = (lead.platform || '').trim().toLowerCase();
    const cleanUrl = lead.post_url ? lead.post_url.split('?')[0].split('#')[0].trim() : null;

    let existing = null;
    if (cleanHandle && cleanPlatform) {
      existing = db.prepare('SELECT id, status, intent_score FROM leads WHERE LOWER(platform) = ? AND LOWER(TRIM(author_handle)) = ?').get(cleanPlatform, cleanHandle);
    }
    if (!existing && cleanUrl) {
      existing = db.prepare('SELECT id, status, intent_score FROM leads WHERE post_url = ? OR post_url LIKE ?').get(cleanUrl, `${cleanUrl}%`);
    }

    if (existing) {
      // NEVER insert duplicate! Update existing lead record with latest post activity
      db.prepare(`
        UPDATE leads SET
          intent_score = MAX(leads.intent_score, ?),
          intent_reason = COALESCE(?, leads.intent_reason),
          post_text = COALESCE(?, leads.post_text),
          ai_comment = COALESCE(?, leads.ai_comment),
          post_date = COALESCE(?, leads.post_date),
          post_time_text = COALESCE(?, leads.post_time_text),
          post_age_days = COALESCE(?, leads.post_age_days),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        lead.intent_score || 0,
        lead.intent_reason || null,
        lead.post_text || null,
        lead.ai_comment || null,
        lead.post_date || null,
        lead.post_time_text || null,
        lead.post_age_days || 0,
        existing.id
      );
      return { lastInsertRowid: existing.id, isDuplicate: true };
    }

    // Ensure all required/optional parameters are defined
    const payload = {
      platform: lead.platform || 'twitter',
      author_name: lead.author_name || null,
      author_handle: lead.author_handle || null,
      author_url: lead.author_url || null,
      post_url: lead.post_url || null,
      post_text: lead.post_text || lead.post_content || '',
      intent_score: lead.intent_score || 0,
      intent_reason: lead.intent_reason || null,
      keyword_matched: lead.keyword_matched || null,
      status: lead.status || 'new',
      ai_comment: lead.ai_comment || null,
      last_dm: lead.last_dm || null,
      post_date: lead.post_date || null,
      post_time_text: lead.post_time_text || null,
      post_age_days: lead.post_age_days !== undefined ? lead.post_age_days : 0,
      discovered_at: lead.discovered_at || new Date().toISOString(),
      reached_out_at: lead.reached_out_at || null,
      last_comment_url: lead.last_comment_url || null
    };

    const stmt = db.prepare(`
      INSERT INTO leads (
        platform, author_name, author_handle, author_url, post_url, post_text, 
        intent_score, intent_reason, keyword_matched, status, ai_comment, last_dm,
        post_date, post_time_text, post_age_days, discovered_at, reached_out_at, last_comment_url
      )
      VALUES (
        @platform, @author_name, @author_handle, @author_url, @post_url, @post_text, 
        @intent_score, @intent_reason, @keyword_matched, @status, @ai_comment, @last_dm,
        @post_date, @post_time_text, @post_age_days, @discovered_at, @reached_out_at, @last_comment_url
      )
    `);
    return stmt.run(payload);
  },

  getById: (id) => {
    return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  },

  updateComment: (id, comment) => {
    return db.prepare('UPDATE leads SET ai_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(comment, id);
  },

  updateNotes: (id, notes) => {
    return db.prepare('UPDATE leads SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(notes, id);
  },

  getAll: (options = {}) => {
    let limit = 100;
    let maxDays = 7;
    let status = null;

    if (typeof options === 'number') {
      limit = Math.min(Math.max(options, 1), 1000);
    } else if (typeof options === 'object' && options !== null) {
      if (options.limit !== undefined) {
        const parsedLimit = parseInt(options.limit, 10);
        limit = isNaN(parsedLimit) || parsedLimit <= 0 ? 100 : Math.min(parsedLimit, 1000);
      }
      if (options.maxDays !== undefined) {
        maxDays = options.maxDays === 'all' ? 99999 : (parseFloat(options.maxDays) || 7);
      }
      if (options.status) status = options.status;
    }

    const whereClauses = [];
    const params = [];

    if (maxDays < 90000) {
      whereClauses.push('(post_age_days <= ? OR post_age_days IS NULL)');
      params.push(maxDays);
    }

    if (status) {
      whereClauses.push('status = ?');
      params.push(status);
    }

    if (options.feedback && options.feedback !== 'all') {
      if (options.feedback === 'unreviewed') {
        whereClauses.push('(feedback IS NULL OR feedback = "")');
      } else {
        whereClauses.push('feedback = ?');
        params.push(options.feedback);
      }
    }

    if (options.verification_status && options.verification_status !== 'all') {
      whereClauses.push('verification_status = ?');
      params.push(options.verification_status);
    }

    // Default: Newest leads on top (Descending by discovery/created date)
    let orderBy = 'ORDER BY COALESCE(discovered_at, created_at, post_date) DESC, id DESC';
    if (options.sortBy === 'newest' || options.sortBy === 'date_desc') {
      orderBy = 'ORDER BY COALESCE(discovered_at, created_at, post_date) DESC, id DESC';
    } else if (options.sortBy === 'oldest' || options.sortBy === 'date_asc') {
      orderBy = 'ORDER BY COALESCE(discovered_at, created_at, post_date) ASC, id ASC';
    } else if (options.sortBy === 'intent') {
      orderBy = 'ORDER BY intent_score DESC, COALESCE(discovered_at, created_at) DESC';
    } else if (options.sortBy === 'freshness') {
      orderBy = 'ORDER BY post_age_days ASC, post_date DESC';
    } else if (options.sortBy === 'status') {
      orderBy = "ORDER BY CASE status WHEN 'discovered' THEN 1 WHEN 'engaged' THEN 2 WHEN 'dm_sent' THEN 3 WHEN 'converted' THEN 4 ELSE 5 END, intent_score DESC";
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(limit);

    return db.prepare(`SELECT * FROM leads ${whereSql} ${orderBy} LIMIT ?`).all(...params);
  },

  getByStatus: (status, maxDays = 7) => {
    if (maxDays && maxDays !== 'all') {
      return db.prepare('SELECT * FROM leads WHERE status = ? AND (post_age_days <= ? OR post_age_days IS NULL) ORDER BY intent_score DESC').all(status, parseFloat(maxDays));
    }
    return db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY intent_score DESC').all(status);
  },

  /**
   * Records user quality feedback ('correct' vs 'incorrect') and learns rules to refine future lead generation
   */
  setFeedback: (id, feedback, notes = '') => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!lead) throw new Error(`Lead #${id} not found`);

    const validFeedback = ['correct', 'incorrect', 'reset'].includes(feedback) ? feedback : null;
    const feedbackVal = validFeedback === 'reset' ? null : validFeedback;

    db.prepare(`
      UPDATE leads 
      SET feedback = ?, 
          feedback_at = CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END,
          feedback_notes = ?,
          status = CASE WHEN ? = 'incorrect' THEN 'disqualified' ELSE status END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(feedbackVal, feedbackVal, notes || null, feedbackVal, id);

    if (feedbackVal === 'incorrect') {
      // 1. BLOCK THE AUTHOR permanently so they never appear again
      if (lead.author_handle) {
        try {
          db.prepare(`
            INSERT OR IGNORE INTO blocked_authors (author_handle, author_name, platform, reason, source_lead_id)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            lead.author_handle.toLowerCase().trim().replace(/^@/, ''),
            lead.author_name || lead.author_handle,
            lead.platform || 'all',
            notes || 'Marked as Not a Lead by user',
            id
          );
        } catch (_) {}
      }

      // 2. Store negative pattern from keyword match (high weight — explicit disqualification signal)
      if (lead.keyword_matched && lead.keyword_matched.length > 2) {
        // Don't blacklist the keyword itself (it's a search term), but store it for pattern analysis only at low weight
        try {
          db.prepare(`
            INSERT INTO lead_learning_rules (signal_type, term_or_pattern, platform, weight, source_lead_id)
            VALUES ('negative', ?, ?, 0.3, ?)
            ON CONFLICT(signal_type, term_or_pattern) DO UPDATE SET weight = weight + 0.1
          `).run(lead.keyword_matched.toLowerCase().trim(), lead.platform || 'all', id);
        } catch (_) {}
      }

      // 3. Extract HIGH-SIGNAL self-promo / networking / irrelevant phrases from the post
      //    These are multi-word patterns that are very specific (not single common words)
      const postText = (lead.post_text || '').toLowerCase();
      const negativePatterns = [
        // Self-promo / creator patterns
        ...(postText.match(/(?:i'?m? a |i am a |i'?m? an? )[\w\s]{3,30}/g) || []),
        ...(postText.match(/(?:let'?s? connect|let us connect|grow together|share what we'?re|share what we are)[^.]{0,40}/g) || []),
        ...(postText.match(/(?:follow|follow me|follow back|follow for follow|check (?:out |my )?(?:profile|page|link|bio))[^.]{0,30}/g) || []),
        ...(postText.match(/(?:hiring|we(?:'re| are) hiring|job opening|job post|join (?:our |my |the )?team)[^.]{0,30}/g) || []),
        ...(postText.match(/(?:promo|discount|coupon|free webinar|link in bio|link in my bio|giveaway|contest)[^.]{0,30}/g) || []),
        ...(postText.match(/(?:solo founder|indie hacker|saas or app builder|startup founder|building in public|building startups)[^.]{0,30}/g) || []),
      ];

      for (const rawPattern of negativePatterns) {
        const pattern = rawPattern.trim().replace(/\s+/g, ' ').slice(0, 80);
        if (pattern.length < 8) continue;
        try {
          db.prepare(`
            INSERT INTO lead_learning_rules (signal_type, term_or_pattern, platform, weight, source_lead_id)
            VALUES ('negative', ?, 'all', 2.0, ?)
            ON CONFLICT(signal_type, term_or_pattern) DO UPDATE SET weight = weight + 0.5
          `).run(pattern, id);
        } catch (_) {}
      }

      // 4. Also extract short distinctive single words from notes (user's own explanation)
      if (notes && notes.length > 3) {
        const noteWords = notes.toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 5 && !['these', 'their', 'about', 'which', 'there', 'other', 'would', 'could', 'being', 'posts', 'users', 'leads'].includes(w));
        for (const word of Array.from(new Set(noteWords)).slice(0, 3)) {
          try {
            db.prepare(`
              INSERT INTO lead_learning_rules (signal_type, term_or_pattern, platform, weight, source_lead_id)
              VALUES ('negative', ?, ?, 1.5, ?)
              ON CONFLICT(signal_type, term_or_pattern) DO UPDATE SET weight = weight + 0.3
            `).run(word, lead.platform || 'all', id);
          } catch (_) {}
        }
      }

    } else if (feedbackVal === 'correct') {
      // Positive learning: reinforce keyword that found this lead
      if (lead.keyword_matched && lead.keyword_matched.length > 2) {
        try {
          db.prepare(`
            INSERT INTO lead_learning_rules (signal_type, term_or_pattern, platform, weight, source_lead_id)
            VALUES ('positive', ?, ?, 2.0, ?)
            ON CONFLICT(signal_type, term_or_pattern) DO UPDATE SET weight = weight + 0.5
          `).run(lead.keyword_matched.toLowerCase().trim(), lead.platform || 'all', id);
        } catch (_) {}
      }
    }

    return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  },

  getLearningRules: (signalType = null) => {
    if (signalType) {
      return db.prepare('SELECT * FROM lead_learning_rules WHERE signal_type = ? ORDER BY weight DESC').all(signalType);
    }
    return db.prepare('SELECT * FROM lead_learning_rules ORDER BY weight DESC').all();
  },

  getBlockedAuthors: () => {
    return db.prepare('SELECT * FROM blocked_authors ORDER BY blocked_at DESC').all();
  },

  /**
   * Checks if an author handle is permanently blocked (user marked their post as "Not a Lead")
   */
  isBlockedAuthor: (authorHandle) => {
    if (!authorHandle) return false;
    const clean = authorHandle.toLowerCase().trim().replace(/^@/, '');
    const found = db.prepare('SELECT id FROM blocked_authors WHERE author_handle = ?').get(clean);
    return found ? { blocked: true, reason: `Author @${clean} is blocked (previously marked Not a Lead)` } : { blocked: false };
  },

  /**
   * Evaluates post text against learned negative rejection patterns (weight >= 1.5 threshold)
   */
  isDisqualifiedText: (text) => {
    if (!text) return { disqualified: false };
    const lower = text.toLowerCase();
    const negativeRules = db.prepare('SELECT term_or_pattern FROM lead_learning_rules WHERE signal_type = ? AND weight >= ?').all('negative', 1.5);
    for (const rule of negativeRules) {
      if (lower.includes(rule.term_or_pattern.toLowerCase())) {
        return { disqualified: true, reason: `Matches learned negative pattern: "${rule.term_or_pattern}"` };
      }
    }
    return { disqualified: false };
  },

  /**
   * Combined check: is this author blocked OR does this post match a negative pattern?
   * Call this BEFORE adding any post to leads during a scan.
   */
  shouldSkipPost: (authorHandle, postText) => {
    const authorCheck = LeadModel.isBlockedAuthor(authorHandle);
    if (authorCheck.blocked) return { skip: true, reason: authorCheck.reason };
    const textCheck = LeadModel.isDisqualifiedText(postText);
    if (textCheck.disqualified) return { skip: true, reason: textCheck.reason };
    return { skip: false };
  },

  updateStatus: (id, status, extra = {}) => {
    const fields = ['status = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values = [status];
    if (extra.ai_comment !== undefined) {
      fields.push('ai_comment = ?');
      values.push(extra.ai_comment);
    }
    if (extra.last_dm !== undefined) {
      fields.push('last_dm = ?');
      values.push(extra.last_dm);
    }
    if (extra.last_comment_url !== undefined) {
      fields.push('last_comment_url = ?');
      values.push(extra.last_comment_url);
    }
    // Record exact timestamp when reaching out via comment or DM
    if (['engaged', 'dm_sent', 'converted'].includes(status)) {
      fields.push('reached_out_at = COALESCE(?, reached_out_at, CURRENT_TIMESTAMP)');
      values.push(extra.reached_out_at || new Date().toISOString());
    }
    values.push(id);
    const sql = `UPDATE leads SET ${fields.join(', ')} WHERE id = ?`;
    return db.prepare(sql).run(...values);
  },

  verifyLead: (id, status = 'verified', reason = null) => {
    if (status === 'dead' || status === 'deleted') {
      return LeadModel.markDead(id, reason || 'Profile or post not found (404/deleted)');
    }
    return db.prepare(`
      UPDATE leads 
      SET verification_status = 'verified', 
          verified_at = CURRENT_TIMESTAMP, 
          verification_reason = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reason || 'Confirmed active', id);
  },

  markDead: (id, reason = 'Profile or post not found (404/deleted)') => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!lead) return null;

    db.prepare(`
      UPDATE leads 
      SET verification_status = 'dead', 
          verified_at = CURRENT_TIMESTAMP, 
          verification_reason = ?,
          status = 'disqualified',
          feedback = 'incorrect',
          feedback_notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(reason, reason, id);

    if (lead.author_handle) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO blocked_authors (author_handle, author_name, platform, reason, source_lead_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          lead.author_handle.toLowerCase().trim().replace(/^@/, ''),
          lead.author_name || lead.author_handle,
          lead.platform || 'all',
          reason,
          id
        );
      } catch (_) {}
    }

    return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  },

  getUnverifiedLeads: () => {
    return db.prepare(`
      SELECT * FROM leads 
      WHERE status != 'disqualified' 
        AND (verification_status IS NULL OR verification_status = 'unverified')
      ORDER BY id DESC
    `).all();
  },

  getStats: (maxDays = 7) => {
    const filter = maxDays < 90000 ? 'WHERE (post_age_days <= ? OR post_age_days IS NULL)' : '';
    const params = maxDays < 90000 ? [maxDays] : [];

    const total = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter}`).get(...params).count;
    const discovered = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter ? filter + ' AND' : 'WHERE'} status = 'discovered'`).get(...params).count;
    const engaged = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter ? filter + ' AND' : 'WHERE'} status = 'engaged'`).get(...params).count;
    const dm_sent = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter ? filter + ' AND' : 'WHERE'} status = 'dm_sent'`).get(...params).count;
    const converted = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter ? filter + ' AND' : 'WHERE'} status = 'converted'`).get(...params).count;
    const high_intent = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter ? filter + ' AND' : 'WHERE'} intent_score >= 70`).get(...params).count;
    const correct_feedback = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter ? filter + ' AND' : 'WHERE'} feedback = 'correct'`).get(...params).count;
    const incorrect_feedback = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter ? filter + ' AND' : 'WHERE'} feedback = 'incorrect'`).get(...params).count;
    const verified = db.prepare(`SELECT COUNT(*) as count FROM leads ${filter ? filter + ' AND' : 'WHERE'} status != 'disqualified' AND verification_status = 'verified'`).get(...params).count;
    const dead = db.prepare(`SELECT COUNT(*) as count FROM leads WHERE verification_status = 'dead'`).get().count;

    return { total, discovered, engaged, dm_sent, converted, high_intent, correct_feedback, incorrect_feedback, verified, dead };
  },

  delete: (id) => {
    return db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  }
};

export const GoogleMapsLeadModel = {
  create: (lead) => {
    const stmt = db.prepare(`
      INSERT INTO google_maps_leads (
        business_name, category, phone, email, whatsapp_url, address, city, state,
        rating, reviews_count, has_website, website_url, maps_url,
        social_links, missing_socials, opportunity_score, opportunity_type,
        opportunity_summary, ai_call_script, ai_whatsapp_pitch, ai_email_pitch,
        status, contact_status, contact_methods, is_medical, doctor_prescription, social_audit, search_query, location_searched
      )
      VALUES (
        @business_name, @category, @phone, @email, @whatsapp_url, @address, @city, @state,
        @rating, @reviews_count, @has_website, @website_url, @maps_url,
        @social_links, @missing_socials, @opportunity_score, @opportunity_type,
        @opportunity_summary, @ai_call_script, @ai_whatsapp_pitch, @ai_email_pitch,
        @status, @contact_status, @contact_methods, @is_medical, @doctor_prescription, @social_audit, @search_query, @location_searched
      )
      ON CONFLICT(maps_url) DO UPDATE SET
        business_name = excluded.business_name,
        category = COALESCE(excluded.category, google_maps_leads.category),
        phone = COALESCE(excluded.phone, google_maps_leads.phone),
        email = COALESCE(excluded.email, google_maps_leads.email),
        whatsapp_url = COALESCE(excluded.whatsapp_url, google_maps_leads.whatsapp_url),
        address = COALESCE(excluded.address, google_maps_leads.address),
        rating = COALESCE(excluded.rating, google_maps_leads.rating),
        reviews_count = COALESCE(excluded.reviews_count, google_maps_leads.reviews_count),
        has_website = excluded.has_website,
        website_url = COALESCE(excluded.website_url, google_maps_leads.website_url),
        social_links = COALESCE(excluded.social_links, google_maps_leads.social_links),
        missing_socials = COALESCE(excluded.missing_socials, google_maps_leads.missing_socials),
        opportunity_score = excluded.opportunity_score,
        opportunity_type = excluded.opportunity_type,
        opportunity_summary = excluded.opportunity_summary,
        ai_call_script = COALESCE(excluded.ai_call_script, google_maps_leads.ai_call_script),
        ai_whatsapp_pitch = COALESCE(excluded.ai_whatsapp_pitch, google_maps_leads.ai_whatsapp_pitch),
        ai_email_pitch = COALESCE(excluded.ai_email_pitch, google_maps_leads.ai_email_pitch),
        contact_status = COALESCE(excluded.contact_status, google_maps_leads.contact_status),
        contact_methods = COALESCE(excluded.contact_methods, google_maps_leads.contact_methods),
        is_medical = COALESCE(excluded.is_medical, google_maps_leads.is_medical),
        doctor_prescription = COALESCE(excluded.doctor_prescription, google_maps_leads.doctor_prescription),
        social_audit = COALESCE(excluded.social_audit, google_maps_leads.social_audit),
        updated_at = CURRENT_TIMESTAMP
    `);

    const cleanName = (lead.business_name || '').trim().toLowerCase();
    const cleanCity = (lead.city || '').trim().toLowerCase();
    const cleanPhone = (lead.phone || '').trim().replace(/[^0-9+]/g, '');
    const cleanUrl = lead.maps_url ? lead.maps_url.split('?')[0] : null;

    let existing = null;
    if (cleanPhone && cleanPhone.length > 6) {
      existing = db.prepare('SELECT id FROM google_maps_leads WHERE REPLACE(REPLACE(phone, " ", ""), "-", "") = ?').get(cleanPhone);
    }
    if (!existing && cleanName && cleanCity) {
      existing = db.prepare('SELECT id FROM google_maps_leads WHERE LOWER(TRIM(business_name)) = ? AND LOWER(TRIM(city)) = ?').get(cleanName, cleanCity);
    }
    if (!existing && cleanUrl) {
      existing = db.prepare('SELECT id FROM google_maps_leads WHERE maps_url LIKE ?').get(`${cleanUrl}%`);
    }

    if (existing) {
      // Update existing record without inserting duplicate
      db.prepare(`
        UPDATE google_maps_leads SET
          rating = COALESCE(?, rating),
          reviews_count = MAX(COALESCE(?, reviews_count), reviews_count),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          website_url = COALESCE(?, website_url),
          has_website = COALESCE(?, has_website),
          whatsapp_url = COALESCE(?, whatsapp_url),
          social_audit = COALESCE(?, social_audit),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        lead.rating ?? null,
        lead.reviews_count || 0,
        lead.phone || null,
        lead.email || null,
        lead.website_url || null,
        lead.has_website ? 1 : 0,
        lead.whatsapp_url || null,
        typeof lead.social_audit === 'string' ? lead.social_audit : (lead.social_audit ? JSON.stringify(lead.social_audit) : null),
        existing.id
      );
      return { lastInsertRowid: existing.id, isDuplicate: true };
    }

    const cleanLead = {
      business_name: lead.business_name,
      category: lead.category || '',
      phone: lead.phone || null,
      email: lead.email || null,
      whatsapp_url: lead.whatsapp_url || null,
      address: lead.address || '',
      city: lead.city || '',
      state: lead.state || '',
      rating: lead.rating ?? null,
      reviews_count: lead.reviews_count || 0,
      has_website: lead.has_website ? 1 : 0,
      website_url: lead.website_url || null,
      maps_url: lead.maps_url,
      social_links: typeof lead.social_links === 'string' ? lead.social_links : JSON.stringify(lead.social_links || {}),
      missing_socials: typeof lead.missing_socials === 'string' ? lead.missing_socials : JSON.stringify(lead.missing_socials || []),
      opportunity_score: lead.opportunity_score || 80,
      opportunity_type: lead.opportunity_type || 'ai_growth',
      opportunity_summary: lead.opportunity_summary || '',
      ai_call_script: lead.ai_call_script || '',
      ai_whatsapp_pitch: lead.ai_whatsapp_pitch || '',
      ai_email_pitch: lead.ai_email_pitch || '',
      status: lead.status || 'discovered',
      contact_status: lead.contact_status || 'verified',
      contact_methods: typeof lead.contact_methods === 'string' ? lead.contact_methods : JSON.stringify(lead.contact_methods || []),
      is_medical: lead.is_medical ? 1 : 0,
      doctor_prescription: lead.doctor_prescription || '',
      social_audit: typeof lead.social_audit === 'string' ? lead.social_audit : (lead.social_audit ? JSON.stringify(lead.social_audit) : null),
      search_query: lead.search_query || '',
      location_searched: lead.location_searched || ''
    };

    return stmt.run(cleanLead);
  },

  getAll: (options = {}) => {
    const whereClauses = [];
    const params = [];

    // By default, exclude uncontactable dead-end leads unless specifically requested
    if (options.include_uncontactable !== 'true') {
      whereClauses.push("(contact_status != 'uncontactable' OR contact_status IS NULL)");
    }

    if (options.has_website !== undefined && options.has_website !== 'all') {
      const val = (options.has_website === 'true' || options.has_website === true || options.has_website === '1') ? 1 : 0;
      whereClauses.push('has_website = ?');
      params.push(val);
    }

    if (options.is_medical !== undefined && options.is_medical !== 'all') {
      const val = (options.is_medical === 'true' || options.is_medical === true || options.is_medical === '1') ? 1 : 0;
      whereClauses.push('is_medical = ?');
      params.push(val);
    }

    if (options.status && options.status !== 'all') {
      whereClauses.push('status = ?');
      params.push(options.status);
    }

    if (options.contact_method === 'phone') {
      whereClauses.push("(phone IS NOT NULL AND phone != '')");
    } else if (options.contact_method === 'email') {
      whereClauses.push("(email IS NOT NULL AND email != '')");
    } else if (options.contact_method === 'whatsapp') {
      whereClauses.push("(whatsapp_url IS NOT NULL AND whatsapp_url != '')");
    }

    if (options.opportunity_type && options.opportunity_type !== 'all') {
      whereClauses.push('opportunity_type = ?');
      params.push(options.opportunity_type);
    }

    if (options.search) {
      whereClauses.push('(business_name LIKE ? OR category LIKE ? OR city LIKE ? OR phone LIKE ? OR email LIKE ?)');
      const s = `%${options.search}%`;
      params.push(s, s, s, s, s);
    }

    // Default: Newest leads strictly on top (Descending by discovered date)
    let orderBy = 'ORDER BY discovered_at DESC, id DESC';
    if (options.sortBy === 'oldest' || options.sortBy === 'date_asc') {
      orderBy = 'ORDER BY discovered_at ASC, id ASC';
    } else if (options.sortBy === 'newest' || options.sortBy === 'date_desc') {
      orderBy = 'ORDER BY discovered_at DESC, id DESC';
    } else if (options.sortBy === 'opportunity_desc') {
      orderBy = 'ORDER BY opportunity_score DESC, discovered_at DESC';
    } else if (options.sortBy === 'reviews_asc') {
      orderBy = 'ORDER BY reviews_count ASC, opportunity_score DESC';
    } else if (options.sortBy === 'rating_asc') {
      orderBy = 'ORDER BY rating ASC, reviews_count ASC';
    }

    const limit = Math.min(parseInt(options.limit || '100', 10), 500);
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(limit);

    return db.prepare(`SELECT * FROM google_maps_leads ${whereSql} ${orderBy} LIMIT ?`).all(...params);
  },

  getById: (id) => {
    return db.prepare('SELECT * FROM google_maps_leads WHERE id = ?').get(id);
  },

  updateStatus: (id, status) => {
    return db.prepare('UPDATE google_maps_leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  },

  updateContactDetails: (id, details) => {
    return db.prepare(`
      UPDATE google_maps_leads 
      SET phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          whatsapp_url = COALESCE(?, whatsapp_url),
          has_website = COALESCE(?, has_website),
          website_url = COALESCE(?, website_url),
          social_links = COALESCE(?, social_links),
          contact_status = COALESCE(?, contact_status),
          contact_methods = COALESCE(?, contact_methods),
          opportunity_score = COALESCE(?, opportunity_score),
          opportunity_type = COALESCE(?, opportunity_type),
          opportunity_summary = COALESCE(?, opportunity_summary),
          is_medical = COALESCE(?, is_medical),
          doctor_prescription = COALESCE(?, doctor_prescription),
          social_audit = COALESCE(?, social_audit),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      details.phone || null,
      details.email || null,
      details.whatsapp_url || null,
      details.has_website !== undefined ? (details.has_website ? 1 : 0) : null,
      details.website_url || null,
      details.social_links ? (typeof details.social_links === 'string' ? details.social_links : JSON.stringify(details.social_links)) : null,
      details.contact_status || null,
      details.contact_methods ? (typeof details.contact_methods === 'string' ? details.contact_methods : JSON.stringify(details.contact_methods)) : null,
      details.opportunity_score || null,
      details.opportunity_type || null,
      details.opportunity_summary || null,
      details.is_medical !== undefined ? (details.is_medical ? 1 : 0) : null,
      details.doctor_prescription || null,
      details.social_audit ? (typeof details.social_audit === 'string' ? details.social_audit : JSON.stringify(details.social_audit)) : null,
      id
    );
  },

  updatePitches: (id, { ai_call_script, ai_whatsapp_pitch, ai_email_pitch, doctor_prescription }) => {
    return db.prepare(`
      UPDATE google_maps_leads 
      SET ai_call_script = COALESCE(?, ai_call_script),
          ai_whatsapp_pitch = COALESCE(?, ai_whatsapp_pitch),
          ai_email_pitch = COALESCE(?, ai_email_pitch),
          doctor_prescription = COALESCE(?, doctor_prescription),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(ai_call_script || null, ai_whatsapp_pitch || null, ai_email_pitch || null, doctor_prescription || null, id);
  },

  updateDoctorPrescription: (id, prescriptionText) => {
    return db.prepare(`
      UPDATE google_maps_leads 
      SET doctor_prescription = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(prescriptionText, id);
  },

  updateSocialAudit: (id, socialAudit) => {
    const val = typeof socialAudit === 'string' ? socialAudit : JSON.stringify(socialAudit);
    return db.prepare(`
      UPDATE google_maps_leads 
      SET social_audit = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(val, id);
  },

  delete: (id) => {
    return db.prepare('DELETE FROM google_maps_leads WHERE id = ?').run(id);
  },

  getStats: () => {
    const total = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE contact_status != 'uncontactable' OR contact_status IS NULL").get().count;
    const no_website = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE has_website = 0 AND (contact_status != 'uncontactable' OR contact_status IS NULL)").get().count;
    const with_phone = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE phone IS NOT NULL AND phone != '' AND (contact_status != 'uncontactable' OR contact_status IS NULL)").get().count;
    const with_email = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE email IS NOT NULL AND email != '' AND (contact_status != 'uncontactable' OR contact_status IS NULL)").get().count;
    const with_whatsapp = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE (whatsapp_url IS NOT NULL AND whatsapp_url != '' OR (phone IS NOT NULL AND phone != '')) AND (contact_status != 'uncontactable' OR contact_status IS NULL)").get().count;
    const low_reviews = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE reviews_count < 25 AND (contact_status != 'uncontactable' OR contact_status IS NULL)").get().count;
    const contacted = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE status = 'contacted'").get().count;
    const uncontactable = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE contact_status = 'uncontactable'").get().count;
    const medical_leads = db.prepare("SELECT COUNT(*) as count FROM google_maps_leads WHERE is_medical = 1 AND (contact_status != 'uncontactable' OR contact_status IS NULL)").get().count;
    return { total, no_website, with_phone, with_email, with_whatsapp, low_reviews, contacted, uncontactable, medical_leads };
  },

  exportCsv: (options = {}) => {
    const leads = GoogleMapsLeadModel.getAll({ ...options, limit: 1000 });
    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const s = String(str).replace(/"/g, '""');
      return `"${s}"`;
    };

    const headers = [
      'ID', 'Business Name', 'Category', 'Is Medical Doctor/Clinic', 'Phone', 'Email', 'WhatsApp URL', 'Address', 'City', 'Rating', 'Reviews Count',
      'Has Website', 'Website URL', 'Google Maps URL', 'Opportunity Type', 'Opportunity Score',
      'Opportunity Summary', 'Status', 'Contact Status', 'Social Channels', 'WhatsApp Pitch', 'Cold Call Script', 'Email Pitch', 'Doctor Rx Prescription'
    ];

    const rows = leads.map(l => [
      l.id,
      escapeCsv(l.business_name),
      escapeCsv(l.category),
      l.is_medical ? 'Yes (Doctor/Clinic)' : 'No',
      escapeCsv(l.phone),
      escapeCsv(l.email),
      escapeCsv(l.whatsapp_url),
      escapeCsv(l.address),
      escapeCsv(l.city),
      l.rating || '',
      l.reviews_count || 0,
      l.has_website ? 'Yes' : 'NO (High-Ticket AI Web Dev Lead)',
      escapeCsv(l.website_url),
      escapeCsv(l.maps_url),
      escapeCsv(l.opportunity_type),
      l.opportunity_score,
      escapeCsv(l.opportunity_summary),
      escapeCsv(l.status),
      escapeCsv(l.contact_status || 'verified'),
      escapeCsv(l.social_links),
      escapeCsv(l.ai_whatsapp_pitch),
      escapeCsv(l.ai_call_script),
      escapeCsv(l.ai_email_pitch),
      escapeCsv(l.doctor_prescription)
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }
};

export const ScorecardLeadModel = {
  create: (data) => {
    const cleanName = (data.business_name || '').trim().toLowerCase();
    const cleanPerson = (data.contact_person || '').trim().toLowerCase();
    const cleanPhone = (data.phone || '').trim().replace(/[^0-9+]/g, '');
    const cleanEmail = (data.email || '').trim().toLowerCase();

    // Prevent duplicate entries for the same lead
    let existing = null;
    if (cleanPhone && cleanPhone.length > 6) {
      existing = db.prepare("SELECT id FROM scorecard_leads WHERE REPLACE(REPLACE(phone, ' ', ''), '-', '') = ?").get(cleanPhone);
    }
    if (!existing && cleanEmail) {
      existing = db.prepare('SELECT id FROM scorecard_leads WHERE LOWER(email) = ?').get(cleanEmail);
    }
    if (!existing && cleanName && cleanPerson) {
      existing = db.prepare('SELECT id FROM scorecard_leads WHERE LOWER(TRIM(business_name)) = ? AND LOWER(TRIM(contact_person)) = ?').get(cleanName, cleanPerson);
    }

    if (existing) {
      // Update existing lead record instead of creating a duplicate
      db.prepare(`
        UPDATE scorecard_leads SET
          overall_score = ?,
          video_score = ?,
          discovery_score = ?,
          conversion_score = ?,
          answers = ?,
          prescription_text = ?,
          prescription_data = ?,
          city = COALESCE(?, city),
          consultation_fee = COALESCE(?, consultation_fee),
          work_timing = COALESCE(?, work_timing),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          pdf_path = COALESCE(?, pdf_path),
          pdf_url = COALESCE(?, pdf_url),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        data.overall_score || 0,
        data.video_score || 0,
        data.discovery_score || 0,
        data.conversion_score || 0,
        typeof data.answers === 'string' ? data.answers : JSON.stringify(data.answers || {}),
        data.prescription_text || '',
        typeof data.prescription_data === 'string' ? data.prescription_data : JSON.stringify(data.prescription_data || {}),
        data.city || null,
        data.consultation_fee || null,
        data.work_timing || null,
        data.phone || null,
        data.email || null,
        data.pdf_path || null,
        data.pdf_url || null,
        existing.id
      );
      return existing.id;
    }

    const stmt = db.prepare(`
      INSERT INTO scorecard_leads (
        business_name, contact_person, phone, email, business_type, city,
        consultation_fee, work_timing, overall_score, video_score, discovery_score,
        conversion_score, answers, prescription_text, prescription_data, status, notes,
        pdf_path, pdf_url
      ) VALUES (
        @business_name, @contact_person, @phone, @email, @business_type, @city,
        @consultation_fee, @work_timing, @overall_score, @video_score, @discovery_score,
        @conversion_score, @answers, @prescription_text, @prescription_data, @status, @notes,
        @pdf_path, @pdf_url
      )
    `);
    const info = stmt.run({
      business_name: data.business_name || 'Anonymous Practice',
      contact_person: data.contact_person || 'Doctor / Director',
      phone: data.phone || null,
      email: data.email || null,
      business_type: data.business_type || 'Dental / Medical',
      city: data.city || null,
      consultation_fee: data.consultation_fee || null,
      work_timing: data.work_timing || null,
      overall_score: data.overall_score || 0,
      video_score: data.video_score || 0,
      discovery_score: data.discovery_score || 0,
      conversion_score: data.conversion_score || 0,
      answers: typeof data.answers === 'string' ? data.answers : JSON.stringify(data.answers || {}),
      prescription_text: data.prescription_text || '',
      prescription_data: typeof data.prescription_data === 'string' ? data.prescription_data : JSON.stringify(data.prescription_data || {}),
      status: data.status || 'new',
      notes: data.notes || null,
      pdf_path: data.pdf_path || null,
      pdf_url: data.pdf_url || null
    });
    return info.lastInsertRowid;
  },

  getAll: (options = {}) => {
    let whereClauses = [];
    let params = [];

    if (options.status && options.status !== 'all') {
      whereClauses.push('status = ?');
      params.push(options.status);
    }

    if (options.business_type && options.business_type !== 'all') {
      whereClauses.push('business_type LIKE ?');
      params.push(`%${options.business_type}%`);
    }

    // Default: Newest leads on top
    let orderBy = 'ORDER BY created_at DESC, id DESC';
    if (options.sortBy === 'oldest' || options.sortBy === 'date_asc') {
      orderBy = 'ORDER BY created_at ASC, id ASC';
    } else if (options.sortBy === 'newest' || options.sortBy === 'date_desc') {
      orderBy = 'ORDER BY created_at DESC, id DESC';
    } else if (options.sortBy === 'score_asc') {
      orderBy = 'ORDER BY overall_score ASC';
    } else if (options.sortBy === 'score_desc') {
      orderBy = 'ORDER BY overall_score DESC';
    }

    const limit = Math.min(parseInt(options.limit || '100', 10), 500);
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    params.push(limit);

    return db.prepare(`SELECT * FROM scorecard_leads ${whereSql} ${orderBy} LIMIT ?`).all(...params);
  },

  getById: (id) => {
    return db.prepare('SELECT * FROM scorecard_leads WHERE id = ?').get(id);
  },

  updateStatus: (id, status) => {
    return db.prepare('UPDATE scorecard_leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  },

  updateNotes: (id, notes) => {
    return db.prepare('UPDATE scorecard_leads SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(notes, id);
  },

  updatePdf: (id, pdfPath, pdfUrl) => {
    return db.prepare('UPDATE scorecard_leads SET pdf_path = ?, pdf_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(pdfPath, pdfUrl, id);
  },

  delete: (id) => {
    return db.prepare('DELETE FROM scorecard_leads WHERE id = ?').run(id);
  },

  getStats: () => {
    const total = db.prepare('SELECT COUNT(*) as count FROM scorecard_leads').get().count;
    const new_count = db.prepare("SELECT COUNT(*) as count FROM scorecard_leads WHERE status = 'new'").get().count;
    const contacted = db.prepare("SELECT COUNT(*) as count FROM scorecard_leads WHERE status = 'contacted'").get().count;
    const booked = db.prepare("SELECT COUNT(*) as count FROM scorecard_leads WHERE status = 'meeting_booked' OR topmate_booked = 1").get().count;
    const converted = db.prepare("SELECT COUNT(*) as count FROM scorecard_leads WHERE status = 'converted'").get().count;
    const avgScoreRow = db.prepare('SELECT AVG(overall_score) as avg_score FROM scorecard_leads').get();
    const avg_score = avgScoreRow && avgScoreRow.avg_score ? Math.round(avgScoreRow.avg_score) : 0;
    return { total, new_count, contacted, booked, converted, avg_score };
  }
};

export const LogModel = {
  add: (platform, action_type, message, metadata = null) => {
    const stmt = db.prepare(`
      INSERT INTO activity_logs (platform, action_type, message, metadata)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(platform, action_type, message, metadata ? JSON.stringify(metadata) : null);
  },
  getRecent: (limit = 50) => {
    return db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  }
};

export const PostModel = {
  create: (post) => {
    const stmt = db.prepare(`
      INSERT INTO posts (platform, content, image_path, status, scheduled_at)
      VALUES (@platform, @content, @image_path, @status, @scheduled_at)
    `);
    return stmt.run(post);
  },
  getAll: (limit = 50) => {
    return db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ?').all(limit);
  },
  updateStatus: (id, status, post_url = null) => {
    return db.prepare(`
      UPDATE posts SET status = ?, post_url = ?, published_at = CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END
      WHERE id = ?
    `).run(status, post_url, status, id);
  }
};

export const QuotaModel = {
  getToday: (platform) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const row = db.prepare('SELECT * FROM daily_quotas WHERE date_str = ? AND platform = ?').get(todayStr, platform);
    if (!row) {
      db.prepare('INSERT OR IGNORE INTO daily_quotas (date_str, platform) VALUES (?, ?)').run(todayStr, platform);
      return { date_str: todayStr, platform, comments_count: 0, dms_count: 0, posts_count: 0 };
    }
    return row;
  },
  increment: (platform, type = 'comments_count') => {
    const allowed = ['comments_count', 'dms_count', 'posts_count'];
    if (!allowed.includes(type)) {
      throw new Error(`Invalid quota increment type: ${type}`);
    }
    const todayStr = new Date().toISOString().split('T')[0];
    db.prepare('INSERT OR IGNORE INTO daily_quotas (date_str, platform) VALUES (?, ?)').run(todayStr, platform);
    return db.prepare(`UPDATE daily_quotas SET ${type} = ${type} + 1 WHERE date_str = ? AND platform = ?`).run(todayStr, platform);
  }
};

export const SettingsModel = {
  get: (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  },
  getAll: () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value);
      } catch {
        result[r.key] = r.value;
      }
    }
    return result;
  },
  set: (key, value) => {
    const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, valStr);
  }
};

// Initialize schema on load
initDatabase();
