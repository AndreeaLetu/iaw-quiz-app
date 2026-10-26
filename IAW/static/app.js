let token = null;
let currentUser = null;

let quizId = null;
let questions = [];
let answers = [];
let times = [];
let current = 0;
let timeLimitMs = 15000;
let questionStart = 0;
let timerId = null;
let retakeScoreId = null;

const DIFFICULTY_LABELS = { easy: "Easy", medium: "Medium", hard: "Hard" };
const LETTERS = ["A", "B", "C", "D", "E", "F"];
const RING_LENGTH = 2 * Math.PI * 52;

const $ = (id) => document.getElementById(id);

function showMessage(text) {
  const box = $("message");
  box.textContent = text;
  box.hidden = false;
}

function clearMessage() {
  $("message").hidden = true;
}

function saveSession() {
  try {
    localStorage.setItem("quiz_token", token);
    localStorage.setItem("quiz_user", JSON.stringify(currentUser));
  } catch (e) {}
}

function clearSession() {
  try {
    localStorage.removeItem("quiz_token");
    localStorage.removeItem("quiz_user");
  } catch (e) {}
}

function loadSession() {
  try {
    const savedToken = localStorage.getItem("quiz_token");
    const savedUser = localStorage.getItem("quiz_user");
    if (savedToken && savedUser) {
      token = savedToken;
      currentUser = JSON.parse(savedUser);
    }
  } catch (e) {
    token = null;
    currentUser = null;
  }
}

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers);
  if (token) headers["Authorization"] = "Bearer " + token;

  let response;
  try {
    response = await fetch(path, Object.assign({}, options, { headers: headers }));
  } catch (e) {
    throw new Error("Cannot reach the server.");
  }
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    let detail = data && data.detail;
    if (Array.isArray(detail)) detail = "Invalid data sent to the server.";
    if (response.status === 401 && token) {
      logout();
      throw new Error(detail || "Your session has expired. Please log in again.");
    }
    throw new Error(detail || "Error " + response.status);
  }
  return data;
}

function showSection(name) {
  if (name !== "quiz") stopTimer();
  document.body.classList.toggle("guest", name === "auth");
  $("auth").hidden = name !== "auth";
  $("setup").hidden = name !== "setup";
  $("quiz").hidden = name !== "quiz";
  $("result").hidden = name !== "result";
  $("user-bar").hidden = !currentUser;
}

function showAuthPanel(name) {
  $("login-panel").hidden = name !== "login";
  $("register-panel").hidden = name !== "register";
}

function showApp() {
  $("user-name").textContent = currentUser.username;
  showSection("setup");
  loadScores();
}

async function login(username, password) {
  const data = await api("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: username, password: password }),
  });
  token = data.access_token;
  currentUser = { id: data.user_id, username: data.username };
  saveSession();
  showApp();
}

async function onLoginSubmit(event) {
  event.preventDefault();
  clearMessage();
  try {
    await login($("login-username").value.trim(), $("login-password").value);
    $("login-password").value = "";
  } catch (e) {
    showMessage(e.message);
  }
}

async function onRegisterSubmit(event) {
  event.preventDefault();
  clearMessage();

  const username = $("register-username").value.trim();
  const password = $("register-password").value;
  if (password !== $("register-password2").value) {
    showMessage("Passwords do not match.");
    return;
  }

  try {
    await api("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password }),
    });
    await login(username, password);
    $("register-password").value = "";
    $("register-password2").value = "";
  } catch (e) {
    showMessage(e.message);
  }
}

function logout() {
  stopTimer();
  token = null;
  currentUser = null;
  clearSession();
  quizId = null;
  questions = [];
  answers = [];
  times = [];
  retakeScoreId = null;
  showSection("auth");
  showAuthPanel("login");
  loadScores();
}

async function loadCategories() {
  try {
    const categories = await api("/api/categories");
    for (const c of categories) {
      const option = document.createElement("option");
      option.value = c.id;
      option.textContent = c.name;
      $("category").appendChild(option);
    }
  } catch (e) {
    showMessage(e.message);
  }
}

function setRing(fraction, low) {
  const ring = $("timer-ring");
  ring.style.strokeDasharray = RING_LENGTH;
  ring.style.strokeDashoffset = RING_LENGTH * (1 - fraction);
  ring.classList.toggle("low", low);
  $("timer-text").classList.toggle("low", low);
}

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer() {
  stopTimer();
  questionStart = Date.now();
  setRing(1, false);
  $("timer-text").textContent = Math.ceil(timeLimitMs / 1000);
  $("timer-note").textContent = "";
  timerId = setInterval(tick, 100);
}

