/* ============================================================
   UTBK Try Out 2026 — Main Application
   ============================================================ */

// ===== STATE =====
const state = {
  allQuestions: [],
  currentUser: null,
  currentMission: null,
  currentSession: null,
  missionQuestions: [],
  currentQuestionIdx: 0,
  selectedOption: null,
  submitted: false,
  sessionResponses: [],
  timerInterval: null,
  timerSeconds: 0,
};

// ===== STORAGE KEYS =====
const K = {
  USERS:    'utbk_users',
  SESSIONS: 'utbk_sessions',
  RESPONSES:'utbk_responses',
  ANALYTICS:'utbk_analytics',
  PROGRESS: 'utbk_progress',
  SCORES:   'utbk_scores',
  CURUSER:  'utbk_current_user',
};

// ===== STORAGE HELPERS =====
const db = {
  get: (key) => JSON.parse(localStorage.getItem(key) || 'null'),
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),

  getUsers:     () => db.get(K.USERS) || [],
  setUsers:     (v) => db.set(K.USERS, v),
  getSessions:  () => db.get(K.SESSIONS) || [],
  setSessions:  (v) => db.set(K.SESSIONS, v),
  getResponses: () => db.get(K.RESPONSES) || [],
  setResponses: (v) => db.set(K.RESPONSES, v),
  getAnalytics: () => db.get(K.ANALYTICS) || {},
  setAnalytics: (v) => db.set(K.ANALYTICS, v),
  getProgress:  () => db.get(K.PROGRESS) || {},
  setProgress:  (v) => db.set(K.PROGRESS, v),
  getScores:    () => db.get(K.SCORES) || {},
  setScores:    (v) => db.set(K.SCORES, v),
  getCurrentUser: () => db.get(K.CURUSER),
  setCurrentUser: (v) => db.set(K.CURUSER, v),
};

// ===== ROUTER =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
}

// ===== HELPERS =====
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function scoreColor(pct) {
  if (pct >= 75) return 'good';
  if (pct >= 50) return 'mid';
  return 'bad';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderKatex(container) {
  if (window.renderMathInElement) {
    renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
      ],
      throwOnError: false,
    });
  }
}

