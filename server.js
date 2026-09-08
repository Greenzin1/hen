const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'hen.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    bio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    reply_to INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reply_to) REFERENCES posts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS likes (
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS reposts (
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS hashtags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag TEXT UNIQUE NOT NULL
  );
  CREATE TABLE IF NOT EXISTS post_hashtags (
    post_id INTEGER NOT NULL,
    hashtag_id INTEGER NOT NULL,
    PRIMARY KEY (post_id, hashtag_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (hashtag_id) REFERENCES hashtags(id) ON DELETE CASCADE
  );
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// === AUTH HELPERS ===
function auth(req, res, next) {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return res.status(401).json({ errors: [{ message: 'Token required' }] });
  const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(t);
  if (!s) return res.status(401).json({ errors: [{ message: 'Invalid token' }] });
  req.userId = s.user_id;
  next();
}

function optAuth(req, res, next) {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (t) {
    const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(t);
    if (s) req.userId = s.user_id;
  }
  next();
}

function getUser(id) {
  const u = db.prepare('SELECT id, username, display_name, bio, created_at FROM users WHERE id=?').get(id);
  if (!u) return null;
  const followers = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id=?').get(id).c;
  const following = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id=?').get(id).c;
  const posts_count = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=?').get(id).c;
  return { ...u, followers_count: followers, friends_count: following, statuses_count: posts_count };
}

function postSQL(req) {
  let s = `SELECT p.*, u.username, u.display_name,
    (SELECT COUNT(*) FROM likes WHERE post_id=p.id) as favorite_count,
    (SELECT COUNT(*) FROM reposts WHERE post_id=p.id) as retweet_count,
    (SELECT COUNT(*) FROM posts WHERE reply_to=p.id) as reply_count`;
  if (req.userId) {
    s += `, (SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${req.userId}) as favorited,
            (SELECT 1 FROM reposts WHERE post_id=p.id AND user_id=${req.userId}) as retweeted`;
  }
  return s;
}

function formatTweet(p) {
  return {
    id_str: String(p.id),
    id: p.id,
    full_text: p.content,
    text: p.content,
    created_at: new Date(p.created_at + 'Z').toUTCString(),
    favorite_count: p.favorite_count || 0,
    retweet_count: p.retweet_count || 0,
    reply_count: p.reply_count || 0,
    favorited: !!p.favorited,
    retweeted: !!p.retweeted,
    user: {
      id_str: String(p.user_id),
      id: p.user_id,
      name: p.display_name,
      screen_name: p.username,
      profile_image_url_https: `https://ui-avatars.com/api/?name=${encodeURIComponent(p.display_name)}&background=random&size=48`
    }
  };
}

function formatUser(u) {
  return {
    id_str: String(u.id),
    id: u.id,
    name: u.display_name,
    screen_name: u.username,
    description: u.bio || '',
    followers_count: u.followers_count || 0,
    friends_count: u.friends_count || 0,
    statuses_count: u.statuses_count || 0,
    created_at: new Date(u.created_at + 'Z').toUTCString(),
    profile_image_url_https: `https://ui-avatars.com/api/?name=${encodeURIComponent(u.display_name)}&background=random&size=48`
  };
}

// ==========================================
//  TWITTER API 1.1 COMPATIBLE ENDPOINTS
// ==========================================

// --- Bearer Token / OAuth ---
app.post('/oauth2/token', (req, res) => {
  res.json({ token_type: 'bearer', access_token: 'hen_bearer_token_' + uuidv4() });
});

// --- Account ---
app.get('/1.1/account/verify_credentials.json', auth, (req, res) => {
  const u = getUser(req.userId);
  if (!u) return res.status(404).json({ errors: [{ message: 'User not found' }] });
  res.json(formatUser(u));
});

app.post('/1.1/account/update_profile.json', auth, (req, res) => {
  const { name, description } = req.body;
  db.prepare('UPDATE users SET display_name=COALESCE(?,display_name), bio=COALESCE(?,bio) WHERE id=?').run(name, description, req.userId);
  res.json(formatUser(getUser(req.userId)));
});

app.get('/1.1/account/settings.json', auth, (req, res) => {
  res.json({ screen_name: getUser(req.userId).screen_name, language: 'pt' });
});

// --- Login/Register (Twitter OAuth flow simulation) ---
app.post('/1.1/account/login.json', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ errors: [{ message: 'Missing fields' }] });
  const u = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(username, username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ errors: [{ message: 'Wrong password' }] });
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, u.id);
  res.json({ token, user: formatUser(getUser(u.id)) });
});

