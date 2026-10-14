let quizId = null;
let questions = [];
let answers = [];
let current = 0;

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


async function startQuiz(event) {
  event.preventDefault();
  clearMessage();

  const body = { amount: Number($("amount").value) };
  if ($("difficulty").value) body.difficulty = $("difficulty").value;
  if ($("category").value) body.category = Number($("category").value);

  const button = $("start-btn");
  button.disabled = true;     // evită dublu-click (Open Trivia limitează cererile)
  try {
    const data = await api("/api/quizzes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    quizId = data.quiz_id;
    questions = data.questions;
    answers = [];
    current = 0;
    showSection("quiz");
    showQuestion();
  } catch (e) {
    showMessage(e.message);
  } finally {
    button.disabled = false;
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
  $("next-btn").disabled = true;   // se activează după ce alegi o variantă
}

function selectOption(index, button) {
  answers[current] = index;
  for (const b of $("options").children) b.classList.remove("selected");
  button.classList.add("selected");
  $("next-btn").disabled = false;
}

function nextQuestion() {
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
    const result = await api("/api/quizzes/" + quizId + "/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player: $("player").value.trim(), answers: answers }),
    });
    showResult(result);
    loadScores();
  } catch (e) {
    showMessage(e.message);
    $("next-btn").disabled = false;
  }
}

function showResult(result) {
  $("result-title").textContent = "Scor: " + result.score + " / " + result.total;

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
    list.appendChild(li);
  }
  showSection("result");
}

function newQuiz() {
  clearMessage();
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
        DIFFICULTY_LABELS[s.difficulty] || "Oricare",
      ];
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.appendChild(td);
      }

      const actionCell = document.createElement("td");
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "Șterge";
      del.addEventListener("click", () => deleteScore(s.id));
      actionCell.appendChild(del);
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