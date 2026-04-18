"""
Supabase service — helper wrappers around the supabase-py client.
"""
import os
from typing import Optional, Dict, Any, List
from supabase import create_client, Client

_client: Optional[Client] = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL", "")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_ANON_KEY", ""))
        if not url or not key:
            raise RuntimeError("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
        _client = create_client(url, key)
    return _client


async def insert_row(table: str, data: Dict[str, Any]) -> Dict:
    """Insert a row into a table. Returns the inserted row."""
    client = get_client()
    response = client.table(table).insert(data).execute()
    if response.data:
        return response.data[0]
    return {}


async def select_row(table: str, filters: Dict[str, Any]) -> Optional[Dict]:
    """Select a single row matching all filters."""
    client = get_client()
    query = client.table(table).select("*")
    for key, value in filters.items():
        query = query.eq(key, value)
    response = query.limit(1).execute()
    if response.data:
        return response.data[0]
    return None


async def select_rows(table: str, filters: Dict[str, Any]) -> List[Dict]:
    """Select multiple rows matching all filters."""
    client = get_client()
    query = client.table(table).select("*")
    for key, value in filters.items():
        query = query.eq(key, value)
    response = query.execute()
    return response.data or []


async def update_row(table: str, filters: Dict[str, Any], data: Dict[str, Any]) -> Dict:
    """Update rows matching filters with new data."""
    client = get_client()
    query = client.table(table).update(data)
    for key, value in filters.items():
        query = query.eq(key, value)
    response = query.execute()
    if response.data:
        return response.data[0]
    return {}
