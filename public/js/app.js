let token = localStorage.getItem('hen_token');
let current_user = null;
let current_view = '/';

const ICONS = {
  comment: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"/></svg>',
  repost: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>',
  like: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  likeOutline: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  heartFill: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#e0245e"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  notification: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
  personNotif: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>'
};

// === API ===
async function api(path, opts = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch('/api' + path, { ...opts, headers: h });
  return r.json();
}

// === AUTH ===
function showLogin() { document.getElementById('signup-form').parentElement.style.display = 'none'; document.getElementById('login-box').style.display = 'block'; }
function showSignup() { document.getElementById('login-box').style.display = 'none'; document.getElementById('signup-form').parentElement.style.display = 'block'; }

document.getElementById('signup-form').onsubmit = async (e) => {
  e.preventDefault();
  const r = await api('/signup', { method: 'POST', body: JSON.stringify({
    display_name: document.getElementById('signup-displayname').value,
    username: document.getElementById('signup-username').value,
    email: document.getElementById('signup-email').value,
    password: document.getElementById('signup-password').value
  })});
  if (r.token) { token = r.token; localStorage.setItem('hen_token', token); init(); } else alert(r.error);
};

document.getElementById('login-form').onsubmit = async (e) => {
  e.preventDefault();
  const r = await api('/login', { method: 'POST', body: JSON.stringify({
    login: document.getElementById('login-user').value,
    password: document.getElementById('login-pass').value
  })});
  if (r.token) { token = r.token; localStorage.setItem('hen_token', token); init(); } else alert(r.error);
};

// === INIT ===
async function init() {
  if (!token) { show('auth-screen'); return; }
  current_user = await api('/me');
  if (current_user.error) { localStorage.removeItem('hen_token'); token = null; show('auth-screen'); return; }
  document.getElementById('nav-avatar').textContent = current_user.display_name[0].toUpperCase();
  document.getElementById('nav-displayname').textContent = current_user.display_name;
  document.getElementById('nav-username').textContent = '@' + current_user.username;
  show('main-screen');
  document.getElementById('main-screen').classList.add('active');
  document.getElementById('compose-avatar').textContent = current_user.display_name[0].toUpperCase();
  loadTrends();
  loadSuggestions();
  go(window.location.hash.slice(1) || '/');
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
  document.getElementById(id).style.display = id === 'main-screen' ? 'flex' : 'flex';
}

// === ROUTING ===
function go(path) {
  current_view = path;
  window.location.hash = path;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('#view-home,#view-explore,#view-profile,#view-post,#view-notifications,#view-more,#view-tag').forEach(v => v.style.display = 'none');

  if (path === '/' || path === '/home') { document.getElementById('view-home').style.display = 'block'; document.querySelector('.nav-item:nth-child(1)').classList.add('active'); loadFeed(); }
  else if (path === '/explore') { document.getElementById('view-explore').style.display = 'block'; document.querySelector('.nav-item:nth-child(2)').classList.add('active'); loadExplore(); }
  else if (path === '/notifications') { document.getElementById('view-notifications').style.display = 'block'; document.querySelector('.nav-item:nth-child(3)').classList.add('active'); loadNotifications(); }
  else if (path.startsWith('/profile/')) { document.getElementById('view-profile').style.display = 'block'; loadProfile(path.split('/profile/')[1]); }
  else if (path.startsWith('/post/')) { document.getElementById('view-post').style.display = 'block'; loadPost(path.split('/post/')[1]); }
  else if (path.startsWith('/tag/')) { document.getElementById('view-tag').style.display = 'block'; loadTag(path.split('/tag/')[1]); }
  else if (path === '/more') { document.getElementById('view-more').style.display = 'block'; document.querySelector('.nav-item:nth-child(5)').classList.add('active'); loadMore(); }
  else if (path.startsWith('/search')) { document.getElementById('view-explore').style.display = 'block'; loadExplore(); }
  window.scrollTo(0, 0);
}

window.onhashchange = () => go(window.location.hash.slice(1) || '/');

// === FEED ===
async function loadFeed() {
  const v = document.getElementById('view-home');
  v.innerHTML = `
    <div class="view-header"><h2>Home</h2></div>
    <div class="compose-inline">
      <div class="avatar">${current_user.display_name[0].toUpperCase()}</div>
      <textarea id="home-compose" placeholder="O que está acontecendo?" maxlength="280" oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"></textarea>
    </div>
    <div class="compose-inline-footer">
      <button class="btn-tweet-sm" onclick="submitHomePost()">Postar</button>
    </div>
    <div id="feed-posts" class="loading">Carregando...</div>`;
  const posts = await api('/feed');
  renderPosts(posts, 'feed-posts');
}

