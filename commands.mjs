const get = id => document.getElementById(id);
const arm = get('arm');
const player = get('player');
const slide = get('slide');
const status = get('action-status');
const labels = {
  right:'Sağa kaydır', left:'Sola kaydır', Open_Palm:'Açık avuç',
  Thumb_Up:'Başparmak yukarı', Thumb_Down:'Başparmak aşağı',
  Victory:'Zafer işareti', Pointing_Up:'İşaret parmağı yukarı', ILoveYou:'🤟 Seni seviyorum',
};
const titles = {
  '':'Kapalı', next:'Sonraki slayt', prev:'Önceki slayt',
  play:'Oynat / duraklat', louder:'Sesi artır', quieter:'Sesi azalt',
  mute:'Sesi kapat / aç', nextTrack:'Sonraki parça', prevTrack:'Önceki parça',
};
const profiles = {
  mixed:{right:'next',left:'prev',Open_Palm:'play',Thumb_Up:'louder',Thumb_Down:'quieter',Victory:'mute',Pointing_Up:'nextTrack',ILoveYou:'prevTrack'},
  slides:{right:'next',left:'prev'},
  media:{right:'nextTrack',left:'prevTrack',Open_Palm:'play'},
  sound:{Thumb_Up:'louder',Thumb_Down:'quieter',Victory:'mute'},
};
const bindings = {};
for (const [gesture,title] of Object.entries(labels)) {
  const label = document.createElement('label');
  const select = document.createElement('select');
  label.append(title,select);
  for (const [value,name] of Object.entries(titles)) select.add(new Option(name,value));
  get('bindings').append(label);
  bindings[gesture] = select;
}
let repeatHeld = false;
let sending = false;
let candidate = '', since = 0, absentSince = null, activeGesture = '', last = -Infinity;
function applyProfile() {
  arm.checked = false;
  const preset = profiles[get('profile').value];
  for (const [gesture,select] of Object.entries(bindings)) select.value = preset[gesture] || '';
}
get('profile').addEventListener('change',applyProfile);
applyProfile();

const target = get('target');
const codeInput = get('bridge-code');
const connect = get('bridge-connect');
const bridgeStatus = get('bridge-status');
let bridgeCode = '';
let cameraReady = false;

function updateArm() {
  get('test-volume').disabled = !bridgeCode;
  get('test-play').disabled = !bridgeCode;
  arm.disabled = !cameraReady || (target.value === 'windows' && !bridgeCode);
}

target.onchange = () => {
  arm.checked = false;
  get('windows-panel').hidden = target.value !== 'windows';
  updateArm();
};

async function bridgeRequest(path, code) {
  const base = location.origin === 'http://127.0.0.1:8765' ? '' : 'http://127.0.0.1:8765';
  const response = await fetch(base + path, {
    method: 'POST',
    headers: {'X-Radar-Code': code},
    signal: AbortSignal.timeout(3500),
  });
  if (response.status === 429) return false;
  if (!response.ok) throw new Error('Windows yardımcı yanıtı: ' + response.status);
  return true;
}

connect.onclick = async () => {
  const code = codeInput.value.trim();
  if (!/^[A-Za-z0-9_-]{24}$/.test(code)) {
    bridgeStatus.textContent = 'Yardımcı penceresindeki bağlantı kodunu gir.';
    return;
  }
  connect.disabled = true;
  arm.checked = false;
  bridgeCode = '';
  updateArm();
  bridgeStatus.textContent = 'Bağlanıyor…';
  try {
    await bridgeRequest('/connect',code);
    bridgeCode = code;
    codeInput.value = '';
    bridgeStatus.textContent = 'Windows bağlı. Hareketle kontrolü açabilirsin.';
  } catch (error) {
    bridgeStatus.textContent = 'Bağlanılamadı. Yardımcıyı, kodu ve yerel ağ iznini kontrol et. ' + error.message;
  } finally {
    connect.disabled = false;
    updateArm();
  }
};

for (const [id,command] of [['test-volume','quieter'],['test-play','play']]) {
  get(id).onclick = async () => {
    try {
      if (!await bridgeRequest('/command/' + command,bridgeCode)) {
        bridgeStatus.textContent = 'Komutlar çok hızlı gönderildi. Bir saniye sonra tekrar dene.';
        return;
      }
      bridgeStatus.textContent = 'Windows komutu gönderildi · ' + titles[command];
    } catch (error) {
      bridgeStatus.textContent = 'Test başarısız. ' + error.message;
    }
  };
}
const localCode = new URLSearchParams(location.hash.slice(1)).get('code');
if (localCode && location.origin === 'http://127.0.0.1:8765') {
  history.replaceState(null,'',location.pathname);
  target.value = 'windows';
  target.onchange();
  codeInput.value = localCode;
  connect.click();
}

