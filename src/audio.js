// All sounds are synthesized with Web Audio, so there are no sound files to load

const MUTE_KEY = 'tammy-bird-muted';

let ctx = null;
let master = null;
let muted = loadMuted();

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

// Created lazily: browsers only allow audio after a user gesture
function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 1;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {}
  return muted;
}

// Short attack/sustain/release envelope on a gain node
function envelope(gain, t, peak, dur, attack = 0.01) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

// "Ummm" hum on every flap
export function playUmm() {
  if (muted) return;
  const ac = audio();
  const t = ac.currentTime;
  const dur = 0.45;

  // Voice-like buzz with a slight downward pitch drift
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.linearRampToValueAtTime(125, t + dur);

  // Filter starts open ("uh") and closes to a nasal hum ("mmm")
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 4;
  filter.frequency.setValueAtTime(900, t);
  filter.frequency.exponentialRampToValueAtTime(320, t + 0.12);

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
  gain.gain.setValueAtTime(0.35, t + dur - 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(filter).connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur);
}

// Bright two-note "ding" for passing a pipe
export function playPoint() {
  if (muted) return;
  const ac = audio();
  const t = ac.currentTime;
  [
    [988, 0],
    [1319, 0.07],
  ].forEach(([freq, delay]) => {
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const gain = ac.createGain();
    envelope(gain, t + delay, 0.08, 0.18);
    osc.connect(gain).connect(master);
    osc.start(t + delay);
    osc.stop(t + delay + 0.2);
  });
}

// Low thump plus a noise smack for crashing
export function playHit() {
  if (muted) return;
  const ac = audio();
  const t = ac.currentTime;

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  const oscGain = ac.createGain();
  envelope(oscGain, t, 0.7, 0.3, 0.005);
  osc.connect(oscGain).connect(master);
  osc.start(t);
  osc.stop(t + 0.32);

  const len = Math.floor(ac.sampleRate * 0.15);
  const buffer = ac.createBuffer(1, len, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const noise = ac.createBufferSource();
  noise.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1500;
  const noiseGain = ac.createGain();
  envelope(noiseGain, t, 0.35, 0.15, 0.003);
  noise.connect(filter).connect(noiseGain).connect(master);
  noise.start(t);
}

// Descending "whoop" as the face drops after a crash
export function playFall() {
  if (muted) return;
  const ac = audio();
  const t = ac.currentTime + 0.12;
  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.exponentialRampToValueAtTime(120, t + 0.45);
  const gain = ac.createGain();
  envelope(gain, t, 0.15, 0.45, 0.02);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.5);
}
