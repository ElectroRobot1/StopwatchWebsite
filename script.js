const BOOKS_STORAGE_KEY = 'stopwatch_books_v1';
const THEME_STORAGE_KEY = 'stopwatch_theme_preference_v1';
const MAX_BOOKS = 12;

let uiTickInterval = null;
let state = null;
let pendingBookNameAction = null; // { mode: 'create', id } | { mode: 'rename', bookId }

const display = document.getElementById('display');
const bookTitle = document.getElementById('book-title');
const tabsRoot = document.getElementById('tabs');
const newTabButton = document.getElementById('new-tab');
const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');
const resetButton = document.getElementById('reset');
const saveButton = document.getElementById('save');
const clearAllButton = document.getElementById('clear-all');
const timesList = document.getElementById('times-list');
const editButton = document.getElementById('edit');
const incrementButton = document.getElementById('increment');
const decrementButton = document.getElementById('decrement');
const timeInputBox = document.getElementById('time-input-box');
const enterTimeButton = document.getElementById('enter-time');
const hoursInput = document.getElementById('hours-input');
const minutesInput = document.getElementById('minutes-input');
const secondsInput = document.getElementById('seconds-input');
const themeToggle = document.getElementById('theme-toggle');
const systemThemeQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

// Book name modal
const bookNameBox = document.getElementById('book-name-box');
const bookNameInput = document.getElementById('book-name-input');
const confirmBookNameBtn = document.getElementById('confirm-book-name');
const cancelBookNameBtn = document.getElementById('cancel-book-name');

function getStoredThemePreference() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return null;
}

function getDeviceTheme() {
  return systemThemeQuery && systemThemeQuery.matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  if (themeToggle) themeToggle.checked = resolved === 'dark';
}

function initTheme() {
  const storedTheme = getStoredThemePreference();
  applyTheme(storedTheme || getDeviceTheme());

  if (themeToggle) {
    themeToggle.addEventListener('change', () => {
      const next = themeToggle.checked ? 'dark' : 'light';
      localStorage.setItem(THEME_STORAGE_KEY, next);
      applyTheme(next);
    });
  }

  if (!systemThemeQuery) return;

  const handleSystemThemeChange = () => {
    if (getStoredThemePreference()) return;
    applyTheme(getDeviceTheme());
  };

  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', handleSystemThemeChange);
    return;
  }

  if (typeof systemThemeQuery.addListener === 'function') {
    systemThemeQuery.addListener(handleSystemThemeChange);
  }
}