// ===== DATA LOADING =====
async function loadQuestions() {
  // When opened via file:// protocol, fetch is blocked by CORS.
  // data.js sets window.UTBK_QUESTIONS as a fallback.
  if (location.protocol === 'file:' || !CONFIG.DATA_URL) {
    if (window.UTBK_QUESTIONS) return window.UTBK_QUESTIONS;
    throw new Error('Data tidak ditemukan. Pastikan data.js ada di folder yang sama.');
  }
  try {
    const res = await fetch(CONFIG.DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    // Fall back to inline data if fetch fails
    if (window.UTBK_QUESTIONS) return window.UTBK_QUESTIONS;
    throw err;
  }
}

// ===== ADAPTIVE ALGORITHM =====
function getThemeDistribution(userId, missionNo) {
  const analytics = db.getAnalytics();
  const userAnalytics = analytics[userId] || {};
  const dist = {};

  // Baseline: equal distribution
  CONFIG.TEMAS.forEach(t => { dist[t] = CONFIG.SOAL_PER_TEMA_DEFAULT; });

  if (missionNo <= 1) return dist;

  let totalSlots = CONFIG.SOAL_PER_MISI;
  const removedTemas = [];

  // First pass: identify completed/weak themes
  CONFIG.TEMAS.forEach(tema => {
    const ta = userAnalytics[tema];
    if (!ta) return;
    const acc = ta.accuracy || 0;
    if (acc > CONFIG.THRESHOLD_SELESAI) {
      // Theme mastered → remove from rotation
      dist[tema] = 0;
      removedTemas.push(tema);
    } else if (acc < CONFIG.THRESHOLD_TAMBAH) {
      // Weak theme → add more slots
      dist[tema] = CONFIG.MAKS_SOAL_TEMA_LEMAH;
    }
  });

  // Redistribute freed slots from mastered themes to weak ones
  const freedSlots = removedTemas.reduce((sum, t) => sum + CONFIG.SOAL_PER_TEMA_DEFAULT, 0);
  const activeWeak = CONFIG.TEMAS.filter(t => {
    const ta = userAnalytics[t];
    return !removedTemas.includes(t) && ta && (ta.accuracy || 0) < CONFIG.THRESHOLD_TAMBAH;
  });

  if (activeWeak.length > 0 && freedSlots > 0) {
    const extra = Math.floor(freedSlots / activeWeak.length);
    activeWeak.forEach(t => { dist[t] = Math.min(dist[t] + extra, CONFIG.MAKS_SOAL_TEMA_LEMAH); });
  }

  // Normalize to SOAL_PER_MISI
  const currentTotal = Object.values(dist).reduce((a, b) => a + b, 0);
  if (currentTotal !== totalSlots) {
    const diff = totalSlots - currentTotal;
    const adjustable = CONFIG.TEMAS.filter(t => dist[t] > 0 && !removedTemas.includes(t));
    if (adjustable.length > 0) {
      dist[adjustable[0]] += diff;
    }
  }

  return dist;
}

function selectQuestionsForMission(missionNo, userId) {
  const dist = getThemeDistribution(userId, missionNo);
  const usedIds = getUsedQuestionIds(userId);
  const selected = [];

  CONFIG.TEMAS.forEach(tema => {
    const count = dist[tema] || 0;
    if (count === 0) return;

    // Candidates: active questions for this tema, prefer matching mission
    let candidates = state.allQuestions.filter(q =>
      q.tema === tema &&
      q.status === 'AKTIF' &&
      !usedIds.has(q.id)
    );

    // Sort: prefer questions with matching or adjacent mission level
    candidates.sort((a, b) => {
      const da = Math.abs((a.no_misi_default || 1) - missionNo);
      const db_ = Math.abs((b.no_misi_default || 1) - missionNo);
      if (da !== db_) return da - db_;
      return (a.level_kesulitan || 0) - (b.level_kesulitan || 0);
    });

    // If not enough unused questions, allow reuse
    if (candidates.length < count) {
      const all = state.allQuestions.filter(q => q.tema === tema && q.status === 'AKTIF');
      candidates = shuffle(all);
    }

    const picked = shuffle(candidates.slice(0, count * 2)).slice(0, count);
    selected.push(...picked);
  });

  return shuffle(selected);
}

function getUsedQuestionIds(userId) {
  const responses = db.getResponses().filter(r => r.userId === userId);
  return new Set(responses.map(r => r.questionId));
}

// ===== ANALYTICS UPDATE =====
function updateAnalytics(userId, responses) {
  const analytics = db.getAnalytics();
  if (!analytics[userId]) analytics[userId] = {};

  CONFIG.TEMAS.forEach(tema => {
    if (!analytics[userId][tema]) {
      analytics[userId][tema] = {
        totalAnswered: 0, totalCorrect: 0, accuracy: 0,
        subtopicsCovered: [], status: 'AKTIF'
      };
    }
    const ta = analytics[userId][tema];
    const temaResponses = responses.filter(r => r.tema === tema);

    temaResponses.forEach(r => {
      ta.totalAnswered++;
      if (r.isCorrect) ta.totalCorrect++;
      if (r.subTema && !ta.subtopicsCovered.includes(r.subTema)) {
        ta.subtopicsCovered.push(r.subTema);
      }
    });

    ta.accuracy = ta.totalAnswered > 0
      ? Math.round((ta.totalCorrect / ta.totalAnswered) * 100)
      : 0;
  });

  db.setAnalytics(analytics);
}

// ===== SCREENS =====

// ---- LOGIN ----
function renderLogin() {
  const users = db.getUsers();
  const select = document.getElementById('user-select');

  // Rebuild options
  select.innerHTML = '<option value="">-- Pilih pengguna --</option>';
  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.name;
    select.appendChild(opt);
  });
  const addOpt = document.createElement('option');
  addOpt.value = '__new__';
  addOpt.textContent = '+ Tambah nama baru';
  select.appendChild(addOpt);

  // Default date/time
  const now = new Date();
  document.getElementById('login-date').value = now.toISOString().slice(0, 10);
  document.getElementById('login-time').value = now.toTimeString().slice(0, 5);

  showScreen('login');
}

