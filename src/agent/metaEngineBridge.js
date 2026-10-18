import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { LeadModel, LogModel, parsePostAge } from '../db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');
const ENGINE_DIR = path.resolve(ROOT_DIR, 'engine');
const KNOWLEDGE_DIR = path.resolve(ENGINE_DIR, 'knowledge');
const STATE_FILE = path.resolve(ENGINE_DIR, 'threads-engagement-state.json');

export class MetaEngineBridge {
  constructor() {
    this.activeChild = null;
    this.activeTaskName = null;
  }

  /**
   * Fast check if Chrome / Brave CDP is active on port 9222
   */
  async isCdpActive(port = 9222, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/json/version',
          timeout: timeoutMs
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve({ active: true, browser: parsed.Browser || 'Chrome/CDP', wsUrl: parsed.webSocketDebuggerUrl });
            } catch (_) {
              resolve({ active: res.statusCode === 200, browser: 'Unknown CDP' });
            }
          });
        }
      );
      req.on('error', () => resolve({ active: false }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ active: false });
      });
    });
  }

  /**
   * Read state file and synchronize qualified posts & proposed comments into SQLite leads table
   */
  syncStateToDatabase() {
    if (!fs.existsSync(STATE_FILE)) return { synced: 0 };
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const state = JSON.parse(raw);
      const posts = state.posts || {};
      let syncedCount = 0;

      for (const [postId, post] of Object.entries(posts)) {
        // Find if this post has buying or networking intent
        const intent = String(post.intent || '').toUpperCase();
        const isQualified =
          intent === 'BUYER' ||
          intent === 'FOUNDER_NETWORKING' ||
          intent === 'HIGH' ||
          intent === 'WARM' ||
          post.qualification;

        if (isQualified || post.commentProposed) {
          const authorHandle = post.username || post.author || 'prospect';
          const postUrl = post.url || `https://www.threads.com/@${authorHandle}/post/${postId}`;
          const postText = post.text || post.content || '';

          // Calculate post age & check 7-day freshness constraint
          const postTime = parsePostAge(postText, post.timestamp);
          if (!postTime.is_within_7_days) {
            // Discard dead leads (> 7 days old)
            continue;
          }

          let intentScore = 75;
          if (intent === 'BUYER' || intent === 'HIGH') intentScore = 95;
          else if (intent === 'WARM') intentScore = 85;
          else if (intent === 'FOUNDER_NETWORKING') intentScore = 80;

          const reason =
            post.reason ||
            post.requirement ||
            `Qualified via agentic intent classifier: ${intent} signal`;

          // Find if there is a proposed or simulated comment for this post
          const proposedComment =
            post.commentProposed ||
            (state.comments && state.comments[postId] && state.comments[postId].text) ||
            null;

          const isEngaged = post.commentStatus === 'POSTED' || post.commentStatus === 'ENGAGED';

          LeadModel.create({
            platform: post.platform || 'threads',
            author_name: post.name || authorHandle,
            author_handle: authorHandle,
            author_url: `https://www.threads.com/@${authorHandle}`,
            post_url: postUrl,
            post_text: postText,
            intent_score: intentScore,
            intent_reason: reason,
            keyword_matched: post.service || 'ai_automation',
            status: isEngaged ? 'engaged' : 'discovered',
            ai_comment: proposedComment,
            post_date: postTime.post_date,
            post_time_text: postTime.post_time_text,
            post_age_days: postTime.post_age_days,
            discovered_at: post.capturedAt || new Date().toISOString(),
            reached_out_at: isEngaged ? (post.commentedAt || new Date().toISOString()) : null,
            last_comment_url: isEngaged ? postUrl : null
          });
          syncedCount++;
        }
      }

      return { synced: syncedCount, totalScanned: state.stats?.total_scanned || 0 };
    } catch (err) {
      console.error('[MetaEngineBridge] Error syncing state to database:', err);
      return { error: err.message };
    }
  }

  /**
   * Execute node CLI script in engine/ with real-time streaming output
   */
  executeScript(scriptName, args = [], onLog = () => {}, onExit = () => {}) {
    if (this.activeChild) {
      throw new Error(`Engine task '${this.activeTaskName}' is already executing`);
    }

    this.activeTaskName = scriptName;
    onLog(`[Engine] Starting ${scriptName} ${args.join(' ')}...`);

    const child = spawn('node', [scriptName, ...args], {
      cwd: ENGINE_DIR,
      env: { ...process.env, NODE_ENV: 'production' }
    });

    this.activeChild = child;

    const streamLine = (chunk, isErr = false) => {
      const text = chunk.toString();
      const lines = text.split('\n');
      for (const line of lines) {
        const clean = line.replace(/\r/g, '').trimEnd();
        if (clean) {
          onLog(clean, isErr);
        }
      }
    };

    child.stdout.on('data', (chunk) => streamLine(chunk, false));
    child.stderr.on('data', (chunk) => streamLine(chunk, true));

    child.on('close', (code) => {
      this.activeChild = null;
      this.activeTaskName = null;
      onLog(`[Engine] Process ${scriptName} exited with code ${code}`);
      // Auto sync state whenever an engine script completes
      this.syncStateToDatabase();
      onExit(code);
    });

    child.on('error', (err) => {
      this.activeChild = null;
      this.activeTaskName = null;
      onLog(`[Engine Error] ${err.message}`, true);
      onExit(-1, err);
    });

    return child;
  }

  /**
   * Trigger threads-agent.js scan
   */
  scan(limit = 10, onLog, onExit) {
    return this.executeScript('threads-agent.js', ['scan', `--limit=${limit}`], onLog, onExit);
  }

  /**
   * Trigger threads-agent.js analyze
   */
  analyze(onLog, onExit) {
    return this.executeScript('threads-agent.js', ['analyze'], onLog, onExit);
  }

  /**
   * Run social autopilot
   */
  runSocialAutopilot(onLog, onExit) {
    return this.executeScript('agentic-social.js', [], onLog, onExit);
  }

  /**
   * Run job autopilot
   */
  runJobAutopilot(onLog, onExit) {
    return this.executeScript('job-agent.js', ['run'], onLog, onExit);
  }

  /**
   * Stop active engine process if running
   */
  stopActive() {
    if (this.activeChild) {
      this.activeChild.kill('SIGTERM');
      const name = this.activeTaskName;
      this.activeChild = null;
      this.activeTaskName = null;
      return { success: true, stopped: name };
    }
    return { success: false, message: 'No engine task currently running' };
  }

  /**
   * Get engine knowledge files
   */
  getKnowledgeList() {
    if (!fs.existsSync(KNOWLEDGE_DIR)) return [];
    const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
    return files.map((filename) => {
      const fullPath = path.join(KNOWLEDGE_DIR, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        title: filename.replace('.md', '').replace(/-/g, ' ').toUpperCase(),
        size: stat.size,
        updatedAt: stat.mtime
      };
    });
  }

  getKnowledgeFile(filename) {
    const cleanName = path.basename(filename);
    if (!cleanName.endsWith('.md')) throw new Error(`Invalid knowledge file type: ${cleanName}`);
    const fullPath = path.join(KNOWLEDGE_DIR, cleanName);
    if (!fs.existsSync(fullPath)) throw new Error(`Knowledge file not found: ${cleanName}`);
    return fs.readFileSync(fullPath, 'utf8');
  }

  saveKnowledgeFile(filename, content) {
    const cleanName = path.basename(filename);
    if (!cleanName.endsWith('.md')) throw new Error(`Only .md markdown files may be saved: ${cleanName}`);
    const fullPath = path.join(KNOWLEDGE_DIR, cleanName);
    fs.writeFileSync(fullPath, content, 'utf8');
    return { success: true, filename: cleanName, bytes: Buffer.byteLength(content) };
  }
}

export const metaEngineBridge = new MetaEngineBridge();
