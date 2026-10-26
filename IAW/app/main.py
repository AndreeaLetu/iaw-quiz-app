import time
import uuid
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import database, opentdb

app = FastAPI()
database.init_db()

TIME_LIMIT_MS = 15000
MIN_TIME_MS = 300
TOLERANCE_MS = 2000
BASE_POINTS = 100
MAX_BONUS = 100

quizzes = {}


class QuizRequest(BaseModel):
    amount: int = Field(5, ge=1, le=20)
    difficulty: Optional[Literal["easy", "medium", "hard"]] = None
    category: Optional[int] = Field(None, ge=1)


class SubmitRequest(BaseModel):
    player: str = Field(min_length=1, max_length=30)
    answers: list[int]
    times_ms: list[int]


class RetakeRequest(BaseModel):
    quiz_id: str
    answers: list[int]
    times_ms: list[int]


def clamp_time(time_ms):
    return min(max(time_ms, MIN_TIME_MS), TIME_LIMIT_MS)


def validate_attempt(quiz, answers, times_ms):
    count = len(quiz["questions"])
    if len(answers) != count or len(times_ms) != count:
        raise HTTPException(
            status_code=422,
            detail="Numărul de răspunsuri și de timpi trebuie să fie egal cu numărul de întrebări.",
        )

    elapsed_ms = (time.time() - quiz["started_at"]) * 1000
    reported_ms = sum(min(max(t, 0), TIME_LIMIT_MS) for t in times_ms)
    if reported_ms > elapsed_ms + TOLERANCE_MS:
        raise HTTPException(
            status_code=422,
            detail="Timpii raportați sunt mai mari decât timpul scurs de la crearea quiz-ului.",
        )


def grade(questions, answers, times_ms):
    score = 0
    points = 0
    details = []
    for question, answer, time_ms in zip(questions, answers, times_ms):
        options = question["options"]
        is_correct = answer == question["correct_index"]
        t = clamp_time(time_ms)

        question_points = 0
        if is_correct:
            score += 1
            bonus = round(MAX_BONUS * (TIME_LIMIT_MS - t) / TIME_LIMIT_MS)
            question_points = BASE_POINTS + bonus
        points += question_points

        details.append({
            "question": question["question"],
            "your_answer": options[answer] if 0 <= answer < len(options) else None,
            "correct_answer": options[question["correct_index"]],
            "is_correct": is_correct,
            "time_ms": t,
            "points": question_points,
        })
    return score, points, details


@app.get("/api/hello")
def hello():
    return {"message": "Salut din serverul quiz!"}


@app.get("/api/categories")
def list_categories():
    try:
        return opentdb.get_categories()
    except opentdb.OpenTriviaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.post("/api/quizzes", status_code=201)
def create_quiz(body: QuizRequest):
    try:
        questions = opentdb.get_questions(body.amount, body.difficulty, body.category)
    except opentdb.OpenTriviaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    quiz_id = uuid.uuid4().hex
    quizzes[quiz_id] = {
        "questions": questions,
        "difficulty": body.difficulty,
        "started_at": time.time(),
    }

    return {
        "quiz_id": quiz_id,
        "time_limit_ms": TIME_LIMIT_MS,
        "questions": [
            {"question": q["question"], "category": q["category"], "options": q["options"]}
            for q in questions
        ],
    }


@app.post("/api/quizzes/{quiz_id}/submit", status_code=201)
def submit_quiz(quiz_id: str, body: SubmitRequest):
    quiz = quizzes.get(quiz_id)
    if quiz is None:
        raise HTTPException(status_code=404, detail="Quiz-ul nu există sau a fost deja trimis.")

    player = body.player.strip()
    if not player:
        raise HTTPException(status_code=422, detail="Numele jucătorului nu poate fi gol.")

    validate_attempt(quiz, body.answers, body.times_ms)
    score, points, details = grade(quiz["questions"], body.answers, body.times_ms)

    total = len(quiz["questions"])
    score_id = database.add_score(player, score, total, quiz["difficulty"], points)
    del quizzes[quiz_id]

    return {
        "score_id": score_id,
        "score": score,
        "points": points,
        "total": total,
        "details": details,
    }


@app.put("/api/scores/{score_id}")
def retake_quiz(score_id: int, body: RetakeRequest):
    quiz = quizzes.get(body.quiz_id)
    if quiz is None:
        raise HTTPException(status_code=404, detail="Quiz-ul nu există sau a fost deja trimis.")

    validate_attempt(quiz, body.answers, body.times_ms)
    score, points, details = grade(quiz["questions"], body.answers, body.times_ms)

    total = len(quiz["questions"])
    if not database.update_score(score_id, score, total, quiz["difficulty"], points):
        raise HTTPException(status_code=404, detail="Scorul nu există.")

    del quizzes[body.quiz_id]

    return {
        "score_id": score_id,
        "score": score,
        "points": points,
        "total": total,
        "details": details,
    }


@app.get("/api/scores")
def list_scores(limit: int = Query(10, ge=1, le=100)):
    return database.list_scores(limit)


@app.delete("/api/scores/{score_id}", status_code=204)
def delete_score(score_id: int):
    if not database.delete_score(score_id):
        raise HTTPException(status_code=404, detail="Scorul nu există.")


app.mount("/", StaticFiles(directory="static", html=True), name="static")