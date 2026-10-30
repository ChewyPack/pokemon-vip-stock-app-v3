/* Shared collector social UI for profile posts and the Community Feed. */
(function () {
  'use strict';
  const $ = (root, selector) => root.querySelector(selector);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const labels = {status:'Status',pull:'Card pull',collection:'Collection update',trade:'Trade',question:'Question',event:'Event',restock:'Restock sighting'};
  const IMAGE_TYPES = ['image/jpeg','image/png','image/webp','image/avif'];
  const VIDEO_TYPES = ['video/mp4','video/webm'];
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
  function ensureMediaStyles() {
    if (document.getElementById('social-media-layout-style')) return;
    const style = document.createElement('style');
    style.id = 'social-media-layout-style';
    style.textContent = '.social-composer-row,.cp-social-composer-row{grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto!important}.social-composer-media-inputs,.cp-social-media-inputs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}.social-media-preview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:10px}.social-media-preview:empty{display:none}.social-media-preview__item{min-width:0;display:grid;gap:4px;padding:6px;border:1px solid #dbe4f4;border-radius:9px;background:#f5f7fc;color:#31517f;font-size:.75rem;font-weight:800;overflow:hidden}.social-media-preview__item img,.social-media-preview__item video{display:block;width:100%;height:88px;object-fit:contain;background:#eaf1ff;border-radius:5px}.social-media-preview__note{grid-column:1/-1;margin:0;color:#a32222;font-size:.82rem;font-weight:800}.social-post-media-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}.social-post-media-grid.is-single{grid-template-columns:minmax(0,1fr)}.social-post-media-item{min-width:0;overflow:hidden;border-radius:11px;background:#f3f6fc}.social-post-media-item .social-post-image,.social-post-video{display:block;width:100%;height:100%;max-height:560px;object-fit:contain;background:#f3f6fc;border-radius:11px;margin:0}.social-post-video{aspect-ratio:16/9;min-height:150px}.social-stat-button{border:0;background:transparent;color:#607096;font:inherit;font-size:.82rem;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:3px}.social-stat-button:hover,.social-stat-button:focus-visible{color:#0b2a6b}.social-view-count{color:#607096;font-size:.82rem}.social-likers-thread{margin:8px 0;padding:11px;border:1px solid #dbe4f4;border-radius:10px;background:#f7faff}.social-likers-thread[hidden]{display:none!important}.social-likers-list{display:grid;gap:8px}.social-liker{display:flex;align-items:center;gap:9px;min-width:0;padding:6px;border-radius:8px;background:#fff}.social-liker-avatar{width:34px;height:34px;flex:0 0 34px;object-fit:cover;border-radius:50%;background:#eaf1ff}.social-liker-name{min-width:0;overflow-wrap:anywhere}.social-liker-name a{color:#0b2a6b;text-decoration:none;font-weight:900}.social-liker-name span{display:block;color:#607096;font-size:.78rem}@media(max-width:640px){.social-composer-row,.cp-social-composer-row{grid-template-columns:1fr!important}.social-composer-media-inputs,.cp-social-media-inputs{grid-template-columns:1fr}.social-media-preview{grid-template-columns:repeat(2,minmax(0,1fr))}.social-post-media-grid{gap:6px}.social-post-video{min-height:100px}}';
    style.textContent += '.social-comment-form{display:grid!important;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px}.social-comment-form [data-reply-context]{grid-column:1/-1}.social-comment-form textarea{display:block!important;visibility:visible!important;opacity:1!important;width:100%;min-width:0;min-height:72px;box-sizing:border-box;grid-column:1}.social-comment-form button[type="submit"]{grid-column:2;grid-row:2;align-self:end}';
    style.textContent += '.social-post-header{position:relative}.social-post-menu{position:relative;margin-left:auto;align-self:flex-start}.social-post-menu-trigger{width:34px;height:34px;border:0;border-radius:50%;background:transparent;color:#607096;font-size:25px;line-height:1;letter-spacing:1px;cursor:pointer}.social-post-menu-trigger:hover,.social-post-menu-trigger:focus-visible{background:#edf3ff;color:#0b2a6b}.social-post-menu-items{position:absolute;z-index:20;right:0;top:36px;min-width:145px;padding:5px;background:#fff;border:1px solid #dbe4f4;border-radius:10px;box-shadow:0 8px 24px #07194d24}.social-post-menu-items[hidden]{display:none!important}.social-post-menu-items button{display:block;width:100%;padding:9px 11px;border:0;border-radius:7px;background:transparent;text-align:left;color:#17386c;font:inherit;font-size:.86rem;font-weight:800;cursor:pointer}.social-post-menu-items button:hover{background:#edf3ff}.social-post-menu-items .social-post-delete{color:#b42318}';
    document.head.appendChild(style);
  }
  ensureMediaStyles();
  const dateText = value => {
    // SQLite CURRENT_TIMESTAMP values are UTC but arrive without a timezone suffix.
    // Treat those timestamp strings as UTC before converting them to the viewer's local time.
    const raw = typeof value === 'string' ? value.trim() : value;
    const timestamp = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)
      ? raw.replace(' ', 'T') + 'Z'
      : raw;
    const d = new Date(timestamp);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], {month:'short',day:'numeric',year:d.getFullYear()===new Date().getFullYear()?undefined:'numeric',hour:'numeric',minute:'2-digit'});
  };
  async function api(url, options) {
    const response = await fetch(url, Object.assign({credentials:'include',cache:'no-store'}, options || {}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const messages = {
        login_required:'Please sign in to do that.',
        collector_social_migration_required:'The Community Feed database tables are unavailable. Please contact support.',
        post_content_required:'Write something or add at least one photo or video before posting.',
        post_too_long:'Posts can be up to 2,000 characters.',
        invalid_image_url:'Please choose media using the upload controls.',
        invalid_media_url:'A selected photo or video is invalid. Please choose it again.',
        too_many_photos:'A post can include up to 3 photos.',
        too_many_videos:'A post can include only 1 video.',
        post_media_limit_exceeded:'A post can include up to 3 photos and 1 video.',
        duplicate_media:'The same media cannot be attached twice.',
        already_reported:'You already reported this post.',
        follow_migration_required:'The collector follow database setup is incomplete. Please contact support.',
        comment_replies_migration_required:'Direct replies need the production comment-replies migration. Please contact support.',
        invalid_parent_comment_id:'Choose a valid comment to reply to.',
        parent_comment_not_found:'That comment is no longer available to reply to.'
      };
      throw new Error(messages[data.error] || data.message || data.error || 'The request could not be completed.');
    }
    return data;
  }
  function postCard(post) {
    const avatar = post.avatar_url
      ? '<img class="social-avatar" src="' + safe(post.avatar_url) + '" alt="" loading="lazy">'
      : '<span class="social-avatar social-avatar-placeholder" aria-hidden="true">P</span>';
    const media = Array.isArray(post.media) ? post.media : (post.image_url ? [{type:'image',url:post.image_url}] : []);
    const mediaMarkup = media.length ? '<div class="social-post-media-grid' + (media.length===1?' is-single':'') + '">' + media.map(item => {
      if (item.type === 'video') {
        const mime = /\.webm(?:$|[?#])/i.test(item.url) ? 'video/webm' : 'video/mp4';
        return '<div class="social-post-media-item"><video class="social-post-video" controls preload="metadata" playsinline aria-label="Video shared by ' + safe(post.display_name || post.username) + '"><source src="' + safe(item.url) + '" type="' + mime + '">Your browser does not support video playback.</video></div>';
      }
      return '<div class="social-post-media-item"><img class="social-post-image" src="' + safe(item.url) + '" alt="Photo shared by ' + safe(post.display_name || post.username) + '" loading="lazy"></div>';
    }).join('') + '</div>' : '';
    return '<article class="social-post" data-post-card="' + Number(post.id) + '">' +
      '<header class="social-post-header">' + avatar +
      '<div class="social-post-author"><a href="/collector.html?user=' + encodeURIComponent(post.username) + '">' + safe(post.display_name || post.username) + '</a><div><a href="/collector.html?user=' + encodeURIComponent(post.username) + '">@' + safe(post.username) + '</a><span> · ' + safe(dateText(post.created_at)) + '</span></div></div>' +
      '<div class="social-post-menu"><button type="button" class="social-post-menu-trigger" data-post-menu-toggle="' + Number(post.id) + '" aria-label="Post options" aria-expanded="false">···</button><div class="social-post-menu-items" data-post-menu="' + Number(post.id) + '" hidden>' + (!post.is_own ? '<button type="button" data-post-report="' + Number(post.id) + '">Report post</button>' : '<button type="button" data-post-edit="' + Number(post.id) + '" data-post-body="' + safe(post.body || '') + '" data-post-media="' + safe(JSON.stringify(media)) + '">Edit post</button><button type="button" data-post-delete="' + Number(post.id) + '" class="social-post-delete">Delete post</button>') + '</div></div></header>' +
      (post.body ? '<p class="social-post-body">' + safe(post.body).replace(/\n/g, '<br>') + '</p>' : '') + mediaMarkup +
      '<div class="social-post-stats"><button type="button" class="social-stat-button" data-post-likers="' + Number(post.id) + '" data-like-count aria-label="See post reactions">' + Number(post.like_count || 0) + (Number(post.like_count || 0) === 1 ? ' reaction' : ' reactions') + '</button><button type="button" class="social-stat-button" data-post-open-comments="' + Number(post.id) + '" data-comment-count aria-label="See comments on this post">' + Number(post.comment_count || 0) + (Number(post.comment_count || 0) === 1 ? ' comment' : ' comments') + '</button><span class="social-view-count" data-view-count' + (post.is_own ? '' : ' hidden') + '>' + Number(post.view_count || 0) + (Number(post.view_count || 0) === 1 ? ' view' : ' views') + '</span></div>' +
      '<section class="social-likers-thread" data-likers-thread="' + Number(post.id) + '" hidden><p class="social-inline-status" data-likes-status role="status" aria-live="polite"></p><div class="social-likers-list" data-likes-list></div></section>' +
      '<div class="social-post-actions"><div class="social-reaction-picker" data-reaction-picker="' + Number(post.id) + '"><button type="button" class="social-reaction-trigger' + (post.my_reaction ? ' is-reacted' : '') + '" data-reaction-trigger="' + Number(post.id) + '" aria-label="Choose a reaction" aria-expanded="false">' + (post.my_reaction ? safe(({like:'👍',love:'❤️',haha:'😂',wow:'😮',sad:'😢',angry:'😡'})[post.my_reaction] || '👍') : '＋') + ' <span>' + (post.my_reaction ? 'Reacted' : 'React') + '</span></button><div class="social-reaction-options" data-reaction-options hidden>' + [{key:'like',emoji:'👍',label:'Like'},{key:'love',emoji:'❤️',label:'Love'},{key:'haha',emoji:'😂',label:'Haha'},{key:'wow',emoji:'😮',label:'Wow'},{key:'sad',emoji:'😢',label:'Sad'},{key:'angry',emoji:'😡',label:'Angry'}].map(x=>'<button type="button" data-reaction="' + x.key + '" data-post-id="' + Number(post.id) + '" aria-label="' + x.label + '" title="' + x.label + '">' + x.emoji + '</button>').join('') + '</div></div><button type="button" data-post-comments="' + Number(post.id) + '">Comment</button></div>' +
      '<section class="social-comments" data-comments-thread="' + Number(post.id) + '" hidden><div class="social-comment-list" data-comment-list></div>' +
      '<form class="social-comment-form" data-comment-form="' + Number(post.id) + '"><div class="social-reply-context" data-reply-context hidden>Replying to <strong data-reply-name></strong><button type="button" data-comment-reply-cancel>Cancel</button></div><input type="hidden" name="parent_comment_id" value=""><label class="sr-only" for="social-comment-' + Number(post.id) + '">Write a comment or reply</label><textarea id="social-comment-' + Number(post.id) + '" name="body" maxlength="1000" required rows="2" placeholder="Add a comment…"></textarea><button type="submit">Comment</button></form><p class="social-inline-status" data-comment-status role="status" aria-live="polite"></p></section></article>';
  }
  async function loadLikers(root, postId) {
    const section = $(root, '[data-likers-thread="' + postId + '"]');
    if (!section) return;
    const status = $(section, '[data-likes-status]');
    const list = $(section, '[data-likes-list]');
    status.textContent = 'Loading reactions…';
    list.replaceChildren();
    try {
      const data = await api('/api/collector/post-reaction?id=' + encodeURIComponent(postId));
      const users = data.users || [];
      const counts = data.counts || {};
      const summary = Object.entries(counts).filter(([,count])=>Number(count)>0).map(([type,count])=>({like:'👍',love:'❤️',haha:'😂',wow:'😮',sad:'😢',angry:'😡'}[type] + ' ' + count)).join(' · ');
      status.textContent = users.length ? (summary ? summary + ' — ' : '') + users.length + (users.length === 1 ? ' collector reacted.' : ' collectors reacted.') : 'No reactions yet.';
      list.innerHTML = users.map(user => '<article class="social-liker">' +
        (user.avatar_url ? '<img class="social-liker-avatar" src="' + safe(user.avatar_url) + '" alt="" loading="lazy">' : '<span class="social-liker-avatar social-avatar-placeholder">P</span>') +
        '<div class="social-liker-name"><a href="/collector.html?user=' + encodeURIComponent(user.username) + '">' + safe(user.display_name || user.username) + '</a><span>@' + safe(user.username) + ' · ' + safe(({like:'👍 Like',love:'❤️ Love',haha:'😂 Haha',wow:'😮 Wow',sad:'😢 Sad',angry:'😡 Angry'})[user.reaction] || '👍 Like') + '</span></div></article>').join('');
      section.dataset.loaded = 'true';
    } catch (error) { status.textContent = error.message || 'Could not load who liked this post.'; }
  }
  async function openComments(root, postId) {
    const thread = $(root, '[data-comments-thread="' + postId + '"]');
    if (!thread) return;
    thread.hidden = !thread.hidden;
    if (!thread.hidden && thread.dataset.loaded !== 'true') await loadComments(root, postId);
  }
  let viewObserver = null;
  const attemptedPostViews = new Set();
  function browserViewerKey() {
    try {
      let value = localStorage.getItem('ppp-collector-viewer-key');
      if (!value || !/^[a-f0-9-]{36}$/i.test(value)) {
        value = window.crypto && typeof window.crypto.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
              const r = Math.random() * 16 | 0;
              return (ch === 'x' ? r : (r & 3 | 8)).toString(16);
            });
        localStorage.setItem('ppp-collector-viewer-key', value);
      }
      return value;
    } catch (_) {
      if (!window.__pppCollectorViewerKey) {
        window.__pppCollectorViewerKey = window.crypto && typeof window.crypto.randomUUID === 'function'
          ? window.crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => ((Math.random()*16)|0).toString(16));
      }
      return window.__pppCollectorViewerKey;
    }
  }
  async function recordPostView(postId, card) {
    if (attemptedPostViews.has(postId)) return;
    attemptedPostViews.add(postId);
    try {
      const response = await fetch('/api/collector/post-view', {
        method:'POST',credentials:'include',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({post_id:Number(postId),viewer_key:browserViewerKey()})
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok && card) {
        const count = $(card, '[data-view-count]');
        if (count) count.textContent = Number(data.view_count || 0) + ' views';
      } else { attemptedPostViews.delete(postId); }
    } catch (_) { attemptedPostViews.delete(postId); }
  }
  function observePostViews(root, posts) {
    if (viewObserver) viewObserver.disconnect();
    if ('IntersectionObserver' in window) {
      viewObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.15) return;
          const card = entry.target;
          viewObserver.unobserve(card);
          const post = posts.find(item => Number(item.id) === Number(card.dataset.postCard));
          if (post && !post.is_own) recordPostView(post.id, card);
        });
      }, {threshold:[0.15]});
      root.querySelectorAll('[data-post-card]').forEach(card => viewObserver.observe(card));
    } else {
      root.querySelectorAll('[data-post-card]').forEach(card => {
        const post = posts.find(item => Number(item.id) === Number(card.dataset.postCard));
        if (post && !post.is_own) recordPostView(post.id, card);
      });
    }
  }
  function renderComments(root, postId, comments, supportsReplies) {
    const thread = $(root, '[data-comments-thread="' + postId + '"]');
    if (!thread) return;
    const list = $(thread, '[data-comment-list]');
    const byParent = new Map();
    const ids = new Set(comments.map(c => Number(c.id)));
    comments.forEach(c => {
      const candidate = Number(c.parent_comment_id || 0);
      const parentId = candidate && ids.has(candidate) && candidate !== Number(c.id) ? candidate : 0;
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(c);
    });
    function renderOne(c, depth) {
      const id = Number(c.id);
      const author = c.username || c.display_name || 'collector';
      const article = '<article class="social-comment' + (depth ? ' social-comment--reply' : '') + '" data-comment-id="' + id + '">' +
        (c.avatar_url ? '<img class="social-comment-avatar" src="' + safe(c.avatar_url) + '" alt="" loading="lazy">' : '<span class="social-comment-avatar">P</span>') +
        '<div class="social-comment-content"><div><a href="/collector.html?user=' + encodeURIComponent(c.username || '') + '">' + safe(c.display_name || c.username) + '</a><span> · ' + safe(dateText(c.created_at)) + '</span></div><p>' + safe(c.body).replace(/\n/g, '<br>') + '</p><div class="social-comment-controls">' +
        (supportsReplies ? '<button type="button" class="social-comment-reply-btn" data-comment-reply="' + id + '" data-comment-reply-author="' + safe(author) + '">Reply</button>' : '') +
        (c.is_own ? '<button type="button" class="social-comment-remove" data-comment-delete="' + id + '" aria-label="Delete your comment">Delete</button>' : '') +
        '</div></div></article>';
      const children = byParent.get(id) || [];
      const replies = children.length ? '<div class="social-comment-replies">' + children.map(child => renderOne(child, Math.min(depth + 1, 4))).join('') + '</div>' : '';
      return '<div class="social-comment-node">' + article + replies + '</div>';
    }
    const topLevel = byParent.get(0) || [];
    list.innerHTML = comments.length
      ? topLevel.map(comment => renderOne(comment, 0)).join('')
      : '<p class="social-empty-comments">No comments yet. Start the conversation.</p>';
    const form = $(thread, '[data-comment-form]');
    if (form) attachMentionAutocomplete($(form, '[name="body"]'));
    if (form) form.dataset.supportsReplies = String(!!supportsReplies);
    if (!supportsReplies) {
      const note = $(thread, '[data-comment-status]');
      if (note) note.textContent = 'Direct replies will be available after the production database migration. You can still add regular comments.';
    }
  }
  function setReplyTarget(form, id, author) {
    if (!form) return;
    const input = form.elements.parent_comment_id;
    const context = $(form, '[data-reply-context]');
    const name = $(form, '[data-reply-name]');
    const textarea = form.elements.body;
    const button = form.querySelector('[type="submit"]');
    input.value = id ? String(id) : '';
    context.hidden = !id;
    name.textContent = id ? '@' + String(author || 'collector').replace(/^@/, '') : '';
    textarea.placeholder = id ? 'Reply to @' + String(author || 'collector').replace(/^@/, '') + '…' : 'Add a comment…';
    button.textContent = id ? 'Send reply' : 'Comment';
  }
  async function loadComments(root, postId) {
    const thread = $(root, '[data-comments-thread="' + postId + '"]');
    if (!thread) return;
    const status = $(thread, '[data-comment-status]');
    status.textContent = 'Loading comments…';
    try {
      const d = await api('/api/collector/post-comments?post_id=' + encodeURIComponent(postId));
      renderComments(root, postId, d.comments || [], !!d.supports_replies);
      if (!d.supports_replies) status.textContent = 'Direct replies will be available after the production database migration. You can still add regular comments.'; else status.textContent = '';
      thread.dataset.loaded = 'true';
    } catch (e) { status.textContent = e.message; }
  }
  async function loadPosts(root, state) {
    const list = $(root, '[data-social-post-list]');
    const status = $(root, '[data-social-feed-status]');
    if (!list) return;
    status.textContent = 'Loading posts…';
    list.innerHTML = '';
    try {
      const requestedPost = new URLSearchParams(location.search).get('post');
      let url;
      if (requestedPost && state.mode !== 'profile') url = '/api/collector/posts?post_id=' + encodeURIComponent(requestedPost);
      else if (state.mode === 'profile') url = '/api/collector/posts?username=' + encodeURIComponent(state.username);
      else url = '/api/collector/posts?feed=' + encodeURIComponent(state.feed || 'for-you');
      const d = await api(url);
      const posts = d.posts || [];
      list.innerHTML = posts.length ? posts.map(postCard).join('') : '<div class="social-empty-state"><strong>No posts yet.</strong><span>' + (state.mode === 'profile' ? 'When this collector shares an update, it will appear here.' : 'Be the first to share something with the community.') + '</span></div>';
      status.textContent = posts.length ? posts.length + (posts.length === 1 ? ' post' : ' posts') : '';
      observePostViews(root, posts);
      if (requestedPost) {
        const focusCard = $(list, '[data-post-card="' + Number(requestedPost) + '"]');
        if (focusCard) focusCard.scrollIntoView({behavior:'smooth',block:'center'});
      }
    } catch (e) {
      status.textContent = e.message;
      if (String(e.message).includes('database setup')) list.innerHTML = '<div class="social-empty-state"><strong>Community Feed setup needed</strong><span>The Community Feed database tables are unavailable. Please contact support before using the feed.</span></div>';
    }
    state.loaded = true;
  }
  function attachMentionAutocomplete(bodyInput) {
    if (!bodyInput || bodyInput.dataset.mentionsBound === 'true') return;
    bodyInput.dataset.mentionsBound = 'true';
    const suggestionBox = document.createElement('div');
    suggestionBox.className = 'social-compose-suggestions';
    suggestionBox.hidden = true;
    bodyInput.insertAdjacentElement('afterend', suggestionBox);
    let suggestionTimer = null;
    let suggestionRequest = 0;
    const starterTags = ['Pokemon','PokemonTCG','OnePieceTCG','Lorcana','DragonBallSuper','PokemonCards','CardPull','TCGCommunity','PokePrizePool'];
    function closeSuggestions() { suggestionBox.hidden = true; suggestionBox.replaceChildren(); }
    function insertSuggestion(value, start, end) {
      bodyInput.value = bodyInput.value.slice(0,start) + value + ' ' + bodyInput.value.slice(end);
      const cursor = start + value.length + 1;
      bodyInput.focus(); bodyInput.setSelectionRange(cursor,cursor); closeSuggestions();
    }
    function show(items,start,end) {
      suggestionBox.replaceChildren();
      items.slice(0,8).forEach(item => {
        const button=document.createElement('button'); button.type='button'; button.className='social-compose-suggestion';
        const label=document.createElement('span'); label.textContent=item.label;
        if(item.detail){const small=document.createElement('small');small.textContent=item.detail;label.appendChild(small);}
        button.appendChild(label); button.addEventListener('mousedown',e=>e.preventDefault());
        button.addEventListener('click',()=>insertSuggestion(item.insert,start,end)); suggestionBox.appendChild(button);
      });
      suggestionBox.hidden=!items.length;
    }
    bodyInput.addEventListener('input',()=>{
      clearTimeout(suggestionTimer);
      const cursor=bodyInput.selectionStart||0, before=bodyInput.value.slice(0,cursor);
      const match=before.match(/(^|\s)([#@])([a-zA-Z0-9_]{0,24})$/);
      if(!match){suggestionRequest++;closeSuggestions();return;}
      const start=cursor-match[2].length-match[3].length, token=match[3].toLowerCase(), requestId=++suggestionRequest;
      if(match[2]==='#'){
        suggestionTimer=setTimeout(async()=>{
          let tags=starterTags;
          try{const r=await fetch('/api/collector/hashtags?q='+encodeURIComponent(token),{credentials:'include',cache:'no-store'});const d=await r.json();if(d.ok&&Array.isArray(d.hashtags))tags=[...d.hashtags.map(x=>x.tag),...starterTags];}catch(_){}
          if(requestId!==suggestionRequest)return;
          const unique=[...new Set(tags)].filter(t=>t.toLowerCase().startsWith(token)).slice(0,8);
          show(unique.map(tag=>({label:'#'+tag,detail:'Community hashtag',insert:'#'+tag})),start,cursor);
        },100);
        return;
      }
      const everyone=token&&'everyone'.startsWith(token)?[{label:'@Everyone',detail:'Mention the community',insert:'@Everyone'}]:[];
      suggestionTimer=setTimeout(async()=>{
        try{const r=await fetch('/api/collector/mentions?q='+encodeURIComponent(token),{credentials:'include',cache:'no-store'});const d=await r.json();if(requestId!==suggestionRequest)return;
          const members=(d.members||[]).map(m=>({label:'@'+m.username,detail:m.display_name||'PokePrizePool member',insert:'@'+m.username}));
          show([...everyone,...members],start,cursor);
        }catch(_){if(requestId===suggestionRequest)show(everyone,start,cursor);}
      },150);
    });
    bodyInput.addEventListener('keydown',e=>{if(e.key==='Escape')closeSuggestions();});
  }
  async function setupComposer(root, state) {
    const form = $(root, '[data-social-composer]');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    const status = $(form, '[data-composer-status]');
    attachMentionAutocomplete($(form, '[name="body"]'));
    const imagesInput = $(form, '[name="images"]');
    const videoInput = $(form, '[name="video"]');
    const preview = $(form, '[data-media-preview]');
    let previewUrls = [];
    function clearPreview() {
      previewUrls.forEach(url => URL.revokeObjectURL(url));
      previewUrls = [];
      if (preview) preview.replaceChildren();
    }
    function addPreviewItem(file, index, type) {
      if (!preview) return;
      const item = document.createElement('div');
      item.className = 'social-media-preview__item';
      const url = URL.createObjectURL(file);
      previewUrls.push(url);
      let media;
      if (type === 'video') {
        media = document.createElement('video');
        media.src = url;
        media.controls = true;
        media.muted = true;
        media.preload = 'metadata';
        media.playsInline = true;
      } else {
        media = document.createElement('img');
        media.src = url;
        media.alt = 'Selected photo ' + index;
      }
      const caption = document.createElement('span');
      caption.textContent = type === 'video' ? 'Video preview' : 'Photo ' + index;
      item.append(media, caption);
      preview.appendChild(item);
    }
    function refreshPreview() {
      clearPreview();
      const images = Array.from(imagesInput && imagesInput.files || []);
      const video = videoInput && videoInput.files && videoInput.files[0];
      images.slice(0, 3).forEach((file, index) => addPreviewItem(file, index + 1, 'image'));
      if (video) addPreviewItem(video, 1, 'video');
      if (images.length > 3 && preview) {
        const note = document.createElement('p');
        note.className = 'social-media-preview__note';
        note.textContent = 'Choose no more than 3 photos. Please reselect your photos.';
        preview.appendChild(note);
      }
    }
    if (imagesInput) imagesInput.addEventListener('change', refreshPreview);
    if (videoInput) videoInput.addEventListener('change', refreshPreview);

    async function uploadMedia(file, positionLabel) {
      status.textContent = 'Uploading ' + positionLabel + '…';
      const response = await fetch('/api/collector/upload?kind=post', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':file.type}, body:file
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        const messages = {
          image_storage_not_configured:'Photo/video storage is not configured for this site yet. Please contact support.',
          login_required:'Please sign in again.',
          image_too_large:'Each photo must be 5 MB or smaller.',
          video_too_large:'The video must be 25 MB or smaller.',
          unsupported_media_type:'Use JPG, PNG, WebP, or AVIF photos and MP4 or WebM videos.'
        };
        throw new Error(messages[result.error] || 'Upload failed for ' + positionLabel + '.');
      }
      return result.url;
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const body = $(form, '[name="body"]').value.trim();
      const imageFiles = Array.from(imagesInput && imagesInput.files || []);
      const videoFile = videoInput && videoInput.files && videoInput.files[0] || null;
      const button = $(form, '[type="submit"]');
      if (imageFiles.length > 3) { status.textContent = 'A post can include up to 3 photos.'; return; }
      if (imageFiles.some(file => !IMAGE_TYPES.includes(file.type))) { status.textContent = 'Use JPG, PNG, WebP, or AVIF photos.'; return; }
      if (imageFiles.some(file => file.size > MAX_IMAGE_BYTES)) { status.textContent = 'Each photo must be 5 MB or smaller.'; return; }
      if (videoFile && !VIDEO_TYPES.includes(videoFile.type)) { status.textContent = 'Use an MP4 or WebM video.'; return; }
      if (videoFile && videoFile.size > MAX_VIDEO_BYTES) { status.textContent = 'The video must be 25 MB or smaller.'; return; }
      if (!body && !imageFiles.length && !videoFile) { status.textContent = 'Write something or add at least one photo or video before posting.'; return; }
      if (body.length > 2000) { status.textContent = 'Posts can be up to 2,000 characters.'; return; }
      button.disabled = true;
      const uploadedMedia = [];
      try {
        for (let index=0; index<imageFiles.length; index++) {
          const url = await uploadMedia(imageFiles[index], 'photo ' + (index + 1) + ' of ' + imageFiles.length);
          uploadedMedia.push({type:'image',url});
        }
        if (videoFile) {
          const url = await uploadMedia(videoFile, 'video');
          uploadedMedia.push({type:'video',url});
        }
        status.textContent = 'Publishing post…';
        await api('/api/collector/posts', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({body,media:uploadedMedia})
        });
        form.reset();
        refreshPreview();
        status.textContent = 'Post published.';
        await loadPosts(root, state);
      } catch (e) {
        status.textContent = e.message || 'Could not publish post.';
      } finally { button.disabled = false; }
    });
  }
  async function initProfile(state) {
    const root = document.getElementById('profile-social');
    if (!root || root.dataset.socialInitialized === 'true' || !state || !state.username) return;
    root.dataset.socialInitialized = 'true';
    root.querySelector('[data-profile-composer]').hidden = !state.own;
    if (state.own) await setupComposer(root, {mode:'profile',username:state.username});
    else {
      const form = $(root, '[data-social-composer]');
      if (form) form.hidden = true;
    }
    const feedState = {mode:'profile',username:state.username};
    root.addEventListener('click', event => handleClick(event, root, feedState));
    root.addEventListener('submit', event => handleCommentSubmit(event, root, feedState));
    await loadPosts(root, feedState);
  }
  async function initCommunity() {
    const root = document.getElementById('community-feed');
    if (!root || root.dataset.socialInitialized === 'true') return;
    root.dataset.socialInitialized = 'true';
    const state = {mode:'feed',feed:'latest'};
    try {
      const me = await fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(r=>r.json()).catch(()=>({}));
      const form = $(root, '[data-social-composer]');
      if (me && me.ok && me.authenticated && form) {
        form.hidden = false;
        await setupComposer(root,state);
      }
    } catch (_) {}
    const feedSort = $(root, '#community-feed-sort');
    if (feedSort) feedSort.addEventListener('change', async () => {
      const feed = feedSort.value;
      if (feed === 'following') {
        try { const me=await fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(r=>r.json()); if(!me.authenticated){location.href='/account.html';return;} }
        catch (_) { location.href='/account.html'; return; }
      }
      state.feed=feed;
      await loadPosts(root,state);
    });
    root.addEventListener('click', event => handleClick(event,root,state));
    root.addEventListener('submit', event => handleCommentSubmit(event,root,state));
    await loadPosts(root,state);
  }
  async function handleClick(event, root, state) {
    const reactionTrigger = event.target.closest('[data-reaction-trigger]');
    if (reactionTrigger) {
      const picker = reactionTrigger.closest('[data-reaction-picker]');
      const options = picker && $(picker,'[data-reaction-options]');
      if (options) { options.hidden = !options.hidden; reactionTrigger.setAttribute('aria-expanded',String(!options.hidden)); }
      return;
    }
    const reactionButton = event.target.closest('[data-reaction][data-post-id]');
    if (reactionButton) {
      const id=reactionButton.dataset.postId, reaction=reactionButton.dataset.reaction;
      reactionButton.disabled=true;
      try {
        const d=await api('/api/collector/post-reaction?id='+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reaction})});
        const card=reactionButton.closest('[data-post-card]');
        const picker=card&&$(card,'[data-reaction-picker]');
        const trigger=picker&&$(picker,'[data-reaction-trigger]');
        if(trigger){const emoji=({like:'👍',love:'❤️',haha:'😂',wow:'😮',sad:'😢',angry:'😡'})[d.my_reaction]||'＋';trigger.innerHTML=emoji+' <span>'+(d.my_reaction?'Reacted':'React')+'</span>';trigger.classList.toggle('is-reacted',!!d.my_reaction);}
        if(picker){const options=$(picker,'[data-reaction-options]');if(options)options.hidden=true;const t=$(picker,'[data-reaction-trigger]');if(t)t.setAttribute('aria-expanded','false');}
        const count=card&&$(card,'[data-like-count]');if(count)count.textContent=Number(d.reaction_count)+(Number(d.reaction_count)===1?' reaction':' reactions');
        const thread=card&&$(card,'[data-likers-thread]');if(thread&&thread.dataset.loaded==='true')loadLikers(root,id);
      } catch(e) { if(e.message==='Please sign in to do that.')location.href='/account.html';else alert(e.message); }
      finally {reactionButton.disabled=false;}
      return;
    }
    const likers = event.target.closest('[data-post-likers]');
    if (likers) {
      const id = likers.dataset.postLikers;
      const section = $(root, '[data-likers-thread="' + id + '"]');
      if (section) {
        section.hidden = !section.hidden;
        if (!section.hidden) await loadLikers(root, id);
      }
      return;
    }
    const commentCount = event.target.closest('[data-post-open-comments]');
    if (commentCount) {
      await openComments(root, commentCount.dataset.postOpenComments);
      return;
    }
    const comments = event.target.closest('[data-post-comments]');
    if (comments) {
      await openComments(root, comments.dataset.postComments);
      return;
    }
    const menuToggle = event.target.closest('[data-post-menu-toggle]');
    if (menuToggle) {
      const card = menuToggle.closest('[data-post-card]');
      const menu = card && $(card, '[data-post-menu]');
      if (menu) {
        const willOpen = menu.hidden;
        root.querySelectorAll('[data-post-menu]').forEach(item => { item.hidden = true; });
        root.querySelectorAll('[data-post-menu-toggle]').forEach(item => item.setAttribute('aria-expanded', 'false'));
        menu.hidden = !willOpen;
        menuToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      }
      return;
    }
    const edit = event.target.closest('[data-post-edit]');
    if (edit) {
      const nextBody = prompt('Edit your post:', edit.dataset.postBody || '');
      if (nextBody === null) return;
      let media = [];
      try { media = JSON.parse(edit.dataset.postMedia || '[]'); } catch (_) {}
      edit.disabled = true;
      try {
        await api('/api/collector/posts', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:Number(edit.dataset.postEdit),body:nextBody,media})});
        await loadPosts(root,state);
      } catch (e) { alert(e.message); }
      finally { edit.disabled = false; }
      return;
    }
    const del = event.target.closest('[data-post-delete]');
    if (del) {
      if (!confirm('Delete this post? This cannot be undone.')) return;
      del.disabled=true;
      try { await api('/api/collector/posts?id='+encodeURIComponent(del.dataset.postDelete),{method:'DELETE'}); await loadPosts(root,state); }
      catch(e){alert(e.message);} finally {del.disabled=false;}
      return;
    }
    const report = event.target.closest('[data-post-report]');
    if (report) {
      const answer=prompt('Why are you reporting this post? Enter: spam, scam, harassment, inappropriate, misleading, or other.','other');
      if (answer===null)return;
      const reason=answer.trim().toLowerCase();
      if (!['spam','scam','harassment','inappropriate','misleading','other'].includes(reason)){alert('Choose spam, scam, harassment, inappropriate, misleading, or other.');return;}
      const details=prompt('Additional details (optional):','')||'';
      report.disabled=true;
      try { await api('/api/collector/post-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({post_id:Number(report.dataset.postReport),reason,details})});alert('Thanks. Your report has been recorded.');}
      catch(e){alert(e.message);} finally {report.disabled=false;}
    }
    const replyButton=event.target.closest('[data-comment-reply]');
    if(replyButton){
      const thread=replyButton.closest('[data-comments-thread]');
      const form=thread&&$(thread,'[data-comment-form]');
      if(form){
        if(form.dataset.supportsReplies!=='true'){const status=$(thread,'[data-comment-status]');status.textContent='Direct replies are not available until the production comment-replies migration is applied.';return;}
        setReplyTarget(form,replyButton.dataset.commentReply,replyButton.dataset.commentReplyAuthor);
        form.elements.body.focus();
      }
      return;
    }
    const cancelReply=event.target.closest('[data-comment-reply-cancel]');
    if(cancelReply){setReplyTarget(cancelReply.closest('[data-comment-form]'),null,'');return;}
    const removeComment=event.target.closest('[data-comment-delete]');
    if(removeComment){if(!confirm('Delete your comment?'))return;try{await api('/api/collector/post-comments?id='+encodeURIComponent(removeComment.dataset.commentDelete),{method:'DELETE'});const card=removeComment.closest('[data-post-card]');const id=card.dataset.postCard;await loadComments(root,id);const count=card.querySelector('[data-comment-count]');const n=Number((count.textContent.match(/\d+/)||['0'])[0]);const nextCount=Math.max(0,n-1);count.textContent=nextCount+(nextCount===1?' comment':' comments');}catch(e){alert(e.message);}}
  }
  async function handleCommentSubmit(event,root,state){
    const form=event.target.closest('[data-comment-form]');if(!form)return;
    event.preventDefault();const id=form.dataset.commentForm,body=form.elements.body.value.trim(),parentId=Number(form.elements.parent_comment_id.value||0)||null,status=form.closest('[data-comments-thread]').querySelector('[data-comment-status]'),button=form.querySelector('[type="submit"]');if(!body)return;
    button.disabled=true;status.textContent=parentId?'Sending reply…':'Sending comment…';
    try{
      await api('/api/collector/post-comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({post_id:Number(id),body,parent_comment_id:parentId})});
      form.reset();setReplyTarget(form,null,'');await loadComments(root,id);
      const card=form.closest('[data-post-card]'),count=card.querySelector('[data-comment-count]'),n=Number((count.textContent.match(/\d+/)||['0'])[0]);const nextCount=n+1;count.textContent=nextCount+(nextCount===1?' comment':' comments');status.textContent=parentId?'Reply added.':'Comment added.';
    }
    catch(e){status.textContent=e.message;if(e.message==='Please sign in to do that.')location.href='/account.html';}
    finally{button.disabled=false;}
  }
  window.addEventListener('collector-profile-loaded', event => initProfile(event.detail));
  if (window.collectorSocialProfile) initProfile(window.collectorSocialProfile);
  initCommunity();
})();