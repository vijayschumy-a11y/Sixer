/* Sixer — player photo capture: live webcam (getUserMedia) + file/upload fallback.
   Returns a small compressed square JPEG dataURL to keep localStorage light. */
(function () {
  const APP = (window.Sixer = window.Sixer || {});

  function compress(srcCanvasOrImg, size = 256) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const sw = srcCanvasOrImg.videoWidth || srcCanvasOrImg.naturalWidth || srcCanvasOrImg.width;
    const sh = srcCanvasOrImg.videoHeight || srcCanvasOrImg.naturalHeight || srcCanvasOrImg.height;
    const side = Math.min(sw, sh);
    const sx = (sw - side) / 2, sy = (sh - side) / 2;
    ctx.drawImage(srcCanvasOrImg, sx, sy, side, side, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.8);
  }

  function fromFile(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(compress(img));
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /* Opens a capture UI inside a container; resolves with dataURL or null (cancel). */
  function capture(onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'backdrop';
    overlay.innerHTML = `
      <div class="sheet">
        <div class="sheet-handle"></div>
        <h3>Player photo</h3>
        <div class="camera-wrap" id="cam-wrap">
          <video id="cam-video" autoplay playsinline muted></video>
          <canvas id="cam-canvas" class="hidden"></canvas>
        </div>
        <div id="cam-msg" class="small muted center" style="margin-top:8px"></div>
        <div class="cap-grid">
          <button class="btn primary" id="cam-shot">📸 Capture</button>
          <button class="btn" id="cam-upload">🖼️ Upload</button>
        </div>
        <div class="cap-grid" id="cam-confirm" style="display:none">
          <button class="btn primary" id="cam-use">✓ Use photo</button>
          <button class="btn" id="cam-retake">↺ Retake</button>
        </div>
        <button class="btn ghost block" id="cam-cancel" style="margin-top:10px">Cancel</button>
        <input type="file" id="cam-file" accept="image/*" capture="user" class="hidden" />
      </div>`;
    document.getElementById('modal-root').appendChild(overlay);

    const video = overlay.querySelector('#cam-video');
    const canvas = overlay.querySelector('#cam-canvas');
    const msg = overlay.querySelector('#cam-msg');
    const fileInput = overlay.querySelector('#cam-file');
    const shotBtn = overlay.querySelector('#cam-shot');
    const confirmRow = overlay.querySelector('#cam-confirm');
    let stream = null;
    let captured = null;

    function stop() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }
    function close(result) { stop(); overlay.remove(); onDone(result); }

    async function startCam() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
        video.srcObject = stream;
        msg.textContent = 'Position the face in frame';
      } catch (e) {
        msg.textContent = 'Camera unavailable — use Upload instead';
        video.classList.add('hidden');
        shotBtn.disabled = true;
      }
    }

    overlay.querySelector('#cam-shot').onclick = () => {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      captured = compress(canvas);
      video.classList.add('hidden'); canvas.classList.remove('hidden');
      canvas.getContext('2d').drawImage(video, 0, 0); // keep frame visible
      shotBtn.parentElement.style.display = 'none';
      confirmRow.style.display = 'grid';
      stop();
    };
    overlay.querySelector('#cam-retake').onclick = () => {
      captured = null; canvas.classList.add('hidden'); video.classList.remove('hidden');
      confirmRow.style.display = 'none'; shotBtn.parentElement.style.display = 'grid';
      startCam();
    };
    overlay.querySelector('#cam-use').onclick = () => close(captured);
    overlay.querySelector('#cam-upload').onclick = () => fileInput.click();
    overlay.querySelector('#cam-cancel').onclick = () => close(null);
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    fileInput.onchange = async () => {
      if (fileInput.files[0]) {
        const data = await fromFile(fileInput.files[0]);
        close(data);
      }
    };

    startCam();
  }

  APP.photo = { capture, fromFile, compress };
})();
