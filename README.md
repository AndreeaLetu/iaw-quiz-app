# Educational Quiz

A quiz web app built for the IAW course (Assignment B), tied to Assignment A on REST web services. The FastAPI server consumes the public [Open Trivia DB](https://opentdb.com) API and exposes its own REST API to a plain HTML/CSS/JavaScript frontend.

## Features
- Choose number of questions, difficulty and category
- Answer multiple-choice questions one at a time
- Score computed on the server; correct answers shown at the end
- Leaderboard stored in SQLite, with score deletion
- Error handling for Open Trivia DB failures, rate limits and invalid input

## Tech stack
Python, FastAPI, Uvicorn, requests, Pydantic, SQLite, HTML/CSS/JavaScript

## Project structure
```
app/
  main.py        REST endpoints and quiz logic
  opentdb.py     Open Trivia DB client
  database.py    SQLite access
static/          frontend (index.html, style.css, app.js)
requirements.txt
```

## Run
Requires Python 3.9+.

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

- App: http://127.0.0.1:8000/
- API docs (Swagger UI): http://127.0.0.1:8000/docs

The `quiz.db` database is created automatically on first start.

## API

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/categories` | List question categories |
| POST | `/api/quizzes` | Create a quiz (questions without correct answers) |
| POST | `/api/quizzes/{quiz_id}/submit` | Submit answers, compute and save the score |
| GET | `/api/scores` | Leaderboard (optional `limit`) |
| DELETE | `/api/scores/{score_id}` | Delete a score |
