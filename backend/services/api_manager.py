import os
import logging
from pathlib import Path
from dotenv import load_dotenv
from typing import Optional
from groq import Groq, AsyncGroq, RateLimitError, APIConnectionError, APIStatusError

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger(__name__)

class GroqKeyManager:
    """
    Manages rotation of Groq API keys to handle rate limiting.
    Provides robust wrappers for both sync and async chat completions.
    """
    def __init__(self):
        keys_env = os.getenv("GROQ_API_KEYS")
        if keys_env:
            self.keys = [k.strip() for k in keys_env.split(",") if k.strip()]
        else:
            single_key = os.getenv("GROQ_API_KEY")
            self.keys = [single_key.strip()] if single_key else []

        if not self.keys:
            raise ValueError("No Groq API keys configured. Set GROQ_API_KEYS or GROQ_API_KEY in .env.")

        self.current_index = 0
        self._sync_clients = {}
        self._async_clients = {}

    def get_current_key(self) -> str:
        return self.keys[self.current_index]

    def rotate_key(self):
        old_index = self.current_index
        self.current_index = (self.current_index + 1) % len(self.keys)
        logger.warning(
            f"Groq API Rate Limit hit. Rotated key from index {old_index} to {self.current_index}. "
            f"Key prefix: {self.get_current_key()[:10]}..."
        )

    def get_sync_client(self) -> Groq:
        key = self.get_current_key()
        if key not in self._sync_clients:
            # max_retries=0 is critical so we can catch RateLimitError instantly and rotate
            self._sync_clients[key] = Groq(api_key=key, max_retries=0)
        return self._sync_clients[key]

    def get_async_client(self) -> AsyncGroq:
        key = self.get_current_key()
        if key not in self._async_clients:
            self._async_clients[key] = AsyncGroq(api_key=key, max_retries=0)
        return self._async_clients[key]

# Singleton instance
_manager = GroqKeyManager()

def create_chat_completion(*args, **kwargs):
    """
    Wrapper around client.chat.completions.create with automatic key rotation.
    Retries across all available API keys before bubbling up the exception.
    """
    max_attempts = len(_manager.keys)
    last_exception: Optional[Exception] = None

    for attempt in range(max_attempts):
        try:
            client = _manager.get_sync_client()
            return client.chat.completions.create(*args, **kwargs)
        except (RateLimitError, APIStatusError, APIConnectionError) as e:
            # Usually rate limits are 429 APIStatusError / RateLimitError.
            # We treat them all as signals to rotate if we still have attempts.
            last_exception = e
            if attempt < max_attempts - 1:
                _manager.rotate_key()
            else:
                logger.error("All Groq API keys exhausted due to rate limits or errors.")
                raise e

    if last_exception:
        raise last_exception

async def create_async_chat_completion(*args, **kwargs):
    """
    Async wrapper around client.chat.completions.create with automatic key rotation.
    If stream=True, this handles the initial stream setup rate limits.
    """
    max_attempts = len(_manager.keys)
    last_exception: Optional[Exception] = None

    for attempt in range(max_attempts):
        try:
            client = _manager.get_async_client()
            return await client.chat.completions.create(*args, **kwargs)
        except (RateLimitError, APIStatusError, APIConnectionError) as e:
            last_exception = e
            if attempt < max_attempts - 1:
                _manager.rotate_key()
            else:
                logger.error("All Groq API keys exhausted due to rate limits or errors.")
                raise e

    if last_exception:
        raise last_exception
