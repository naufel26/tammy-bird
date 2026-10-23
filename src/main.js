import { isMuted, playFall, playHit, playPoint, playUmm, toggleMute } from './audio.js';
import { askName, isModalOpen, qualifies, refreshBoard, showBoard } from './leaderboard.js';

const canvas = document.getElementById('game');
const trophyBtn = document.getElementById('trophy');
const muteBtn = document.getElementById('mute');
const ctx = canvas.getContext('2d');

// Game logic uses a fixed 288x512 space; the canvas renders at 3x for a sharp face sprite
const W = 288;
const H = 512;
const SCALE = 3;
canvas.width = W * SCALE;
canvas.height = H * SCALE;
ctx.scale(SCALE, SCALE);
ctx.imageSmoothingQuality = 'high';
const GROUND_H = 80;

// Physics (pixels per second / per second²)
const GRAVITY = 1400;
const FLAP_VELOCITY = -420;
const MAX_FALL_SPEED = 600;

// Difficulty ramps from the start values to the max values as the score climbs to RAMP_SCORE
const RAMP_SCORE = 50;
const SPEED_START = 120; // px/s, shared by pipes and ground
const SPEED_MAX = 160;
const GAP_START = 125; // vertical opening between pipes
const GAP_MIN = 100;

// Pipes
const PIPE_W = 52;
const PIPE_CAP_H = 24;
const PIPE_CAP_OVERHANG = 3; // cap is wider than the pipe body on each side
const PIPE_SPACING = 200; // horizontal distance between pipe pairs
const PIPE_MIN_EDGE = 50; // keep gaps this far from the top and the ground

const pipes = []; // { x, gapY, gap, scored } where gapY is the top of the opening
let worldX = 0; // total distance scrolled, drives the ground and parallax layers

// Juice: each decays from 1 to 0
let squash = 0; // face squish on flap
let scorePop = 0; // score number bounce
let shake = 0; // screen shake on crash

// Face sprite (202x277 source), drawn at a fixed height
const faceImg = new Image();
faceImg.src = '/face.png';
const FACE_H = 46;
const FACE_W = Math.round((FACE_H * 202) / 277);

const bird = {
  x: 70,
  y: H / 2,
  radius: 16, // collision radius, slightly smaller than the sprite
  vy: 0,
};

// Game states: 'ready' (waiting for first tap) → 'playing' → 'dying' (falling after a hit) → 'over'
let state = 'ready';
let stateTime = 0; // seconds since entering the current state
let flash = 0; // white screen flash on impact, fades from 1 to 0

const BEST_KEY = 'tammy-bird-best';
let score = 0;
let best = loadBest();
let newBest = false;

function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0; // storage blocked (private mode etc.) — just don't persist
  }
}
function saveBest() {
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch {}
}

const RESTART_DELAY = 0.6; // ignore taps briefly after game over so a panicked tap doesn't restart

let awaitingName = false; // a top-10 name prompt is pending; hold off restarts

function setState(next) {
  state = next;
  stateTime = 0;
  const menu = state === 'ready' || state === 'over';
  trophyBtn.classList.toggle('hidden', !menu);
  muteBtn.classList.toggle('hidden', !menu);
}

function difficulty() {
  return Math.min(score / RAMP_SCORE, 1);
}

function scrollSpeed() {
  return SPEED_START + (SPEED_MAX - SPEED_START) * difficulty();
}

function onGameOver() {
  if (!qualifies(score)) return;
  awaitingName = true;
  // Let the game-over panel land before the prompt pops up
  setTimeout(() => {
    askName(score, {
      onPlayAgain: () => {
        awaitingName = false;
        resetGame();
      },
      onSkip: () => {
        awaitingName = false;
      },
    });
  }, RESTART_DELAY * 1000);
}

function resetGame() {
  bird.y = H / 2 - 20;
  bird.vy = 0;
  pipes.length = 0;
  score = 0;
  newBest = false;
  setState('ready');
  // Keep the cached board current so the top-10 check after this run is accurate
  refreshBoard().catch(() => {});
}

function flap() {
  bird.vy = FLAP_VELOCITY;
  squash = 1;
  playUmm();
}