app.post('/1.1/account/register.json', (req, res) => {
  const { username, email, password, name } = req.body;
  if (!username || !email || !password || !name) return res.status(400).json({ errors: [{ message: 'All fields required' }] });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (username, display_name, email, password_hash) VALUES (?,?,?,?)').run(username, name, email, hash);
    const token = uuidv4();
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, r.lastInsertRowid);
    res.json({ token, user: formatUser(getUser(r.lastInsertRowid)) });
  } catch { res.status(400).json({ errors: [{ message: 'Username or email already taken' }] }); }
});

// --- Tweets ---
app.get('/1.1/statuses/home_timeline.json', auth, (req, res) => {
  const count = parseInt(req.query.count) || 40;
  const posts = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id
    WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.user_id=?
    ORDER BY p.created_at DESC LIMIT ?`).all(req.userId, req.userId, count);
  res.json(posts.map(formatTweet));
});

app.get('/1.1/statuses/user_timeline.json', auth, (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE screen_name=? OR id=?').get(req.query.user_id, req.query.user_id);
  if (!user) return res.json([]);
  const count = parseInt(req.query.count) || 40;
  const posts = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT ?`).all(user.id, count);
  res.json(posts.map(formatTweet));
});

app.get('/1.1/statuses/mentions_timeline.json', auth, (req, res) => {
  res.json([]);
});

app.post('/1.1/statuses/update.json', auth, (req, res) => {
  const { status, in_reply_to_status_id } = req.body;
  if (!status?.trim()) return res.status(400).json({ errors: [{ message: 'Status required' }] });
  const r = db.prepare('INSERT INTO posts (user_id, content, reply_to) VALUES (?,?,?)').run(req.userId, status.trim(), in_reply_to_status_id || null);
  const tags = status.match(/#(\w+)/g);
  if (tags) for (const t of tags) {
    const name = t.slice(1).toLowerCase();
    db.prepare('INSERT OR IGNORE INTO hashtags (tag) VALUES (?)').run(name);
    const ht = db.prepare('SELECT id FROM hashtags WHERE tag=?').get(name);
    if (ht) db.prepare('INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?,?)').run(r.lastInsertRowid, ht.id);
  }
  const p = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.id=?`).get(r.lastInsertRowid);
  res.json(formatTweet(p));
});

app.get('/1.1/statuses/show/:id.json', auth, (req, res) => {
  const p = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.id=?`).get(req.params.id);
  if (!p) return res.status(404).json({ errors: [{ message: 'Not found' }] });
  res.json(formatTweet(p));
});

app.post('/1.1/statuses/retweet/:id.json', auth, (req, res) => {
  try { db.prepare('INSERT INTO reposts (user_id, post_id) VALUES (?,?)').run(req.userId, req.params.id); } catch {}
  res.json({ ok: true });
});

app.post('/1.1/statuses/unretweet/:id.json', auth, (req, res) => {
  db.prepare('DELETE FROM reposts WHERE user_id=? AND post_id=?').run(req.userId, req.params.id);
  res.json({ ok: true });
});

