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
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return res.status(401).json({ error: 'Token required' });
  const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(t);
  if (!s) return res.status(401).json({ error: 'Invalid token' });
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

// === AUTH ===
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
  const u = db.prepare('SELECT id, username, display_name, bio, created_at FROM users WHERE id = ?').get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const followers = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(u.id).c;
  const following = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(u.id).c;
  const posts_count = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(u.id).c;
  res.json({ ...u, followers, following, posts_count });
});

app.put('/api/me', auth, (req, res) => {
  const { display_name, bio } = req.body;
  db.prepare('UPDATE users SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio) WHERE id = ?').run(display_name, bio, req.userId);
  res.json({ ok: true });
});

// === USERS ===
app.get('/api/users/:username', optAuth, (req, res) => {
  const u = db.prepare('SELECT id, username, display_name, bio, created_at FROM users WHERE username = ?').get(req.params.username);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const followers = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(u.id).c;
  const following = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(u.id).c;
  const posts_count = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(u.id).c;
  let is_following = false;
  if (req.userId) is_following = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.userId, u.id);
  res.json({ ...u, followers, following, posts_count, is_following });
});

// === POSTS ===
function postSQL(req) {
  let s = `SELECT p.*, u.username, u.display_name,
    (SELECT COUNT(*) FROM likes WHERE post_id=p.id) as like_count,
    (SELECT COUNT(*) FROM reposts WHERE post_id=p.id) as repost_count,
    (SELECT COUNT(*) FROM posts WHERE reply_to=p.id) as reply_count`;
  if (req.userId) {
    s += `, (SELECT 1 FROM likes WHERE post_id=p.id AND user_id=${req.userId}) as liked,
            (SELECT 1 FROM reposts WHERE post_id=p.id AND user_id=${req.userId}) as reposted`;
  }
  return s;
}

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

// === INTERACTIONS ===
app.post('/api/posts/:id/like', auth, (req, res) => { try { db.prepare('INSERT INTO likes (user_id,post_id) VALUES (?,?)').run(req.userId, req.params.id); } catch {} res.json({ liked: true }); });
app.delete('/api/posts/:id/like', auth, (req, res) => { db.prepare('DELETE FROM likes WHERE user_id=? AND post_id=?').run(req.userId, req.params.id); res.json({ liked: false }); });
app.post('/api/posts/:id/repost', auth, (req, res) => { try { db.prepare('INSERT INTO reposts (user_id,post_id) VALUES (?,?)').run(req.userId, req.params.id); } catch {} res.json({ reposted: true }); });
app.delete('/api/posts/:id/repost', auth, (req, res) => { db.prepare('DELETE FROM reposts WHERE user_id=? AND post_id=?').run(req.userId, req.params.id); res.json({ reposted: false }); });

// === FOLLOWS ===
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

// === FEED ===
app.get('/api/feed', auth, (req, res) => {
  const posts = db.prepare(postSQL(req) + ` FROM posts p JOIN users u ON p.user_id=u.id
    WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id=?) OR p.user_id=?
    ORDER BY p.created_at DESC LIMIT 50`).all(req.userId, req.userId);
  res.json(posts);
});

// === EXPLORE / SEARCH / TRENDING ===
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

// === NOTIFICATIONS ===
app.get('/api/notifications', auth, (req, res) => {
  const likes = db.prepare(`SELECT l.*, u.username, u.display_name, p.id as post_id, p.content FROM likes l JOIN users u ON l.user_id=u.id JOIN posts p ON l.post_id=p.id WHERE p.user_id=? ORDER BY l.created_at DESC LIMIT 20`).all(req.userId);
  const follows = db.prepare(`SELECT f.*, u.username, u.display_name FROM follows f JOIN users u ON f.follower_id=u.id WHERE f.following_id=? ORDER BY f.created_at DESC LIMIT 20`).all(req.userId);
  const all = [...likes.map(l => ({ ...l, type: 'like' })), ...follows.map(f => ({ ...f, type: 'follow' }))];
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(all.slice(0, 30));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hen 🐔 running on port ${PORT}`));
