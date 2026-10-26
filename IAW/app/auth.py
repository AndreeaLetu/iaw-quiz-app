import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

SECRET_KEY = os.environ.get("QUIZ_SECRET", "dev-only-secret-change-me-in-production-0123456789")
ALGORITHM = "HS256"
TOKEN_MINUTES = 60

hasher = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password):
    return hasher.hash(password)


def verify_password(password, hashed):
    return hasher.verify(password, hashed)


def create_token(user_id, username):
    expire = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_MINUTES)
    payload = {"sub": str(user_id), "username": username, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token):
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def unauthorized(detail):
    return HTTPException(
        status_code=401,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
):
    if credentials is None:
        raise unauthorized("Autentificare necesară.")

    try:
        payload = decode_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise unauthorized("Sesiunea a expirat. Autentifică-te din nou.")
    except jwt.InvalidTokenError:
        raise unauthorized("Token invalid.")

    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise unauthorized("Token invalid.")

    return {"id": user_id, "username": payload.get("username", "")}