function handleLogin() {
  const selectVal = document.getElementById('user-select').value;
  const newName = document.getElementById('new-name').value.trim();

  let user;
  if (selectVal === '__new__') {
    if (!newName) { alert('Masukkan nama terlebih dahulu.'); return; }
    user = { id: 'U-' + uid(), name: newName, created: new Date().toISOString() };
    const users = db.getUsers();
    users.push(user);
    db.setUsers(users);
  } else if (selectVal) {
    user = db.getUsers().find(u => u.id === selectVal);
  } else {
    alert('Pilih atau masukkan nama terlebih dahulu.'); return;
  }

  if (!user) return;
  state.currentUser = user;
  db.setCurrentUser(user);
  renderDashboard();
}

// ---- DASHBOARD ----
function renderDashboard() {
  document.getElementById('dashboard-username').textContent = state.currentUser.name;
  renderMissionGrid();
  renderScoreHistory();
  checkResumeBanner();
  showScreen('dashboard');
}

function getHighestCompletedMission(userId) {
  const scores = db.getScores();
  const userScores = scores[userId] || {};
  let highest = 0;
  Object.keys(userScores).forEach(m => { if (parseInt(m) > highest) highest = parseInt(m); });
  return highest;
}

function getMissionStatus(userId, missionNo) {
  const scores = db.getScores();
  const userScores = scores[userId] || {};
  if (userScores[missionNo]) return 'completed';
  const highest = getHighestCompletedMission(userId);
  if (missionNo === highest + 1) return 'available';
  if (missionNo <= highest) return 'completed';
  return 'locked';
}

function renderMissionGrid() {
  const grid = document.getElementById('mission-grid');
  const userId = state.currentUser.id;
  const scores = db.getScores();
  const userScores = scores[userId] || {};

  grid.innerHTML = '';
  for (let m = 1; m <= CONFIG.TOTAL_MISI; m++) {
    const status = getMissionStatus(userId, m);
    const score = userScores[m];
    const card = document.createElement('div');
    card.className = 'mission-card' + (status === 'locked' ? ' locked' : '') +
                     (status === 'completed' ? ' completed' : '') +
                     (status === 'available' ? ' active-mission' : '');

    let scoreHtml;
    if (score) {
      const val = Math.round(score.total);
      scoreHtml = `<div class="mission-score ${scoreColor(val) === 'good' ? '' : scoreColor(val)}">${val}</div>`;
    } else {
      scoreHtml = `<div class="mission-score no-score">${status === 'locked' ? '🔒 Terkunci' : 'Belum dikerjakan'}</div>`;
    }

    card.innerHTML = `
      <div>
        <div class="mission-card-top">
          <span class="mission-num">Misi ${m}</span>
          <span class="mission-badge">${status === 'completed' ? '✅' : status === 'locked' ? '🔒' : '▶️'}</span>
        </div>
        <div class="mission-title">${CONFIG.MISI_LABEL[m - 1]}</div>
        <div class="mission-stars">${CONFIG.MISI_STARS[m - 1]}</div>
      </div>
      ${scoreHtml}
    `;

    if (status !== 'locked') {
      card.addEventListener('click', () => showPreview(m));
    }
    grid.appendChild(card);
  }
}