app.post('/1.1/statuses/destroy/:id.json', auth, (req, res) => {
  const p = db.prepare('SELECT user_id FROM posts WHERE id=?').get(req.params.id);
  if (!p || p.user_id !== req.userId) return res.status(403).json({ errors: [{ message: 'Not allowed' }] });
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// --- Favorites (Likes) ---
app.post('/1.1/favorites/create.json', auth, (req, res) => {
  const id = req.body.id || req.query.id;
  try { db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?,?)').run(req.userId, id); } catch {}
  res.json({ ok: true });
});

app.post('/1.1/favorites/destroy.json', auth, (req, res) => {
  const id = req.body.id || req.query.id;
  db.prepare('DELETE FROM likes WHERE user_id=? AND post_id=?').run(req.userId, id);
  res.json({ ok: true });
});

// --- Friends/Followers ---
app.get('/1.1/friends/ids.json', auth, (req, res) => {
  const rows = db.prepare('SELECT following_id FROM follows WHERE follower_id=?').all(req.userId);
  res.json({ ids: rows.map(r => r.following_id) });
});

app.get('/1.1/followers/ids.json', auth, (req, res) => {
  const rows = db.prepare('SELECT follower_id FROM follows WHERE following_id=?').all(req.userId);
  res.json({ ids: rows.map(r => r.follower_id) });
});

app.post('/1.1/friendships/create.json', auth, (req, res) => {
  const username = req.body.screen_name || req.body.id;
  const u = db.prepare('SELECT id FROM users WHERE username=? OR id=?').get(username, username);
  if (!u) return res.status(404).json({ errors: [{ message: 'Not found' }] });
  try { db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?,?)').run(req.userId, u.id); } catch {}
  res.json(formatUser(getUser(u.id)));
});

app.post('/1.1/friendships/destroy.json', auth, (req, res) => {
  const username = req.body.screen_name || req.body.id;
  const u = db.prepare('SELECT id FROM users WHERE username=? OR id=?').get(username, username);
  if (!u) return res.status(404).json({ errors: [{ message: 'Not found' }] });
  db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(req.userId, u.id);
  res.json(formatUser(getUser(u.id)));
});

app.get('/1.1/friendships/show.json', auth, (req, res) => {
  const target = req.query.target_id;
  const is_following = !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.userId, target);
  const followed_by = !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(target, req.userId);
  res.json({ relationship: { following: is_following, followed_by } });
});

// --- Users ---
app.get('/1.1/users/lookup.json', auth, (req, res) => {
  const names = (req.query.screen_name || '').split(',');
  const users = names.map(n => {
    const u = db.prepare('SELECT id FROM users WHERE username=?').get(n.trim());
    return u ? formatUser(getUser(u.id)) : null;
  }).filter(Boolean);
  res.json(users);
});

app.get('/1.1/users/show.json', auth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username=? OR id=?').get(req.query.screen_name, req.query.user_id);
  if (!u) return res.status(404).json({ errors: [{ message: 'Not found' }] });
  res.json(formatUser(getUser(u.id)));
});

// --- Search ---
app.get('/1.1/search/tweets.json', auth, (req, res) => {
  const q = req.query.q || '';
  const count = parseInt(req.query.count) || 20;
  if (!q) return res.json({ statuses: [] });
  const posts = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.content LIKE ? ORDER BY p.created_at DESC LIMIT ?`).all(`%${q}%`, count);
  res.json({ statuses: posts.map(formatTweet) });
});

// --- Trends ---
app.get('/1.1/trends/place.json', (req, res) => {
  const tags = db.prepare(`SELECT h.tag, COUNT(ph.post_id) as tweet_volume FROM hashtags h JOIN post_hashtags ph ON h.id=ph.hashtag_id GROUP BY h.id ORDER BY tweet_volume DESC LIMIT 20`).all();
  res.json([{ trends: tags.map(t => ({ name: '#' + t.tag, tweet_volume: t.tweet_volume, url: `https://hen.serveousercontent.com/#!/tag/${t.tag}` })) }]);
});

// --- Notifications (simplified) ---
app.get('/1.1/notifications.json', auth, (req, res) => {
  const likes = db.prepare(`SELECT l.*, u.username, u.display_name, p.id as target_post_id FROM likes l JOIN users u ON l.user_id=u.id JOIN posts p ON l.post_id=p.id WHERE p.user_id=? ORDER BY l.created_at DESC LIMIT 20`).all(req.userId);
  const follows = db.prepare(`SELECT f.*, u.username, u.display_name FROM follows f JOIN users u ON f.follower_id=u.id WHERE f.following_id=? ORDER BY f.created_at DESC LIMIT 20`).all(req.userId);
  const notifs = [
    ...likes.map(l => ({ type: 'favorite', actor: { screen_name: l.username, name: l.display_name }, target_object: { id_str: String(l.target_post_id) }, created_at: new Date(l.created_at + 'Z').toUTCString() })),
    ...follows.map(f => ({ type: 'follow', actor: { screen_name: f.username, name: f.display_name }, created_at: new Date(f.created_at + 'Z').toUTCString() }))
  ];
  notifs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ notification_items: notifs.slice(0, 30) });
});

