/* Shared collector social UI for profile posts and the Community Feed. */
(function () {
  'use strict';
  const $ = (root, selector) => root.querySelector(selector);
  const safe = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const labels = {status:'Status',pull:'Card pull',collection:'Collection update',trade:'Trade',question:'Question',event:'Event',restock:'Restock sighting'};
  const dateText = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], {month:'short',day:'numeric',year:d.getFullYear()===new Date().getFullYear()?undefined:'numeric',hour:'numeric',minute:'2-digit'}); };
  async function api(url, options) {
    const response = await fetch(url, Object.assign({credentials:'include',cache:'no-store'}, options || {}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const messages = {
        login_required:'Please sign in to do that.',
        collector_social_migration_required:'The Community Feed database setup has not been applied to the staging database yet.',
        post_content_required:'Write something or add a photo before posting.',
        post_too_long:'Posts can be up to 2,000 characters.',
        invalid_image_url:'Please choose a photo using the upload control.',
        already_reported:'You already reported this post.',
        follow_migration_required:'The staging follow setup is not applied yet.'
      };
      throw new Error(messages[data.error] || data.message || data.error || 'The request could not be completed.');
    }
    return data;
  }
  function postCard(post) {
    const avatar = post.avatar_url
      ? '<img class="social-avatar" src="' + safe(post.avatar_url) + '" alt="" loading="lazy">'
      : '<span class="social-avatar social-avatar-placeholder" aria-hidden="true">P</span>';
    const image = post.image_url ? '<img class="social-post-image" src="' + safe(post.image_url) + '" alt="Photo shared by ' + safe(post.display_name || post.username) + '" loading="lazy">' : '';
    return '<article class="social-post" data-post-card="' + Number(post.id) + '">' +
      '<header class="social-post-header">' + avatar +
      '<div class="social-post-author"><a href="/collector.html?user=' + encodeURIComponent(post.username) + '">' + safe(post.display_name || post.username) + '</a><div><a href="/collector.html?user=' + encodeURIComponent(post.username) + '">@' + safe(post.username) + '</a><span> · ' + safe(dateText(post.created_at)) + '</span></div></div>' +
      '<span class="social-post-type">' + safe(labels[post.post_type] || 'Status') + '</span></header>' +
      (post.body ? '<p class="social-post-body">' + safe(post.body).replace(/\n/g, '<br>') + '</p>' : '') + image +
      '<div class="social-post-stats"><span data-like-count>' + Number(post.like_count || 0) + ' likes</span><span data-comment-count>' + Number(post.comment_count || 0) + ' comments</span></div>' +
      '<div class="social-post-actions"><button type="button" data-post-like="' + Number(post.id) + '" data-liked="' + String(!!post.liked_by_me) + '" aria-pressed="' + String(!!post.liked_by_me) + '" class="' + (post.liked_by_me ? 'is-liked' : '') + '">♥ ' + (post.liked_by_me ? 'Liked' : 'Like') + '</button><button type="button" data-post-comments="' + Number(post.id) + '">Comment</button>' +
      (!post.is_own ? '<button type="button" data-post-report="' + Number(post.id) + '">Report</button>' : '<button type="button" data-post-delete="' + Number(post.id) + '" class="social-post-delete">Delete</button>') + '</div>' +
      '<section class="social-comments" data-comments-thread="' + Number(post.id) + '" hidden><div class="social-comment-list" data-comment-list></div>' +
      '<form class="social-comment-form" data-comment-form="' + Number(post.id) + '"><label class="sr-only" for="social-comment-' + Number(post.id) + '">Write a comment</label><textarea id="social-comment-' + Number(post.id) + '" name="body" maxlength="1000" required rows="2" placeholder="Add a comment…"></textarea><button type="submit">Reply</button></form><p class="social-inline-status" data-comment-status role="status" aria-live="polite"></p></section></article>';
  }
  function renderComments(root, postId, comments) {
    const thread = $(root, '[data-comments-thread="' + postId + '"]');
    if (!thread) return;
    const list = $(thread, '[data-comment-list]');
    list.innerHTML = comments.length ? comments.map(c =>
      '<article class="social-comment">' + (c.avatar_url ? '<img class="social-comment-avatar" src="' + safe(c.avatar_url) + '" alt="" loading="lazy">' : '<span class="social-comment-avatar">P</span>') +
      '<div class="social-comment-content"><div><a href="/collector.html?user=' + encodeURIComponent(c.username) + '">' + safe(c.display_name || c.username) + '</a><span> · ' + safe(dateText(c.created_at)) + '</span></div><p>' + safe(c.body).replace(/\n/g, '<br>') + '</p></div>' +
      (c.is_own ? '<button type="button" class="social-comment-remove" data-comment-delete="' + Number(c.id) + '" aria-label="Delete your comment">×</button>' : '') + '</article>'
    ).join('') : '<p class="social-empty-comments">No comments yet. Start the conversation.</p>';
  }
  async function loadComments(root, postId) {
    const thread = $(root, '[data-comments-thread="' + postId + '"]');
    if (!thread) return;
    const status = $(thread, '[data-comment-status]');
    status.textContent = 'Loading comments…';
    try {
      const d = await api('/api/collector/post-comments?post_id=' + encodeURIComponent(postId));
      renderComments(root, postId, d.comments || []);
      status.textContent = '';
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
      let url;
      if (state.mode === 'profile') url = '/api/collector/posts?username=' + encodeURIComponent(state.username);
      else url = '/api/collector/posts?feed=' + encodeURIComponent(state.feed || 'for-you');
      const d = await api(url);
      const posts = d.posts || [];
      list.innerHTML = posts.length ? posts.map(postCard).join('') : '<div class="social-empty-state"><strong>No posts yet.</strong><span>' + (state.mode === 'profile' ? 'When this collector shares an update, it will appear here.' : 'Be the first to share something with the community.') + '</span></div>';
      status.textContent = posts.length ? posts.length + (posts.length === 1 ? ' post' : ' posts') : '';
    } catch (e) {
      status.textContent = e.message;
      if (String(e.message).includes('database setup')) list.innerHTML = '<div class="social-empty-state"><strong>Community Feed setup needed</strong><span>Apply migrations/staging_collector_social_feed.sql to pokemon-vip-members-staging before testing this feature.</span></div>';
    }
    state.loaded = true;
  }
  async function setupComposer(root, state) {
    const form = $(root, '[data-social-composer]');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    const status = $(form, '[data-composer-status]');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const body = $(form, '[name="body"]').value.trim();
      const type = $(form, '[name="post_type"]').value;
      const file = $(form, '[name="image"]').files && $(form, '[name="image"]').files[0];
      const button = $(form, '[type="submit"]');
      if (!body && !file) { status.textContent = 'Write something or add a photo before posting.'; return; }
      if (body.length > 2000) { status.textContent = 'Posts can be up to 2,000 characters.'; return; }
      if (file && file.size > 5 * 1024 * 1024) { status.textContent = 'Choose an image smaller than 5 MB.'; return; }
      if (file && !['image/jpeg','image/png','image/webp','image/avif'].includes(file.type)) { status.textContent = 'Use a JPEG, PNG, WebP, or AVIF image.'; return; }
      button.disabled = true;
      let imageUrl = '';
      try {
        if (file) {
          status.textContent = 'Uploading photo…';
          const uploadResponse = await fetch('/api/collector/upload?kind=post', {method:'POST',credentials:'include',headers:{'Content-Type':file.type},body:file});
          const upload = await uploadResponse.json().catch(() => ({}));
          if (!uploadResponse.ok || !upload.ok) throw new Error(upload.error === 'image_storage_not_configured' ? 'Photo storage is not configured for this staging deployment.' : upload.error === 'login_required' ? 'Please sign in again.' : 'Photo upload failed.');
          imageUrl = upload.url;
        }
        status.textContent = 'Publishing post…';
        await api('/api/collector/posts', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body,post_type:type,image_url:imageUrl})});
        form.reset();
        status.textContent = 'Post published.';
        await loadPosts(root, state);
      } catch (e) { status.textContent = e.message || 'Could not publish post.'; }
      finally { button.disabled = false; }
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
    root.querySelectorAll('[data-feed-mode]').forEach(button => button.addEventListener('click', async () => {
      const feed = button.dataset.feedMode;
      if (feed === 'following') {
        try { const me=await fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(r=>r.json()); if(!me.authenticated){location.href='/account.html';return;} }
        catch (_) { location.href='/account.html'; return; }
      }
      state.feed=feed;
      root.querySelectorAll('[data-feed-mode]').forEach(b => { const selected=b===button; b.setAttribute('aria-pressed',String(selected));b.classList.toggle('is-active',selected); });
      await loadPosts(root,state);
    }));
    root.addEventListener('click', event => handleClick(event,root,state));
    root.addEventListener('submit', event => handleCommentSubmit(event,root,state));
    await loadPosts(root,state);
  }
  async function handleClick(event, root, state) {
    const like = event.target.closest('[data-post-like]');
    if (like) {
      const id=like.dataset.postLike, was=like.dataset.liked==='true'; like.disabled=true;
      try {
        const d=await api('/api/collector/post-like?id='+encodeURIComponent(id),{method:was?'DELETE':'POST'});
        like.dataset.liked=String(d.liked);like.setAttribute('aria-pressed',String(d.liked));like.classList.toggle('is-liked',d.liked);like.textContent=d.liked?'♥ Liked':'♥ Like';
        const card=like.closest('[data-post-card]'),count=card.querySelector('[data-like-count]');if(count)count.textContent=Number(d.like_count)+' likes';
      } catch(e) { if(e.message==='Please sign in to do that.')location.href='/account.html';else alert(e.message); }
      finally {like.disabled=false;}
      return;
    }
    const comments = event.target.closest('[data-post-comments]');
    if (comments) {
      const id=comments.dataset.postComments,thread=$(root,'[data-comments-thread="'+id+'"]');
      if(thread){thread.hidden=!thread.hidden;if(!thread.hidden&&thread.dataset.loaded!=='true')await loadComments(root,id);}
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
    const removeComment=event.target.closest('[data-comment-delete]');
    if(removeComment){if(!confirm('Delete your comment?'))return;try{await api('/api/collector/post-comments?id='+encodeURIComponent(removeComment.dataset.commentDelete),{method:'DELETE'});const card=removeComment.closest('[data-post-card]');const id=card.dataset.postCard;await loadComments(root,id);const count=card.querySelector('[data-comment-count]');const n=Number((count.textContent.match(/\d+/)||['0'])[0]);count.textContent=Math.max(0,n-1)+' comments';}catch(e){alert(e.message);}}
  }
  async function handleCommentSubmit(event,root,state){
    const form=event.target.closest('[data-comment-form]');if(!form)return;
    event.preventDefault();const id=form.dataset.commentForm,body=form.elements.body.value.trim(),status=form.parentElement.querySelector('[data-comment-status]'),button=form.querySelector('[type="submit"]');if(!body)return;
    button.disabled=true;status.textContent='Sending…';
    try{await api('/api/collector/post-comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({post_id:Number(id),body})});form.reset();await loadComments(root,id);const card=form.closest('[data-post-card]'),count=card.querySelector('[data-comment-count]'),n=Number((count.textContent.match(/\d+/)||['0'])[0]);count.textContent=(n+1)+' comments';status.textContent='Comment added.';}
    catch(e){status.textContent=e.message;if(e.message==='Please sign in to do that.')location.href='/account.html';}
    finally{button.disabled=false;}
  }
  window.addEventListener('collector-profile-loaded', event => initProfile(event.detail));
  if (window.collectorSocialProfile) initProfile(window.collectorSocialProfile);
  initCommunity();
})();