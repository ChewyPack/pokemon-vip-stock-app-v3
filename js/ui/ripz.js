(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    authenticated: false,
    canGoLive: false,
    streamingConfigured: false,
    liveStreams: [],
    pastStreams: [],
    myStream: null,
    studioOpen: false,
    selectedStream: null,
    media: null,
    cameraDeviceId: "",
    microphoneDeviceId: "",
    audioContext: null,
    audioMeterFrame: null,
    broadcaster: null,
    playback: null,
    playbackStreamId: "",
    isPublishing: false,
    isPaused: false,
    savedTrackState: null,
    hostBusy: false,
    recordingTimer: null,
    recordingBusy: false,
    chatTimer: null,
    listTimer: null,
    viewerTimer: null,
    giveawayEntries: [],
    giveawayConfig: { title: "Live Giveaway", prize: "", style: "wheel", eligibility: "everyone", enabled: false, winner: "" },
    giveawayStateTimer: null,
    giveawaySpinTimer: null,
    guestTimer: null,
    guestRequest: null,
    guestPublisher: null,
    guestPublishBusy: false,
    guestSubscriber: null,
    guestSubscribedStreamId: "",
    guestSubscribeBusy: false,
    guestMediaStream: null
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }
  function setStatus(id, message, isError) {
    var node = $(id);
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("ripz-status--error", !!isError);
  }
  async function api(method, body, query) {
    var url = "/api/ripz" + (query ? "?" + new URLSearchParams(query).toString() : "");
    var options = { method: method, credentials: "include", cache: "no-store", headers: {} };
    if (body !== undefined) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    var response = await fetch(url, options);
    var data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || !data.ok) {
      var message = data.message || ({
        login_required: "Please sign in to PokePrizePool to use Ripz.",
        collector_plus_required: "Hosting a live rip requires an active Collector+ membership.",
        streaming_not_configured: "Live video is not connected yet. Please contact PokePrizePool support.",
        unknown_action: "The live site has not finished updating the giveaway controls yet. Refresh Ripz and try again shortly.",
        not_live_stream_owner: "Giveaway viewer import is only available for your own live stream.",
        stream_provider_error: "The live video service could not start a stream. Please try again later.",
        stream_provider_unavailable: "The live video provider did not return the required browser streaming links.",
        stream_not_live: "That stream is no longer live.",
        realtime_not_configured: "RIPZ guest video is not configured yet. Please contact support.",
        guest_not_approved: "Wait for the host to approve your request before turning on your camera.",
        guest_session_not_authorized: "Your guest session is no longer authorized. Request to join again.",
        realtime_session_missing: "Cloudflare Realtime could not create a guest connection.",
        realtime_answer_missing: "Cloudflare Realtime did not return a valid guest connection answer.",
        realtime_offer_missing: "Cloudflare Realtime did not return a valid viewer connection offer."
      })[data.error] || "The Ripz request could not be completed.";
      var error = new Error(message);
      error.code = data.error || "request_failed";
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }


  function syncHostMediaControls() {
    var audio = state.media && state.media.getAudioTracks()[0];
    var video = state.media && state.media.getVideoTracks()[0];
    var mute = $("ripz-host-mute"), camera = $("ripz-host-camera"), pause = $("ripz-host-pause");
    if (mute) { mute.disabled = !audio || state.isPaused; mute.textContent = audio && !audio.enabled ? "Unmute mic" : "Mute mic"; mute.setAttribute("aria-pressed", String(!!(audio && !audio.enabled))); }
    if (camera) { camera.disabled = !video || state.isPaused; camera.textContent = video && !video.enabled ? "Turn camera on" : "Turn camera off"; camera.setAttribute("aria-pressed", String(!!(video && !video.enabled))); }
    if (pause) { pause.disabled = !audio || !video; pause.textContent = state.isPaused ? "Resume stream" : "Pause stream"; pause.setAttribute("aria-pressed", String(state.isPaused)); }
    var liveLabel = $("ripz-host-live-label");
    if (liveLabel) liveLabel.textContent = state.isPaused ? "STREAM PAUSED" : (state.isPublishing ? "YOU’RE LIVE" : "STREAM SETUP");
  }

  function toggleHostMute() {
    if (!state.media) return;
    var track = state.media.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    syncHostMediaControls();
  }

  function toggleHostCamera() {
    if (!state.media) return;
    var track = state.media.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    syncHostMediaControls();
  }

  function toggleHostPause() {
    if (!state.media) return;
    var tracks = state.media.getTracks();
    if (!state.isPaused) {
      state.savedTrackState = tracks.map(function(track){ return { id: track.id, enabled: track.enabled }; });
      tracks.forEach(function(track){ track.enabled = false; });
      state.isPaused = true;
    } else {
      tracks.forEach(function(track){
        var saved = (state.savedTrackState || []).find(function(item){ return item.id === track.id; });
        track.enabled = saved ? saved.enabled : true;
      });
      state.isPaused = false;
      state.savedTrackState = null;
    }
    syncHostMediaControls();
    var status = $("ripz-host-status");
    if (status) status.textContent = state.isPaused
      ? "Stream paused. Viewers remain connected, but your camera and microphone are temporarily disabled."
      : "Stream resumed. Your camera and microphone are back to their previous settings.";
  }

  function renderHostPanel() {
    syncGiveawayDock();
    syncHostMediaControls();
    var host = $("ripz-host-panel");
    if (!state.authenticated) {
      host.innerHTML = '<div class="ripz-host-card"><h3>Sign in to host</h3><p>Sign in to check your member access and launch a live rip.</p><a class="ripz-button" href="/account.html">Sign in</a></div>';
      return;
    }
    if (state.myStream && state.myStream.status === "ended") {
      var recordingStatus = String(state.myStream.recording_status || "");
      var downloadStatus = String(state.myStream.download_status || "");
      var downloadUrl = state.myStream.download_url || "";
      var terminalRecording = ["failed", "unavailable"].includes(recordingStatus) || ["failed", "unavailable"].includes(downloadStatus);
      var recordingText = downloadStatus === "ready" && downloadUrl
        ? "Your MP4 is ready to download."
        : (terminalRecording
          ? (state.myStream.recording_message || "A download is not available for this stream.")
          : (state.myStream.recording_message || "Your recording is being prepared. This can take about a minute after the stream ends."));
      host.innerHTML = '<div class="ripz-host-content">' +
        '<div class="ripz-host-card ripz-host-span"><div class="ripz-live-badge">Stream ended</div><h3 style="margin-top:10px">' + esc(state.myStream.title) + '</h3><p>' + esc(state.myStream.product_name || "") + '</p>' +
        '<p id="ripz-recording-status" class="ripz-host-status" role="status" aria-live="polite" style="margin-top:10px">' + esc(recordingText) + '</p></div>' +
        (downloadStatus === "ready" && downloadUrl
          ? '<div class="ripz-camera-actions ripz-host-span"><a class="ripz-button" href="' + esc(downloadUrl) + '" target="_blank" rel="noopener">Download MP4</a></div>'
          : (!terminalRecording
            ? '<div class="ripz-camera-actions ripz-host-span"><button id="ripz-recording-refresh" class="ripz-button ripz-button--secondary" type="button">Check recording status</button></div>'
            : '')) +
        (state.canGoLive && state.streamingConfigured
          ? '<div class="ripz-camera-actions ripz-host-span"><button id="ripz-new-rip" class="ripz-button" type="button">Start another rip</button></div>'
          : '') +
        '<p class="ripz-note ripz-host-span">Recordings are prepared after you end a stream. MP4 downloads are supported for live recordings under four hours.</p></div>';
      var recordingRefresh = $("ripz-recording-refresh");
      if (recordingRefresh) recordingRefresh.addEventListener("click", function () { loadRecordingStatus(state.myStream.id); });
      var newRip = $("ripz-new-rip");
      if (newRip) newRip.addEventListener("click", function () {
        if (state.recordingTimer) clearTimeout(state.recordingTimer);
        state.recordingTimer = null;
        state.myStream = null;
        renderHostPanel();
      });
      if (!terminalRecording && !(downloadStatus === "ready" && downloadUrl)) {
        scheduleRecordingPoll(state.myStream.id, recordingStatus ? 8000 : 1000);
      }
      return;
    }
    if (!state.canGoLive) {
      host.innerHTML = '<div class="ripz-host-content">' +
        '<div class="ripz-host-card"><h3>Collector+ exclusive</h3><p>Active Collector+ members can host live pack-opening sessions. You can watch and chat with other signed-in collectors here.</p></div>' +
        '<div class="ripz-host-card"><h3>Ready to host?</h3><p>Check your membership and unlock the ability to start your own rip.</p><p style="margin-top:12px"><a class="ripz-button" href="/account.html">View membership</a></p></div></div>';
      return;
    }
    if (!state.streamingConfigured) {
      host.innerHTML = '<div class="ripz-host-card"><h3>Streaming setup needed</h3><p>Your Collector+ membership is eligible, but live video has not been connected by the site administrator yet. You will be able to go live once the stream service is configured.</p></div>';
      return;
    }
    if (state.myStream && state.myStream.status !== "ended") {
      var statusText = state.isPublishing ? "Your camera is connected and you are live." :
        (state.myStream.status === "live" ? "This stream session is open. Preview your camera and microphone before reconnecting." : "Your stream room is ready. Preview your camera and microphone before going live.");
      host.innerHTML = '<div class="ripz-host-content">' +
        '<div class="ripz-host-card ripz-host-span"><div class="ripz-live-badge">Your session</div><h3 style="margin-top:10px">' + esc(state.myStream.title) + '</h3><p>' + esc(state.myStream.product_name) + '</p>' + (state.myStream.status === "live" ? '<p id="ripz-host-viewer-count" class="ripz-viewer-count" aria-live="polite">' + Number(state.myStream.viewer_count || 0) + ' watching</p>' : '') + '<p id="ripz-host-status" class="ripz-host-status" role="status" aria-live="polite" style="margin-top:10px">' + esc(statusText) + '</p></div>' +
        cameraSetupMarkup(true) +
        '<div id="ripz-guest-requests" class="ripz-guest-requests ripz-host-span"><h3>Guest requests</h3><p class="ripz-note">No requests yet.</p></div>' +
        '<div class="ripz-camera-actions ripz-host-span">' +
          '<button id="ripz-host-connect" class="ripz-button" type="button" ' + (state.isPublishing || !state.media ? "disabled" : "") + '>' + (state.myStream.status === "live" ? "Reconnect &amp; go live" : "Go live") + '</button>' +
          '<button id="ripz-host-stop" class="ripz-button ripz-button--danger" type="button">End stream</button>' +
        '</div><p class="ripz-note ripz-host-span">Preview first, then go live when your picture and microphone look right. Keep this page open while you rip.</p>' +
        '</div>';
      bindCameraControls(true);
      syncGiveawayDock();
      var connect = $("ripz-host-connect");
      if (connect) connect.addEventListener("click", function () { connectExistingStream(); });
      var stop = $("ripz-host-stop");
      if (stop) stop.addEventListener("click", function () { stopHostStream(false); });
      return;
    }
    host.innerHTML = '<form class="ripz-form" id="ripz-start-form">' +
      '<label for="ripz-title">Stream title<input id="ripz-title" name="title" maxlength="100" required minlength="3" placeholder="e.g. Chasing the SIR tonight"></label>' +
      '<label for="ripz-product">What are you ripping?<input id="ripz-product" name="product_name" maxlength="120" required minlength="2" placeholder="e.g. Mega Evolution booster packs"></label>' +
      '<label for="ripz-description">Stream description<textarea id="ripz-description" name="description" maxlength="1000" rows="3" placeholder="Tell viewers what you are opening or hunting for."></textarea></label>' +
      cameraSetupMarkup(false) +
      '<button id="ripz-start-button" class="ripz-button" type="submit" disabled>🎥 Go live</button>' +
      '<p id="ripz-host-status" class="ripz-host-status" role="status" aria-live="polite">Start your camera preview first. You can check your picture, microphone, and devices before going live.</p>' +
      '<p class="ripz-note">Your local preview is muted to prevent echo. A camera and microphone are required. Streams are recorded for replay; the MP4 download becomes available after processing.</p>' +
      '</form>';
    bindCameraControls(false);
    $("ripz-start-form").addEventListener("submit", function (event) {
      event.preventDefault();
      startNewStream($("ripz-title").value, $("ripz-product").value, $("ripz-description").value);
    });
  }

  function renderViewerGiveaway(data) {
    var overlay = $("ripz-viewer-giveaway-overlay");
    if (!overlay) return;
    var giveaway = data || state.giveawayConfig;
    if (!giveaway || !giveaway.enabled) { overlay.hidden = true; overlay.innerHTML = ""; return; }
    var entries = Array.isArray(giveaway.entries) ? giveaway.entries : state.giveawayEntries;
    var race = giveaway.style === "duck_race";
    overlay.hidden = false;
    overlay.innerHTML = '<h3>' + esc(giveaway.title || "Live Giveaway") + '</h3>' + (giveaway.prize ? '<p>Prize: <strong>' + esc(giveaway.prize) + '</strong></p>' : '') + '<p>' + (giveaway.eligibility === "collector_plus" ? "Collector+ members only" : giveaway.eligibility === "followers" ? "Follower giveaway" : "Everyone watching can enter") + '</p>' + (race ? '<div class="ripz-race-lanes">' + entries.slice(0, 8).map(function (name, index) { return '<span>' + ["🦆","🐤","🐥","🪿","🦆","🐤","🐥","🪿"][index] + " " + esc(name) + '</span>'; }).join("") + '</div>' : '<p>🎡 ' + entries.length + ' entries in the wheel</p>') + (giveaway.winner ? '<h3>🏆 Winner: ' + esc(giveaway.winner) + '</h3>' : '<p>Watch to see who wins!</p>');
  }

  function pollViewerGiveaway(streamId) {
    if (state.giveawayStateTimer) clearInterval(state.giveawayStateTimer);
    async function update() { try { var result = await api("POST", { action: "giveaway_state", stream_id: streamId }); renderViewerGiveaway(result.giveaway); } catch (_) {} }
    update(); state.giveawayStateTimer = window.setInterval(update, 3000);
  }

  function renderLiveList() {
    var grids = [$("ripz-live-grid"), $("ripz-landing-live-grid")].filter(Boolean);
    var empty = '<div class="ripz-empty" style="grid-column:1/-1"><strong>No one is live right now.</strong><br>When a Collector+ member starts ripping, their stream will show up here.</div>';
    grids.forEach(function (grid) {
      if (!state.liveStreams.length) { grid.innerHTML = empty; return; }
      grid.innerHTML = state.liveStreams.map(function (stream) {
        return '<article class="ripz-live-card">' +
          '<div class="ripz-live-card__top"><span class="ripz-live-badge"><span class="ripz-live-dot"></span> Live</span><span class="ripz-note">Ripz</span></div>' +
          '<h3>' + esc(stream.title) + '</h3><p>Hosted by <strong>@' + esc(stream.host) + '</strong></p>' +
          '<p>' + esc(stream.product_name || "Pack opening") + '</p>' +
          (stream.description ? '<p>' + esc(stream.description) + '</p>' : '') +
          '<p class="ripz-viewer-count">' + Number(stream.viewer_count || 0) + ' watching</p>' +
          '<button class="ripz-button ripz-button--secondary" type="button" data-ripz-watch="' + esc(stream.id) + '">Watch live</button></article>';
      }).join("");
      grid.querySelectorAll("[data-ripz-watch]").forEach(function (button) {
        button.addEventListener("click", function () {
          var stream = state.liveStreams.find(function (item) { return item.id === button.getAttribute("data-ripz-watch"); });
          if (stream) { openStudio(false); watchStream(stream); }
        });
      });
    });
    setStatus("ripz-live-status", state.liveStreams.length ? state.liveStreams.length + " live session" + (state.liveStreams.length === 1 ? "" : "s") + " available." : "No live rips at the moment.");
    setStatus("ripz-landing-live-status", state.liveStreams.length ? state.liveStreams.length + " live session" + (state.liveStreams.length === 1 ? "" : "s") + " available." : "No live streams right now. Check back soon or set up your own stream.");
    var pastGrid = $("ripz-past-grid");
    if (pastGrid) {
      if (!state.pastStreams.length) {
        pastGrid.innerHTML = '<div class="ripz-empty" style="grid-column:1/-1">No replays are available yet. Finished streams will appear here when their recordings are ready.</div>';
        setStatus("ripz-past-status", "No past streams available yet.");
      } else {
        setStatus("ripz-past-status", state.pastStreams.length + " replay" + (state.pastStreams.length === 1 ? "" : "s") + " available.");
        pastGrid.innerHTML = state.pastStreams.map(function (stream) {
          var ended = stream.ended_at ? new Date(String(stream.ended_at).replace(" ", "T") + "Z").toLocaleDateString() : "Past stream";
          return '<article class="ripz-live-card"><div class="ripz-live-card__top"><span class="ripz-pill">Replay</span><span class="ripz-note">' + esc(ended) + '</span></div><h3>' + esc(stream.title) + '</h3><p>Hosted by <strong>@' + esc(stream.host) + '</strong></p><p>' + esc(stream.product_name || "Pack opening") + '</p>' + (stream.description ? '<p>' + esc(stream.description) + '</p>' : '') + '<button class="ripz-button ripz-button--secondary" type="button" data-ripz-replay="' + esc(stream.id) + '">Watch replay</button></article>';
        }).join("");
        pastGrid.querySelectorAll("[data-ripz-replay]").forEach(function (button) {
          button.addEventListener("click", function () {
            var stream = state.pastStreams.find(function (item) { return item.id === button.getAttribute("data-ripz-replay"); });
            if (!stream) return;
            openStudio(false);
            $("ripz-live-panel").hidden = true;
            $("ripz-stage-title").textContent = stream.title;
            $("ripz-stage-subtitle").textContent = "Replay hosted by @" + stream.host + " · " + (stream.product_name || "Pack opening");
            $("ripz-stage-placeholder").hidden = true;
            $("ripz-watch-video").hidden = true;
            $("ripz-replay-frame").src = stream.replay_url;
            $("ripz-replay-frame").hidden = false;
            $("ripz-viewer-count").hidden = true;
            $("ripz-chat-caption").textContent = "Replay mode";
            $("ripz-chat-form").querySelector("input").disabled = true;
            $("ripz-chat-form").querySelector("button").disabled = true;
            $("ripz-chat-messages").innerHTML = '<p class="ripz-note">Chat replay is not available for this stream.</p>';
            setStatus("ripz-playback-status", "Playing past stream replay.");
          });
        });
      }
    }
  }

  function openStudio(setup) {
    state.studioOpen = true;
    $("ripz-landing").hidden = true;
    $("ripz-content").hidden = false;
    $("ripz-studio-heading").textContent = setup ? "Set up your stream" : "Now watching";
    $("ripz-live-panel").hidden = !!setup || !!(state.myStream && state.myStream.status !== "ended");
    if (setup) {
      $("ripz-stage-title").textContent = "Your stream preview";
      $("ripz-stage-subtitle").textContent = "Set your title and description, check your camera and microphone, then go live.";
      $("ripz-stage-placeholder").hidden = false;
      $("ripz-stage-placeholder").innerHTML = '<strong>Camera preview will appear here</strong><span>Start your camera preview in the setup panel.</span>';
      $("ripz-watch-video").hidden = true;
      $("ripz-replay-frame").hidden = true;
      $("ripz-replay-frame").src = "about:blank";
    }
  }

  function refreshData() {
    return api("GET").then(function (data) {
      state.authenticated = true;
      state.canGoLive = !!data.can_go_live;
      state.streamingConfigured = !!data.streaming_configured;
      state.liveStreams = data.live_streams || [];
      state.pastStreams = data.past_streams || [];
      state.myStream = data.my_stream || null;
      $("ripz-signed-out").hidden = true;
      $("ripz-content").hidden = !(state.studioOpen || (state.myStream && state.myStream.status === "live"));
      $("ripz-landing").hidden = !$("ripz-content").hidden;
      if (!state.hostBusy) renderHostPanel();
      renderLiveList();
      if (state.selectedStream && !state.liveStreams.some(function (item) { return item.id === state.selectedStream.id; })) {
        closePlayback();
        state.selectedStream = null;
        $("ripz-watch-video").hidden = true;
        $("ripz-stage-placeholder").hidden = false;
        var endedViewerCount = $("ripz-viewer-count");
        if (endedViewerCount) endedViewerCount.hidden = true;
        $("ripz-stage-title").textContent = "That rip has ended";
        $("ripz-stage-subtitle").textContent = "Choose another live session above.";
        $("ripz-chat-caption").textContent = "Select a stream to join the conversation.";
        $("ripz-chat-form").querySelector("input").disabled = true;
        $("ripz-chat-form").querySelector("button").disabled = true;
        $("ripz-chat-messages").innerHTML = '<p class="ripz-note">The host ended this stream.</p>';
      }
      return data;
    }).catch(function (error) {
      if (error.code === "login_required" || error.status === 401) {
        state.authenticated = false;
        $("ripz-signed-out").hidden = false;
        $("ripz-content").hidden = true;
        return null;
      }
      setStatus("ripz-live-status", error.message, true);
      $("ripz-live-grid").innerHTML = '<div class="ripz-empty" style="grid-column:1/-1">Ripz could not load right now. Refresh this page to try again.</div>';
      $("ripz-content").hidden = true;
      $("ripz-landing").hidden = false;
      return null;
    });
  }

  async function refreshLiveList() {
    try {
      var data = await api("GET");
      state.liveStreams = data.live_streams || [];
      state.pastStreams = data.past_streams || state.pastStreams;
      if (data.my_stream) state.myStream = data.my_stream;
      var hostViewerCount = $("ripz-host-viewer-count");
      if (hostViewerCount && state.myStream) hostViewerCount.textContent = Number(state.myStream.viewer_count || 0) + " watching";
      if (state.selectedStream) {
        var updatedSelected = state.liveStreams.find(function (item) { return item.id === state.selectedStream.id; });
        if (updatedSelected) state.selectedStream.viewer_count = Number(updatedSelected.viewer_count || 0);
      }
      renderLiveList();
      if (state.selectedStream && !state.liveStreams.some(function (item) { return item.id === state.selectedStream.id; })) {
        await closePlayback();
        state.selectedStream = null;
        $("ripz-watch-video").hidden = true;
        $("ripz-watch-video").srcObject = null;
    var joinPanel = $("ripz-guest-join-panel");
    if (joinPanel) joinPanel.hidden = !!(state.myStream && state.myStream.status === "live");
    state.guestRequest = null;
    if ($("ripz-guest-request-status")) $("ripz-guest-request-status").textContent = "";
    refreshGuestState(stream.id);
        $("ripz-stage-placeholder").hidden = false;
        var endedViewerCount = $("ripz-viewer-count");
        if (endedViewerCount) endedViewerCount.hidden = true;
        $("ripz-stage-placeholder").innerHTML = '<strong>That rip has ended</strong><span>Choose another live session above.</span>';
        $("ripz-stage-title").textContent = "That rip has ended";
        $("ripz-stage-subtitle").textContent = "Choose another live session above.";
        $("ripz-chat-caption").textContent = "Select a stream to join the conversation.";
        $("ripz-chat-form").querySelector("input").disabled = true;
        $("ripz-chat-form").querySelector("button").disabled = true;
        $("ripz-chat-messages").innerHTML = '<p class="ripz-note">The host ended this stream.</p>';
      }
    } catch (error) {
      setStatus("ripz-live-status", error.message || "Could not refresh the live list.", true);
    }
  }



  function syncGiveawayDock() {
    var dock = $("ripz-host-dock");
    var modal = $("ripz-giveaway-modal");
    var content = $("ripz-giveaway-modal-content");
    var isLiveHost = !!(state.authenticated && state.myStream && state.myStream.status === "live");
    var isHostStudio = !!(state.authenticated && state.studioOpen && state.canGoLive && (!state.myStream || state.myStream.status !== "ended"));
    if (dock) dock.hidden = !(isLiveHost || isHostStudio);
    if (modal && !(isLiveHost || isHostStudio)) modal.hidden = true;
    if (content && (isLiveHost || isHostStudio) && !content.querySelector("#ripz-giveaway-title")) {
      content.innerHTML = giveawayMarkup();
      bindGiveawayControls();
    }
  }

  function closeGiveawayModal() {
    var modal = $("ripz-giveaway-modal");
    if (modal) modal.hidden = true;
    var button = $("ripz-host-giveaway");
    if (button) button.setAttribute("aria-expanded", "false");
  }

  function openGiveawayModal() {
    var modal = $("ripz-giveaway-modal");
    var content = $("ripz-giveaway-modal-content");
    if (!modal || !content || (state.myStream && state.myStream.status === "ended")) return;
    content.innerHTML = giveawayMarkup();
    bindGiveawayControls();
    modal.hidden = false;
    var button = $("ripz-host-giveaway");
    if (button) button.setAttribute("aria-expanded", "true");
    var close = $("ripz-giveaway-close");
    if (close) close.focus();
  }

  function giveawayMarkup() {
    var entries = state.giveawayEntries;
    var segment = entries.length ? 100 / entries.length : 100;
    var colors = ["#f5c451", "#2b73d2", "#e85c72", "#43b58a", "#9167d9", "#f08a38", "#46b7c5"];
    var stops = [];
    entries.forEach(function (_, index) { stops.push(colors[index % colors.length] + " " + (index * segment) + "% " + ((index + 1) * segment) + "%"); });
    var wheelStyle = entries.length ? "background:conic-gradient(" + stops.join(",") + ");" : "background:conic-gradient(#263858 0% 100%);";
    return '<section class="ripz-giveaway ripz-host-span" aria-labelledby="ripz-giveaway-title">' +
      '<div class="ripz-giveaway__heading"><div><span class="ripz-kicker">HOST TOOL</span><h3 id="ripz-giveaway-title">Live giveaway wheel</h3></div><span class="ripz-pill">' + entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies') + '</span></div>' +
      '<p class="ripz-note">Configure before going live or while streaming. Turn on the giveaway to display it for viewers.</p>' +
      '<label>Giveaway title<input id="ripz-giveaway-title-input" maxlength="100" value="' + esc(state.giveawayConfig.title) + '" placeholder="Community giveaway"></label>' +
      '<label>Prize<input id="ripz-giveaway-prize" maxlength="160" value="' + esc(state.giveawayConfig.prize) + '" placeholder="e.g. Booster bundle"></label>' +
      '<div class="ripz-giveaway__controls"><label>Giveaway style<select id="ripz-giveaway-style"><option value="wheel" ' + (state.giveawayConfig.style === "wheel" ? "selected" : "") + '>Wheel of names</option><option value="duck_race" ' + (state.giveawayConfig.style === "duck_race" ? "selected" : "") + '>Duck race</option></select></label><label>Who can enter?<select id="ripz-giveaway-eligibility"><option value="everyone" ' + (state.giveawayConfig.eligibility === "everyone" ? "selected" : "") + '>Everyone watching</option><option value="collector_plus" ' + (state.giveawayConfig.eligibility === "collector_plus" ? "selected" : "") + '>Collector+ members only</option><option value="followers" ' + (state.giveawayConfig.eligibility === "followers" ? "selected" : "") + '>Followers (manual list)</option></select></label></div>' +
      '<div class="ripz-giveaway__controls"><button id="ripz-giveaway-add-viewers" class="ripz-button ripz-button--secondary" type="button" ' + (!state.myStream || state.myStream.status !== "live" ? "disabled" : "") + '>Add current viewers</button><div class="ripz-giveaway__manual"><input id="ripz-giveaway-name" maxlength="60" placeholder="Enter a username or name" aria-label="Giveaway participant name"><button id="ripz-giveaway-add-name" class="ripz-button ripz-button--secondary" type="button">Add name</button></div></div>' +
      '<div class="ripz-giveaway__actions"><button id="ripz-giveaway-save" class="ripz-button ripz-button--secondary" type="button">Save settings</button><button id="ripz-giveaway-toggle" class="ripz-button" type="button">' + (state.giveawayConfig.enabled ? "Hide from viewers" : "Show on stream") + '</button></div>' +
      '<p id="ripz-giveaway-status" class="ripz-status" role="status" aria-live="polite"></p>' +
      '<div class="ripz-giveaway__wheel-area"><div class="ripz-giveaway__pointer" aria-hidden="true"></div><div id="ripz-giveaway-wheel" class="ripz-giveaway__wheel" style="' + wheelStyle + ' transform:rotate(0deg)" aria-label="Giveaway winner wheel with ' + entries.length + ' entries" role="img"></div></div>' +
      '<div class="ripz-giveaway__actions"><button id="ripz-giveaway-spin" class="ripz-button" type="button" ' + (entries.length < 2 ? 'disabled' : '') + '>Spin for a winner</button><button id="ripz-giveaway-clear" class="ripz-button ripz-button--secondary" type="button" ' + (!entries.length ? 'disabled' : '') + '>Clear entries</button></div>' +
      '<div id="ripz-giveaway-winner" class="ripz-giveaway__winner" hidden aria-live="polite"></div>' +
      '<div class="ripz-giveaway__entry-list">' + (entries.length ? entries.map(function (entry, index) { return '<div class="ripz-giveaway__entry"><span>' + (index + 1) + '. ' + esc(entry) + '</span><button type="button" data-ripz-giveaway-remove="' + index + '" aria-label="Remove ' + esc(entry) + '">Remove</button></div>'; }).join("") : '<p class="ripz-note">No entries yet. Add viewers or enter names to get started.</p>') + '</div></section>';
  }

  function renderGiveaway() {
    var content = $("ripz-giveaway-modal-content");
    if (!content || !content.querySelector("#ripz-giveaway-title")) return;
    content.innerHTML = giveawayMarkup();
    bindGiveawayControls();
  }

  function addGiveawayEntry(value) {
    var name = String(value || "").trim().replace(/^@+/, "").slice(0, 60);
    if (!name || state.giveawayEntries.some(function (entry) { return entry.toLowerCase() === name.toLowerCase(); })) return false;
    state.giveawayEntries.push(name);
    return true;
  }

  function bindGiveawayControls() {
    var addName = $("ripz-giveaway-add-name"), nameInput = $("ripz-giveaway-name");
    var addViewers = $("ripz-giveaway-add-viewers"), spin = $("ripz-giveaway-spin"), clear = $("ripz-giveaway-clear");
    var save = $("ripz-giveaway-save"), toggle = $("ripz-giveaway-toggle");
    if (!addName || !nameInput || !addViewers || !spin || !clear) return;
    function readConfig(enabled) {
      state.giveawayConfig.title = ($("ripz-giveaway-title-input") || {}).value || "Live Giveaway";
      state.giveawayConfig.prize = ($("ripz-giveaway-prize") || {}).value || "";
      state.giveawayConfig.style = ($("ripz-giveaway-style") || {}).value || "wheel";
      state.giveawayConfig.eligibility = ($("ripz-giveaway-eligibility") || {}).value || "everyone";
      if (typeof enabled === "boolean") state.giveawayConfig.enabled = enabled;
      state.giveawayConfig.entries = state.giveawayEntries.slice();
    }
    async function saveConfig(enabled) {
      readConfig(enabled);
      if (!state.myStream || state.myStream.status === "ended") {
        renderViewerGiveaway();
        setStatus("ripz-giveaway-status", "Settings saved for your next stream. They will sync when you create the stream.");
        return;
      }
      try {
        await api("POST", { action: "giveaway_save", stream_id: state.myStream.id, title: state.giveawayConfig.title, prize: state.giveawayConfig.prize, style: state.giveawayConfig.style, eligibility: state.giveawayConfig.eligibility, entries: state.giveawayEntries, enabled: state.giveawayConfig.enabled, winner: state.giveawayConfig.winner || "" });
        renderViewerGiveaway();
        setStatus("ripz-giveaway-status", state.giveawayConfig.enabled ? "Saved and displayed on the stream." : "Giveaway settings saved.");
      } catch (error) { setStatus("ripz-giveaway-status", error.message || "Could not save giveaway settings.", true); }
    }
    if (save) save.addEventListener("click", function () { saveConfig(); });
    if (toggle) toggle.addEventListener("click", function () { saveConfig(!state.giveawayConfig.enabled); });
    addName.addEventListener("click", function () {
      if (!addGiveawayEntry(nameInput.value)) { setStatus("ripz-giveaway-status", nameInput.value.trim() ? "That name is already entered." : "Enter a name first.", true); return; }
      nameInput.value = "";
      renderGiveaway();
      readConfig(); saveConfig();
      setStatus("ripz-giveaway-status", "Entry added.");
    });
    nameInput.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); addName.click(); } });
    addViewers.addEventListener("click", async function () {
      addViewers.disabled = true;
      setStatus("ripz-giveaway-status", "Loading current viewers…");
      try {
        var result = await api("POST", { action: "giveaway_viewers", stream_id: state.myStream.id });
        var added = 0;
        (result.viewers || []).forEach(function (viewer) { if (addGiveawayEntry(viewer.username)) added++; });
        renderGiveaway();
        readConfig(); await saveConfig();
        setStatus("ripz-giveaway-status", added ? "Added " + added + " new viewer " + (added === 1 ? "entry." : "entries.") : "No new viewers to add. Only signed-in accounts watching through Ripz can be added.");
      } catch (error) { setStatus("ripz-giveaway-status", error.message || "Could not load current viewers.", true); }
      finally { var button = $("ripz-giveaway-add-viewers"); if (button) button.disabled = false; }
    });
    spin.addEventListener("click", function () {
      var wheel = $("ripz-giveaway-wheel"), winner = $("ripz-giveaway-winner");
      if (!wheel || state.giveawayEntries.length < 2) return;
      if (state.giveawaySpinTimer) clearTimeout(state.giveawaySpinTimer);
      var entries = state.giveawayEntries.slice(), winnerIndex = Math.floor(Math.random() * entries.length);
      var center = (winnerIndex + 0.5) * (360 / entries.length);
      var rotation = 360 * (5 + Math.floor(Math.random() * 3)) - center;
      spin.disabled = true; clear.disabled = true; addName.disabled = true; addViewers.disabled = true; nameInput.disabled = true;
      winner.hidden = true;
      wheel.style.transition = "transform 4.2s cubic-bezier(.12,.72,.12,1)";
      wheel.style.transform = "rotate(" + rotation + "deg)";
      setStatus("ripz-giveaway-status", "The wheel is spinning…");
      state.giveawaySpinTimer = window.setTimeout(function () {
        winner.textContent = "🎉 Winner: @" + entries[winnerIndex] + "!";
        winner.hidden = false;
        setStatus("ripz-giveaway-status", "Winner selected. Remove the winner or spin again for another round.");
        spin.disabled = state.giveawayEntries.length < 2; clear.disabled = !state.giveawayEntries.length;
        addName.disabled = false; addViewers.disabled = false; nameInput.disabled = false;
        state.giveawaySpinTimer = null;
      }, 4300);
    });
    clear.addEventListener("click", function () {
      if (state.giveawaySpinTimer) { clearTimeout(state.giveawaySpinTimer); state.giveawaySpinTimer = null; }
      state.giveawayEntries = [];
      renderGiveaway();
      setStatus("ripz-giveaway-status", "Entries cleared.");
    });
    document.querySelectorAll("[data-ripz-giveaway-remove]").forEach(function (button) {
      button.addEventListener("click", function () {
        var index = Number(button.getAttribute("data-ripz-giveaway-remove"));
        if (!Number.isInteger(index) || index < 0 || index >= state.giveawayEntries.length) return;
        state.giveawayEntries.splice(index, 1);
        renderGiveaway();
        setStatus("ripz-giveaway-status", "Entry removed.");
      });
    });
  }

  function cameraSetupMarkup(existingSession) {
    return '<div class="ripz-camera-setup ripz-host-span">' +
      '<video id="ripz-host-preview" class="ripz-host-video" autoplay muted playsinline></video>' +
      '<div class="ripz-device-grid">' +
        '<label for="ripz-camera-device">Camera<select id="ripz-camera-device" disabled><option value="">Allow camera access to list devices</option></select></label>' +
        '<label for="ripz-mic-device">Microphone<select id="ripz-mic-device" disabled><option value="">Allow microphone access to list devices</option></select></label>' +
      '</div>' +
      '<div class="ripz-mic-test"><strong>Microphone test</strong><span id="ripz-mic-caption">Start preview and speak to check your audio level.</span><div class="ripz-mic-meter" role="meter" aria-label="Microphone input level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="ripz-mic-level"></span></div></div>' +
      '<div class="ripz-camera-actions"><button id="ripz-preview-start" class="ripz-button ripz-button--secondary" type="button">' + (state.media ? "Refresh preview" : "Start camera preview") + '</button>' +
      (state.media ? '<button id="ripz-preview-stop" class="ripz-button ripz-button--secondary" type="button">Stop preview</button>' : '') +
      '</div><p class="ripz-note">Your camera and microphone are only used for your preview until you choose to go live.</p></div>';
  }

  function selectedDeviceValue(id, fallback) {
    var node = $(id);
    return node && node.value ? node.value : (fallback || "");
  }

  async function getCamera(cameraId, microphoneId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera access is unavailable in this browser. Open PokePrizePool over HTTPS in a recent browser.");
    }
    var video = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
    var audio = true;
    if (cameraId) video.deviceId = { exact: cameraId };
    else video.facingMode = { ideal: "environment" };
    if (microphoneId) audio = { deviceId: { exact: microphoneId } };
    return navigator.mediaDevices.getUserMedia({ video: video, audio: audio });
  }

  async function populateCameraDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    var devices = await navigator.mediaDevices.enumerateDevices();
    var cameraSelect = $("ripz-camera-device");
    var micSelect = $("ripz-mic-device");
    if (!cameraSelect || !micSelect) return;
    var currentVideo = state.media && state.media.getVideoTracks()[0];
    var currentAudio = state.media && state.media.getAudioTracks()[0];
    var cameraCurrent = state.cameraDeviceId || (currentVideo && currentVideo.getSettings().deviceId) || "";
    var micCurrent = state.microphoneDeviceId || (currentAudio && currentAudio.getSettings().deviceId) || "";
    function fill(select, list, current, label) {
      select.innerHTML = "";
      if (!list.length) {
        select.add(new Option("No " + label.toLowerCase() + " found", ""));
        select.disabled = true;
        return;
      }
      list.forEach(function (device, index) {
        select.add(new Option(device.label || (label + " " + (index + 1)), device.deviceId));
      });
      if (current && list.some(function (device) { return device.deviceId === current; })) select.value = current;
      else select.selectedIndex = 0;
      select.disabled = list.length < 2;
    }
    fill(cameraSelect, devices.filter(function (d) { return d.kind === "videoinput"; }), cameraCurrent, "Camera");
    fill(micSelect, devices.filter(function (d) { return d.kind === "audioinput"; }), micCurrent, "Microphone");
    state.cameraDeviceId = cameraSelect.value || "";
    state.microphoneDeviceId = micSelect.value || "";
  }

  function stopAudioMeter() {
    if (state.audioMeterFrame != null) cancelAnimationFrame(state.audioMeterFrame);
    state.audioMeterFrame = null;
    if (state.audioContext) {
      try { state.audioContext.close(); } catch (_) {}
      state.audioContext = null;
    }
    var level = $("ripz-mic-level");
    var meter = level && level.parentElement;
    if (level) level.style.width = "0%";
    if (meter) meter.setAttribute("aria-valuenow", "0");
  }

  function startAudioMeter(stream) {
    stopAudioMeter();
    var caption = $("ripz-mic-caption");
    if (!stream || !stream.getAudioTracks().length) {
      if (caption) caption.textContent = "No microphone audio track was detected.";
      return;
    }
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      if (caption) caption.textContent = "Microphone connected. Audio level testing is not supported in this browser.";
      return;
    }
    try {
      var context = new AudioContextClass();
      var analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      state.audioContext = context;
      var samples = new Uint8Array(analyser.frequencyBinCount);
      function update() {
        if (state.audioContext !== context) return;
        analyser.getByteTimeDomainData(samples);
        var sum = 0;
        for (var i = 0; i < samples.length; i++) {
          var normalized = (samples[i] - 128) / 128;
          sum += normalized * normalized;
        }
        var rms = Math.sqrt(sum / samples.length);
        var percent = Math.min(100, Math.round(rms * 300));
        var level = $("ripz-mic-level");
        var meter = level && level.parentElement;
        if (level) level.style.width = percent + "%";
        if (meter) meter.setAttribute("aria-valuenow", String(percent));
        if (caption) caption.textContent = percent > 5 ? "Microphone is picking up sound." : "Speak to test your microphone.";
        state.audioMeterFrame = requestAnimationFrame(update);
      }
      if (context.state === "suspended") context.resume().catch(function () {});
      update();
    } catch (_) {
      if (caption) caption.textContent = "Microphone connected, but the audio level test could not start.";
    }
  }

  async function startCameraPreview() {
    var button = $("ripz-preview-start");
    var statusNode = $("ripz-host-status");
    if (button) button.disabled = true;
    var goLiveButton = $("ripz-start-button") || $("ripz-host-connect");
    if (goLiveButton) goLiveButton.disabled = true;
    if (statusNode) statusNode.textContent = "Requesting camera and microphone access…";
    try {
      var cameraId = selectedDeviceValue("ripz-camera-device", state.cameraDeviceId);
      var micId = selectedDeviceValue("ripz-mic-device", state.microphoneDeviceId);
      var newMedia = await getCamera(cameraId, micId);
      var oldMedia = state.media;
      state.media = newMedia;
      state.isPaused = false;
      state.savedTrackState = null;
      state.cameraDeviceId = (newMedia.getVideoTracks()[0] && newMedia.getVideoTracks()[0].getSettings().deviceId) || cameraId;
      state.microphoneDeviceId = (newMedia.getAudioTracks()[0] && newMedia.getAudioTracks()[0].getSettings().deviceId) || micId;
      var preview = $("ripz-host-preview");
      if (preview) preview.srcObject = newMedia;
      var mainVideo = $("ripz-watch-video");
      if (mainVideo) { mainVideo.srcObject = newMedia; mainVideo.muted = true; mainVideo.hidden = false; }
      $("ripz-stage-placeholder").hidden = true;
      $("ripz-replay-frame").hidden = true;
      if (oldMedia && oldMedia !== newMedia) oldMedia.getTracks().forEach(function (track) { track.stop(); });
      await populateCameraDevices();
      startAudioMeter(newMedia);
      syncHostMediaControls();
      var goLive = $("ripz-start-button") || $("ripz-host-connect");
      if (goLive) goLive.disabled = false;
      if (statusNode) statusNode.textContent = "Preview is ready. Check your picture and microphone, then go live when you’re ready.";
      var previewButton = $("ripz-preview-start");
      if (previewButton) previewButton.textContent = "Refresh preview";
      if (!$("ripz-preview-stop")) {
        var actions = previewButton && previewButton.parentElement;
        if (actions) {
          var stopButton = document.createElement("button");
          stopButton.id = "ripz-preview-stop";
          stopButton.type = "button";
          stopButton.className = "ripz-button ripz-button--secondary";
          stopButton.textContent = "Stop preview";
          actions.appendChild(stopButton);
        }
      }
      var stopButtonExisting = $("ripz-preview-stop");
      if (stopButtonExisting) stopButtonExisting.addEventListener("click", stopCameraPreview);
    } catch (error) {
      if (statusNode) statusNode.textContent = error.message || "Could not start your camera preview.";
      if (goLiveButton) goLiveButton.disabled = !state.media;
      if (button) button.disabled = false;
      return;
    }
    if (goLiveButton) goLiveButton.disabled = false;
    if (button) button.disabled = false;
  }

  function stopCameraPreview() {
    if (state.isPublishing) return;
    if (state.media) state.media.getTracks().forEach(function (track) { track.stop(); });
    stopAudioMeter();
    state.media = null;
    state.isPaused = false;
    state.savedTrackState = null;
    syncHostMediaControls();
    var preview = $("ripz-host-preview");
    if (preview) preview.srcObject = null;
    var mainVideo = $("ripz-watch-video");
    if (mainVideo) { mainVideo.srcObject = null; mainVideo.hidden = true; }
    $("ripz-stage-placeholder").hidden = false;
    var goLive = $("ripz-start-button") || $("ripz-host-connect");
    if (goLive) goLive.disabled = true;
    var level = $("ripz-mic-caption");
    if (level) level.textContent = "Start preview and speak to check your audio level.";
    var start = $("ripz-preview-start");
    if (start) { start.disabled = false; start.textContent = "Start camera preview"; }
    var stop = $("ripz-preview-stop");
    if (stop) stop.remove();
    var statusNode = $("ripz-host-status");
    if (statusNode) statusNode.textContent = "Preview stopped. Start the camera preview again before going live.";
  }

  function bindCameraControls(existingSession) {
    var previewButton = $("ripz-preview-start");
    if (previewButton) previewButton.addEventListener("click", startCameraPreview);
    var stopButton = $("ripz-preview-stop");
    if (stopButton) stopButton.addEventListener("click", stopCameraPreview);
    var cameraSelect = $("ripz-camera-device");
    if (cameraSelect) cameraSelect.addEventListener("change", function () {
      state.cameraDeviceId = cameraSelect.value;
      if (state.media) startCameraPreview();
    });
    var micSelect = $("ripz-mic-device");
    if (micSelect) micSelect.addEventListener("change", function () {
      state.microphoneDeviceId = micSelect.value;
      if (state.media) startCameraPreview();
    });
    if (state.media) {
      var preview = $("ripz-host-preview");
      if (preview) preview.srcObject = state.media;
      populateCameraDevices().catch(function () {});
      startAudioMeter(state.media);
    }
  }

  async function negotiate(pc, endpoint, direction) {
    if (direction === "publish") {
      if (!state.media) throw new Error("Your camera has not started yet.");
      state.media.getTracks().forEach(function (track) {
        pc.addTransceiver(track, { direction: "sendonly", streams: [state.media] });
      });
    } else {
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    }
    var offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    var response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offer.sdp
    });
    if (!response.ok) throw new Error((direction === "publish" ? "Starting the broadcast" : "Connecting to this stream") + " failed (video service " + response.status + ").");
    var answer = await response.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    var locationHeader = response.headers.get("Location");
    return locationHeader ? new URL(locationHeader, endpoint).toString() : "";
  }

  async function beginPublish(stream) {
    if (state.broadcaster) return;
    var pc = new RTCPeerConnection();
    try {
      var sessionUrl = await negotiate(pc, stream.whip_url, "publish");
      state.broadcaster = { pc: pc, sessionUrl: sessionUrl };
      state.isPublishing = true;
      var statusNode = $("ripz-host-status");
      if (statusNode) statusNode.textContent = "Connecting to Ripz…";
      await api("POST", { action: "publish", stream_id: stream.id });
      state.myStream.status = "live";
      var hostConnect = $("ripz-host-connect");
      if (hostConnect) hostConnect.disabled = true;
      if (statusNode) statusNode.textContent = "You are live. Keep this page open while you rip.";
      refreshData();
    } catch (error) {
      pc.close();
      state.broadcaster = null;
      state.isPublishing = false;
      throw error;
    }
  }

  async function startNewStream(title, product, description) {
    var button = $("ripz-start-button");
    var statusNode = $("ripz-host-status");
    state.hostBusy = true;
    if (button) button.disabled = true;
    if (statusNode) statusNode.textContent = "Requesting camera and microphone access…";
    var streamCreatedHere = false;
    try {
      var titleValue = String(title || "").trim();
      var productValue = String(product || "").trim();
      var descriptionValue = String(description || "").trim();
      if (titleValue.length < 3 || productValue.length < 2) throw new Error("Enter a stream title and what you are ripping.");
      if (!state.media || !state.media.getVideoTracks().length || !state.media.getAudioTracks().length) throw new Error("Start your camera and microphone preview before going live.");
      if (statusNode) statusNode.textContent = "Preparing your live room…";
      var result = await api("POST", { action: "start", title: titleValue, product_name: productValue, description: descriptionValue });
      streamCreatedHere = !result.reused;
      state.myStream = result.stream;
      renderHostPanel();
      if (state.giveawayConfig.enabled || state.giveawayEntries.length || state.giveawayConfig.prize) {
        try { await api("POST", { action: "giveaway_save", stream_id: state.myStream.id, title: state.giveawayConfig.title, prize: state.giveawayConfig.prize, style: state.giveawayConfig.style, eligibility: state.giveawayConfig.eligibility, entries: state.giveawayEntries, enabled: state.giveawayConfig.enabled, winner: state.giveawayConfig.winner || "" }); } catch (giveawayError) { console.warn("Ripz giveaway settings sync failed:", giveawayError.message); }
      }
      var preview = $("ripz-host-preview");
      if (preview) preview.srcObject = state.media;
      setStatus("ripz-host-status", "Connecting your camera to the live room…");
      await beginPublish(state.myStream);
    } catch (error) {
      if (streamCreatedHere && state.myStream) {
        try { await api("POST", { action: "end", stream_id: state.myStream.id }); } catch (_) {}
        state.myStream = null;
        renderHostPanel();
      } else if (statusNode) {
        statusNode.textContent = error.message || "Could not start your live rip.";
      }
      if (error.code === "streaming_not_configured") state.streamingConfigured = false;
      var currentStatus = $("ripz-host-status");
      if (currentStatus && state.myStream) currentStatus.textContent = error.message || "Could not start your live rip.";
      if (error.message) console.warn("Ripz start failed:", error.message);
    } finally {
      state.hostBusy = false;
      var startButton = $("ripz-start-button");
      if (startButton) startButton.disabled = false;
    }
  }

  function scheduleRecordingPoll(streamId, delay) {
    if (state.recordingTimer) clearTimeout(state.recordingTimer);
    state.recordingTimer = null;
    if (!state.myStream || state.myStream.id !== streamId || state.myStream.status !== "ended") return;
    var terminal = ["failed", "unavailable"].includes(String(state.myStream.recording_status || "")) ||
      ["failed", "unavailable"].includes(String(state.myStream.download_status || "")) ||
      (state.myStream.download_status === "ready" && state.myStream.download_url);
    if (terminal) return;
    state.recordingTimer = window.setTimeout(function () {
      state.recordingTimer = null;
      loadRecordingStatus(streamId);
    }, delay);
  }

  async function loadRecordingStatus(streamId) {
    if (!state.myStream || state.myStream.id !== streamId || state.myStream.status !== "ended") return;
    if (state.recordingBusy) {
      setStatus("ripz-recording-status", "A recording check is already running. This page will update when it finishes.", false);
      return;
    }
    if (state.recordingTimer) clearTimeout(state.recordingTimer);
    state.recordingTimer = null;
    state.recordingBusy = true;
    var refreshButton = $("ripz-recording-refresh");
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "Checking…";
    }
    setStatus("ripz-recording-status", "Checking Cloudflare for your recording and MP4 download…", false);
    try {
      var result = await api("POST", { action: "recording", stream_id: streamId });
      if (state.myStream && state.myStream.id === streamId && state.myStream.status === "ended") {
        state.myStream.recording_status = result.recording_status || "processing";
        state.myStream.download_status = result.download_status || "pending";
        state.myStream.download_url = result.download_url || null;
        state.myStream.recording_message = result.message || "";
        renderHostPanel();
      }
    } catch (error) {
      if (state.myStream && state.myStream.id === streamId && state.myStream.status === "ended") {
        state.myStream.recording_message = error.message || "Could not check recording status.";
        renderHostPanel();
      }
    } finally {
      state.recordingBusy = false;
      var currentButton = $("ripz-recording-refresh");
      if (currentButton) {
        currentButton.disabled = false;
        currentButton.textContent = "Check recording status";
      }
    }
  }

  async function connectExistingStream() {
    if (!state.myStream || state.isPublishing) return;
    var button = $("ripz-host-connect");
    var statusNode = $("ripz-host-status");
    state.hostBusy = true;
    if (button) button.disabled = true;
    if (statusNode) statusNode.textContent = "Requesting camera and microphone access…";
    try {
      if (!state.media || !state.media.getVideoTracks().length || !state.media.getAudioTracks().length) throw new Error("Start your camera and microphone preview before reconnecting.");
      if (statusNode) statusNode.textContent = "Connecting to the live room…";
      await beginPublish(state.myStream);
    } catch (error) {
      var currentStatus = $("ripz-host-status");
      if (currentStatus) currentStatus.textContent = error.message || "Could not connect the camera.";
      if (button) button.disabled = false;
    } finally {
      state.hostBusy = false;
    }
  }

  async function stopHostStream(silent) {
    var stream = state.myStream;
    if (!stream) return;
    if (!silent) {
      state.hostBusy = true;
      var stopButton = $("ripz-host-stop");
      if (stopButton) stopButton.disabled = true;
      setStatus("ripz-host-status", "Ending your stream…");
    }
    if (state.broadcaster) {
      var active = state.broadcaster;
      state.broadcaster = null;
      try {
        if (active.sessionUrl) await fetch(active.sessionUrl, { method: "DELETE", keepalive: !!silent });
      } catch (_) {}
      try { active.pc.close(); } catch (_) {}
    }
    state.isPublishing = false;
    if (state.media) {
      state.media.getTracks().forEach(function (track) { track.stop(); });
      state.media = null;
    }
    state.isPaused = false;
    state.savedTrackState = null;
    syncHostMediaControls();
    stopAudioMeter();
    try {
      if (silent && navigator.sendBeacon) {
        navigator.sendBeacon("/api/ripz", new Blob([JSON.stringify({ action: "end", stream_id: stream.id })], { type: "application/json" }));
      } else {
        await api("POST", { action: "end", stream_id: stream.id });
      }
    } catch (error) {
      if (!silent) setStatus("ripz-host-status", "The camera stopped, but the site could not confirm the end of the stream. Please refresh and check your session.", true);
    }
    if (state.myStream && state.myStream.id === stream.id) {
      state.myStream.status = "ended";
      state.myStream.whip_url = "";
      state.myStream.playback_url = "";
    }
    if (!silent) {
      state.hostBusy = false;
      renderHostPanel();
      await refreshData();
      if (state.myStream && state.myStream.id === stream.id && state.myStream.status === "ended") {
        loadRecordingStatus(stream.id);
      }
    }
  }

  async function closePlayback() {
    var previousStreamId = state.playbackStreamId;
    if (state.viewerTimer) { clearInterval(state.viewerTimer); state.viewerTimer = null; }
    if (state.giveawayStateTimer) { clearInterval(state.giveawayStateTimer); state.giveawayStateTimer = null; }
    renderViewerGiveaway(null);
    if (previousStreamId) {
      state.playbackStreamId = "";
      api("POST", { action: "viewer_leave", stream_id: previousStreamId }).catch(function () {});
    }
    if (state.playback) {
      var active = state.playback;
      state.playback = null;
      try {
        if (active.sessionUrl) await fetch(active.sessionUrl, { method: "DELETE", keepalive: true });
      } catch (_) {}
      try { active.pc.close(); } catch (_) {}
    }
    state.playbackStreamId = "";
  }

  async function watchStream(stream) {
    $("ripz-live-panel").hidden = true;
    $("ripz-studio-heading").textContent = "Watching live";
    $("ripz-replay-frame").hidden = true;
    $("ripz-replay-frame").src = "about:blank";
    $("ripz-watch-video").muted = false;
    if (state.media && !state.isPublishing) stopCameraPreview();
    if (state.selectedStream && state.selectedStream.id === stream.id && state.playback) return;
    await closePlayback();
    state.selectedStream = stream;
    var guestJoinPanel = $("ripz-guest-join-panel");
    if (guestJoinPanel) guestJoinPanel.hidden = !!(state.myStream && state.myStream.status === "live" && state.myStream.id === stream.id);
    state.guestRequest = null;
    if ($("ripz-guest-request-status")) $("ripz-guest-request-status").textContent = "";
    $("ripz-stage-title").textContent = stream.title;
    $("ripz-stage-subtitle").textContent = "Hosted by @" + stream.host + " · " + (stream.product_name || "Pack opening");
    var viewerCountNode = $("ripz-viewer-count");
    if (viewerCountNode) { viewerCountNode.hidden = false; viewerCountNode.textContent = Number(stream.viewer_count || 0) + " watching"; }
    $("ripz-stage-placeholder").hidden = true;
    $("ripz-watch-video").hidden = false;
    $("ripz-watch-video").srcObject = null;
    $("ripz-chat-caption").textContent = "Chatting in: " + stream.title;
    $("ripz-chat-form").querySelector("input").disabled = false;
    $("ripz-chat-form").querySelector("button").disabled = false;
    $("ripz-chat-messages").innerHTML = '<p class="ripz-note">Loading chat…</p>';
    pollViewerGiveaway(stream.id);
    setStatus("ripz-playback-status", "Connecting to the live rip…");
    try {
      var pc = new RTCPeerConnection();
      var remoteStream = new MediaStream();
      $("ripz-watch-video").srcObject = remoteStream;
      pc.ontrack = function (event) {
        if (!remoteStream.getTracks().some(function (track) { return track.id === event.track.id; })) remoteStream.addTrack(event.track);
        $("ripz-watch-video").play().catch(function () {});
      };
      var sessionUrl = await negotiate(pc, stream.playback_url, "watch");
      state.playback = { pc: pc, sessionUrl: sessionUrl };
      state.playbackStreamId = stream.id;
      await sendViewerHeartbeat(stream.id);
      if (state.viewerTimer) clearInterval(state.viewerTimer);
      state.viewerTimer = window.setInterval(function () { sendViewerHeartbeat(stream.id); }, 15000);
      setStatus("ripz-playback-status", "You’re watching @" + stream.host + " live.");
      var caption = $("ripz-chat-caption");
      if (caption) caption.textContent = "Chatting in: " + stream.title;
      loadChat(stream.id);
      refreshGuestState(stream.id);
    } catch (error) {
      setStatus("ripz-playback-status", error.message || "Could not connect to this stream.", true);
      $("ripz-watch-video").hidden = true;
      $("ripz-stage-placeholder").hidden = false;
      $("ripz-stage-placeholder").innerHTML = '<strong>Stream unavailable</strong><span>The host may have ended their session. Try refreshing the live list.</span>';
      await closePlayback();
    }
  }



  function waitForGuestIce(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise(function(resolve) {
      var done = false;
      var finish = function() {
        if (done) return;
        done = true;
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      var check = function() { if (pc.iceGatheringState === "complete") finish(); };
      pc.addEventListener("icegatheringstatechange", check);
      window.setTimeout(finish, 7000);
    });
  }

  function currentGuestStreamId() {
    if (state.myStream && state.myStream.status === "live") return state.myStream.id;
    return state.selectedStream && state.selectedStream.id ? state.selectedStream.id : "";
  }

  function clearGuestSubscriber() {
    if (state.guestSubscriber && state.guestSubscriber.pc) {
      try { state.guestSubscriber.pc.close(); } catch (_) {}
    }
    state.guestSubscriber = null;
    state.guestSubscribedStreamId = "";
    var grid = $("ripz-guest-video-grid");
    if (grid) { grid.innerHTML = ""; grid.hidden = true; }
    var videoLayout = $("ripz-live-video-layout");
    if (videoLayout) videoLayout.classList.remove("ripz-live-video-layout--split");
  }

  async function ensureGuestSubscription(streamId) {
    if (!streamId || state.guestSubscribeBusy) return;
    if (state.guestSubscriber && state.guestSubscribedStreamId === streamId) return;
    state.guestSubscribeBusy = true;
    try {
      var list = await api("POST", { action: "guest_sfu_list", stream_id: streamId });
      var publishers = (list.publishers || []).slice(0, 1);
      if (!publishers.length) {
        if (state.guestSubscriber) clearGuestSubscriber();
        return;
      }
      clearGuestSubscriber();
      var created = await api("POST", { action: "guest_sfu_subscriber_create", stream_id: streamId });
      if (!created.session_id || !created.publishers || !created.publishers.length) return;
      var pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
      var remote = new MediaStream();
      var grid = $("ripz-guest-video-grid");
      if (!grid) { pc.close(); return; }
      grid.innerHTML = '<div class="ripz-guest-video-card"><video id="ripz-guest-remote-video" autoplay playsinline></video><span>Guest on camera</span></div>';
      grid.hidden = false;
      var videoLayout = $("ripz-live-video-layout");
      if (videoLayout) videoLayout.classList.add("ripz-live-video-layout--split");
      var remoteVideo = $("ripz-guest-remote-video");
      remoteVideo.srcObject = remote;
      pc.addEventListener("track", function(event) {
        if (!remote.getTracks().some(function(track) { return track.id === event.track.id; })) remote.addTrack(event.track);
        remoteVideo.play().catch(function(){});
      });
      var sub = { pc: pc, streamId: streamId, sessionId: created.session_id };
      state.guestSubscriber = sub;
      state.guestSubscribedStreamId = streamId;
      var negotiated = await api("POST", {
        action: "guest_sfu_subscribe",
        stream_id: streamId,
        session_id: created.session_id,
        publishers: created.publishers
      });
      if (!negotiated.session_description) { clearGuestSubscriber(); return; }
      await pc.setRemoteDescription(negotiated.session_description);
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForGuestIce(pc);
      await api("POST", {
        action: "guest_sfu_subscriber_answer",
        stream_id: streamId,
        session_id: created.session_id,
        session_description: pc.localDescription
      });
      if (pc.connectionState === "failed") throw new Error("Guest media connection failed.");
      remoteVideo.play().catch(function(){});
    } catch (error) {
      clearGuestSubscriber();
      if ($("ripz-playback-status") && state.selectedStream && state.selectedStream.id === streamId) {
        setStatus("ripz-playback-status", "Guest video is connecting. If it does not appear, refresh the stream.", false);
      }
    } finally {
      state.guestSubscribeBusy = false;
    }
  }

  async function startGuestCamera() {
    if (!state.selectedStream || !state.guestRequest || state.guestRequest.status !== "approved" || state.guestPublishBusy || state.guestPublisher) return;
    state.guestPublishBusy = true;
    var startButton = $("ripz-guest-start-camera");
    var statusNode = $("ripz-guest-request-status");
    if (statusNode) {
      statusNode.textContent = "";
      statusNode.classList.remove("ripz-status--error");
    }
    if (startButton) startButton.disabled = true;
    try {
      var media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      state.guestMediaStream = media;
      var preview = $("ripz-guest-local-preview");
      if (preview) { preview.srcObject = media; preview.hidden = false; }
      var session = await api("POST", { action: "guest_sfu_create", stream_id: state.selectedStream.id });
      var pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] });
      media.getTracks().forEach(function(track) { pc.addTransceiver(track, { direction: "sendonly" }); });
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForGuestIce(pc);
      var tracks = pc.getTransceivers().map(function(transceiver) {
        return { mid: transceiver.mid, kind: transceiver.sender.track ? transceiver.sender.track.kind : "" };
      }).filter(function(track) { return track.mid && (track.kind === "audio" || track.kind === "video"); });
      var result = await api("POST", {
        action: "guest_sfu_publish",
        stream_id: state.selectedStream.id,
        session_id: session.session_id,
        session_description: pc.localDescription,
        tracks: tracks
      });
      await pc.setRemoteDescription(result.session_description);
      state.guestPublisher = { pc: pc, streamId: state.selectedStream.id, sessionId: session.session_id };
      if (startButton) startButton.hidden = true;
      var stopButton = $("ripz-guest-stop-camera");
      if (stopButton) stopButton.hidden = false;
      var localPreview = $("ripz-guest-local-preview");
      if (localPreview) { localPreview.pause(); localPreview.srcObject = null; localPreview.hidden = true; }
      setStatus("ripz-guest-request-status", "Your camera and microphone are connected to the live rip.", false);
      await refreshGuestState(state.selectedStream.id);
    } catch (error) {
      if (state.guestMediaStream) state.guestMediaStream.getTracks().forEach(function(track){ track.stop(); });
      state.guestMediaStream = null;
      var preview = $("ripz-guest-local-preview");
      if (preview) { preview.srcObject = null; preview.hidden = true; }
      setStatus("ripz-guest-request-status", error.message || "Could not connect your camera. Check browser permissions and try again.", true);
    } finally {
      state.guestPublishBusy = false;
      if (startButton && state.guestRequest && state.guestRequest.status === "approved" && !state.guestPublisher) startButton.disabled = false;
    }
  }

  function stopGuestCamera() {
    if (state.guestPublisher && state.guestPublisher.pc) {
      try { state.guestPublisher.pc.close(); } catch (_) {}
    }
    state.guestPublisher = null;
    if (state.guestMediaStream) state.guestMediaStream.getTracks().forEach(function(track){ track.stop(); });
    state.guestMediaStream = null;
    var preview = $("ripz-guest-local-preview");
    if (preview) { preview.srcObject = null; preview.hidden = true; }
    var stop = $("ripz-guest-stop-camera"), start = $("ripz-guest-start-camera");
    if (stop) stop.hidden = true;
    if (start) { start.hidden = false; start.disabled = false; }
    if (state.selectedStream) api("POST", { action: "guest_cancel", stream_id: state.selectedStream.id }).catch(function(){});
  }

  async function refreshGuestState(streamId) {
    if (!streamId) return;
    try {
      var result = await api("POST", { action: "guest_state", stream_id: streamId });
      var hostOwns = !!(state.myStream && state.myStream.id === streamId);
      var requestBox = $("ripz-guest-requests");
      if (hostOwns && requestBox) {
        var requests = result.requests || [];
        requestBox.innerHTML = '<h3>Guest requests</h3>' + (requests.length ? requests.map(function (item) {
          return '<div class="ripz-guest-request-row"><div><strong>@' + esc(item.username) + '</strong><p class="ripz-note">' + (item.status === "pending" ? "Waiting for your decision" : "Approved — guest can join when ready") + '</p></div>' +
            (item.status === "pending" ? '<div class="ripz-guest-request-actions"><button class="ripz-button" type="button" data-ripz-guest-approve="' + esc(item.id) + '">Approve</button><button class="ripz-button ripz-button--danger" type="button" data-ripz-guest-decline="' + esc(item.id) + '">Decline</button></div>' : '<span class="ripz-pill">Approved</span>') + '</div>';
        }).join("") : '<p class="ripz-note">No requests yet. Viewers can request to join while you are live.</p>');
      } else if (state.selectedStream && state.selectedStream.id === streamId) {
        state.guestRequest = result.own_request || null;
        var status = $("ripz-guest-request-status");
        var button = $("ripz-guest-request-button");
        if (status && !status.classList.contains("ripz-status--error")) status.textContent = !state.guestRequest ? "You have not requested to join." :
          state.guestRequest.status === "pending" ? "Request sent. Waiting for the host to respond." :
          state.guestRequest.status === "approved" ? "The host approved your request. Start your camera when you are ready." :
          state.guestRequest.status === "declined" ? "The host declined this request." : "Your request was cancelled.";
        if (button) {
          button.disabled = !!(state.guestRequest && ["pending", "approved"].includes(state.guestRequest.status));
          button.textContent = state.guestRequest && state.guestRequest.status === "approved" ? "Request approved" :
            state.guestRequest && state.guestRequest.status === "pending" ? "Request pending" : "Request to join";
        }
        var startCamera = $("ripz-guest-start-camera");
        if (startCamera) startCamera.hidden = !(state.guestRequest && state.guestRequest.status === "approved") || !!state.guestPublisher;
        var stopCamera = $("ripz-guest-stop-camera");
        if (stopCamera) stopCamera.hidden = !state.guestPublisher;
        if (state.guestRequest && state.guestRequest.status === "approved") ensureGuestSubscription(streamId);
      }
    } catch (_) {}
  }

  async function submitGuestRequest() {
    if (!state.selectedStream) return;
    var button = $("ripz-guest-request-button");
    if (button) button.disabled = true;
    try {
      var result = await api("POST", { action: "guest_request", stream_id: state.selectedStream.id });
      state.guestRequest = result.request || null;
      await refreshGuestState(state.selectedStream.id);
    } catch (error) {
      setStatus("ripz-guest-request-status", error.message || "Could not send your request.", true);
    } finally {
      if (button && !(state.guestRequest && ["pending", "approved"].includes(state.guestRequest.status))) button.disabled = false;
    }
  }

  async function decideGuestRequest(requestId, decision) {
    var stream = state.myStream && state.myStream.status === "live" ? state.myStream : state.selectedStream;
    if (!stream) return;
    try {
      await api("POST", { action: "guest_decide", request_id: requestId, decision: decision });
      await refreshGuestState(stream.id);
    } catch (error) {
      setStatus("ripz-host-status", error.message || "Could not update guest request.", true);
    }
  }

  async function sendViewerHeartbeat(streamId) {
    if (!streamId || !state.selectedStream || state.selectedStream.id !== streamId || !state.playback) return;
    try {
      var result = await api("POST", { action: "viewer_heartbeat", stream_id: streamId });
      if (state.selectedStream && state.selectedStream.id === streamId) {
        state.selectedStream.viewer_count = Number(result.viewer_count || 0);
        var node = $("ripz-viewer-count");
        if (node) node.textContent = state.selectedStream.viewer_count + " watching";
      }
    } catch (_) {}
  }

  async function loadChat(streamId) {
    if (!streamId || !state.selectedStream || state.selectedStream.id !== streamId) return;
    try {
      var data = await api("GET", undefined, { stream_id: streamId });
      if (!state.selectedStream || state.selectedStream.id !== streamId) return;
      if (typeof data.viewer_count === "number") {
        state.selectedStream.viewer_count = data.viewer_count;
        var viewerNode = $("ripz-viewer-count");
        if (viewerNode) viewerNode.textContent = data.viewer_count + " watching";
      }
      var messages = data.messages || [];
      var list = $("ripz-chat-messages");
      var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
      if (!messages.length) {
        list.innerHTML = '<p class="ripz-note">No messages yet. Say hello and talk pulls.</p>';
      } else {
        list.innerHTML = messages.map(function (message) {
          var date = new Date(String(message.created_at || "").replace(" ", "T") + "Z");
          var time = isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          return '<div class="ripz-chat-message"><strong>@' + esc(message.username) + (time ? ' · ' + esc(time) : '') + '</strong><span>' + esc(message.message) + '</span></div>';
        }).join("");
      }
      if (nearBottom) list.scrollTop = list.scrollHeight;
    } catch (error) {
      if (error.code === "stream_not_found" || error.code === "stream_not_live") {
        setStatus("ripz-playback-status", "This stream has ended.", true);
      }
    }
  }

  document.addEventListener("click", function (event) {
    var target = event.target.closest("button");
    if (!target) return;
    if (target.id === "ripz-guest-request-button") { submitGuestRequest(); return; }
    if (target.id === "ripz-guest-start-camera") { startGuestCamera(); return; }
    if (target.id === "ripz-guest-stop-camera") { stopGuestCamera(); return; }
    if (target.hasAttribute("data-ripz-guest-approve")) { decideGuestRequest(target.getAttribute("data-ripz-guest-approve"), "approve"); return; }
    if (target.hasAttribute("data-ripz-guest-decline")) { decideGuestRequest(target.getAttribute("data-ripz-guest-decline"), "decline"); return; }
  });

  $("ripz-chat-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    var input = $("ripz-chat-input");
    var message = input.value.trim();
    if (!state.selectedStream || !message) return;
    var button = $("ripz-chat-form").querySelector("button");
    button.disabled = true;
    try {
      await api("POST", { action: "chat", stream_id: state.selectedStream.id, message: message });
      input.value = "";
      await loadChat(state.selectedStream.id);
    } catch (error) {
      setStatus("ripz-playback-status", error.message || "Could not send your chat message.", true);
    } finally {
      button.disabled = false;
    }
  });

  $("ripz-chat-form").querySelector("input").addEventListener("keydown", function (event) {
    if (event.key === "Escape") this.value = "";
  });

  var setupButton = $("ripz-setup-stream");
  if (setupButton) setupButton.addEventListener("click", function () {
    if (!state.authenticated) { $("ripz-signed-out").hidden = false; $("ripz-landing").hidden = true; return; }
    if (state.myStream && state.myStream.status === "ended") state.myStream = null;
    openStudio(true);
    renderHostPanel();
  });
  var backButton = $("ripz-back-to-ripz");
  if (backButton) backButton.addEventListener("click", async function () {
    if (state.myStream && state.myStream.status === "live") { setStatus("ripz-host-status", "Your stream is live. Keep this studio open to stay on air.", true); return; }
    await closePlayback();
    state.studioOpen = false;
    $("ripz-content").hidden = true;
    $("ripz-landing").hidden = false;
    $("ripz-live-panel").hidden = false;
    $("ripz-replay-frame").hidden = true;
    $("ripz-replay-frame").src = "about:blank";
  });

  window.addEventListener("pagehide", function () {
    // Send the end request synchronously before the page is torn down.
    if (state.myStream && navigator.sendBeacon) {
      try { navigator.sendBeacon("/api/ripz", new Blob([JSON.stringify({ action: "end", stream_id: state.myStream.id })], { type: "application/json" })); } catch (_) {}
    }
    if (state.broadcaster) {
      var liveBroadcast = state.broadcaster;
      state.broadcaster = null;
      try { if (liveBroadcast.sessionUrl) fetch(liveBroadcast.sessionUrl, { method: "DELETE", keepalive: true }); } catch (_) {}
      try { liveBroadcast.pc.close(); } catch (_) {}
    }
    if (state.media) state.media.getTracks().forEach(function (track) { track.stop(); });
    if (state.playbackStreamId && navigator.sendBeacon) {
      try { navigator.sendBeacon("/api/ripz", new Blob([JSON.stringify({ action: "viewer_leave", stream_id: state.playbackStreamId })], { type: "application/json" })); } catch (_) {}
    }
    if (state.viewerTimer) { clearInterval(state.viewerTimer); state.viewerTimer = null; }
    if (state.playback) {
      var active = state.playback;
      try { if (active.sessionUrl) fetch(active.sessionUrl, { method: "DELETE", keepalive: true }); } catch (_) {}
      try { active.pc.close(); } catch (_) {}
    }
    if (state.chatTimer) clearInterval(state.chatTimer);
    if (state.guestTimer) clearInterval(state.guestTimer);
    stopGuestCamera();
    clearGuestSubscriber();
    if (state.listTimer) clearInterval(state.listTimer);
    if (state.recordingTimer) clearTimeout(state.recordingTimer);
  });

  var videoFullscreenButton = $("ripz-video-fullscreen");
  var liveVideoLayout = $("ripz-live-video-layout");
  function syncVideoFullscreenButton() {
    if (!videoFullscreenButton || !liveVideoLayout) return;
    var active = document.fullscreenElement === liveVideoLayout || liveVideoLayout.classList.contains("ripz-fullscreen-fallback");
    videoFullscreenButton.textContent = active ? "⤢ Exit full screen" : "⛶ Full screen";
    videoFullscreenButton.setAttribute("aria-label", active ? "Exit full screen for host and guest feeds" : "View host and guest feeds full screen");
  }
  async function toggleVideoFullscreen() {
    if (!liveVideoLayout) return;
    if (document.fullscreenElement === liveVideoLayout) {
      try { await document.exitFullscreen(); } catch (_) {}
      liveVideoLayout.classList.remove("ripz-fullscreen-fallback");
      syncVideoFullscreenButton();
      return;
    }
    if (liveVideoLayout.classList.contains("ripz-fullscreen-fallback")) {
      liveVideoLayout.classList.remove("ripz-fullscreen-fallback");
      syncVideoFullscreenButton();
      return;
    }
    var request = liveVideoLayout.requestFullscreen || liveVideoLayout.webkitRequestFullscreen;
    if (request) {
      try {
        await request.call(liveVideoLayout);
        syncVideoFullscreenButton();
        return;
      } catch (_) {}
    }
    liveVideoLayout.classList.add("ripz-fullscreen-fallback");
    syncVideoFullscreenButton();
  }
  if (videoFullscreenButton) videoFullscreenButton.addEventListener("click", toggleVideoFullscreen);
  document.addEventListener("fullscreenchange", syncVideoFullscreenButton);
  document.addEventListener("webkitfullscreenchange", syncVideoFullscreenButton);

  var giveawayOpenButton = $("ripz-host-giveaway");
  if (giveawayOpenButton) giveawayOpenButton.addEventListener("click", openGiveawayModal);
  var giveawayCloseButton = $("ripz-giveaway-close");
  if (giveawayCloseButton) giveawayCloseButton.addEventListener("click", closeGiveawayModal);
  var giveawayBackdrop = $("ripz-giveaway-modal");
  if (giveawayBackdrop) giveawayBackdrop.addEventListener("click", function (event) {
    if (event.target === giveawayBackdrop) closeGiveawayModal();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeGiveawayModal();
  });
  var dockEndButton = $("ripz-host-dock-end");
  if (dockEndButton) dockEndButton.addEventListener("click", function () { stopHostStream(false); });
  var muteButton = $("ripz-host-mute"); if (muteButton) muteButton.addEventListener("click", toggleHostMute);
  var cameraButton = $("ripz-host-camera"); if (cameraButton) cameraButton.addEventListener("click", toggleHostCamera);
  var pauseButton = $("ripz-host-pause"); if (pauseButton) pauseButton.addEventListener("click", toggleHostPause);

  refreshData().then(function () {
    state.listTimer = window.setInterval(refreshLiveList, 12000);
    state.chatTimer = window.setInterval(function () {
      if (state.selectedStream) loadChat(state.selectedStream.id);
    }, 3500);
    state.guestTimer = window.setInterval(function () {
      var activeGuestStream = state.myStream && state.myStream.status === "live" ? state.myStream.id : (state.selectedStream && state.selectedStream.id);
      if (activeGuestStream) {
        refreshGuestState(activeGuestStream);
        ensureGuestSubscription(activeGuestStream);
      }
    }, 3000);
  });
})();