function renderScoreHistory() {
  const container = document.getElementById('score-history');
  const userId = state.currentUser.id;
  const scores = db.getScores();
  const userScores = scores[userId] || {};
  const entries = Object.entries(userScores).sort((a, b) => parseInt(b[0]) - parseInt(a[0]));

  if (entries.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>Belum ada nilai. Mulai misi pertama!</p></div>`;
    return;
  }

  container.innerHTML = entries.map(([mNo, s]) => {
    const bars = CONFIG.TEMAS.map(t => {
      const acc = s.themes?.[t] ?? null;
      const cls = acc === null ? '' : acc >= 75 ? 'good' : acc >= 50 ? 'mid' : 'bad';
      const width = acc ?? 0;
      return `<div class="score-bar-item">
        <div class="score-bar-label">${t.slice(0,3)}</div>
        <div class="score-bar-track"><div class="score-bar-fill ${cls}" style="width:${width}%"></div></div>
      </div>`;
    }).join('');

    return `<div class="score-row">
      <div class="score-row-num">${mNo}</div>
      <div class="score-row-info">
        <div class="score-row-title">Misi ${mNo} — ${CONFIG.MISI_LABEL[parseInt(mNo) - 1]}</div>
        <div class="score-row-date">${formatDate(s.date)}</div>
        <div class="score-bars">${bars}</div>
      </div>
      <div class="score-row-val">${Math.round(s.total)}</div>
    </div>`;
  }).join('');
}

function checkResumeBanner() {
  const progress = db.getProgress();
  const userId = state.currentUser.id;
  const userProgress = progress[userId];
  const banner = document.getElementById('resume-banner');

  if (userProgress && userProgress.activeMission && userProgress.missionQuestions?.length) {
    banner.classList.remove('hidden');
    document.getElementById('btn-resume').onclick = () => resumeMission(userProgress);
  } else {
    banner.classList.add('hidden');
  }
}

// ---- PREVIEW ----
function showPreview(missionNo) {
  state.currentMission = missionNo;
  const userId = state.currentUser.id;
  const analytics = db.getAnalytics();
  const userAnalytics = analytics[userId] || {};
  const dist = getThemeDistribution(userId, missionNo);
  const scores = db.getScores();
  const lastScore = (scores[userId] || {})[missionNo];

  const totalQ = Object.values(dist).reduce((a, b) => a + b, 0);
  const estimatedMin = Math.ceil(totalQ * 1.5);

  const themeChips = CONFIG.TEMAS.map(t => {
    const count = dist[t] || 0;
    if (count === 0) return '';
    const acc = userAnalytics[t]?.accuracy;
    const isWeak = acc !== undefined && acc < CONFIG.THRESHOLD_TAMBAH;
    return `<div class="theme-chip ${isWeak ? 'weak' : ''}">
      ${CONFIG.TEMA_EMOJI[t]} ${t}
      <span class="chip-count">${count}</span>
    </div>`;
  }).join('');

  let lastScoreHtml = '';
  if (lastScore) {
    const val = Math.round(lastScore.total);
    const cls = val >= 75 ? '' : val >= 50 ? 'mid' : 'bad';
    lastScoreHtml = `
      <div class="preview-last-score">
        <h4>📈 Nilai Terakhir</h4>
        <div class="score-big ${cls}">${val}</div>
        <p style="font-size:13px;color:var(--text-muted);margin-top:4px">${formatDate(lastScore.date)}</p>
      </div>`;
  }

  document.getElementById('preview-content').innerHTML = `
    <div class="preview-hero">
      <div class="stars">${CONFIG.MISI_STARS[missionNo - 1]}</div>
      <h2>Misi ${missionNo}</h2>
      <p class="label">${CONFIG.MISI_LABEL[missionNo - 1]}</p>
    </div>
    <div class="preview-stats">
      <div class="preview-stat">
        <div class="preview-stat-val">${totalQ}</div>
        <div class="preview-stat-label">Soal</div>
      </div>
      <div class="preview-stat">
        <div class="preview-stat-val">${estimatedMin}</div>
        <div class="preview-stat-label">Menit est.</div>
      </div>
      <div class="preview-stat">
        <div class="preview-stat-val">${CONFIG.TEMAS.filter(t => dist[t] > 0).length}</div>
        <div class="preview-stat-label">Tema aktif</div>
      </div>
    </div>
    <div class="preview-themes">
      <h4>Distribusi Soal per Tema</h4>
      <div class="theme-chips">${themeChips || '<span style="color:var(--text-muted);font-size:14px">Semua tema telah dikuasai! 🎉</span>'}</div>
    </div>
    ${lastScoreHtml}
    <button id="btn-start-mission" class="btn btn-primary btn-full">🚀 Mulai Misi ${missionNo}</button>
    <div style="height:8px"></div>
  `;

  document.getElementById('btn-start-mission').addEventListener('click', () => startMission(missionNo));
  showScreen('preview');
}

// ---- MISSION ----
function startMission(missionNo) {
  const userId = state.currentUser.id;

  // Check if there's saved progress for this mission
  const progress = db.getProgress();
  const userProgress = progress[userId];
  if (userProgress?.activeMission === missionNo && userProgress?.missionQuestions?.length) {
    if (confirm('Kamu punya sesi misi ini yang belum selesai. Lanjutkan?')) {
      resumeMission(userProgress);
      return;
    }
  }

  const questions = selectQuestionsForMission(missionNo, userId);

  if (questions.length === 0) {
    alert('Tidak ada soal tersedia untuk misi ini. Tambahkan lebih banyak soal ke bank soal.');
    return;
  }

  const session = {
    id: 'SE-' + uid(),
    userId,
    missionNo,
    dateStart: new Date().toISOString(),
    status: 'IN_PROGRESS',
    totalQuestions: questions.length,
  };

  state.currentSession = session;
  state.currentMission = missionNo;
  state.missionQuestions = questions;
  state.currentQuestionIdx = 0;
  state.sessionResponses = [];

  // Save progress
  saveProgress(userId, missionNo, session.id, 0, questions.map(q => q.id));

  // Save session
  const sessions = db.getSessions();
  sessions.push(session);
  db.setSessions(sessions);

  startTimer();
  renderQuestion();
  showScreen('question');
}

function resumeMission(userProgress) {
  const userId = state.currentUser.id;
  const { activeMission, activeSessionId, lastQuestionIndex, missionQuestions: qIds } = userProgress;

  // Reconstruct question objects
  const questions = qIds.map(id => state.allQuestions.find(q => q.id === id)).filter(Boolean);
  const session = db.getSessions().find(s => s.id === activeSessionId);

  if (!questions.length || !session) {
    clearProgress(userId);
    renderDashboard();
    return;
  }

  // Load already-answered responses for this session
  const existing = db.getResponses().filter(r => r.sessionId === activeSessionId);

  state.currentSession = session;
  state.currentMission = activeMission;
  state.missionQuestions = questions;
  state.currentQuestionIdx = Math.min(lastQuestionIndex, questions.length - 1);
  state.sessionResponses = existing;

  startTimer();
  renderQuestion();
  showScreen('question');
}

// ---- QUESTION ----
function renderQuestion() {
  const q = state.missionQuestions[state.currentQuestionIdx];
  const total = state.missionQuestions.length;
  const idx = state.currentQuestionIdx;

  state.selectedOption = null;
  state.submitted = false;

  // Header
  document.getElementById('q-mission-label').textContent = `Misi ${state.currentMission}`;
  document.getElementById('q-tema-label').textContent = `${CONFIG.TEMA_EMOJI[q.tema] || ''} ${q.tema}`;
  document.getElementById('q-progress-label').textContent = `Soal ${idx + 1} dari ${total}`;

  const pct = Math.round(((idx + 1) / total) * 100);
  document.getElementById('progress-bar').style.width = pct + '%';

  // Buttons
  const btnSubmit = document.getElementById('btn-submit');
  const btnNext = document.getElementById('btn-next');
  btnSubmit.classList.remove('hidden');
  btnNext.classList.add('hidden');
  btnSubmit.disabled = true;

  // Options
  const options = [];
  ['a', 'b', 'c', 'd', 'e'].forEach(letter => {
    const val = q['opsi_' + letter];
    if (val) options.push({ letter: letter.toUpperCase(), text: val });
  });

  const optionsHtml = options.map(opt => `
    <button class="option-btn" data-letter="${opt.letter}" type="button">
      <span class="option-letter">${opt.letter}</span>
      <span class="option-text">${opt.text}</span>
    </button>
  `).join('');

  const materiHtml = q.materi_pengantar ? `
    <div class="materi-accordion">
      <button class="materi-toggle" type="button">
        <span>📖 Materi Pengantar — ${q.sub_tema}</span>
        <span class="arrow">▼</span>
      </button>
      <div class="materi-body">${q.materi_pengantar}</div>
    </div>
  ` : '';

  document.getElementById('question-body').innerHTML = `
    ${materiHtml}
    <div class="question-text">${q.pertanyaan}</div>
    <div class="options-list">${optionsHtml}</div>
    <div id="feedback-area"></div>
  `;

  // Materi accordion toggle
  const toggle = document.querySelector('.materi-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('open');
      document.querySelector('.materi-body').classList.toggle('open');
    });
  }

  // Option selection
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.submitted) return;
      document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedOption = btn.dataset.letter;
      btnSubmit.disabled = false;
    });
  });

  // KaTeX
  if (q.ada_latex) {
    renderKatex(document.getElementById('question-body'));
  }
}

function submitAnswer() {
  if (!state.selectedOption || state.submitted) return;
  state.submitted = true;

  const q = state.missionQuestions[state.currentQuestionIdx];
  const correct = q.kunci_jawaban.toUpperCase();
  const chosen = state.selectedOption.toUpperCase();
  const isCorrect = chosen === correct;

  // Style options
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.disabled = true;
    const letter = btn.dataset.letter.toUpperCase();
    if (letter === correct) btn.classList.add('correct');
    else if (letter === chosen && !isCorrect) btn.classList.add('wrong');
    btn.classList.remove('selected');
  });

  // Feedback
  const feedbackArea = document.getElementById('feedback-area');
  feedbackArea.innerHTML = `
    <div class="feedback-box ${isCorrect ? 'feedback-correct' : 'feedback-wrong'}">
      <div class="feedback-title">${isCorrect ? '✅ Jawaban Benar!' : `❌ Jawaban Salah — Kunci: ${correct}`}</div>
      <div>${q.penjelasan_jawaban}</div>
    </div>
  `;

  if (q.ada_latex) renderKatex(feedbackArea);

  // Save response
  const response = {
    id: 'R-' + uid(),
    sessionId: state.currentSession.id,
    userId: state.currentUser.id,
    missionNo: state.currentMission,
    questionId: q.id,
    tema: q.tema,
    subTema: q.sub_tema,
    questionOrder: state.currentQuestionIdx + 1,
    userAnswer: chosen,
    correctAnswer: correct,
    isCorrect,
    submitTime: new Date().toISOString(),
  };
  state.sessionResponses.push(response);

  const responses = db.getResponses();
  responses.push(response);
  db.setResponses(responses);

  // Update progress
  saveProgress(
    state.currentUser.id,
    state.currentMission,
    state.currentSession.id,
    state.currentQuestionIdx + 1,
    state.missionQuestions.map(q => q.id)
  );

  // Toggle buttons
  document.getElementById('btn-submit').classList.add('hidden');
  const btnNext = document.getElementById('btn-next');
  btnNext.classList.remove('hidden');

  const isLast = state.currentQuestionIdx === state.missionQuestions.length - 1;
  btnNext.textContent = isLast ? 'Lihat Hasil Misi 🏁' : 'Soal Berikutnya →';
  btnNext.onclick = isLast ? finishMission : nextQuestion;

  // Scroll feedback into view
  feedbackArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function nextQuestion() {
  state.currentQuestionIdx++;
  renderQuestion();
  document.getElementById('question-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- TIMER ----
function startTimer() {
  state.timerSeconds = 0;
  clearInterval(state.timerInterval);
  updateTimerDisplay();
  state.timerInterval = setInterval(() => {
    state.timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerInterval);
}

function updateTimerDisplay() {
  const m = String(Math.floor(state.timerSeconds / 60)).padStart(2, '0');
  const s = String(state.timerSeconds % 60).padStart(2, '0');
  const el = document.getElementById('q-timer');
  if (el) el.textContent = `${m}:${s}`;
}

// ---- FINISH MISSION ----
function finishMission() {
  stopTimer();

  const userId = state.currentUser.id;
  const missionNo = state.currentMission;
  const responses = state.sessionResponses;

  // Calculate scores
  const totalCorrect = responses.filter(r => r.isCorrect).length;
  const totalQ = responses.length;
  const finalScore = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;

  const themeScores = {};
  CONFIG.TEMAS.forEach(tema => {
    const temaRes = responses.filter(r => r.tema === tema);
    if (temaRes.length === 0) { themeScores[tema] = null; return; }
    const correct = temaRes.filter(r => r.isCorrect).length;
    themeScores[tema] = Math.round((correct / temaRes.length) * 100);
  });

  // Save score
  const scores = db.getScores();
  if (!scores[userId]) scores[userId] = {};
  scores[userId][missionNo] = {
    total: finalScore,
    themes: themeScores,
    correct: totalCorrect,
    total_q: totalQ,
    date: new Date().toISOString(),
    duration: state.timerSeconds,
  };
  db.setScores(scores);

  // Update analytics
  updateAnalytics(userId, responses);

  // Update session
  const sessions = db.getSessions();
  const sIdx = sessions.findIndex(s => s.id === state.currentSession.id);
  if (sIdx >= 0) {
    sessions[sIdx].status = 'COMPLETED';
    sessions[sIdx].dateEnd = new Date().toISOString();
    sessions[sIdx].finalScore = finalScore;
    sessions[sIdx].totalCorrect = totalCorrect;
    db.setSessions(sessions);
  }

  // Clear progress
  clearProgress(userId);

  renderResult(finalScore, themeScores, totalCorrect, totalQ, missionNo);
  showScreen('result');
}

// ---- RESULT ----
function renderResult(score, themeScores, correct, total, missionNo) {
  const userId = state.currentUser.id;
  const analytics = db.getAnalytics();
  const userAnalytics = analytics[userId] || {};

  const scoreClass = score >= 75 ? 'good' : score >= 50 ? 'mid' : 'bad';

  const themeBreakdown = CONFIG.TEMAS.map(tema => {
    const acc = themeScores[tema];
    if (acc === null) return '';
    const cls = scoreColor(acc);
    return `
      <div class="tema-row">
        <div class="tema-row-top">
          <span class="tema-name">${CONFIG.TEMA_EMOJI[tema]} ${CONFIG.TEMA_NAMES[tema]}</span>
          <span class="tema-score ${cls}">${acc}%</span>
        </div>
        <div class="tema-track">
          <div class="tema-fill ${cls}" style="width:${acc}%"></div>
        </div>
      </div>
    `;
  }).join('');

  // Analysis
  const weak = CONFIG.TEMAS.filter(t => themeScores[t] !== null && themeScores[t] < CONFIG.THRESHOLD_TAMBAH);
  const strong = CONFIG.TEMAS.filter(t => themeScores[t] !== null && themeScores[t] > CONFIG.THRESHOLD_SELESAI);
  const analysisItems = [];

  if (weak.length > 0) {
    weak.forEach(t => {
      analysisItems.push(`<div class="analysis-item">❗ <span><b>${CONFIG.TEMA_NAMES[t]}</b> perlu lebih banyak latihan (${themeScores[t]}%). Misi berikutnya akan menambah soal tema ini.</span></div>`);
    });
  }
  if (strong.length > 0) {
    strong.forEach(t => {
      analysisItems.push(`<div class="analysis-item">✅ <span><b>${CONFIG.TEMA_NAMES[t]}</b> sudah dikuasai (${themeScores[t]}%). Tema ini mungkin dikurangi di misi berikutnya.</span></div>`);
    });
  }
  if (analysisItems.length === 0) {
    analysisItems.push(`<div class="analysis-item">📊 <span>Performa seimbang di semua tema. Terus berlatih!</span></div>`);
  }

  const isLastMission = missionNo >= CONFIG.TOTAL_MISI;

  document.getElementById('result-content').innerHTML = `
    <div class="result-hero">
      <div class="result-mission">Misi ${missionNo} — ${CONFIG.MISI_LABEL[missionNo - 1]}</div>
      <div class="result-score-big">${score}</div>
      <div class="result-score-label">${correct} dari ${total} jawaban benar</div>
    </div>

    <div class="result-breakdown">
      <h4>📊 Skor per Tema</h4>
      ${themeBreakdown}
    </div>

    <div class="result-analysis">
      <h4>🔍 Analisis Belajar</h4>
      ${analysisItems.join('')}
    </div>

    <div class="result-actions">
      ${!isLastMission
        ? `<button class="btn btn-primary btn-full" id="btn-next-mission">Misi Berikutnya (${missionNo + 1}) →</button>`
        : `<div class="card text-center" style="padding:20px"><div style="font-size:32px">🏆</div><p style="font-weight:700;margin-top:8px">Selamat! Semua misi selesai!</p></div>`
      }
      <button class="btn btn-secondary btn-full" id="btn-to-dashboard">← Kembali ke Dashboard</button>
    </div>
    <div style="height:8px"></div>
  `;

  document.getElementById('btn-to-dashboard').addEventListener('click', () => {
    state.currentMission = null;
    renderDashboard();
  });

  if (!isLastMission) {
    document.getElementById('btn-next-mission').addEventListener('click', () => {
      showPreview(missionNo + 1);
    });
  }
}

// ---- PROGRESS ----
function saveProgress(userId, missionNo, sessionId, questionIdx, questionIds) {
  const progress = db.getProgress();
  progress[userId] = {
    activeMission: missionNo,
    activeSessionId: sessionId,
    lastQuestionIndex: questionIdx,
    missionQuestions: questionIds,
    savedAt: new Date().toISOString(),
  };
  db.setProgress(progress);
}

function clearProgress(userId) {
  const progress = db.getProgress();
  delete progress[userId];
  db.setProgress(progress);
}

// ===== INIT =====
async function init() {
  // Wire up static event listeners
  document.getElementById('user-select').addEventListener('change', e => {
    const newNameGroup = document.getElementById('new-name-group');
    if (e.target.value === '__new__') newNameGroup.classList.remove('hidden');
    else newNameGroup.classList.add('hidden');
  });

  document.getElementById('btn-login').addEventListener('click', handleLogin);
  document.getElementById('btn-logout').addEventListener('click', () => {
    state.currentUser = null;
    db.setCurrentUser(null);
    stopTimer();
    renderLogin();
  });
  document.getElementById('btn-preview-back').addEventListener('click', () => {
    renderDashboard();
  });
  document.getElementById('btn-submit').addEventListener('click', submitAnswer);

  // Load questions
  try {
    state.allQuestions = await loadQuestions();
  } catch (err) {
    const errEl = document.getElementById('loading-error');
    errEl.textContent = `Gagal memuat soal: ${err.message}. Pastikan soal_utbk_baru.json tersedia.`;
    errEl.classList.remove('hidden');
    return;
  }

  // Check for returning user
  const savedUser = db.getCurrentUser();
  if (savedUser) {
    // Verify user still exists in db
    const users = db.getUsers();
    const found = users.find(u => u.id === savedUser.id);
    if (found) {
      state.currentUser = found;
      renderDashboard();
      return;
    }
  }

  renderLogin();
}

// Kick off
init();
