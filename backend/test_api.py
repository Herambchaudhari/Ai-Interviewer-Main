import os
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

response = client.get("/api/v1/news/feed")
print(response.status_code)
print(response.text)
