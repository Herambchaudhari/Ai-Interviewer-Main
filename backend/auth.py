"""
Supabase JWT authentication middleware.
AUTH DISABLED — always returns mock dev-user for local development.

Original behaviour (re-enable for production):
  - Production: verifies JWT with SUPABASE_JWT_SECRET
  - Dev mode:   accepts any token when SUPABASE_JWT_SECRET is not set
"""
import os
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
# from jose import jwt, JWTError  # AUTH DISABLED

security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """
    AUTH DISABLED — returns mock dev-user without any token validation.
    Re-enable JWT verification below when deploying to production.
    """
    # AUTH DISABLED — always return mock user
    return {"user_id": "dev-user", "payload": {"sub": "dev-user"}}

    # ── Original production auth (commented out) ───────────────────────────
    # SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
    # if not SUPABASE_JWT_SECRET:
    #     if not credentials:
    #         return {"user_id": "dev-user", "payload": {"sub": "dev-user"}}
    #     try:
    #         payload = jwt.get_unverified_claims(credentials.credentials)
    #         user_id = payload.get("sub", "dev-user")
    #     except Exception:
    #         user_id = "dev-user"
    #     return {"user_id": user_id, "payload": {"sub": user_id}}
    #
    # if not credentials:
    #     raise HTTPException(
    #         status_code=status.HTTP_401_UNAUTHORIZED,
    #         detail="Authentication token missing",
    #         headers={"WWW-Authenticate": "Bearer"},
    #     )
    # token = credentials.credentials
    # try:
    #     payload = jwt.decode(
    #         token, SUPABASE_JWT_SECRET,
    #         algorithms=["HS256"], options={"verify_aud": False},
    #     )
    #     user_id: str = payload.get("sub")
    #     if not user_id:
    #         raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
    #                             detail="Invalid token payload")
    #     return {"user_id": user_id, "payload": payload}
    # except JWTError as e:
    #     raise HTTPException(
    #         status_code=status.HTTP_401_UNAUTHORIZED,
    #         detail=f"Could not validate credentials: {str(e)}",
    #         headers={"WWW-Authenticate": "Bearer"},
    #     )