let slides = [], tracks = [], slideIndex = 0, trackIndex = 0;
function showSlide() {
  slide.hidden = !slides.length;
  if (slides.length) slide.src = slides[slideIndex].url;
  else slide.removeAttribute('src');
  get('slide-info').textContent = slides.length ? `${slideIndex + 1} / ${slides.length} · ${slides[slideIndex].name}` : 'Slayt görselleri seç.';
}
function showTrack() {
  if (tracks.length) player.src = tracks[trackIndex].url;
  else player.removeAttribute('src');
  player.load();
  get('track-info').textContent = tracks.length ? `${trackIndex + 1} / ${tracks.length} · ${tracks[trackIndex].name}` : 'Ses veya video dosyası seç.';
}
function loadFiles(input, oldFiles) {
  for (const file of oldFiles) URL.revokeObjectURL(file.url);
  return Array.from(input.files, file => ({url:URL.createObjectURL(file),name:file.name}));
}
get('slides').onchange = event => {
  slides = loadFiles(event.target,slides);
  slideIndex = 0;
  showSlide();
};
get('tracks').onchange = event => {
  tracks = loadFiles(event.target,tracks);
  trackIndex = 0;
  showTrack();
};
showSlide();
showTrack();

async function execute(command) {
  if (command === 'next' || command === 'prev') {
    if (!slides.length) return 'Önce slayt görsellerini seç.';
    slideIndex = Math.max(0,Math.min(slides.length - 1,slideIndex + (command === 'next' ? 1 : -1)));
    showSlide();
    return `Slayt ${slideIndex + 1} / ${slides.length}`;
  }
  if (!tracks.length) return 'Önce ses veya video dosyası seç.';
  switch (command) {
    case 'play':
      if (player.paused) await player.play();
      else player.pause();
      break;
    case 'nextTrack':
    case 'prevTrack': {
      const wasPlaying = !player.paused;
      trackIndex = (trackIndex + (command === 'nextTrack' ? 1 : -1) + tracks.length) % tracks.length;
      showTrack();
      if (wasPlaying) await player.play();
      break;
    }
    case 'louder':
    case 'quieter':
      player.volume = Math.max(0,Math.min(1,player.volume + (command === 'louder' ? .1 : -.1)));
      return `Ses seviyesi %${Math.round(player.volume * 100)}`;
    case 'mute':
      player.muted = !player.muted;
      return player.muted ? 'Ses kapalı' : 'Ses açık';
  }
  return titles[command];
}
async function announce(command) {
  try {
    status.textContent = await execute(command);
  } catch {
    status.textContent = 'Medya oynatılamadı. Oynatıcıdaki başlat düğmesini veya başka bir dosyayı dene.';
  }
}
get('next').onclick = () => announce('next');
get('prev').onclick = () => announce('prev');

export function setCameraReady(ready) {
  cameraReady = ready;
  updateArm();
  arm.checked = false;
  candidate = '';
  absentSince = null;
  activeGesture = '';
  repeatHeld = false;
  last = -Infinity;
}

export function runGesture(gesture, now) {
  const command = bindings[gesture]?.value;
  const repeats = gesture !== 'right' && gesture !== 'left' &&
    (command === 'louder' || command === 'quieter');
  const continuing = repeats && repeatHeld && activeGesture === gesture && candidate === gesture;
  if (!arm.checked || !command || sending || (activeGesture && !continuing) || now - last < 850) return;
  last = now;
  activeGesture = gesture;
  repeatHeld = repeats;
  if (target.value === 'page') {
    announce(command);
    return;
  }
  const code = bridgeCode;
  sending = true;
  bridgeRequest('/command/' + command,code).then(sent => {
    if (!sent) return;
    status.textContent = 'Windows · ' + titles[command];
  }).catch(() => {
    if (bridgeCode !== code) return;
    bridgeCode = '';
    if (target.value === 'windows') arm.checked = false;
    updateArm();
    bridgeStatus.textContent = 'Windows bağlantısı kesildi. Yeniden bağlan.';
  }).finally(() => { sending = false; });
}

export function handleGesture(gesture, hasHand, now) {
  if (!hasHand) {
    absentSince ??= now;
    if (now - absentSince >= 250) activeGesture = '';
  } else absentSince = null;
  if (candidate !== gesture) {
    candidate = gesture;
    since = now;
  }
  if (now - since < (gesture === 'Open_Palm' ? 750 : 500)) return;
  if (gesture === 'Closed_Fist' && arm.checked) {
    arm.checked = false;
    status.textContent = 'Hareketle kontrol duraklatıldı.';
    return;
  }
  runGesture(gesture,now);
}
