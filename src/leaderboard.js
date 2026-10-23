// Global top-10 leaderboard: talks to /api/leaderboard and drives the HTML modal over the canvas

const TOP_N = 10;
const NAME_KEY = 'tammy-bird-name';
const API = '/api/leaderboard';

const $ = (id) => document.getElementById(id);
const modal = $('modal');
const nameForm = $('name-form');
const nameInput = $('name-input');
const boardView = $('board-view');

let entries = [];
let loaded = false;
let onCloseBoard = null;
let onSkipName = null;

function loadName() {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}
function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {}
}

export async function refreshBoard() {
  const res = await fetch(API);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  entries = (await res.json()).entries;
  loaded = true;
  return entries;
}

// Whether a score would make the top 10 (based on the last fetched board)
export function qualifies(score) {
  if (!loaded || score <= 0) return false;
  return entries.length < TOP_N || score > entries[entries.length - 1].score;
}

export function isModalOpen() {
  return !modal.classList.contains('hidden');
}

function showView(view) {
  modal.classList.remove('hidden');
  nameForm.classList.toggle('hidden', view !== 'name');
  boardView.classList.toggle('hidden', view !== 'board');
}

function closeModal() {
  modal.classList.add('hidden');
  document.activeElement?.blur();
}

function renderBoard(highlight) {
  const list = $('board-list');
  list.replaceChildren(
    ...entries.map(({ name, score }) => {
      const li = document.createElement('li');
      if (highlight && name.toLowerCase() === highlight.toLowerCase()) li.className = 'me';
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = name;
      const s = document.createElement('span');
      s.className = 'score';
      s.textContent = score;
      li.append(n, s);
      return li;
    }),
  );
  $('board-status').textContent = entries.length ? '' : 'No scores yet. Be the first!';
}

// Show the leaderboard. Fetches fresh data unless `fresh` is false (just submitted).
export async function showBoard({ highlight = loadName(), buttonLabel = 'Close', onClose = null, fresh = true } = {}) {
  onCloseBoard = onClose;
  $('board-close').textContent = buttonLabel;
  showView('board');
  if (!fresh) return renderBoard(highlight);

  $('board-list').replaceChildren();
  $('board-status').textContent = 'Loading…';
  try {
    await refreshBoard();
    renderBoard(highlight);
  } catch {
    $('board-status').textContent = "Couldn't load the leaderboard.";
  }
}

// Ask for a name after a top-10 run, submit it, then show the board.
// onPlayAgain runs from the board's button; onSkip if the player declines.
export function askName(score, { onPlayAgain, onSkip }) {
  onSkipName = onSkip;
  $('nf-score').textContent = score;
  $('nf-error').textContent = '';
  $('nf-submit').disabled = false;
  nameInput.value = loadName();
  showView('name');
  nameInput.focus();
  nameInput.select();

  nameForm.onsubmit = async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    $('nf-submit').disabled = true;
    $('nf-error').textContent = '';
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, score }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      entries = data.entries;
      saveName(name);
      showBoard({ highlight: name, buttonLabel: 'Play again', onClose: onPlayAgain, fresh: false });
    } catch (err) {
      $('nf-error').textContent = `Couldn't submit: ${err.message}`;
      $('nf-submit').disabled = false;
    }
  };
}

function skipName() {
  closeModal();
  onSkipName?.();
}

function closeBoard() {
  closeModal();
  const cb = onCloseBoard;
  onCloseBoard = null;
  cb?.();
}

$('nf-skip').addEventListener('click', skipName);
$('board-close').addEventListener('click', closeBoard);
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !isModalOpen()) return;
  if (!nameForm.classList.contains('hidden')) skipName();
  else closeBoard();
});
