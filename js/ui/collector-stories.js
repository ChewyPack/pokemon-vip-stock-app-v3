(() => {
  const root = document.getElementById('community-feed');
  if (!root) return;

  const tray = root.querySelector('[data-story-tray]');
  const form = root.querySelector('[data-story-create-form]');
  const fileInput = form && form.querySelector('[data-story-file]');
  const captionInput = form && form.querySelector('[data-story-caption]');
  const preview = form && form.querySelector('[data-story-preview]');
  const status = form && form.querySelector('[data-story-status]');
  const storyStatus = root.querySelector('[data-story-feed-status]');
  if (!tray || !form || !fileInput) return;

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
  const IMAGE_TYPES = ['image/jpeg','image/png','image/webp','image/avif'];
  const VIDEO_TYPES = ['video/mp4','video/webm'];
  let stories = [];
  let groups = [];
  let authenticated = false;
  let previewUrl = '';
  let viewer = null;
  let activeGroupIndex = 0;
  let activeStoryIndex = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[char]);
  }
  function relativeTime(value) {
    const date = new Date(String(value || '').replace(' ', 'T') + (String(value || '').includes('Z') ? '' : 'Z'));
    if (!Number.isFinite(date.getTime())) return 'Recently';
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return 'Recently';
  }
  async function request(url, options) {
    const response = await fetch(url, Object.assign({credentials:'include',cache:'no-store'}, options || {}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const messages = {
        login_required:'Sign in to share a story.',
        collector_stories_migration_required:'Stories need their production database migration before they can be used.',
        story_caption_too_long:'Story captions can be up to 180 characters.',
        image_storage_not_configured:'Story media storage is not configured yet.',
        image_too_large:'Photos must be 5 MB or smaller.',
        video_too_large:'Videos must be 25 MB or smaller.',
        unsupported_media_type:'Choose a JPG, PNG, WebP, AVIF, MP4, or WebM file.',
        invalid_story_media_url:'Upload the story media again and retry.'
      };
      throw new Error(messages[data.error] || 'The story request could not be completed.');
    }
    return data;
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
  function groupsFromStories(list) {
    const map = new Map();
    list.forEach(story => {
      const key = String(story.account_id);
      if (!map.has(key)) map.set(key, {account_id:story.account_id,username:story.username,display_name:story.display_name,avatar_url:story.avatar_url,stories:[]});
      map.get(key).stories.push(story);
    });
    return Array.from(map.values()).map(group => {
      group.stories.sort((a,b) => new Date(String(a.created_at).replace(' ','T')+'Z') - new Date(String(b.created_at).replace(' ','T')+'Z'));
      return group;
    }).sort((a,b) => new Date(String(b.stories[b.stories.length-1].created_at).replace(' ','T')+'Z') - new Date(String(a.stories[a.stories.length-1].created_at).replace(' ','T')+'Z'));
  }
  function tileMarkup(group, own) {
    const latest = group.stories[group.stories.length - 1];
    const seen = !own && group.stories.every(story => story.viewed_by_me);
    const thumbnail = latest.media_type === 'image'
      ? '<img src="' + escapeHtml(latest.media_url) + '" alt="" loading="lazy">'
      : '<span class="story-tile-video" aria-hidden="true">▶</span>';
    return '<div class="story-card-wrap' + (own ? ' is-own' : '') + '">' +
      '<button type="button" class="story-card' + (seen ? ' is-seen' : '') + '" data-story-open="' + Number(group.account_id) + '" aria-label="View ' + escapeHtml(own ? 'your' : group.display_name) + ' stories">' +
      '<span class="story-card-ring">' + thumbnail + '</span><span class="story-card-label">' + escapeHtml(own ? 'Your story' : (group.display_name || group.username)) + '</span>' +
      '<span class="story-card-count">' + group.stories.length + '</span></button>' +
      (own ? '<button type="button" class="story-card-add" data-story-create aria-label="Add to your story">+</button>' : '') +
      '</div>';
  }
  function renderTray() {
    groups = groupsFromStories(stories);
    const own = groups.find(group => group.stories.some(story => story.is_own));
    const cards = [];
    if (own) cards.push(tileMarkup(own, true));
    else cards.push('<button type="button" class="story-card story-card--create" data-story-create><span class="story-card-create-icon">+</span><span class="story-card-label">Your story</span><span class="story-card-subtitle">Share an update</span></button>');
    groups.filter(group => !own || Number(group.account_id) !== Number(own.account_id)).forEach(group => cards.push(tileMarkup(group,false)));
    if (cards.length === 1 && !own) {
      // Keep the first tile available as the starting point for a new story.
    }
    tray.innerHTML = cards.join('') || '<p class="story-empty">No stories yet. Share the first collection update.</p>';
    if (storyStatus) storyStatus.textContent = stories.length ? stories.length + (stories.length === 1 ? ' active story' : ' active stories') : 'Be the first to share';
  }
  async function loadStories() {
    try {
      const data = await request('/api/collector/stories');
      stories = Array.isArray(data.stories) ? data.stories : [];
      renderTray();
    } catch (error) {
      if (storyStatus) storyStatus.textContent = error.message;
      tray.innerHTML = '<p class="story-empty">Stories could not be loaded.</p>';
    }
  }
  function openCreateForm() {
    if (!authenticated) { location.href = '/account.html'; return; }
    form.hidden = false;
    form.scrollIntoView({behavior:'smooth',block:'nearest'});
    fileInput.focus();
  }
  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    if (preview) preview.replaceChildren();
  }
  function renderPreview(file) {
    clearPreview();
    if (!file || !preview) return;
    previewUrl = URL.createObjectURL(file);
    let element;
    if (VIDEO_TYPES.includes(file.type)) {
      element = document.createElement('video');
      element.src = previewUrl;
      element.controls = true;
      element.muted = true;
      element.playsInline = true;
      element.preload = 'metadata';
    } else {
      element = document.createElement('img');
      element.src = previewUrl;
      element.alt = 'Story preview';
    }
    preview.appendChild(element);
  }
  async function uploadStoryMedia(file) {
    const response = await fetch('/api/collector/upload?kind=story', {
      method:'POST',credentials:'include',headers:{'Content-Type':file.type},body:file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const messages = {
        login_required:'Sign in again to share a story.',
        image_storage_not_configured:'Story media storage is not configured yet.',
        image_too_large:'Photos must be 5 MB or smaller.',
        video_too_large:'Videos must be 25 MB or smaller.',
        unsupported_media_type:'Choose a supported photo or MP4/WebM video.'
      };
      throw new Error(messages[data.error] || 'The story media could not be uploaded.');
    }
    return data.url;
  }
  function storyAt(groupIndex, storyIndex) {
    const group = groups[groupIndex];
    return group && group.stories[storyIndex];
  }
  function closeViewer() {
    if (!viewer) return;
    viewer.remove();
    viewer = null;
    document.removeEventListener('keydown', onViewerKeydown);
    loadStories();
  }
  function onViewerKeydown(event) {
    if (event.key === 'Escape') closeViewer();
    if (event.key === 'ArrowRight') moveStory(1);
    if (event.key === 'ArrowLeft') moveStory(-1);
  }
  async function markViewed(story) {
    if (!authenticated || story.is_own || story.viewed_by_me) return;
    story.viewed_by_me = true;
    request('/api/collector/stories', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:story.id})}).catch(() => {});
  }
  function viewerMarkup(group, story, storyIndex) {
    const isVideo = story.media_type === 'video';
    const media = isVideo
      ? '<video class="story-viewer-media" src="' + escapeHtml(story.media_url) + '" controls autoplay muted playsinline></video>'
      : '<img class="story-viewer-media" src="' + escapeHtml(story.media_url) + '" alt="Story shared by ' + escapeHtml(group.display_name || group.username) + '">';
    return '<div class="story-viewer-backdrop" data-story-backdrop>' +
      '<section class="story-viewer-panel" role="dialog" aria-modal="true" aria-label="Collector story">' +
      '<div class="story-viewer-progress"><span>' + (storyIndex + 1) + ' / ' + group.stories.length + '</span><button type="button" data-story-close aria-label="Close story">×</button></div>' +
      '<header class="story-viewer-header">' +
      (group.avatar_url ? '<img src="' + escapeHtml(group.avatar_url) + '" alt="" class="story-viewer-avatar">' : '<span class="story-viewer-avatar story-viewer-avatar--empty">P</span>') +
      '<div><strong>' + escapeHtml(group.display_name || group.username) + '</strong><span>@' + escapeHtml(group.username) + ' · ' + escapeHtml(relativeTime(story.created_at)) + '</span></div>' +
      (story.is_own ? '<button type="button" class="story-viewer-delete" data-story-delete="' + Number(story.id) + '">Delete</button>' : '') +
      '</header>' +
      '<div class="story-viewer-content" data-story-gesture>' + media + (story.caption ? '<p class="story-viewer-caption">' + escapeHtml(story.caption) + '</p>' : '') + '</div>' +
      '<div class="story-viewer-hint" aria-hidden="true">Tap sides or swipe to navigate · Stories disappear after 24 hours</div>' +
      '</section></div>';
  }
  function renderViewer() {
    if (!viewer) return;
    const group = groups[activeGroupIndex];
    const story = storyAt(activeGroupIndex, activeStoryIndex);
    if (!group || !story) { closeViewer(); return; }
    viewer.innerHTML = viewerMarkup(group,story,activeStoryIndex);
    const close = viewer.querySelector('[data-story-close]');
    if (close) close.addEventListener('click',closeViewer);
    const gestureArea = viewer.querySelector('[data-story-gesture]');
    if (gestureArea) {
      let pointerStart = null;
      gestureArea.addEventListener('pointerdown',event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        pointerStart = {x:event.clientX,y:event.clientY};
      });
      gestureArea.addEventListener('pointerup',event => {
        if (!pointerStart) return;
        const start = pointerStart;
        pointerStart = null;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          moveStory(dx < 0 ? 1 : -1);
          return;
        }
        if (event.target.closest('button,[data-story-close]')) return;
        if (event.target.closest('video') && event.clientY > gestureArea.getBoundingClientRect().bottom - 58) return;
        const bounds = gestureArea.getBoundingClientRect();
        moveStory(event.clientX < bounds.left + bounds.width / 2 ? -1 : 1);
      });
      gestureArea.addEventListener('pointercancel',() => { pointerStart = null; });
    }
    const del = viewer.querySelector('[data-story-delete]');
    if (del) del.addEventListener('click',async () => {
      del.disabled = true;
      try {
        await request('/api/collector/stories?id=' + encodeURIComponent(del.dataset.storyDelete),{method:'DELETE'});
        group.stories = group.stories.filter(item => Number(item.id) !== Number(del.dataset.storyDelete));
        stories = stories.filter(item => Number(item.id) !== Number(del.dataset.storyDelete));
        groups = groups.filter(item => item.stories.length);
        if (!groups.length) closeViewer();
        else {
          activeGroupIndex = Math.min(activeGroupIndex,groups.length-1);
          activeStoryIndex = Math.min(activeStoryIndex,groups[activeGroupIndex].stories.length-1);
          renderViewer();
        }
        renderTray();
      } catch (error) { del.disabled = false; window.alert(error.message); }
    });
    if (viewer.querySelector('[data-story-backdrop]')) {
      viewer.querySelector('[data-story-backdrop]').addEventListener('click',event => {
        if (event.target.matches('[data-story-backdrop]')) closeViewer();
      });
    }
    markViewed(story);
  }
  function openViewer(accountId) {
    const index = groups.findIndex(group => Number(group.account_id) === Number(accountId));
    if (index < 0) return;
    activeGroupIndex = index;
    activeStoryIndex = 0;
    if (!viewer) {
      viewer = document.createElement('div');
      viewer.className = 'story-viewer';
      document.body.appendChild(viewer);
      document.addEventListener('keydown',onViewerKeydown);
    }
    renderViewer();
  }
  function moveStory(direction) {
    if (!viewer) return;
    let nextGroup = activeGroupIndex;
    let nextStory = activeStoryIndex + direction;
    if (nextStory >= groups[nextGroup].stories.length) { nextGroup++; nextStory = 0; }
    if (nextStory < 0) { nextGroup--; nextStory = nextGroup >= 0 ? groups[nextGroup].stories.length - 1 : -1; }
    if (nextGroup < 0 || nextGroup >= groups.length || nextStory < 0) { closeViewer(); return; }
    activeGroupIndex = nextGroup;
    activeStoryIndex = nextStory;
    renderViewer();
  }

  tray.addEventListener('click',event => {
    const create = event.target.closest('[data-story-create]');
    if (create) { openCreateForm(); return; }
    const open = event.target.closest('[data-story-open]');
    if (open) openViewer(open.dataset.storyOpen);
  });
  const cancel = form.querySelector('[data-story-cancel]');
  if (cancel) cancel.addEventListener('click',() => {
    form.hidden = true;
    form.reset();
    clearPreview();
    if (status) status.textContent = '';
  });
  fileInput.addEventListener('change',() => renderPreview(fileInput.files && fileInput.files[0]));
  form.addEventListener('submit',async event => {
    event.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    const caption = String(captionInput && captionInput.value || '').trim();
    if (!file) { status.textContent = 'Choose a photo or short video first.'; return; }
    if (!IMAGE_TYPES.includes(file.type) && !VIDEO_TYPES.includes(file.type)) { status.textContent = 'Choose a JPG, PNG, WebP, AVIF, MP4, or WebM file.'; return; }
    if (IMAGE_TYPES.includes(file.type) && file.size > MAX_IMAGE_BYTES) { status.textContent = 'Photos must be 5 MB or smaller.'; return; }
    if (VIDEO_TYPES.includes(file.type) && file.size > MAX_VIDEO_BYTES) { status.textContent = 'Videos must be 25 MB or smaller.'; return; }
    if (caption.length > 180) { status.textContent = 'Story captions can be up to 180 characters.'; return; }
    if (VIDEO_TYPES.includes(file.type)) {
      try {
        const duration = await readVideoDuration(file);
        if (!Number.isFinite(duration) || duration <= 0 || duration > 90) { status.textContent = 'Story videos must be 90 seconds or shorter.'; return; }
      } catch (_) { status.textContent = 'This video could not be previewed. Try a standard MP4 or WebM clip.'; return; }
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      status.textContent = 'Uploading story media…';
      const mediaUrl = await uploadStoryMedia(file);
      status.textContent = 'Publishing story…';
      await request('/api/collector/stories',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({media_type:VIDEO_TYPES.includes(file.type)?'video':'image',media_url:mediaUrl,caption})});
      form.reset();
      form.hidden = true;
      clearPreview();
      status.textContent = 'Your story is live for 24 hours.';
      await loadStories();
    } catch (error) { status.textContent = error.message; }
    finally { submit.disabled = false; }
  });

  fetch('/api/account/me',{credentials:'include',cache:'no-store'}).then(response=>response.json()).then(data=>{authenticated=!!(data&&data.ok&&data.authenticated);}).catch(()=>{});
  loadStories();
})();