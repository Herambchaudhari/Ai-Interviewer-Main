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

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> dict:
    """
    [TEMPORARILY DISABLED]
    Decode and validate the Supabase JWT.
    Returns dict with 'user_id' and 'payload'.
    
    Currently mocked to bypass auth and always return 'dev-user'.
    """
    user_id = "dev-user"
    return {"user_id": user_id, "payload": {"sub": user_id}}
    
    # --- ORIGINAL AUTH LOGIC (Commented out for now) ---
    # if not credentials:
    #     raise HTTPException(
    #         status_code=status.HTTP_401_UNAUTHORIZED,
    #         detail="Authentication token missing",
    #         headers={"WWW-Authenticate": "Bearer"},
    #     )
    # 
    # token = credentials.credentials
    # 
    # if not SUPABASE_JWT_SECRET:
    #     try:
    #         payload = jwt.get_unverified_claims(token)
    #         user_id = payload.get("sub", "dev-user")
    #     except Exception:
    #         user_id = "dev-user"
    #     return {"user_id": user_id, "payload": {"sub": user_id}}
    # 
    # try:
    #     payload = jwt.decode(
    #         token,
    #         SUPABASE_JWT_SECRET,
    #         algorithms=["HS256"],
    #         options={"verify_aud": False},
    #     )
    #     user_id: str = payload.get("sub")
    #     if not user_id:
    #         raise HTTPException(
    #             status_code=status.HTTP_401_UNAUTHORIZED,
    #             detail="Invalid token payload",
    #         )
    #     return {"user_id": user_id, "payload": payload}
    # except JWTError as e:
    #     raise HTTPException(
    #         status_code=status.HTTP_401_UNAUTHORIZED,
    #         detail=f"Could not validate credentials: {str(e)}",
    #         headers={"WWW-Authenticate": "Bearer"},
    #     )
