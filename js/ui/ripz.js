(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    authenticated: false,
    canGoLive: false,
    streamingConfigured: false,
    liveStreams: [],
    myStream: null,
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
    hostBusy: false,
    recordingTimer: null,
    recordingBusy: false,
    chatTimer: null,
    listTimer: null,
    viewerTimer: null
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
        stream_provider_error: "The live video service could not start a stream. Please try again later.",
        stream_provider_unavailable: "The live video provider did not return the required browser streaming links.",
        stream_not_live: "That stream is no longer live."
      })[data.error] || "The Ripz request could not be completed.";
      var error = new Error(message);
      error.code = data.error || "request_failed";
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function renderHostPanel() {
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
        '<div class="ripz-camera-actions ripz-host-span">' +
          '<button id="ripz-host-connect" class="ripz-button" type="button" ' + (state.isPublishing || !state.media ? "disabled" : "") + '>' + (state.myStream.status === "live" ? "Reconnect &amp; go live" : "Go live") + '</button>' +
          '<button id="ripz-host-stop" class="ripz-button ripz-button--danger" type="button">End stream</button>' +
        '</div><p class="ripz-note ripz-host-span">Preview first, then go live when your picture and microphone look right. Keep this page open while you rip.</p>' +
        '</div>';
      bindCameraControls(true);
      var connect = $("ripz-host-connect");
      if (connect) connect.addEventListener("click", function () { connectExistingStream(); });
      var stop = $("ripz-host-stop");
      if (stop) stop.addEventListener("click", function () { stopHostStream(false); });
      return;
    }
    host.innerHTML = '<form class="ripz-form" id="ripz-start-form">' +
      '<label for="ripz-title">Stream title<input id="ripz-title" name="title" maxlength="100" required minlength="3" placeholder="e.g. Chasing the SIR tonight"></label>' +
      '<label for="ripz-product">What are you ripping?<input id="ripz-product" name="product_name" maxlength="120" required minlength="2" placeholder="e.g. Mega Evolution booster packs"></label>' +
      cameraSetupMarkup(false) +
      '<button id="ripz-start-button" class="ripz-button" type="submit" disabled>🎥 Go live</button>' +
      '<p id="ripz-host-status" class="ripz-host-status" role="status" aria-live="polite">Start your camera preview first. You can check your picture, microphone, and devices before going live.</p>' +
      '<p class="ripz-note">Your local preview is muted to prevent echo. A camera and microphone are required. Streams are recorded for replay; the MP4 download becomes available after processing.</p>' +
      '</form>';
    bindCameraControls(false);
    $("ripz-start-form").addEventListener("submit", function (event) {
      event.preventDefault();
      startNewStream($("ripz-title").value, $("ripz-product").value);
    });
  }

  function renderLiveList() {
    var grid = $("ripz-live-grid");
    if (!state.liveStreams.length) {
      grid.innerHTML = '<div class="ripz-empty" style="grid-column:1/-1"><strong>No one is live right now.</strong><br>When a Collector+ member starts ripping, their stream will show up here.</div>';
      setStatus("ripz-live-status", "No live rips at the moment.");
      return;
    }
    setStatus("ripz-live-status", state.liveStreams.length + " live session" + (state.liveStreams.length === 1 ? "" : "s") + " available.");
    grid.innerHTML = state.liveStreams.map(function (stream) {
      return '<article class="ripz-live-card">' +
        '<div class="ripz-live-card__top"><span class="ripz-live-badge"><span class="ripz-live-dot"></span> Live</span><span class="ripz-note">Ripz</span></div>' +
        '<h3>' + esc(stream.title) + '</h3>' +
        '<p>Hosted by <strong>@' + esc(stream.host) + '</strong></p>' +
        '<p>' + esc(stream.product_name || "Pack opening") + '</p>' +
        '<p class="ripz-viewer-count">' + Number(stream.viewer_count || 0) + ' watching</p>' +
        '<button class="ripz-button ripz-button--secondary" type="button" data-ripz-watch="' + esc(stream.id) + '">Watch this rip</button>' +
        '</article>';
    }).join("");
    grid.querySelectorAll("[data-ripz-watch]").forEach(function (button) {
      button.addEventListener("click", function () {
        var stream = state.liveStreams.find(function (item) { return item.id === button.getAttribute("data-ripz-watch"); });
        if (stream) watchStream(stream);
      });
    });
  }

  function refreshData() {
    return api("GET").then(function (data) {
      state.authenticated = true;
      state.canGoLive = !!data.can_go_live;
      state.streamingConfigured = !!data.streaming_configured;
      state.liveStreams = data.live_streams || [];
      state.myStream = data.my_stream || null;
      $("ripz-signed-out").hidden = true;
      $("ripz-content").hidden = false;
      if (!state.hostBusy) renderHostPanel();
      renderLiveList();
      if (state.selectedStream && !state.liveStreams.some(function (item) { return item.id === state.selectedStream.id; })) {
        closePlayback();
        state.selectedStream = null;
        $("ripz-watch-video").hidden = true;
        $("ripz-stage-placeholder").hidden = false;
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
      $("ripz-content").hidden = false;
      return null;
    });
  }

  async function refreshLiveList() {
    try {
      var data = await api("GET");
      state.liveStreams = data.live_streams || [];
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
        $("ripz-stage-placeholder").hidden = false;
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
      state.cameraDeviceId = (newMedia.getVideoTracks()[0] && newMedia.getVideoTracks()[0].getSettings().deviceId) || cameraId;
      state.microphoneDeviceId = (newMedia.getAudioTracks()[0] && newMedia.getAudioTracks()[0].getSettings().deviceId) || micId;
      var preview = $("ripz-host-preview");
      if (preview) preview.srcObject = newMedia;
      if (oldMedia && oldMedia !== newMedia) oldMedia.getTracks().forEach(function (track) { track.stop(); });
      await populateCameraDevices();
      startAudioMeter(newMedia);
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
    var preview = $("ripz-host-preview");
    if (preview) preview.srcObject = null;
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

  async function startNewStream(title, product) {
    var button = $("ripz-start-button");
    var statusNode = $("ripz-host-status");
    state.hostBusy = true;
    if (button) button.disabled = true;
    if (statusNode) statusNode.textContent = "Requesting camera and microphone access…";
    var streamCreatedHere = false;
    try {
      var titleValue = String(title || "").trim();
      var productValue = String(product || "").trim();
      if (titleValue.length < 3 || productValue.length < 2) throw new Error("Enter a stream title and what you are ripping.");
      if (!state.media || !state.media.getVideoTracks().length || !state.media.getAudioTracks().length) throw new Error("Start your camera and microphone preview before going live.");
      if (statusNode) statusNode.textContent = "Preparing your live room…";
      var result = await api("POST", { action: "start", title: titleValue, product_name: productValue });
      streamCreatedHere = !result.reused;
      state.myStream = result.stream;
      renderHostPanel();
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
    if (state.selectedStream && state.selectedStream.id === stream.id && state.playback) return;
    await closePlayback();
    state.selectedStream = stream;
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
    } catch (error) {
      setStatus("ripz-playback-status", error.message || "Could not connect to this stream.", true);
      $("ripz-watch-video").hidden = true;
      $("ripz-stage-placeholder").hidden = false;
      $("ripz-stage-placeholder").innerHTML = '<strong>Stream unavailable</strong><span>The host may have ended their session. Try refreshing the live list.</span>';
      await closePlayback();
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
    if (state.listTimer) clearInterval(state.listTimer);
    if (state.recordingTimer) clearTimeout(state.recordingTimer);
  });

  refreshData().then(function () {
    state.listTimer = window.setInterval(refreshLiveList, 12000);
    state.chatTimer = window.setInterval(function () {
      if (state.selectedStream) loadChat(state.selectedStream.id);
    }, 3500);
  });
})();