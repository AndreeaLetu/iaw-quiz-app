import uuid
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field
from fastapi.staticfiles import StaticFiles


from app import database, opentdb

app = FastAPI()
database.init_db()

quizzes = {}


class QuizRequest(BaseModel):
    amount: int = Field(5, ge=1, le=20)
    difficulty: Optional[Literal["easy", "medium", "hard"]] = None
    category: Optional[int] = Field(None, ge=1)


class SubmitRequest(BaseModel):
    player: str = Field(min_length=1, max_length=30)
    answers: list[int]


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
    quizzes[quiz_id] = {"questions": questions, "difficulty": body.difficulty}

    return {
        "quiz_id": quiz_id,
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

    questions = quiz["questions"]
    if len(body.answers) != len(questions):
        raise HTTPException(
            status_code=422,
            detail="Numărul de răspunsuri nu corespunde numărului de întrebări.",
        )

    score = 0
    details = []
    for question, answer in zip(questions, body.answers):
        options = question["options"]
        is_correct = answer == question["correct_index"]
        if is_correct:
            score += 1
        details.append({
            "question": question["question"],
            # un index în afara intervalului nu dă IndexError, ci "fără răspuns"
            "your_answer": options[answer] if 0 <= answer < len(options) else None,
            "correct_answer": options[question["correct_index"]],
            "is_correct": is_correct,
        })

    score_id = database.add_score(player, score, len(questions), quiz["difficulty"])
    del quizzes[quiz_id]

    return {"score_id": score_id, "score": score, "total": len(questions), "details": details}


@app.get("/api/scores")
def list_scores(limit: int = Query(10, ge=1, le=100)):
    return database.list_scores(limit)


@app.delete("/api/scores/{score_id}", status_code=204)
def delete_score(score_id: int):
    if not database.delete_score(score_id):
        raise HTTPException(status_code=404, detail="Scorul nu există.")


app.mount("/", StaticFiles(directory="static", html=True), name="static")