function formatTime(time) {
  const seconds = Math.floor((time / 1000) % 60);
  const minutes = Math.floor((time / (1000 * 60)) % 60);
  const hours = Math.floor(time / (1000 * 60 * 60));
  return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function newId() {
  return `b_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getDefaultState() {
  const firstId = newId();
  return {
    version: 1,
    activeBookId: firstId,
    books: [
      {
        id: firstId,
        name: 'Book 1',
        baseElapsedMs: 0,
        isRunning: false,
        startedAt: null,
        savedTimes: [],
      },
    ],
  };
}

function loadState() {
  const raw = localStorage.getItem(BOOKS_STORAGE_KEY);
  const parsed = raw ? safeJsonParse(raw, null) : null;
  if (parsed && parsed.version === 1 && Array.isArray(parsed.books) && parsed.books.length) {
    // sanitize activeBookId
    if (!parsed.books.some(b => b.id === parsed.activeBookId)) {
      parsed.activeBookId = parsed.books[0].id;
    }
    return parsed;
  }

  // Migrate legacy single-book storage
  const legacyElapsed = parseInt(localStorage.getItem('elapsedTime')) || 0;
  const legacySavedTimesRaw = safeJsonParse(localStorage.getItem('savedTimes'), []) || [];
  const legacySavedTimes = legacySavedTimesRaw.map(entry => {
    if (typeof entry === 'string') return { time: entry, millis: null, page: null };
    return entry;
  });

  const migrated = getDefaultState();
  migrated.books[0].baseElapsedMs = legacyElapsed;
  migrated.books[0].savedTimes = legacySavedTimes;
  saveState(migrated);
  // Keep legacy keys around (harmless), but the app now uses BOOKS_STORAGE_KEY.
  return migrated;
}

function saveState(nextState = state) {
  state = nextState;
  try {
    localStorage.setItem(BOOKS_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save state', e);
  }
}

function getActiveBook() {
  return state.books.find(b => b.id === state.activeBookId) || state.books[0];
}

function getElapsedMs(book) {
  if (!book) return 0;
  if (!book.isRunning) return book.baseElapsedMs || 0;
  const startedAt = book.startedAt || Date.now();
  return (book.baseElapsedMs || 0) + (Date.now() - startedAt);
}

function setElapsedMs(book, nextElapsedMs) {
  const clamped = Math.max(0, Math.floor(nextElapsedMs || 0));
  if (!book) return;
  if (book.isRunning) {
    book.baseElapsedMs = clamped;
    book.startedAt = Date.now();
  } else {
    book.baseElapsedMs = clamped;
    book.startedAt = null;
  }
}

function toggleTimeInputBox(button) {
  const isActive = button.classList.contains('active');
  document.querySelectorAll('.control-box button').forEach(btn => btn.classList.remove('active'));
  if (!isActive) {
    button.classList.add('active');
    timeInputBox.classList.remove('hidden');
  } else {
    timeInputBox.classList.add('hidden');
  }
}

function applyTimeChange(mode) {
  const hours = parseInt(hoursInput.value) || 0;
  const minutes = parseInt(minutesInput.value) || 0;
  const seconds = parseInt(secondsInput.value) || 0;
  const totalMilliseconds = (hours * 3600 + minutes * 60 + seconds) * 1000;

  const book = getActiveBook();
  const current = getElapsedMs(book);
  let next = current;

  if (mode === 'edit') next = totalMilliseconds;
  else if (mode === 'increment') next = current + totalMilliseconds;
  else if (mode === 'decrement') next = Math.max(0, current - totalMilliseconds);

  setElapsedMs(book, next);
  saveState();
  render();
  timeInputBox.classList.add('hidden');
}

function saveTime() {
  showSavePageBox();
}

function clearAllSavedTimes() {
  const book = getActiveBook();
  book.savedTimes = [];
  saveState();
  render();
}

function deleteSavedTime(index) {
  const book = getActiveBook();
  book.savedTimes.splice(index, 1);
  saveState();
  render();
}

function updateSavedTimesList() {
  timesList.innerHTML = '';
  const book = getActiveBook();
  const savedTimes = book.savedTimes || [];

  savedTimes.forEach((entry, index) => {
    const listItem = document.createElement('li');
    listItem.className = 'saved-time-item';

    const timeText = document.createElement('span');
    const displayTime = entry.time || formatTime(entry.millis || 0);
    const pageText = (entry.page !== null && entry.page !== undefined) ? ` - Page ${entry.page}` : '';
    timeText.textContent = `${index + 1}. ${displayTime}${pageText}`;
    listItem.appendChild(timeText);

    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.className = 'delete-button';
    deleteButton.addEventListener('click', () => deleteSavedTime(index));
    listItem.appendChild(deleteButton);

    timesList.appendChild(listItem);
  });

  clearAllButton.disabled = savedTimes.length === 0;
}

editButton.addEventListener('click', () => toggleTimeInputBox(editButton));
incrementButton.addEventListener('click', () => toggleTimeInputBox(incrementButton));
decrementButton.addEventListener('click', () => toggleTimeInputBox(decrementButton));
enterTimeButton.addEventListener('click', () => {
  const activeButton = document.querySelector('.control-box button.active');
  if (activeButton === editButton) applyTimeChange('edit');
  if (activeButton === incrementButton) applyTimeChange('increment');
  if (activeButton === decrementButton) applyTimeChange('decrement');
  hoursInput.value = '';
  minutesInput.value = '';
  secondsInput.value = '';
});

startButton.addEventListener('click', startStopwatch);
stopButton.addEventListener('click', stopStopwatch);
resetButton.addEventListener('click', resetStopwatch);
saveButton.addEventListener('click', saveTime);
clearAllButton.addEventListener('click', clearAllSavedTimes);

// Save page popup elements (may be absent in older pages)
const savePageBox = document.getElementById('save-page-box');
const suggestedPageInput = document.getElementById('suggested-page-input');
const pageIncrement = document.getElementById('page-increment');
const pageDecrement = document.getElementById('page-decrement');
const confirmSavePageBtn = document.getElementById('confirm-save-page');
const cancelSavePageBtn = document.getElementById('cancel-save-page');

function computeAveragePPM() {
  const book = getActiveBook();
  const savedTimes = book.savedTimes || [];

  const entries = savedTimes
    .filter(e => e.millis !== null && e.millis !== undefined && e.page !== null && e.page !== undefined)
    .slice()
    .sort((a,b) => a.millis - b.millis);
  if (entries.length < 2) return 0;
  // Compute per-pair pages/minute and average them for more robust rate
  let rates = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i-1];
    const curr = entries[i];
    const deltaPages = curr.page - prev.page;
    const deltaMinutes = (curr.millis - prev.millis) / 60000;
    if (deltaMinutes > 0) rates.push(deltaPages / deltaMinutes);
  }
  if (rates.length === 0) return 0;
  const sum = rates.reduce((s,v) => s+v, 0);
  const avg = sum / rates.length;
  return avg;
}

function showSavePageBox() {
  const book = getActiveBook();
  const savedTimes = book.savedTimes || [];
  const elapsedTime = getElapsedMs(book);

  // Determine suggested page based on last saved page and average pages per minute
  const entries = savedTimes.filter(e => e.millis !== null && e.page !== null && e.millis !== undefined && e.page !== undefined);
  let suggested = 1;
  if (entries.length === 0) {
    suggested = 1;
  } else {
    const sorted = entries.slice().sort((a,b) => a.millis - b.millis);
    const last = sorted[sorted.length - 1];
    const avgPPM = computeAveragePPM();
    const minutesSinceLast = Math.max(0, (elapsedTime - last.millis) / 60000);
    if (avgPPM && avgPPM > 0) {
      suggested = Math.max(0, Math.round(last.page + avgPPM * minutesSinceLast));
    } else {
      // No reliable average: keep same page as last
      suggested = last.page;
    }
  }

  // If popup elements aren't present, fall back to directly saving
  if (!savePageBox || !suggestedPageInput) {
    const entry = { time: formatTime(elapsedTime), millis: elapsedTime, page: null };
    book.savedTimes.push(entry);
    saveState();
    render();
    return;
  }

  suggestedPageInput.value = suggested;
  savePageBox.classList.remove('hidden');
  savePageBox.classList.add('save-page-visible');
  try {
    suggestedPageInput.focus();
    suggestedPageInput.select();
  } catch (e) {
    // ignore focus issues
  }
  // prevent page from scrolling under the modal
  try { document.body.style.overflow = 'hidden'; } catch(e) {}
}

function hideSavePageBox() {
  savePageBox.classList.add('hidden');
  savePageBox.classList.remove('save-page-visible');
  try { document.body.style.overflow = ''; } catch(e) {}
}

if (pageIncrement) {
  pageIncrement.addEventListener('click', () => {
    suggestedPageInput.value = (parseInt(suggestedPageInput.value) || 0) + 1;
  });
}
if (pageDecrement) {
  pageDecrement.addEventListener('click', () => {
    suggestedPageInput.value = Math.max(0, (parseInt(suggestedPageInput.value) || 0) - 1);
  });
}

if (confirmSavePageBtn) {
  confirmSavePageBtn.addEventListener('click', () => {
    const book = getActiveBook();
    const elapsedTime = getElapsedMs(book);
    const pageNum = Math.max(0, parseInt(suggestedPageInput.value) || 0);
    const entry = { time: formatTime(elapsedTime), millis: elapsedTime, page: pageNum };
    book.savedTimes.push(entry);
    saveState();
    render();
    hideSavePageBox();
  });
}

if (cancelSavePageBtn) {
  cancelSavePageBtn.addEventListener('click', () => {
    hideSavePageBox();
  });
}

function startStopwatch() {
  const book = getActiveBook();
  if (book.isRunning) return;
  book.isRunning = true;
  book.startedAt = Date.now();
  saveState();
  render();
}

function stopStopwatch() {
  const book = getActiveBook();
  if (!book.isRunning) return;
  book.baseElapsedMs = getElapsedMs(book);
  book.isRunning = false;
  book.startedAt = null;
  saveState();
  render();
}

function resetStopwatch() {
  const book = getActiveBook();
  book.baseElapsedMs = 0;
  book.isRunning = false;
  book.startedAt = null;
  saveState();
  render();
}

function setActiveBook(bookId) {
  state.activeBookId = bookId;
  saveState();
  // Hide any open time-input UI when switching books
  document.querySelectorAll('.control-box button').forEach(btn => btn.classList.remove('active'));
  timeInputBox.classList.add('hidden');
  render();
}

function closeBook(bookId) {
  if (!state.books.some(b => b.id === bookId)) return;
  if (state.books.length <= 1) return; // always keep at least one book

  // If closing active, switch to neighbor first
  if (state.activeBookId === bookId) {
    const idx = state.books.findIndex(b => b.id === bookId);
    const next = state.books[idx + 1] || state.books[idx - 1] || state.books[0];
    state.activeBookId = next.id;
  }

  state.books = state.books.filter(b => b.id !== bookId);
  saveState();
  render();
}

function renderTabs() {
  if (!tabsRoot) return;
  tabsRoot.innerHTML = '';

  state.books.forEach(book => {
    const wrap = document.createElement('div');
    wrap.className = `tab${book.id === state.activeBookId ? ' active' : ''}`;
    wrap.setAttribute('role', 'presentation');

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'tab-select';
    select.textContent = book.name || 'Untitled';
    select.setAttribute('role', 'tab');
    select.setAttribute('aria-selected', book.id === state.activeBookId ? 'true' : 'false');
    select.addEventListener('click', () => setActiveBook(book.id));
    select.addEventListener('dblclick', () => beginRenameBook(book.id));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = 'x';
    close.setAttribute('aria-label', `Close ${book.name || 'book'}`);
    close.disabled = state.books.length <= 1;
    close.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeBook(book.id);
    });

    wrap.appendChild(select);
    wrap.appendChild(close);
    tabsRoot.appendChild(wrap);
  });
}

function updateMainUi() {
  const book = getActiveBook();
  const elapsed = getElapsedMs(book);

  if (bookTitle) bookTitle.textContent = book.name || 'Stopwatch';
  display.textContent = formatTime(elapsed);

  // Buttons reflect the active book's state
  startButton.disabled = book.isRunning;
  stopButton.disabled = !book.isRunning;
  resetButton.disabled = elapsed <= 0 && !book.isRunning;
  saveButton.disabled = elapsed <= 0;

  updateSavedTimesList();
}

function ensureTicker() {
  if (uiTickInterval) {
    clearInterval(uiTickInterval);
    uiTickInterval = null;
  }

  const book = getActiveBook();
  if (!book.isRunning) return;

  uiTickInterval = setInterval(() => {
    // Only update the display (keep work minimal)
    const active = getActiveBook();
    display.textContent = formatTime(getElapsedMs(active));
  }, 50);
}

function render() {
  renderTabs();
  updateMainUi();
  ensureTicker();
}

function showBookNameBox() {
  if (!bookNameBox) return;
  bookNameBox.classList.remove('hidden');
  bookNameBox.classList.add('book-name-visible');
  try { document.body.style.overflow = 'hidden'; } catch(e) {}

  // configured by openBookNameModal()
}

function hideBookNameBox() {
  if (!bookNameBox) return;
  bookNameBox.classList.add('hidden');
  bookNameBox.classList.remove('book-name-visible');
  try { document.body.style.overflow = ''; } catch(e) {}
}

function openBookNameModal({ mode, prefill }) {
  if (!bookNameBox || !bookNameInput || !confirmBookNameBtn || !cancelBookNameBtn) return;

  const isCreate = mode === 'create';
  const titleEl = document.getElementById('book-name-title');
  if (titleEl) titleEl.textContent = isCreate ? 'Name this book' : 'Rename this book';

  confirmBookNameBtn.textContent = isCreate ? 'Create' : 'Rename';
  cancelBookNameBtn.textContent = isCreate ? 'Close Tab' : 'Cancel';

  bookNameInput.value = prefill || '';
  confirmBookNameBtn.disabled = !(bookNameInput.value || '').trim();

  showBookNameBox();
  setTimeout(() => {
    try {
      bookNameInput.focus();
      bookNameInput.select();
    } catch (e) {}
  }, 0);
}

function beginCreateBook() {
  if (state.books.length >= MAX_BOOKS) {
    alert(`Please close a tab before creating more books (max ${MAX_BOOKS}).`);
    return;
  }
  pendingBookNameAction = { mode: 'create', id: newId() };
  openBookNameModal({ mode: 'create', prefill: '' });
}

function beginRenameBook(bookId) {
  const book = state.books.find(b => b.id === bookId);
  if (!book) return;
  pendingBookNameAction = { mode: 'rename', bookId };
  openBookNameModal({ mode: 'rename', prefill: book.name || '' });
}

function commitBookName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed || !pendingBookNameAction) return;

  if (pendingBookNameAction.mode === 'create') {
    const book = {
      id: pendingBookNameAction.id,
      name: trimmed,
      baseElapsedMs: 0,
      isRunning: false,
      startedAt: null,
      savedTimes: [],
    };

    state.books.push(book);
    state.activeBookId = book.id;
    saveState();
    pendingBookNameAction = null;
    hideBookNameBox();
    render();
    return;
  }

  if (pendingBookNameAction.mode === 'rename') {
    const book = state.books.find(b => b.id === pendingBookNameAction.bookId);
    if (!book) return;
    book.name = trimmed;
    saveState();
    pendingBookNameAction = null;
    hideBookNameBox();
    render();
    return;
  }
}

function cancelBookNameAction() {
  pendingBookNameAction = null;
  hideBookNameBox();
  render();
}

if (newTabButton) {
  newTabButton.addEventListener('click', beginCreateBook);
}

if (bookNameInput) {
  bookNameInput.addEventListener('input', () => {
    const val = (bookNameInput.value || '').trim();
    confirmBookNameBtn.disabled = !val;
  });
  bookNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!confirmBookNameBtn.disabled) commitBookName(bookNameInput.value);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelBookNameAction();
    }
  });
}

if (confirmBookNameBtn) {
  confirmBookNameBtn.addEventListener('click', () => commitBookName(bookNameInput.value));
}

if (cancelBookNameBtn) {
  cancelBookNameBtn.addEventListener('click', cancelBookNameAction);
}

// Init
initTheme();
state = loadState();
render();