function tick() {
  const left = timeLimitMs - (Date.now() - questionStart);
  if (left <= 0) {
    onTimeout();
    return;
  }
  setRing(left / timeLimitMs, left <= 5000);
  $("timer-text").textContent = Math.ceil(left / 1000);
}

function lockOptions() {
  for (const b of $("options").children) b.disabled = true;
}

function onTimeout() {
  stopTimer();
  answers[current] = -1;
  times[current] = timeLimitMs;
  lockOptions();
  setRing(0, true);
  $("timer-text").textContent = "0";
  $("timer-note").textContent = "Time's up.";
  $("next-btn").disabled = false;
}

function beginQuiz(data, scoreId, infoText) {
  quizId = data.quiz_id;
  questions = data.questions;
  timeLimitMs = data.time_limit_ms || 15000;
  answers = [];
  times = [];
  current = 0;
  retakeScoreId = scoreId;

  const info = $("retake-info");
  info.textContent = infoText || "";
  info.hidden = !infoText;

  showSection("quiz");
  showQuestion();
}

async function startQuiz(event) {
  event.preventDefault();
  clearMessage();

  const body = { amount: Number($("amount").value) };
  if ($("difficulty").value) body.difficulty = $("difficulty").value;
  if ($("category").value) body.category = Number($("category").value);

  const button = $("start-btn");
  button.disabled = true;
  try {
    const data = await api("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    beginQuiz(data, null, null);
  } catch (e) {
    showMessage(e.message);
  } finally {
    button.disabled = false;
  }
}

async function startRetake(score) {
  clearMessage();

  const body = { amount: score.total };
  if (score.difficulty) body.difficulty = score.difficulty;

  try {
    const data = await api("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    beginQuiz(data, score.id, "You are retaking this quiz. Your leaderboard score will be replaced.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    showMessage(e.message);
  }
}

function showQuestion() {
  const q = questions[current];
  $("progress").textContent = "Question " + (current + 1) + " of " + questions.length;
  $("question-text").textContent = q.question;
  $("question-category").textContent = q.category;

  const segments = $("segments");
  segments.replaceChildren();
  questions.forEach((_, i) => {
    const seg = document.createElement("span");
    seg.className = "seg" + (i < current ? " done" : i === current ? " now" : "");
    segments.appendChild(seg);
  });

  const container = $("options");
  container.replaceChildren();
  q.options.forEach((text, index) => {
    const button = document.createElement("button");
    button.type = "button";

    const letter = document.createElement("span");
    letter.className = "letter";
    letter.textContent = LETTERS[index] || String(index + 1);

    const label = document.createElement("span");
    label.textContent = text;

    button.appendChild(letter);
    button.appendChild(label);
    button.addEventListener("click", () => selectOption(index, button));
    container.appendChild(button);
  });

  const isLast = current === questions.length - 1;
  $("next-btn").textContent = isLast ? "Finish" : "Next";
  $("next-btn").disabled = true;

  startTimer();
}

function selectOption(index, button) {
  if (timerId === null) return;
  stopTimer();
  answers[current] = index;
  times[current] = Date.now() - questionStart;
  button.classList.add("selected");
  lockOptions();
  $("next-btn").disabled = false;
}

function nextQuestion() {
  stopTimer();
  if (current < questions.length - 1) {
    current += 1;
    showQuestion();
  } else {
    submitQuiz();
  }
}

async function submitQuiz() {
  clearMessage();
  $("next-btn").disabled = true;
  try {
    let result;
    if (retakeScoreId === null) {
      result = await api("/api/quizzes/" + quizId + "/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: answers, times_ms: times }),
      });
    } else {
      result = await api("/api/scores/" + retakeScoreId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiz_id: quizId, answers: answers, times_ms: times }),
      });
      retakeScoreId = null;
    }
    showResult(result);
    loadScores();
  } catch (e) {
    showMessage(e.message);
    $("next-btn").disabled = false;
  }
}

