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
    style.textContent += '.social-compose-suggestion-anchor{position:relative;display:block;width:100%;min-width:0}.social-compose-suggestion-anchor>textarea{display:block;width:100%;box-sizing:border-box}.social-compose-suggestions{position:absolute;z-index:1000;left:0;right:0;top:calc(100% + 7px);display:grid;gap:3px;max-height:260px;overflow-y:auto;padding:6px;background:#101f38;border:1px solid #3b567c;border-radius:12px;box-shadow:0 16px 38px #0008;backdrop-filter:blur(16px)}.social-compose-suggestions[hidden]{display:none!important}.social-compose-suggestion{display:flex;align-items:center;width:100%;min-height:40px;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:#eef4ff;text-align:left;font:800 .9rem Nunito,system-ui,sans-serif;cursor:pointer}.social-compose-suggestion:hover,.social-compose-suggestion:focus-visible{outline:none;background:#203b60;color:#ffd21f}.social-compose-suggestion-anchor:has(.social-compose-suggestions:not([hidden])){z-index:50}';
    style.textContent += '.social-post-permalink{color:inherit;text-decoration:none}.social-post-permalink:hover,.social-post-permalink:focus-visible{text-decoration:underline;text-underline-offset:3px}.social-share-status{margin:6px 0 0;color:#607096;font-size:.78rem;min-height:1em}.social-single-post-view .social-composer,.social-single-post-view .community-filter{display:none!important}.social-post-body a{color:inherit;text-decoration:underline;text-decoration-color:#7da9e8;text-underline-offset:3px;overflow-wrap:anywhere}.social-post-body a:hover,.social-post-body a:focus-visible{text-decoration-color:currentColor}';
    style.textContent += '.social-share-count{color:#607096;font-size:.82rem}';
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
  function renderLinkedText(value) {
    const text = String(value ?? '');
    const pattern = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s<>"']*)?/gi;
    let html = '';
    let cursor = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const raw = match[0];
      const before = text[match.index - 1] || '';
      if (/[a-z0-9_@.-]/i.test(before)) continue;
      let candidate = raw;
      let trailing = '';
      while (/[.,!?;:]/.test(candidate.slice(-1))) {
        trailing = candidate.slice(-1) + trailing;
        candidate = candidate.slice(0, -1);
      }
      let trimmed = true;
      while (trimmed && candidate) {
        trimmed = false;
        const pairs = [[')', '('], [']', '['], ['}', '{']];
        for (const pair of pairs) {
          if (candidate.endsWith(pair[0]) && candidate.split(pair[0]).length > candidate.split(pair[1]).length) {
            candidate = candidate.slice(0, -1);
            trailing = pair[0] + trailing;
            trimmed = true;
            break;
          }
        }
      }
      html += safe(text.slice(cursor, match.index));
      const href = /^(?:https?:\/\/)/i.test(candidate) ? candidate : 'https://' + candidate;
      let validHref = '';
      try {
        const parsed = new URL(href);
        if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.includes('.') && !parsed.username && !parsed.password) validHref = parsed.href;
      } catch (_) {}
      if (validHref) html += '<a href="' + safe(validHref) + '" target="_blank" rel="noopener noreferrer nofollow">' + safe(candidate) + '</a>' + safe(trailing);
      else html += safe(raw);
      cursor = match.index + raw.length;
    }
    html += safe(text.slice(cursor));
    return html.replace(/\n/g, '<br>');
  }
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
    return '<article class="social-post' + (media.some(item => item.type === 'video') ? ' social-post--video' : '') + '" data-post-card="' + Number(post.id) + '">' +
      '<header class="social-post-header">' + avatar +
      '<div class="social-post-author"><a href="/collector.html?user=' + encodeURIComponent(post.username) + '">' + safe(post.display_name || post.username) + '</a><div><a href="/collector.html?user=' + encodeURIComponent(post.username) + '">@' + safe(post.username) + '</a><span> · <a class="social-post-permalink" href="/post/' + Number(post.id) + '" aria-label="Open this post directly">' + safe(dateText(post.created_at)) + '</a></span></div></div>' +
      '<div class="social-post-menu"><button type="button" class="social-post-menu-trigger" data-post-menu-toggle="' + Number(post.id) + '" aria-label="Post options" aria-expanded="false">···</button><div class="social-post-menu-items" data-post-menu="' + Number(post.id) + '" hidden>' + (!post.is_own ? '<button type="button" data-post-report="' + Number(post.id) + '">Report post</button>' : '<button type="button" data-post-edit="' + Number(post.id) + '" data-post-body="' + safe(post.body || '') + '" data-post-media="' + safe(JSON.stringify(media)) + '">Edit post</button><button type="button" data-post-delete="' + Number(post.id) + '" class="social-post-delete">Delete post</button>') + '</div></div></header>' +
      (post.body ? '<p class="social-post-body">' + renderLinkedText(post.body) + '</p>' : '') + mediaMarkup +
      '<div class="social-post-stats"><button type="button" class="social-stat-button" data-post-likers="' + Number(post.id) + '" data-like-count aria-label="See post reactions">' + Number(post.like_count || 0) + (Number(post.like_count || 0) === 1 ? ' reaction' : ' reactions') + '</button><button type="button" class="social-stat-button" data-post-open-comments="' + Number(post.id) + '" data-comment-count aria-label="See comments on this post">' + Number(post.comment_count || 0) + (Number(post.comment_count || 0) === 1 ? ' comment' : ' comments') + '</button><span class="social-share-count" data-share-count>' + Number(post.share_count || 0) + (Number(post.share_count || 0) === 1 ? ' share' : ' shares') + '</span><span class="social-view-count" data-view-count' + (post.is_own ? '' : ' hidden') + '>' + Number(post.view_count || 0) + (Number(post.view_count || 0) === 1 ? ' view' : ' views') + '</span></div>' +
      '<section class="social-likers-thread" data-likers-thread="' + Number(post.id) + '" hidden><p class="social-inline-status" data-likes-status role="status" aria-live="polite"></p><div class="social-likers-list" data-likes-list></div></section>' +
      '<div class="social-post-actions"><div class="social-reaction-picker" data-reaction-picker="' + Number(post.id) + '"><button type="button" class="social-reaction-trigger' + (post.my_reaction ? ' is-reacted' : '') + '" data-reaction-trigger="' + Number(post.id) + '" aria-label="Choose a reaction" aria-expanded="false">' + (post.my_reaction ? safe(({like:'👍',love:'❤️',haha:'😂',wow:'😮',sad:'😢',angry:'😡'})[post.my_reaction] || '👍') : '＋') + ' <span>' + (post.my_reaction ? 'Reacted' : 'React') + '</span></button><div class="social-reaction-options" data-reaction-options hidden>' + [{key:'like',emoji:'👍',label:'Like'},{key:'love',emoji:'❤️',label:'Love'},{key:'haha',emoji:'😂',label:'Haha'},{key:'wow',emoji:'😮',label:'Wow'},{key:'sad',emoji:'😢',label:'Sad'},{key:'angry',emoji:'😡',label:'Angry'}].map(x=>'<button type="button" data-reaction="' + x.key + '" data-post-id="' + Number(post.id) + '" aria-label="' + x.label + '" title="' + x.label + '">' + x.emoji + '</button>').join('') + '</div></div><button type="button" data-post-comments="' + Number(post.id) + '">Comment</button><button type="button" data-post-share="' + Number(post.id) + '" aria-label="Share this post">Share</button></div><p class="social-share-status" data-share-status role="status" aria-live="polite"></p>' +
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
      const pathPost = location.pathname.match(/^\/post\/([1-9][0-9]*)\/?$/);
      const requestedPost = new URLSearchParams(location.search).get('post') || (pathPost && pathPost[1]) || '';
      if (requestedPost && !/^[1-9][0-9]{0,15}$/.test(requestedPost)) {
        status.textContent = 'Invalid post link.';
        list.innerHTML = '<div class="social-empty-state"><strong>Invalid post link</strong><span>Check the link and try again.</span></div>';
        state.loaded = true;
        return;
      }
      root.classList.toggle('social-single-post-view', Boolean(requestedPost));
      let url;
      if (requestedPost && state.mode !== 'profile') url = '/api/collector/posts?post_id=' + encodeURIComponent(requestedPost);
      else if (state.mode === 'profile') url = '/api/collector/posts?username=' + encodeURIComponent(state.username);
      else url = '/api/collector/posts?feed=' + encodeURIComponent(state.feed || 'for-you');
      const d = await api(url);
      const posts = d.posts || [];
      if (posts.length) {
        list.innerHTML = posts.map(postCard).join('');
        status.textContent = posts.length + (posts.length === 1 ? ' post' : ' posts');
      } else if (requestedPost) {
        list.innerHTML = '<div class="social-empty-state"><strong>Post unavailable</strong><span>This post may have been deleted or is no longer public.</span></div>';
        status.textContent = 'Post unavailable';
      } else {
        list.innerHTML = '<div class="social-empty-state"><strong>No posts yet.</strong><span>' + (state.mode === 'profile' ? 'When this collector shares an update, it will appear here.' : 'Be the first to share something with the community.') + '</span></div>';
        status.textContent = '';
      }
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
    const suggestionAnchor = document.createElement('div');
    suggestionAnchor.className = 'social-compose-suggestion-anchor';
    bodyInput.parentNode.insertBefore(suggestionAnchor, bodyInput);
    suggestionAnchor.appendChild(bodyInput);
    const suggestionBox = document.createElement('div');
    suggestionBox.className = 'social-compose-suggestions';
    suggestionBox.hidden = true;
    suggestionAnchor.appendChild(suggestionBox);
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
          const members=(d.members||[]).map(m=>({label:'@'+m.username,insert:'@'+m.username}));
          show([...everyone,...members],start,cursor);
        }catch(_){if(requestId===suggestionRequest)show(everyone,start,cursor);}
      },150);
    });
    bodyInput.addEventListener('keydown',e=>{if(e.key==='Escape')closeSuggestions();});
  }
  function readVideoDuration(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      const cleanup = () => URL.revokeObjectURL(url);
      video.onloadedmetadata = () => { const duration = video.duration; cleanup(); resolve(duration); };
      video.onerror = () => { cleanup(); reject(new Error('Video metadata unavailable')); };
      video.src = url;
    });
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
      if (videoFile) {
        let duration = 0;
        try { duration = await readVideoDuration(videoFile); }
        catch (_) { status.textContent = 'This video could not be previewed. Try a standard MP4 or WebM clip.'; return; }
        if (!Number.isFinite(duration) || duration <= 0 || duration > 90) {
          status.textContent = 'Short-form videos must be 90 seconds or shorter.';
          return;
        }
      }
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
    const state = {mode:'feed',feed:'for-you'};
    try {
      const me = await fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(r=>r.json()).catch(()=>({}));
      const form = $(root, '[data-social-composer]');
      if (me && me.ok && me.authenticated && form) {
        form.hidden = false;
        await setupComposer(root,state);
      }
    } catch (_) {}
    const tabs = Array.from(root.querySelectorAll('[data-feed-tab]'));
    const postList = $(root, '[data-social-post-list]');
    const feedStatus = $(root, '[data-social-feed-status]');
    function syncFeedTab() {
      root.dataset.activeFeed = state.feed;
      root.classList.toggle('social-stories-mode', state.feed === 'stories');
      root.classList.toggle('social-video-feed', state.feed === 'video');
      tabs.forEach(tab => {
        const active = tab.dataset.feedTab === state.feed;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      if (postList) postList.hidden = state.feed === 'stories';
      if (feedStatus) {
        feedStatus.hidden = state.feed === 'stories';
        if (state.feed === 'stories') feedStatus.textContent = '';
      }
    }
    async function selectFeed(feed) {
      if (!['for-you','following','latest','trending','video','stories'].includes(feed)) return;
      if (feed === 'following') {
        try {
          const me = await fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(r=>r.json());
          if (!me || !me.authenticated) { location.href='/account.html'; return; }
        } catch (_) { location.href='/account.html'; return; }
      }
      state.feed = feed;
      syncFeedTab();
      if (feed !== 'stories') await loadPosts(root,state);
    }
    root.addEventListener('click', event => {
      const tab = event.target.closest('[data-feed-tab]');
      if (!tab || !root.contains(tab)) return;
      event.preventDefault();
      selectFeed(tab.dataset.feedTab);
    });
    root.addEventListener('click', event => handleClick(event,root,state));
    root.addEventListener('submit', event => handleCommentSubmit(event,root,state));
    syncFeedTab();
    await loadPosts(root,state);
  }
  async function copyToClipboard(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    field.style.pointerEvents = 'none';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error('Clipboard access is unavailable.');
  }
  function createShareEventId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      const r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  async function recordPostShare(postId, card) {
    try {
      const data = await api('/api/collector/post-share?id=' + encodeURIComponent(postId), {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({share_id:createShareEventId()})
      });
      const count = card && $(card, '[data-share-count]');
      if (count) {
        const total = Number(data.share_count || 0);
        count.textContent = total + (total === 1 ? ' share' : ' shares');
      }
      return true;
    } catch (_) {
      return false;
    }
  }
  async function handleClick(event, root, state) {
    const shareButton = event.target.closest('[data-post-share]');
    if (shareButton) {
      const id = Number(shareButton.dataset.postShare);
      if (!Number.isSafeInteger(id) || id < 1) return;
      const shareUrl = new URL('/post/' + id, location.origin).href;
      const card = shareButton.closest('[data-post-card]');
      const status = card && $(card, '[data-share-status]');
      shareButton.disabled = true;
      try {
        if (typeof navigator.share === 'function') {
          try {
            await navigator.share({title:'PokePrizePool post',text:'Check out this post on PokePrizePool.',url:shareUrl});
            const tracked = await recordPostShare(id, card);
            if (status) status.textContent = tracked ? 'Post shared. Share count updated.' : 'Post shared, but the share count could not refresh.';
            return;
          } catch (shareError) {
            if (shareError && shareError.name === 'AbortError') return;
          }
        }
        try {
          await copyToClipboard(shareUrl);
          const tracked = await recordPostShare(id, card);
          if (status) status.textContent = tracked ? 'Post link copied. Share count updated.' : 'Post link copied, but the share count could not refresh.';
        } catch (_) {
          window.prompt('Copy this post link:', shareUrl);
          if (status) status.textContent = 'The post link is shown above for copying.';
        }
      } finally {
        shareButton.disabled = false;
      }
      return;
    }
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