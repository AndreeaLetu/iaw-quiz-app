import time
import uuid
from typing import Literal, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import auth, database, opentdb

app = FastAPI()
database.init_db()

TIME_LIMIT_MS = 15000
MIN_TIME_MS = 300
TOLERANCE_MS = 2000
BASE_POINTS = 100
MAX_BONUS = 100

quizzes = {}


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=8, max_length=128)


class QuizRequest(BaseModel):
    amount: int = Field(5, ge=1, le=20)
    difficulty: Optional[Literal["easy", "medium", "hard"]] = None
    category: Optional[int] = Field(None, ge=1)


class SubmitRequest(BaseModel):
    answers: list[int]
    times_ms: list[int]


class RetakeRequest(BaseModel):
    quiz_id: str
    answers: list[int]
    times_ms: list[int]


def clamp_time(time_ms):
    return min(max(time_ms, MIN_TIME_MS), TIME_LIMIT_MS)


def get_owned_quiz(quiz_id, user):
    quiz = quizzes.get(quiz_id)
    if quiz is None or quiz["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Quiz-ul nu există sau a fost deja trimis.")
    return quiz


def get_owned_score(score_id, user):
    score = database.get_score(score_id)
    if score is None:
        raise HTTPException(status_code=404, detail="Scorul nu există.")
    if score["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="Nu poți modifica scorul altui jucător.")
    return score


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


@app.post("/api/auth/register", status_code=201)
def register(body: Credentials):
    username = body.username.strip()
    if len(username) < 3:
        raise HTTPException(
            status_code=422,
            detail="Numele de utilizator trebuie să aibă cel puțin 3 caractere.",
        )

    user_id = database.create_user(username, auth.hash_password(body.password))
    if user_id is None:
        raise HTTPException(status_code=409, detail="Numele de utilizator există deja.")

    return {"id": user_id, "username": username}


@app.post("/api/auth/login")
def login(body: Credentials):
    user = database.get_user_by_username(body.username.strip())
    if user is None or not auth.verify_password(body.password, user["password_hash"]):
        raise HTTPException(
            status_code=401,
            detail="Nume de utilizator sau parolă incorecte.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "access_token": auth.create_token(user["id"], user["username"]),
        "token_type": "bearer",
        "user_id": user["id"],
        "username": user["username"],
    }


@app.get("/api/auth/me")
def me(user: dict = Depends(auth.get_current_user)):
    return user


@app.get("/api/categories")
def list_categories():
    try:
        return opentdb.get_categories()
    except opentdb.OpenTriviaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)


@app.post("/api/quizzes", status_code=201)
def create_quiz(body: QuizRequest, user: dict = Depends(auth.get_current_user)):
    try:
        questions = opentdb.get_questions(body.amount, body.difficulty, body.category)
    except opentdb.OpenTriviaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    quiz_id = uuid.uuid4().hex
    quizzes[quiz_id] = {
        "questions": questions,
        "difficulty": body.difficulty,
        "started_at": time.time(),
        "user_id": user["id"],
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
def submit_quiz(quiz_id: str, body: SubmitRequest, user: dict = Depends(auth.get_current_user)):
    quiz = get_owned_quiz(quiz_id, user)

    validate_attempt(quiz, body.answers, body.times_ms)
    score, points, details = grade(quiz["questions"], body.answers, body.times_ms)

    total = len(quiz["questions"])
    score_id = database.add_score(
        user["username"], score, total, quiz["difficulty"], points, user_id=user["id"]
    )
    del quizzes[quiz_id]

    return {
        "score_id": score_id,
        "score": score,
        "points": points,
        "total": total,
        "details": details,
    }


@app.put("/api/scores/{score_id}")
def retake_quiz(score_id: int, body: RetakeRequest, user: dict = Depends(auth.get_current_user)):
    get_owned_score(score_id, user)
    quiz = get_owned_quiz(body.quiz_id, user)

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
def delete_score(score_id: int, user: dict = Depends(auth.get_current_user)):
    get_owned_score(score_id, user)
    if not database.delete_score(score_id):
        raise HTTPException(status_code=404, detail="Scorul nu există.")


app.mount("/", StaticFiles(directory="static", html=True), name="static")