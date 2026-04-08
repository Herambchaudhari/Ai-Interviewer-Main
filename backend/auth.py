"""
Supabase JWT authentication middleware.
Validates the Bearer token from requests.

Supports:
  - Production: verifies JWT with SUPABASE_JWT_SECRET
  - Dev mode:   if SUPABASE_JWT_SECRET is not set, accepts any token
                and returns a mock user (for local development without Supabase)
"""
import os
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError

security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """
    Decode and validate the Supabase JWT.
    Returns dict with 'user_id' and 'payload'.

    - If SUPABASE_JWT_SECRET is set: verifies signature (production mode).
    - If SUPABASE_JWT_SECRET is not set: dev mode — accepts any token (unverified)
      or no token at all (returns mock dev-user). Never deploy without secret set.
    """
    SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
    if not SUPABASE_JWT_SECRET:
        # Dev mode: no secret configured — accept any request
        if not credentials:
            return {"user_id": "dev-user", "payload": {"sub": "dev-user"}}
        try:
            payload = jwt.get_unverified_claims(credentials.credentials)
            user_id = payload.get("sub", "dev-user")
        except Exception:
            user_id = "dev-user"
        return {"user_id": user_id, "payload": {"sub": user_id}}

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
            )
        return {"user_id": user_id, "payload": payload}
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not validate credentials: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