function handleInput() {
  if (isModalOpen() || awaitingName) return;
  if (state === 'ready') {
    setState('playing');
    flap();
  } else if (state === 'playing') {
    flap();
  } else if (state === 'over' && stateTime > RESTART_DELAY) {
    resetGame();
  }
}

function spawnPipe(x) {
  const gap = GAP_START - (GAP_START - GAP_MIN) * difficulty();
  const minY = PIPE_MIN_EDGE;
  const maxY = H - GROUND_H - PIPE_MIN_EDGE - gap;
  pipes.push({ x, gapY: minY + Math.random() * (maxY - minY), gap, scored: false });
}

function updatePipes(dt) {
  const speed = scrollSpeed();
  for (const pipe of pipes) pipe.x -= speed * dt;
  worldX += speed * dt;

  // Drop pipes that have left the screen
  while (pipes.length && pipes[0].x + PIPE_W + PIPE_CAP_OVERHANG < 0) pipes.shift();

  // Keep a steady stream coming in from the right
  const lastX = pipes.length ? pipes[pipes.length - 1].x : -Infinity;
  if (lastX < W - PIPE_SPACING) spawnPipe(Math.max(lastX + PIPE_SPACING, W));
}

// Circle vs axis-aligned rectangle
function circleHitsRect(cx, cy, r, x, y, w, h) {
  const nx = Math.max(x, Math.min(cx, x + w));
  const ny = Math.max(y, Math.min(cy, y + h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

function hitsPipe() {
  const capW = PIPE_W + PIPE_CAP_OVERHANG * 2;
  for (const { x, gapY, gap } of pipes) {
    const capX = x - PIPE_CAP_OVERHANG;
    const bottomY = gapY + gap;
    // Body and cap of each pipe; the bodies extend past the screen edges so you can't fly over
    if (
      circleHitsRect(bird.x, bird.y, bird.radius, x, -1000, PIPE_W, gapY + 1000) ||
      circleHitsRect(bird.x, bird.y, bird.radius, capX, gapY - PIPE_CAP_H, capW, PIPE_CAP_H) ||
      circleHitsRect(bird.x, bird.y, bird.radius, x, bottomY, PIPE_W, H) ||
      circleHitsRect(bird.x, bird.y, bird.radius, capX, bottomY, capW, PIPE_CAP_H)
    ) {
      return true;
    }
  }
  return false;
}

function updateScore() {
  for (const pipe of pipes) {
    if (!pipe.scored && pipe.x + PIPE_W < bird.x) {
      pipe.scored = true;
      score++;
      scorePop = 1;
      playPoint();
    }
  }
}

function die(hitGround) {
  flash = 1;
  shake = 1;
  playHit();
  if (!hitGround) playFall();
  if (score > best) {
    best = score;
    newBest = true;
    saveBest();
  }
  setState('dying');
}

function applyGravity(dt) {
  bird.vy = Math.min(bird.vy + GRAVITY * dt, MAX_FALL_SPEED);
  bird.y += bird.vy * dt;
}

function update(dt) {
  stateTime += dt;
  flash = Math.max(0, flash - dt * 4);
  squash = Math.max(0, squash - dt * 5);
  scorePop = Math.max(0, scorePop - dt * 5);
  shake = Math.max(0, shake - dt * 3);
  const floor = H - GROUND_H - bird.radius;

  if (state === 'ready') {
    // Gentle hover while waiting for the first tap; ground keeps scrolling
    bird.y = H / 2 - 20 + Math.sin(stateTime * 6) * 5;
    worldX += SPEED_START * dt;
  } else if (state === 'playing') {
    updatePipes(dt);
    applyGravity(dt);

    // The ceiling blocks you but doesn't kill you, like the original
    if (bird.y < bird.radius) {
      bird.y = bird.radius;
      bird.vy = 0;
    }
    if (bird.y >= floor) {
      bird.y = floor;
      die(true);
    } else if (hitsPipe()) {
      die(false);
    } else {
      updateScore();
    }
  } else if (state === 'dying') {
    // World freezes; the face drops to the ground
    applyGravity(dt);
    if (bird.y >= floor) {
      bird.y = floor;
      setState('over');
      onGameOver();
    }
  }
}

function drawBird() {
  // Tilt the face based on vertical speed; face-plant once dead
  let angle = state === 'ready' ? 0 : Math.max(-0.4, Math.min(bird.vy / 800, 0.9));
  if (state === 'dying' || state === 'over') angle = Math.PI / 2;
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(angle);
  // Squash and stretch: wide and short right after a flap, springing back
  const k = Math.sin(squash * Math.PI) * 0.18;
  ctx.scale(1 + k, 1 - k);
  if (faceImg.complete && faceImg.naturalWidth) {
    ctx.drawImage(faceImg, -FACE_W / 2, -FACE_H / 2, FACE_W, FACE_H);
  }
  ctx.restore();
}

// Pre-rendered background strip, tiled horizontally and scrolled at a fraction of the world speed
function makeLayer(width, height, draw) {
  const layer = document.createElement('canvas');
  layer.width = width * SCALE;
  layer.height = height * SCALE;
  const lctx = layer.getContext('2d');
  lctx.scale(SCALE, SCALE);
  draw(lctx);
  return { canvas: layer, width, height };
}

// Small seeded RNG so the skyline looks the same every visit
function rng(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

function pixelCloud(c, x, y, s) {
  c.fillStyle = '#eaf8f8';
  c.fillRect(x + 2 * s, y, 4 * s, s);
  c.fillRect(x + s, y + s, 7 * s, s);
  c.fillRect(x, y + 2 * s, 10 * s, s);
  c.fillStyle = '#c3e6ea';
  c.fillRect(x, y + 3 * s, 10 * s, s);
}

const cloudLayer = makeLayer(W, 260, (c) => {
  pixelCloud(c, 20, 60, 5);
  pixelCloud(c, 150, 20, 4);
  pixelCloud(c, 200, 140, 5);
  pixelCloud(c, 70, 200, 3);
});

const SKYLINE_H = 110;
const skylineLayer = makeLayer(W, SKYLINE_H, (c) => {
  const rand = rng(7);
  // Buildings
  let x = 0;
  while (x < W) {
    const w = 18 + Math.floor(rand() * 22);
    const h = 30 + Math.floor(rand() * 55);
    const top = SKYLINE_H - h;
    c.fillStyle = '#a6d9d0';
    c.fillRect(x, top, w, h);
    c.fillStyle = '#93cdc3';
    c.fillRect(x + w - 3, top, 3, h);
    // Windows
    c.fillStyle = '#c4ebe4';
    for (let wy = top + 5; wy < SKYLINE_H - 25; wy += 8) {
      for (let wx = x + 4; wx < x + w - 6; wx += 6) {
        if (rand() > 0.3) c.fillRect(wx, wy, 3, 4);
      }
    }
    x += w;
  }
  // Bushes along the bottom
  c.fillStyle = '#5fbf5f';
  for (let bx = -10; bx < W + 20; bx += 22) {
    const r = 12 + ((bx * 7) % 6);
    c.beginPath();
    c.arc(bx, SKYLINE_H - 6, r, Math.PI, 0);
    c.fill();
  }
  c.fillRect(0, SKYLINE_H - 8, W, 8);
});

function drawLayer(layer, y, speedFactor) {
  const offset = -((worldX * speedFactor) % layer.width);
  for (let x = offset; x < W; x += layer.width) {
    ctx.drawImage(layer.canvas, x, y, layer.width, layer.height);
  }
}

function drawBackground() {
  ctx.fillStyle = '#70c5ce';
  ctx.fillRect(0, 0, W, H);
  drawLayer(cloudLayer, 0, 0.1);
  drawLayer(skylineLayer, H - GROUND_H - SKYLINE_H, 0.3);
}

const PIPE_COLORS = {
  outline: '#1f2a1a',
  light: '#86d84a',
  mid: '#55a22c',
  dark: '#3e7b20',
};

// One pipe segment with the classic light/mid/dark vertical shading
function drawPipeRect(x, y, w, h) {
  if (h <= 0) return;
  ctx.fillStyle = PIPE_COLORS.outline;
  ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
  ctx.fillStyle = PIPE_COLORS.mid;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = PIPE_COLORS.light;
  ctx.fillRect(x + w * 0.08, y, w * 0.12, h);
  ctx.fillStyle = PIPE_COLORS.dark;
  ctx.fillRect(x + w * 0.78, y, w * 0.22, h);
}

function drawPipes() {
  const capW = PIPE_W + PIPE_CAP_OVERHANG * 2;
  const groundY = H - GROUND_H;
  for (const { x, gapY, gap } of pipes) {
    const capX = x - PIPE_CAP_OVERHANG;
    const bottomY = gapY + gap;

    // Top pipe: body hangs from the ceiling, cap at the gap
    drawPipeRect(x, -2, PIPE_W, gapY - PIPE_CAP_H + 2);
    drawPipeRect(capX, gapY - PIPE_CAP_H, capW, PIPE_CAP_H);

    // Bottom pipe: cap at the gap, body down to the ground
    drawPipeRect(x, bottomY + PIPE_CAP_H, PIPE_W, groundY - bottomY - PIPE_CAP_H);
    drawPipeRect(capX, bottomY, capW, PIPE_CAP_H);
  }
}

function drawGround() {
  const top = H - GROUND_H;
  ctx.fillStyle = '#ded895';
  ctx.fillRect(0, top, W, GROUND_H);

  // Scrolling diagonal stripes on the grass strip
  ctx.fillStyle = '#5ee270';
  ctx.fillRect(0, top, W, 12);
  ctx.fillStyle = '#4cc75d';
  const offset = -(worldX % 24);
  for (let x = offset - 24; x < W + 24; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x, top + 12);
    ctx.lineTo(x + 12, top);
    ctx.lineTo(x + 24, top);
    ctx.lineTo(x + 12, top + 12);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#d0c874';
  ctx.fillRect(0, top + 12, W, 3);
}

const DISPLAY_FONT = "'Luckiest Guy', system-ui, -apple-system, 'Segoe UI', sans-serif";

function drawText(text, x, y, size) {
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size / 6;
  ctx.strokeStyle = '#2b2b2b';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

const MEDALS = [
  { min: 40, name: 'Platinum', light: '#f4fbff', dark: '#9fb6c6' },
  { min: 30, name: 'Gold', light: '#ffe873', dark: '#d79a00' },
  { min: 20, name: 'Silver', light: '#f2f2f2', dark: '#9a9a9a' },
  { min: 10, name: 'Bronze', light: '#f0b27a', dark: '#a0582a' },
];

function drawLockedMedal(cx, cy, r) {
  // Faded medal with a dashed rim and a padlock: clearly "not earned yet" rather than missing
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#cfc785';
  ctx.fill();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#a89f62';
  ctx.stroke();
  ctx.setLineDash([]);

  // Padlock
  ctx.fillStyle = '#a89f62';
  ctx.strokeStyle = '#a89f62';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy - 3, 6, Math.PI, 0);
  ctx.stroke();
  roundRect(cx - 9, cy - 3, 18, 14, 3);
  ctx.fill();
  ctx.fillStyle = '#cfc785';
  ctx.fillRect(cx - 1.5, cy + 1, 3, 6);
}

function drawMedal(cx, cy, r, medal, t) {
  if (!medal) return drawLockedMedal(cx, cy, r);
  const g = ctx.createRadialGradient(cx - r / 3, cy - r / 3, 2, cx, cy, r);
  g.addColorStop(0, medal.light);
  g.addColorStop(1, medal.dark);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#543847';
  ctx.stroke();

  // Star
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.28 : r * 0.62;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fill();

  // Twinkle that sweeps around the rim
  const a = t * 3;
  ctx.beginPath();
  ctx.arc(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, 2 + Math.sin(t * 9) * 1, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function drawScorePanel(cx, cy, t) {
  const w = 220;
  const h = 110;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const medal = MEDALS.find((m) => score >= m.min);

  roundRect(x, y, w, h, 10);
  ctx.fillStyle = '#ded895';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#543847';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e86101';
  ctx.font = "800 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText('MEDAL', cx - 55, y + 18);
  ctx.fillText('SCORE', cx + 50, y + 18);
  ctx.fillText('BEST', cx + 50, y + 62);

  drawMedal(cx - 55, y + 58, 26, medal, t);

  // Medal name, or how far to the first one
  const nextMedal = MEDALS[MEDALS.length - 1];
  ctx.font = "800 10px system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillStyle = medal ? '#543847' : '#9a8f5a';
  ctx.fillText(medal ? medal.name.toUpperCase() : `${nextMedal.min} FOR ${nextMedal.name.toUpperCase()}`, cx - 55, y + 97);
  drawText(String(score), cx + 50, y + 42, 26);
  drawText(String(best), cx + 50, y + 86, 26);

  if (newBest) {
    roundRect(cx + 72, y + 55, 34, 14, 7);
    ctx.fillStyle = '#e8412c';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = "800 9px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.fillText('NEW', cx + 89, y + 62.5);
  }
}

// "TAMMY BIRD" title: chunky gradient letters with a thick outline and drop shadow, gently bobbing
function drawBanner(cx, cy, t) {
  ctx.save();
  ctx.translate(cx, cy + Math.sin(t * 2.5) * 4);
  ctx.rotate(-0.06 + Math.sin(t * 1.3) * 0.015);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const lines = [
    { text: 'TAMMY', y: -28, size: 62 },
    { text: 'BIRD', y: 30, size: 62 },
  ];

  for (const { text, y, size } of lines) {
    ctx.font = `${size}px ${DISPLAY_FONT}`;

    // Drop shadow
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(40, 20, 30, 0.45)';
    ctx.strokeText(text, 3, y + 6);

    // Thick dark outline
    ctx.strokeStyle = '#3b1f2b';
    ctx.strokeText(text, 0, y);

    // White inner rim for a sticker look
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(text, 0, y);

    // Sunny gradient fill
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, '#fff7a1');
    g.addColorStop(0.45, '#ffcf1f');
    g.addColorStop(1, '#ff7a00');
    ctx.fillStyle = g;
    ctx.fillText(text, 0, y);

    // Glossy highlight on the top half of the letters
    ctx.save();
    ctx.beginPath();
    ctx.rect(-W, y - size / 2, W * 2, size * 0.42);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillText(text, 0, y);
    ctx.restore();
  }
  ctx.restore();
}

function drawOverlay() {
  if (state === 'ready') {
    drawBanner(W / 2, 120, stateTime);
    drawText('Tap or press Space', W / 2, H / 2 + 56, 18);
    if (best > 0) drawText(`Best: ${best}`, W / 2, H / 2 + 86, 18);
  } else if (state === 'playing' || state === 'dying') {
    drawText(String(score), W / 2, 60, 48 * (1 + Math.sin(scorePop * Math.PI) * 0.3));
  } else if (state === 'over') {
    // Slide the panel in from slightly above
    const t = Math.min(stateTime / 0.3, 1);
    const y = 120 - (1 - t) * 30;
    ctx.globalAlpha = t;
    drawText('Game Over', W / 2, y, 40);
    drawScorePanel(W / 2, y + 95, stateTime);
    ctx.globalAlpha = 1;
    if (stateTime > RESTART_DELAY && !awaitingName) {
      ctx.globalAlpha = 0.65 + Math.sin(stateTime * 5) * 0.35;
      drawText('Tap to play again', W / 2, y + 190, 18);
      ctx.globalAlpha = 1;
    }
  }

  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${flash})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function render() {
  ctx.save();
  if (shake > 0) {
    const m = shake * shake * 6;
    ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
  }
  drawBackground();
  drawPipes();
  drawGround();
  drawBird();
  ctx.restore();
  drawOverlay();
}

let last = performance.now();
function loop(now) {
  // Clamp dt so a backgrounded tab doesn't cause a huge jump
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
// Canvas text doesn't trigger web-font loading on its own
document.fonts?.load(`40px 'Luckiest Guy'`);

resetGame();
requestAnimationFrame(loop);

// Input: space / up arrow, mouse click, or touch
window.addEventListener('keydown', (e) => {
  if (isModalOpen()) return; // let the name field and buttons have the keyboard
  if (e.code === 'KeyM') return updateMuteButton(toggleMute());
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) handleInput();
  }
});
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  handleInput();
});
trophyBtn.addEventListener('click', () => showBoard());

function updateMuteButton(muted) {
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
}
updateMuteButton(isMuted());
muteBtn.addEventListener('click', () => {
  updateMuteButton(toggleMute());
  muteBtn.blur(); // so Space flaps instead of re-clicking the button
});