async function submitHomePost() {
  const inp = document.getElementById('home-compose');
  if (!inp.value.trim()) return;
  await api('/posts', { method: 'POST', body: JSON.stringify({ content: inp.value.trim() }) });
  inp.value = '';
  loadFeed();
}

// === EXPLORE ===
async function loadExplore() {
  const v = document.getElementById('view-explore');
  v.innerHTML = `<div class="view-header"><h2>Explorar</h2></div>
    <div class="search-box" style="padding:12px 16px"><input type="text" id="explore-search" placeholder="Buscar no Hen" onkeyup="if(event.key==='Enter')doSearchFromExplore()"></div>
    <div id="explore-content"></div>`;
}

async function doSearchFromExplore() {
  const q = document.getElementById('explore-search').value;
  if (!q) return;
  const r = await api('/search?q=' + encodeURIComponent(q));
  const el = document.getElementById('explore-content');
  let html = '<div class="search-section"><h3>Pessoas</h3>';
  if (r.users?.length) r.users.forEach(u => {
    html += `<div class="follow-item" onclick="go('/profile/${u.username}')">
      <div class="avatar">${u.display_name[0].toUpperCase()}</div>
      <div class="follow-item-info"><div class="follow-item-name">${u.display_name}</div><div class="follow-item-user">@${u.username}</div></div></div>`;
  });
  html += '</div><div class="search-section"><h3>Posts</h3></div>';
  el.innerHTML = html;
  if (r.posts?.length) renderPosts(r.posts, null, el);
}

function doSearch() { const q = document.getElementById('search-input').value; if (q) { go('/explore'); setTimeout(() => { document.getElementById('explore-search').value = q; doSearchFromExplore(); }, 100); } }

// === POSTS ===
function renderPosts(posts, containerId, appendTo) {
  const el = appendTo || document.getElementById(containerId);
  if (!el) return;
  if (!posts?.length) { if (!appendTo) el.innerHTML = '<div class="loading">Nenhum post ainda</div>'; return; }
  const html = posts.map(p => {
    const time = timeAgo(p.created_at);
    const content = highlightHashtags(escapeHtml(p.content));
    return `<div class="post" onclick="go('/post/${p.id}')">
      <div class="avatar" onclick="event.stopPropagation();go('/profile/${p.username}')">${p.display_name[0].toUpperCase()}</div>
      <div class="post-body">
        <div class="post-header">
          <span class="post-name" onclick="event.stopPropagation();go('/profile/${p.username}')">${p.display_name}</span>
          <span class="post-username">@${p.username}</span>
          <span class="post-time">${time}</span>
        </div>
        <div class="post-content">${content}</div>
        <div class="post-actions">
          <span class="post-action" onclick="event.stopPropagation();"><span class="action-icon">${ICONS.comment}</span>${p.reply_count || ''}</span>
          <span class="post-action ${p.reposted ? 'reposted' : ''}" onclick="event.stopPropagation();toggleRepost(${p.id},this)"><span class="action-icon">${ICONS.repost}</span>${p.repost_count || ''}</span>
          <span class="post-action ${p.liked ? 'liked' : ''}" onclick="event.stopPropagation();toggleLike(${p.id},this)"><span class="action-icon">${p.liked ? ICONS.heartFill : ICONS.likeOutline}</span>${p.like_count || ''}</span>
        </div>
      </div></div>`;
  }).join('');
  if (appendTo) el.insertAdjacentHTML('beforeend', html); else el.innerHTML = html;
}

async function toggleLike(id, el) {
  const liked = el.classList.contains('liked');
  await api(`/posts/${id}/${liked ? 'like' : 'like'}`, { method: liked ? 'DELETE' : 'POST' });
  if (current_view.startsWith('/post/')) loadPost(id); else go(current_view);
}

async function toggleRepost(id, el) {
  const reposted = el.classList.contains('reposted');
  await api(`/posts/${id}/${reposted ? 'repost' : 'repost'}`, { method: reposted ? 'DELETE' : 'POST' });
  go(current_view);
}

// === SINGLE POST ===
async function loadPost(id) {
  const r = await api('/posts/' + id);
  const v = document.getElementById('view-post');
  if (r.error) { v.innerHTML = '<div class="view-header"><button onclick="history.back()" style="background:none;font-size:20px">&larr;</button><h2>Post</h2></div><div class="loading">Post não encontrado</div>'; return; }
  let html = `<div class="view-header"><button onclick="history.back()" style="background:none;font-size:20px">&larr;</button><h2>Post</h2></div>`;
  if (r.parent) html += renderSinglePost(r.parent, false);
  html += renderSinglePost(r.post, true);
  if (r.replies?.length) {
    html += `<div style="padding:12px 16px;border-bottom:1px solid var(--border)"><h3>${r.replies.length} resposta${r.replies.length > 1 ? 's' : ''}</h3></div>`;
    r.replies.forEach(p => html += renderSinglePost(p, false));
  }
  html += `<div class="compose-inline" style="margin-top:0">
    <div class="avatar">${current_user.display_name[0].toUpperCase()}</div>
    <textarea id="reply-input" placeholder="Poste sua resposta" maxlength="280"></textarea>
  </div><div class="compose-inline-footer">
    <button class="btn-tweet-sm" onclick="submitReply(${id})">Responder</button></div>`;
  v.innerHTML = html;
}