function showResult(result) {
  $("result-score").textContent = result.score + " / " + result.total;
  $("result-points").textContent = result.points + " points";

  const list = $("result-details");
  list.replaceChildren();
  for (const d of result.details) {
    const li = document.createElement("li");
    li.className = d.is_correct ? "right" : "missed";

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = d.is_correct ? "✓" : "✕";
    li.appendChild(mark);

    const body = document.createElement("div");

    const question = document.createElement("div");
    question.className = "q";
    question.textContent = d.question;
    body.appendChild(question);

    const answer = document.createElement("div");
    answer.className = d.is_correct ? "ok" : "wrong";
    answer.textContent = "Your answer: " + (d.your_answer ?? "no answer");
    body.appendChild(answer);

    if (!d.is_correct) {
      const correct = document.createElement("div");
      correct.className = "ok";
      correct.textContent = "Correct answer: " + d.correct_answer;
      body.appendChild(correct);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const time = document.createElement("span");
    time.textContent = (d.time_ms / 1000).toFixed(1) + " s";
    const pts = document.createElement("span");
    pts.textContent = "+" + d.points + " points";
    meta.appendChild(time);
    meta.appendChild(pts);
    body.appendChild(meta);

    li.appendChild(body);
    list.appendChild(li);
  }
  showSection("result");
}

function newQuiz() {
  clearMessage();
  retakeScoreId = null;
  showSection("setup");
}

async function loadScores() {
  try {
    const scores = await api("/api/scores");
    const list = $("scores-list");
    list.replaceChildren();

    $("empty-scores").hidden = scores.length > 0;
    list.hidden = scores.length === 0;

    scores.forEach((s, i) => {
      const isOwn = currentUser !== null && s.user_id === currentUser.id;

      const li = document.createElement("li");
      li.className = "score-row" + (isOwn ? " own" : "");

      const rank = document.createElement("span");
      rank.className = "rank" + (i < 3 ? " rank-" + (i + 1) : "");
      rank.textContent = i + 1;
      li.appendChild(rank);

      const who = document.createElement("div");

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = s.player;
      who.appendChild(name);

      const sub = document.createElement("div");
      sub.className = "sub";
      const correct = document.createElement("span");
      correct.textContent = s.score + " of " + s.total + " correct";
      const difficulty = document.createElement("span");
      difficulty.textContent = DIFFICULTY_LABELS[s.difficulty] || "Any difficulty";
      sub.appendChild(correct);
      sub.appendChild(difficulty);
      who.appendChild(sub);

      if (isOwn) {
        const actions = document.createElement("div");
        actions.className = "row-actions";

        const retake = document.createElement("button");
        retake.type = "button";
        retake.className = "small";
        retake.textContent = "Retake";
        retake.addEventListener("click", () => startRetake(s));
        actions.appendChild(retake);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "small danger";
        del.textContent = "Delete";
        del.addEventListener("click", () => deleteScore(s.id));
        actions.appendChild(del);

        who.appendChild(actions);
      }
      li.appendChild(who);

      const pts = document.createElement("div");
      pts.className = "pts";
      pts.textContent = s.points;
      const label = document.createElement("small");
      label.textContent = "points";
      pts.appendChild(label);
      li.appendChild(pts);

      list.appendChild(li);
    });
  } catch (e) {
    showMessage(e.message);
  }
}

async function deleteScore(id) {
  clearMessage();
  try {
    await api("/api/scores/" + id, { method: "DELETE" });
    loadScores();
  } catch (e) {
    showMessage(e.message);
  }
}

async function init() {
  $("login-form").addEventListener("submit", onLoginSubmit);
  $("register-form").addEventListener("submit", onRegisterSubmit);
  $("show-register").addEventListener("click", () => {
    clearMessage();
    showAuthPanel("register");
  });
  $("show-login").addEventListener("click", () => {
    clearMessage();
    showAuthPanel("login");
  });
  $("logout-btn").addEventListener("click", () => {
    clearMessage();
    logout();
  });
  $("setup-form").addEventListener("submit", startQuiz);
  $("next-btn").addEventListener("click", nextQuestion);
  $("again-btn").addEventListener("click", newQuiz);

  loadCategories();
  loadSession();

  if (token) {
    try {
      const me = await api("/api/auth/me");
      currentUser = { id: me.id, username: me.username };
      showApp();
      return;
    } catch (e) {
      token = null;
      currentUser = null;
      showMessage(e.message);
    }
  }
  showSection("auth");
  loadScores();
}

init();