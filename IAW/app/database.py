import sqlite3
from contextlib import contextmanager

DB_FILE = "quiz.db"


@contextmanager
def connect():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                player TEXT NOT NULL,
                score INTEGER NOT NULL,
                total INTEGER NOT NULL,
                difficulty TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def add_score(player, score, total, difficulty):
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO scores (player, score, total, difficulty) VALUES (?, ?, ?, ?)",
            (player, score, total, difficulty),
        )
        return cur.lastrowid


def list_scores(limit):
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, player, score, total, difficulty, created_at
            FROM scores
            ORDER BY CAST(score AS REAL) / total DESC, total DESC, id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def delete_score(score_id):
    with connect() as conn:
        cur = conn.execute("DELETE FROM scores WHERE id = ?", (score_id,))
        return cur.rowcount > 0