function renderSinglePost(p, big) {
  const time = timeAgo(p.created_at);
  const content = highlightHashtags(escapeHtml(p.content));
  return `<div class="post" style="cursor:default">
    <div class="avatar" onclick="go('/profile/${p.username}')" style="cursor:pointer">${p.display_name[0].toUpperCase()}</div>
    <div class="post-body">
      <div class="post-header">
        <span class="post-name">${p.display_name}</span>
        <span class="post-username">@${p.username}</span>
        <span class="post-time">${time}</span>
      </div>
      <div class="post-content" style="font-size:${big ? '23px' : '15px'}">${content}</div>
      <div class="post-actions">
        <span class="post-action"><span class="action-icon">${ICONS.comment}</span>${p.reply_count || ''}</span>
        <span class="post-action ${p.reposted ? 'reposted' : ''}" onclick="toggleRepost(${p.id},this)"><span class="action-icon">${ICONS.repost}</span>${p.repost_count || ''}</span>
        <span class="post-action ${p.liked ? 'liked' : ''}" onclick="toggleLike(${p.id},this)"><span class="action-icon">${p.liked ? ICONS.heartFill : ICONS.likeOutline}</span>${p.like_count || ''}</span>
      </div>
    </div></div>`;
}

async function submitReply(id) {
  const inp = document.getElementById('reply-input');
  if (!inp.value.trim()) return;
  await api('/posts', { method: 'POST', body: JSON.stringify({ content: inp.value.trim(), reply_to: id }) });
  loadPost(id);
}

// === PROFILE ===
async function loadProfile(username) {
  const u = await api('/users/' + username);
  if (u.error) { document.getElementById('view-profile').innerHTML = '<div class="view-header"><h2>Perfil</h2></div><div class="loading">Usuário não encontrado</div>'; return; }
  const isMe = current_user.username === u.username;
  const v = document.getElementById('view-profile');
  v.innerHTML = `<div class="view-header"><button onclick="history.back()" style="background:none;font-size:20px">&larr;</button><h2>${u.display_name}</h2></div>
    <div class="profile-banner"></div>
    <div class="profile-info">
      <div class="avatar profile-avatar" style="width:80px;height:80px;font-size:32px;border:4px solid var(--bg)">${u.display_name[0].toUpperCase()}</div>
      <div class="profile-actions">${isMe ? '<button class="follow-btn" onclick="openEditProfile()">Editar perfil</button>' : `<button class="follow-btn ${u.is_following ? 'following' : ''}" onclick="toggleFollow('${u.username}',this)">${u.is_following ? 'Seguindo' : 'Seguir'}</button>`}</div>
      <div class="profile-name">${u.display_name}</div>
      <div class="profile-user">@${u.username}</div>
      <div class="profile-bio">${escapeHtml(u.bio || '')}</div>
      <div class="profile-stats">
        <span><strong>${u.following}</strong> Seguindo</span>
        <span><strong>${u.followers}</strong> Seguidores</span>
        <span><strong>${u.posts_count}</strong> Posts</span>
      </div>
    </div>
    <div class="profile-tabs">
      <div class="profile-tab active" onclick="loadProfilePosts('${u.username}',this)">Posts</div>
      <div class="profile-tab" onclick="loadProfileLiked('${u.username}',this)">Curtidas</div>
    </div>
    <div id="profile-posts" class="loading">Carregando...</div>`;
  const posts = await api('/posts?user_id=' + u.id);
  renderPosts(posts, 'profile-posts');
}

async function loadProfilePosts(username, tab) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const u = await api('/users/' + username);
  const posts = await api('/posts?user_id=' + u.id);
  renderPosts(posts, 'profile-posts');
}

async function loadProfileLiked(username, tab) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('profile-posts').innerHTML = '<div class="loading">Em breve</div>';
}

async function toggleFollow(username, btn) {
  const following = btn.classList.contains('following');
  await api(`/users/${username}/${following ? 'follow' : 'follow'}`, { method: following ? 'DELETE' : 'POST' });
  btn.classList.toggle('following');
  btn.textContent = following ? 'Seguir' : 'Seguindo';
}