// --- Timeline (generic) ---
app.get('/1.1/statuses/:id/replies.json', auth, (req, res) => {
  const posts = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.reply_to=? ORDER BY p.created_at ASC`).all(req.params.id);
  res.json(posts.map(formatTweet));
});

// --- Config/Feature flags (prevent crashes) ---
app.get('/1.1/config/get.json', (req, res) => res.json({}));
app.get('/1.1/clientations/features.json', (req, res) => res.json({}));
app.get('/1.1/help/settings.json', (req, res) => res.json({}));
app.get('/1.1/live_pipeline/pipeline_stats.json', (req, res) => res.json({}));

// --- Media upload stub ---
app.post('/1.1/media/upload.json', auth, (req, res) => {
  res.json({ media_id_string: '0', media_id: 0 });
});

// --- Web API fallback ---
app.get('/web_api/*', (req, res) => res.json({}));

// ==========================================
//  HEN WEB API (for the website)
// ==========================================
app.post('/api/signup', (req, res) => {
  const { username, display_name, email, password } = req.body;
  if (!username || !email || !password || !display_name) return res.status(400).json({ error: 'All fields required' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (username, display_name, email, password_hash) VALUES (?,?,?,?)').run(username, display_name, email, hash);
    const token = uuidv4();
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, r.lastInsertRowid);
    res.json({ token, user: { id: r.lastInsertRowid, username, display_name } });
  } catch { res.status(400).json({ error: 'Username or email taken' }); }
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = uuidv4();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?,?)').run(token, u.id);
  res.json({ token, user: { id: u.id, username: u.username, display_name: u.display_name, bio: u.bio } });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.headers.authorization?.replace('Bearer ', ''));
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  const u = getUser(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ ...u, following: u.friends_count });
});

app.put('/api/me', auth, (req, res) => {
  const { display_name, bio } = req.body;
  db.prepare('UPDATE users SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio) WHERE id = ?').run(display_name, bio, req.userId);
  res.json({ ok: true });
});

app.get('/api/users/:username', optAuth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username=?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const user = getUser(u.id);
  let is_following = false;
  if (req.userId) is_following = !!db.prepare('SELECT 1 FROM follows WHERE follower_id=? AND following_id=?').get(req.userId, u.id);
  res.json({ ...user, following: user.friends_count, is_following });
});

app.post('/api/posts', auth, (req, res) => {
  const { content, reply_to } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content required' });
  const r = db.prepare('INSERT INTO posts (user_id, content, reply_to) VALUES (?,?,?)').run(req.userId, content.trim(), reply_to || null);
  const tags = content.match(/#(\w+)/g);
  if (tags) for (const t of tags) {
    const name = t.slice(1).toLowerCase();
    db.prepare('INSERT OR IGNORE INTO hashtags (tag) VALUES (?)').run(name);
    const ht = db.prepare('SELECT id FROM hashtags WHERE tag = ?').get(name);
    if (ht) db.prepare('INSERT OR IGNORE INTO post_hashtags (post_id, hashtag_id) VALUES (?,?)').run(r.lastInsertRowid, ht.id);
  }
  res.json({ id: r.lastInsertRowid });
});

app.get('/api/posts', optAuth, (req, res) => {
  const { user_id, hashtag, limit = 50, before } = req.query;
  let sql = postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id`;
  const params = [];
  if (user_id) { sql += ` WHERE p.user_id=?`; params.push(user_id); }
  if (hashtag) { sql += params.length ? ` AND` : ` WHERE`; sql += ` p.id IN (SELECT post_id FROM post_hashtags ph JOIN hashtags h ON ph.hashtag_id=h.id WHERE h.tag=?)`; params.push(hashtag.toLowerCase()); }
  if (before) { sql += params.length ? ` AND` : ` WHERE`; sql += ` p.id<?`; params.push(before); }
  sql += ` ORDER BY p.created_at DESC LIMIT ?`; params.push(+limit);
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/posts/:id', optAuth, (req, res) => {
  const post = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.id=?`).get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const replies = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.reply_to=? ORDER BY p.created_at ASC`).all(req.params.id);
  let parent = null;
  if (post.reply_to) parent = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.id=?`).get(post.reply_to);
  res.json({ post, replies, parent });
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const p = db.prepare('SELECT user_id FROM posts WHERE id=?').get(req.params.id);
  if (!p || p.user_id !== req.userId) return res.status(403).json({ error: 'Not allowed' });
  db.prepare('DELETE FROM posts WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/posts/:id/like', auth, (req, res) => { try { db.prepare('INSERT INTO likes (user_id,post_id) VALUES (?,?)').run(req.userId, req.params.id); } catch {} res.json({ liked: true }); });
app.delete('/api/posts/:id/like', auth, (req, res) => { db.prepare('DELETE FROM likes WHERE user_id=? AND post_id=?').run(req.userId, req.params.id); res.json({ liked: false }); });
app.post('/api/posts/:id/repost', auth, (req, res) => { try { db.prepare('INSERT INTO reposts (user_id,post_id) VALUES (?,?)').run(req.userId, req.params.id); } catch {} res.json({ reposted: true }); });
app.delete('/api/posts/:id/repost', auth, (req, res) => { db.prepare('DELETE FROM reposts WHERE user_id=? AND post_id=?').run(req.userId, req.params.id); res.json({ reposted: false }); });

app.post('/api/users/:username/follow', auth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username=?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  try { db.prepare('INSERT INTO follows (follower_id,following_id) VALUES (?,?)').run(req.userId, u.id); } catch {}
  res.json({ following: true });
});
app.delete('/api/users/:username/follow', auth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username=?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM follows WHERE follower_id=? AND following_id=?').run(req.userId, u.id);
  res.json({ following: false });
});

app.get('/api/feed', auth, (req, res) => {
  const posts = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id
    WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.user_id=?
    ORDER BY p.created_at DESC LIMIT 50`).all(req.userId, req.userId);
  res.json(posts);
});

