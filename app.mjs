import { handleGesture, runGesture, setCameraReady } from './commands.mjs';
const get = (id) => document.getElementById(id);
const video = document.querySelector('video');
const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const toggle = get('toggle');
const labels = {
  Open_Palm: 'Açık avuç', Closed_Fist: 'Yumruk', Thumb_Up: 'Başparmak yukarı',
  Thumb_Down: 'Başparmak aşağı', Victory: 'Zafer işareti',
  Pointing_Up: 'İşaret parmağı yukarı', ILoveYou: 'Seni seviyorum',
};
const fingers = [[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[17,0]];
const cdn = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32';
let model, stream, animation, generation = 0, previousFrame = -1, previousTime = 0;
let trail = [], lastMotion = -Infinity;

function draw(points) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!points) return;
  const position = ({x,y}) => [x * canvas.width, y * canvas.height];
  ctx.strokeStyle = '#a4ffc4';
  ctx.lineWidth = 2;
  for (const finger of fingers) {
    ctx.beginPath();
    ctx.moveTo(...position(points[finger[0]]));
    for (const joint of finger.slice(1)) ctx.lineTo(...position(points[joint]));
    ctx.stroke();
  }
  ctx.fillStyle = '#fff';
  for (const point of points) {
    ctx.beginPath();
    ctx.arc(...position(point), 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function trackSwipe(points, openPalm, now) {
  if (!points || !openPalm) {
    trail = [];
    return;
  }
  const {x,y} = points[9];
  trail.push({x: 1 - x, y, now});
  trail = trail.filter(sample => now - sample.now <= 500);
  const start = trail[0];
  const dx = 1 - x - start.x;
  const dy = y - start.y;
  if (now - start.now >= 120 && now - lastMotion > 850 && Math.abs(dx) > .22 && Math.abs(dy) < .12) {
    get('motion').textContent = dx > 0 ? 'Sağa kaydırma →' : '← Sola kaydırma';
    trail = [];
    lastMotion = now;
    runGesture(dx > 0 ? 'right' : 'left', now);
  }
}

function stop(message = 'Kamera durduruldu.') {
  setCameraReady(false);
  generation++;
  clearInterval(animation);
  stream?.getTracks().forEach(track => track.stop());
  stream = undefined;
  video.srcObject = null;
  draw();
  trail = [];
  lastMotion = -Infinity;
  get('placeholder').hidden = false;
  get('gesture').textContent = '—';
  get('motion').textContent = '—';
  get('confidence').textContent = 'Model skoru —';
  get('status').textContent = message;
  toggle.textContent = 'Kamerayı başlat';
  toggle.disabled = false;
}

function tick() {
  const now = performance.now();
  try {
    if (video.readyState >= 2 && previousFrame !== video.currentTime && now - previousTime >= 50) {
      previousFrame = video.currentTime;
      previousTime = now;
      const result = model.recognizeForVideo(video, now);
      const points = result.landmarks[0];
      const prediction = result.gestures[0]?.[0];
      const name = prediction?.score >= .6 ? labels[prediction.categoryName] : undefined;
      get('gesture').textContent = name || (points ? 'Belirsiz işaret' : 'El görünmüyor');
      get('confidence').textContent = name ? 'Model skoru %' + Math.round(prediction.score * 100) : 'Model skoru —';
      draw(points);
      trackSwipe(points, name === labels.Open_Palm, now);
      handleGesture(name ? prediction.categoryName : '', Boolean(points), now);
    }

  } catch {
    stop('Görüntü işlenemedi. Kamerayı yeniden başlatabilirsin.');
  }
}

toggle.addEventListener('click', async () => {
  if (stream) return stop();
  const attempt = ++generation;
  toggle.disabled = true;
  get('status').textContent = 'Kamera izni bekleniyor…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      return stop('Kameraya erişmek için sayfayı HTTPS üzerinden veya localhost üzerinden aç.');
    }
    const camera = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    if (attempt !== generation) {
      camera.getTracks().forEach(track => track.stop());
      return;
    }
    stream = camera;
    camera.getVideoTracks()[0].addEventListener('ended', () => {
      if (stream === camera) stop('Kamera bağlantısı kesildi.');
    });
    toggle.disabled = false;
    toggle.textContent = 'Kamerayı durdur';
    get('status').textContent = 'Algılama modeli yükleniyor…';
    video.srcObject = stream;
    await video.play();
    if (attempt !== generation) return;
    if (!model) {
      const { GestureRecognizer, FilesetResolver } = await import(cdn + '/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(cdn + '/wasm');
      if (attempt !== generation) return;
      const recognizer = await GestureRecognizer.createFromOptions(files, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      if (attempt !== generation) return recognizer.close();
      model = recognizer;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    previousFrame = -1;
    get('placeholder').hidden = true;
    setCameraReady(true);
    get('status').textContent = 'Kamera açık. Elini kadraja al.';
    animation = setInterval(tick, 50);
  } catch (error) {
    if (attempt !== generation) return;
    const messages = {
      NotAllowedError: 'Kamera izni verilmedi. Tarayıcının site ayarlarından izin verip tekrar dene.',
      NotFoundError: 'Kamera bulunamadı.',
      NotReadableError: 'Kamera açılamadı. Kamerayı kullanan diğer uygulamaları kapatıp tekrar dene.',
    };
    stop(messages[error.name] || 'Model veya kamera başlatılamadı. İnternet bağlantını kontrol edip tekrar dene.');
  }
});
window.addEventListener('pagehide', () => stop());
