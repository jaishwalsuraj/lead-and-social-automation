import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import http from 'http';
import { LogModel } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USER_DATA_DIR = path.join(__dirname, '../../user_data/chrome_profile');

// Ensure user profile directory exists
if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

export class BrowserManager {
  constructor() {
    this.context = null;
    this.interactiveBrowser = null;
    this.isHeadless = process.env.HEADLESS === 'true';
    this.activeWorkers = 0;
    this.isCdpConnected = false;
    this.cdpBrowser = null;
  }

  /**
   * Fast check if Chrome / Brave CDP is active on port 9222
   */
  async isCdpActive(port = 9222, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const req = http.get(
        { hostname: '127.0.0.1', port, path: '/json/version', timeout: timeoutMs },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(res.statusCode === 200));
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  /**
   * Returns a persistent browser context ensuring session cookies are preserved.
   * Prioritizes attaching to the user's running Chrome CDP session on port 9222.
   */
  async getContext(headless = null) {
    const isHeadless = headless !== null ? headless : this.isHeadless;

    if (this.context) {
      try {
        const pages = this.context.pages();
        return this.context;
      } catch (err) {
        this.context = null;
      }
    }

    // 1. Prioritize attaching directly to the user's active, authenticated Chrome CDP session
    const cdpAvailable = await this.isCdpActive(9222);
    if (cdpAvailable) {
      try {
        console.log('[BrowserManager] Attaching directly to user active Chrome CDP session on port 9222...');
        this.cdpBrowser = await chromium.connectOverCDP('http://127.0.0.1:9222');
        const contexts = this.cdpBrowser.contexts();
        if (contexts.length > 0) {
          this.context = contexts[0];
          this.isCdpConnected = true;
          LogModel.add('system', 'cdp_attach', 'Attached to live authenticated Chrome browser on port 9222');
          return this.context;
        }
      } catch (cdpErr) {
        console.warn('[BrowserManager] CDP connection attempt failed, falling back to persistent context:', cdpErr.message);
      }
    }

    // 2. Fallback to launching persistent Chromium instance
    console.log(`[BrowserManager] Launching persistent browser context (headless: ${isHeadless})...`);
    LogModel.add('system', 'browser_launch', `Launching persistent browser (headless: ${isHeadless})`);

    this.isCdpConnected = false;
    this.context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: isHeadless,
      viewport: { width: 1366, height: 850 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1366,850',
        '--lang=en-US,en'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    // Anti-detection stealth script injection
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    return this.context;
  }

  /**
   * Launches a dedicated visible browser window for the user to log into their accounts manually once.
   */
  async launchInteractiveLogin(platform = 'threads') {
    const urlMap = {
      threads: 'https://www.threads.net/login',
      instagram: 'https://www.instagram.com/accounts/login/',
      facebook: 'https://www.facebook.com/login',
      linkedin: 'https://www.linkedin.com/login',
      chatgpt: 'https://chatgpt.com',
      claude: 'https://claude.ai/login'
    };

    const targetUrl = urlMap[platform.toLowerCase()] || 'https://www.threads.net';

    LogModel.add(platform, 'login_session_started', `Opened visible browser for interactive login at ${targetUrl}`);

    // If there's an existing persistent context, close it to unlock the user data directory
    if (this.context && !this.isCdpConnected) {
      try {
        await this.context.close();
      } catch (e) {}
      this.context = null;
    }

    const context = await this.getContext(false); // Force visible window
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

    this.invalidateAuthCache();
    return {
      success: true,
      message: `Visible browser opened. Please log into ${platform} in the browser window. Your login session and cookies will be automatically saved!`,
      url: targetUrl
    };
  }

  /**
   * Helper to perform human-like typing delays (supports string selector or ElementHandle)
   */
  async humanType(page, target, text) {
    if (!target) return;
    try {
      if (typeof target === 'string') {
        const el = await page.waitForSelector(target, { state: 'visible', timeout: 8000 }).catch(() => null);
        if (el) {
          await el.scrollIntoViewIfNeeded().catch(() => {});
          await el.click().catch(() => {});
        } else {
          await page.click(target).catch(() => {});
        }
      } else {
        // ElementHandle passed directly
        await target.scrollIntoViewIfNeeded().catch(() => {});
        await target.click().catch(() => {});
      }
    } catch (_) {}

    for (const char of text) {
      await page.keyboard.type(char, { delay: Math.floor(Math.random() * 50) + 30 });
      if (Math.random() < 0.06) {
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 250) + 120)); // Natural thinking pause
      }
    }
  }

  /**
   * Random realistic sleep to mimic human browsing and avoid rate-limits
   */
  async humanDelay(minMs = 2500, maxMs = 6000) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Natural smooth scroll
   */
  async smoothScroll(page, distance = 400) {
    await page.mouse.wheel(0, distance);
    await this.humanDelay(1200, 2500);
  }

  /**
   * Cached platform authentication status with 60-second TTL.
   * Completely silent: checks browser cookies and existing open tabs directly without
   * ever creating new tabs or navigating in the user's browser.
   */
  async getConnectedPlatforms(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this._platformCache && (now - (this._platformCacheTime || 0) < 60000)) {
      return this._platformCache;
    }

    try {
      const context = await this.getContext();
      const cookies = await context.cookies().catch(() => []);

      const hasCookie = (domainPattern, cookieNames) => {
        return cookies.some(c => {
          const dom = (c.domain || '').toLowerCase();
          return dom.includes(domainPattern) && cookieNames.includes(c.name);
        });
      };

      // Also check existing open pages without opening any new ones
      const openPages = context.pages ? context.pages() : [];
      const hasOpenTab = (urlPattern) => {
        return openPages.some(p => {
          try {
            const u = p.url().toLowerCase();
            return u.includes(urlPattern) && !u.includes('/login') && !u.includes('authwall');
          } catch (_) {
            return false;
          }
        });
      };

      // Threads is connected if sessionid/ds_user_id exists on threads/instagram or active tab is open
      const threadsLoggedIn = hasCookie('threads', ['sessionid', 'ds_user_id']) || 
                              hasCookie('instagram', ['sessionid', 'ds_user_id']) ||
                              hasOpenTab('threads.com') || hasOpenTab('threads.net');

      // Instagram is connected if sessionid/ds_user_id exists or active tab is open
      const instagramLoggedIn = hasCookie('instagram', ['sessionid', 'ds_user_id']) ||
                                hasOpenTab('instagram.com');

      // Facebook is connected if c_user / xs cookie exists or active tab is open
      const facebookLoggedIn = hasCookie('facebook', ['c_user', 'xs']) ||
                               hasOpenTab('facebook.com');

      // LinkedIn is connected if li_at cookie exists or active tab is open
      const linkedinLoggedIn = hasCookie('linkedin', ['li_at']) ||
                               hasOpenTab('linkedin.com/feed');

      // ChatGPT is connected if session token exists or tab is open
      const chatgptLoggedIn = hasCookie('openai', ['__Secure-next-auth.session-token', '_puid']) ||
                              hasCookie('chatgpt', ['__Secure-next-auth.session-token']) ||
                              hasOpenTab('chatgpt.com');

      // Claude is connected if sessionKey exists or tab is open
      const claudeLoggedIn = hasCookie('claude', ['sessionKey']) ||
                             hasCookie('anthropic', ['sessionKey']) ||
                             hasOpenTab('claude.ai');

      const statuses = [
        { platform: 'threads', loggedIn: !!threadsLoggedIn },
        { platform: 'instagram', loggedIn: !!instagramLoggedIn },
        { platform: 'facebook', loggedIn: !!facebookLoggedIn },
        { platform: 'linkedin', loggedIn: !!linkedinLoggedIn },
        { platform: 'chatgpt', loggedIn: !!chatgptLoggedIn },
        { platform: 'claude', loggedIn: !!claudeLoggedIn }
      ];

      this._platformCache = statuses;
      this._platformCacheTime = now;
      return statuses;
    } catch (err) {
      console.warn('[BrowserManager] Error checking platform statuses:', err.message);
      return [
        { platform: 'threads', loggedIn: false, error: err.message },
        { platform: 'instagram', loggedIn: false, error: err.message },
        { platform: 'facebook', loggedIn: false, error: err.message },
        { platform: 'linkedin', loggedIn: false, error: err.message },
        { platform: 'chatgpt', loggedIn: false, error: err.message },
        { platform: 'claude', loggedIn: false, error: err.message }
      ];
    }
  }

  /**
   * Invalidates the platform auth status cache
   */
  invalidateAuthCache() {
    this._platformCache = null;
    this._platformCacheTime = 0;
  }

  /**
   * Silent check for a specific platform using cookies and existing open tabs
   */
  async checkPlatformAuthStatus(platform) {
    const all = await this.getConnectedPlatforms(true);
    return all.find(p => p.platform === platform) || { platform, loggedIn: false };
  }

  async close() {
    if (this.isCdpConnected) {
      if (this.cdpBrowser) {
        try { await this.cdpBrowser.close(); } catch (_) {}
        this.cdpBrowser = null;
      }
      this.context = null;
      this.isCdpConnected = false;
      return;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}

export const browserManager = new BrowserManager();