app.get('/api/search', optAuth, (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ users: [], posts: [] });
  const users = db.prepare(`SELECT id, username, display_name, bio FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 10`).all(`%${q}%`, `%${q}%`);
  const posts = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id WHERE p.content LIKE ? ORDER BY p.created_at DESC LIMIT 20`).all(`%${q}%`);
  res.json({ users, posts });
});

app.get('/api/trending', (req, res) => {
  res.json(db.prepare(`SELECT h.tag, COUNT(ph.post_id) as count FROM hashtags h JOIN post_hashtags ph ON h.id=ph.hashtag_id GROUP BY h.id ORDER BY count DESC LIMIT 10`).all());
});

app.get('/api/suggestions', auth, (req, res) => {
  res.json(db.prepare(`SELECT id, username, display_name, bio FROM users WHERE id!=? AND id NOT IN (SELECT following_id FROM follows WHERE follower_id=?) ORDER BY RANDOM() LIMIT 5`).all(req.userId, req.userId));
});

app.get('/api/notifications', auth, (req, res) => {
  const likes = db.prepare(`SELECT l.*, u.username, u.display_name, p.id as post_id, p.content FROM likes l JOIN users u ON l.user_id=u.id JOIN posts p ON l.post_id=p.id WHERE p.user_id=? ORDER BY l.created_at DESC LIMIT 20`).all(req.userId);
  const follows = db.prepare(`SELECT f.*, u.username, u.display_name FROM follows f JOIN users u ON f.follower_id=u.id WHERE f.following_id=? ORDER BY f.created_at DESC LIMIT 20`).all(req.userId);
  const all = [...likes.map(l => ({ ...l, type: 'like' })), ...follows.map(f => ({ ...f, type: 'follow' }))];
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(all.slice(0, 30));
});

// === DOWNLOAD ===
app.get('/download', (req, res) => res.sendFile(path.join(__dirname, 'public', 'download.html')));
app.get('/hen.apk', (req, res) => res.download(path.join(__dirname, 'hen.apk'), 'hen.apk'));

// === CATCH ALL ===
app.use((req, res) => {
  console.log(`404: ${req.method} ${req.url}`);
  if (req.url.startsWith('/1.1/') || req.url.startsWith('/oauth') || req.url.startsWith('/web_api')) {
    return res.status(404).json({ errors: [{ message: `Not found: ${req.url}` }] });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hen 🐔 running on port ${PORT}`));