function openEditProfile() {
  const name = prompt('Nome:', current_user.display_name);
  const bio = prompt('Bio:', current_user.bio || '');
  if (name !== null) api('/me', { method: 'PUT', body: JSON.stringify({ display_name: name, bio }) }).then(() => { current_user.display_name = name; current_user.bio = bio; loadProfile(current_user.username); });
}

// === NOTIFICATIONS ===
async function loadNotifications() {
  const v = document.getElementById('view-notifications');
  v.innerHTML = `<div class="view-header"><h2>Notificações</h2></div><div id="notif-list" class="loading">Carregando...</div>`;
  const notifs = await api('/notifications');
  const el = document.getElementById('notif-list');
  if (!notifs.length) { el.innerHTML = '<div class="loading">Nenhuma notificação</div>'; return; }
  el.innerHTML = notifs.map(n => {
    if (n.type === 'like') return `<div class="notif-item" onclick="go('/post/${n.post_id}')"><div class="notif-icon notif-like">${ICONS.heartFill}</div><div class="notif-content"><div class="notif-text"><strong>${n.display_name}</strong> curtiu seu post</div><div class="notif-time">${timeAgo(n.created_at)}</div></div></div>`;
    return `<div class="notif-item" onclick="go('/profile/${n.username}')"><div class="notif-icon notif-follow">${ICONS.personNotif}</div><div class="notif-content"><div class="notif-text"><strong>${n.display_name}</strong> começou a seguir você</div><div class="notif-time">${timeAgo(n.created_at)}</div></div></div>`;
  }).join('');
}

// === TAG ===
async function loadTag(tag) {
  const v = document.getElementById('view-tag');
  v.innerHTML = `<div class="view-header"><button onclick="history.back()" style="background:none;font-size:20px">&larr;</button><h2>#${tag}</h2></div><div id="tag-posts" class="loading">Carregando...</div>`;
  const posts = await api('/posts?hashtag=' + encodeURIComponent(tag));
  renderPosts(posts, 'tag-posts');
}

// === MORE ===
function loadMore() {
  document.getElementById('view-more').innerHTML = `<div class="view-header"><h2>Mais</h2></div>
    <ul class="more-menu">
      <li class="more-item" onclick="openEditProfile()"><span class="more-icon">${ICONS.edit}</span> Editar perfil</li>
      <li class="more-item" onclick="api('/logout',{method:'POST'}).then(()=>{localStorage.removeItem('hen_token');location.reload()})"><span class="more-icon">${ICONS.logout}</span> Sair</li>
    </ul>`;
}

// === TRENDS & SUGGESTIONS ===
async function loadTrends() {
  const tags = await api('/trending');
  document.getElementById('trends-list').innerHTML = tags.length ? tags.map(t => `
    <div class="trend-item" onclick="go('/tag/${t.tag}')">
      <div class="trend-category">Assunto do momento</div>
      <div class="trend-tag">#${t.tag}</div>
      <div class="trend-count">${t.count} posts</div>
    </div>`).join('') : '<div class="loading">Nenhum trending ainda</div>';
}

async function loadSuggestions() {
  const users = await api('/suggestions');
  document.getElementById('suggestions-list').innerHTML = users.length ? users.map(u => `
    <div class="follow-item">
      <div class="avatar avatar-sm">${u.display_name[0].toUpperCase()}</div>
      <div class="follow-item-info">
        <div class="follow-item-name">${u.display_name}</div>
        <div class="follow-item-user">@${u.username}</div>
      </div>
      <button class="follow-btn" onclick="toggleFollow('${u.username}',this)">Seguir</button>
    </div>`).join('') : '<div class="loading">Nenhuma sugestão</div>';
}

// === COMPOSE ===
function openCompose() { document.getElementById('compose-modal').style.display = 'flex'; document.getElementById('compose-input').focus(); }
function closeCompose() { document.getElementById('compose-modal').style.display = 'none'; }

async function submitPost() {
  const inp = document.getElementById('compose-input');
  if (!inp.value.trim()) return;
  await api('/posts', { method: 'POST', body: JSON.stringify({ content: inp.value.trim() }) });
  inp.value = '';
  closeCompose();
  go(current_view);
}

document.getElementById('compose-input')?.addEventListener('input', function() {
  document.getElementById('char-count').textContent = 280 - this.value.length;
});

// === UTILS ===
function escapeHtml(t) { return t?.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') || ''; }
function highlightHashtags(t) { return t?.replace(/#(\w+)/g, '<span class="hashtag">#$1</span>') || ''; }
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d + 'Z')) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h';
  return Math.floor(s/86400) + 'd';
}

// === START ===
init();
setInterval(() => { if (token && current_view === '/') loadFeed(); }, 30000);
