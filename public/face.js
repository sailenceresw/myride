// Face verification for MyRide Drive (KYC enrolment + Real-Time ID selfie checks).
// Runs face-api.js in the browser: detects one face, computes a 128-d descriptor, and runs a head-turn liveness
// challenge. The server compares descriptors and stores the photo for human review.
const MRFace = (() => {
  const MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
  let loaded = null;
  const load = () => (loaded ||= Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODELS),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODELS),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODELS),
  ]));
  const opts = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

  async function detect(input) {
    await load();
    return faceapi.detectSingleFace(input, opts()).withFaceLandmarks().withFaceDescriptor();
  }

  // Head yaw proxy from landmarks: nose tip offset from the eye midpoint, normalised by eye distance.
  function yaw(landmarks) {
    const le = landmarks.getLeftEye(), re = landmarks.getRightEye(), nose = landmarks.getNose();
    const cx = (a) => a.reduce((s, p) => s + p.x, 0) / a.length;
    const l = cx(le), r = cx(re), mid = (l + r) / 2, dist = Math.abs(r - l) || 1;
    return (nose[3].x - mid) / dist;
  }

  /**
   * Open the camera in `container`, run a liveness challenge (turn head left, then right),
   * then capture a frontal selfie. Resolves { descriptor:number[128], photo:dataURL, liveness:{passed} }.
   */
  async function captureLive(container, { onStatus = () => {}, liveness = true, timeoutMs = 25000 } = {}) {
    onStatus('Loading face models…');
    await load();
    const video = document.createElement('video');
    video.autoplay = true; video.playsInline = true; video.muted = true;
    video.style.cssText = 'width:100%;border-radius:12px;transform:scaleX(-1);background:#000';
    container.innerHTML = '';
    container.appendChild(video);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    video.srcObject = stream;
    await new Promise((r) => (video.onloadedmetadata = r));
    const stop = () => stream.getTracks().forEach((t) => t.stop());
    try {
      const start = Date.now();
      const turned = new Set(); // -1 / +1: one clear turn each way (order doesn't matter; preview is mirrored)
      let best = null;
      const waitFor = async (msg, done) => {
        onStatus(msg);
        for (;;) {
          if (Date.now() - start > timeoutMs) throw new Error('Timed out — make sure your face is well lit and try again');
          const det = await detect(video);
          if (det) { const y = yaw(det.landmarks); if (done(y, det)) return; }
          await new Promise((r) => setTimeout(r, 120));
        }
      };
      if (liveness) {
        await waitFor('Turn your head slowly to one side', (y) => (Math.abs(y) > 0.12 ? (turned.add(Math.sign(y)), true) : false));
        await waitFor('Now turn to the other side', (y) => (Math.abs(y) > 0.12 && !turned.has(Math.sign(y)) ? (turned.add(Math.sign(y)), true) : false));
      }
      await waitFor('Look straight at the camera', (y, det) => (Math.abs(y) < 0.07 ? ((best = det), true) : false));
      const seen = [...turned];
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const photo = canvas.toDataURL('image/jpeg', 0.8);
      const final = (await detect(canvas)) || best;
      if (!final) throw new Error('No face found — try again');
      return { descriptor: Array.from(final.descriptor), photo, liveness: { passed: liveness && new Set(seen.slice(0, 2)).size === 2 } };
    } finally {
      stop();
    }
  }

  // Descriptor of the face printed on an ID document photo (licence / citizenship), or null.
  async function fromImage(dataUrl) {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const det = await detect(img);
    return det ? Array.from(det.descriptor) : null;
  }

  return { load, captureLive, fromImage };
})();
