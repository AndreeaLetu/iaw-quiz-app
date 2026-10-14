import html
import random

import requests

BASE_URL = "https://opentdb.com"

RESPONSE_CODES = {
    1: ("Nu există destule întrebări pentru filtrele alese.", 404),
    2: ("Parametri invalizi trimiși către Open Trivia DB.", 400),
    5: ("Prea multe cereri. Reîncearcă peste câteva secunde.", 429),
}


class OpenTriviaError(Exception):
    def __init__(self, message, status_code=502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _get(path, params=None):
    try:
        resp = requests.get(f"{BASE_URL}/{path}", params=params, timeout=10)

        # Timeout: o limită de 0.001 secunde nu poate fi respectată => OpenTriviaError 504
        # resp = requests.get(f"{BASE_URL}/{path}", params=params, timeout=0.001)

        # Rețea căzută: un server care nu există => OpenTriviaError 502
        # resp = requests.get("https://server-inexistent.invalid/api.php", timeout=10)

        # Limita de cereri: un serviciu de test care întoarce 429 => OpenTriviaError 429
        # resp = requests.get("https://httpbin.org/status/429", timeout=10)

    except requests.Timeout:
        raise OpenTriviaError("Open Trivia DB nu a răspuns la timp.", 504)
    except requests.RequestException:
        raise OpenTriviaError("Nu se poate contacta Open Trivia DB.", 502)
    return resp.json()


def get_categories():
    data = _get("api_category.php")
    return data["trivia_categories"]


def get_questions(amount, difficulty=None, category=None):
    params = {"amount": amount, "type": "multiple"}
    if difficulty:
        params["difficulty"] = difficulty
    if category:
        params["category"] = category

    data = _get("api.php", params)

    code = data["response_code"]
    if code != 0:
        message, status = RESPONSE_CODES.get(
            code, ("Răspuns neașteptat de la Open Trivia DB.", 502)
        )
        raise OpenTriviaError(message, status)

    questions = []
    for item in data["results"]:
        correct = html.unescape(item["correct_answer"]).strip()
        options = [html.unescape(o).strip() for o in item["incorrect_answers"]]
        options.append(correct)
        random.shuffle(options)
        questions.append({
            "question": html.unescape(item["question"]).strip(),
            "category": html.unescape(item["category"]).strip(),
            "options": options,
            "correct_index": options.index(correct),
        })
    return questions