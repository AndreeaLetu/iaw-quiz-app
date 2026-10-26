let quizId = null;
let questions = [];
let answers = [];
let times = [];
let current = 0;
let timeLimitMs = 15000;
let questionStart = 0;
let timerId = null;
let retakeScoreId = null;

const DIFFICULTY_LABELS = { easy: "Ușor", medium: "Mediu", hard: "Greu" };

const $ = (id) => document.getElementById(id);

function showMessage(text) {
  const box = $("message");
  box.textContent = text;
  box.hidden = false;
}

function clearMessage() {
  $("message").hidden = true;
}

async function api(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (e) {
    throw new Error("Nu se poate contacta serverul.");
  }
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    let detail = data && data.detail;
    if (Array.isArray(detail)) detail = "Date invalide trimise către server.";
    throw new Error(detail || "Eroare " + response.status);
  }
  return data;
}

function showSection(name) {
  if (name !== "quiz") stopTimer();
  $("setup").hidden = name !== "setup";
  $("quiz").hidden = name !== "quiz";
  $("result").hidden = name !== "result";
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

function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer() {
  stopTimer();
  questionStart = Date.now();
  $("timer-bar").style.width = "100%";
  $("timer-bar").classList.remove("low");
  $("timer-text").textContent = Math.ceil(timeLimitMs / 1000) + " s";
  timerId = setInterval(tick, 100);
}

function tick() {
  const left = timeLimitMs - (Date.now() - questionStart);
  if (left <= 0) {
    onTimeout();
    return;
  }
  $("timer-bar").style.width = (left / timeLimitMs) * 100 + "%";
  $("timer-bar").classList.toggle("low", left <= 5000);
  $("timer-text").textContent = Math.ceil(left / 1000) + " s";
}

function lockOptions() {
  for (const b of $("options").children) b.disabled = true;
}

function onTimeout() {
  stopTimer();
  answers[current] = -1;
  times[current] = timeLimitMs;
  lockOptions();
  $("timer-bar").style.width = "0%";
  $("timer-text").textContent = "Timpul a expirat";
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
    beginQuiz(
      data,
      score.id,
      "Reiei quiz-ul pentru " + score.player + ". Scorul din clasament va fi înlocuit."
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    showMessage(e.message);
  }
}

function showQuestion() {
  const q = questions[current];
  $("progress").textContent = "Întrebarea " + (current + 1) + " din " + questions.length;
  $("question-text").textContent = q.question;
  $("question-category").textContent = q.category;

  const container = $("options");
  container.replaceChildren();
  q.options.forEach((text, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", () => selectOption(index, button));
    container.appendChild(button);
  });

  const isLast = current === questions.length - 1;
  $("next-btn").textContent = isLast ? "Termină" : "Următoarea";
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
        body: JSON.stringify({
          player: $("player").value.trim(),
          answers: answers,
          times_ms: times,
        }),
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
  $("result-title").textContent =
    "Scor: " + result.score + " / " + result.total + " · " + result.points + " puncte";

  const list = $("result-details");
  list.replaceChildren();
  for (const d of result.details) {
    const li = document.createElement("li");

    const question = document.createElement("div");
    question.className = "q";
    question.textContent = d.question;
    li.appendChild(question);

    const answer = document.createElement("div");
    answer.className = d.is_correct ? "ok" : "wrong";
    answer.textContent = "Răspunsul tău: " + (d.your_answer ?? "(fără răspuns)");
    li.appendChild(answer);

    if (!d.is_correct) {
      const correct = document.createElement("div");
      correct.className = "ok";
      correct.textContent = "Corect: " + d.correct_answer;
      li.appendChild(correct);
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = (d.time_ms / 1000).toFixed(1) + " s · +" + d.points + " puncte";
    li.appendChild(meta);

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
    const body = $("scores-body");
    body.replaceChildren();

    $("empty-scores").hidden = scores.length > 0;
    $("scores-table").hidden = scores.length === 0;

    scores.forEach((s, i) => {
      const tr = document.createElement("tr");
      const cells = [
        i + 1,
        s.player,
        s.score + " / " + s.total,
        s.points,
        DIFFICULTY_LABELS[s.difficulty] || "Oricare",
      ];
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      }

      const actionCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "actions";

      const retake = document.createElement("button");
      retake.type = "button";
      retake.textContent = "Reia";
      retake.addEventListener("click", () => startRetake(s));
      actions.appendChild(retake);

      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "Șterge";
      del.addEventListener("click", () => deleteScore(s.id));
      actions.appendChild(del);

      actionCell.appendChild(actions);
      tr.appendChild(actionCell);

      body.appendChild(tr);
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

$("setup-form").addEventListener("submit", startQuiz);
$("next-btn").addEventListener("click", nextQuestion);
$("again-btn").addEventListener("click", newQuiz);

loadCategories();
loadScores();