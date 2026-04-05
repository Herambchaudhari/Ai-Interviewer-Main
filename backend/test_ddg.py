import os, sys, asyncio
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from ddgs import DDGS

def test_queries():
    queries = [
        "Google tech hiring",
        "Google AND hiring",
        "software engineering hiring",
        "OpenAI layoffs"
    ]
    with DDGS() as ddgs:
        for q in queries:
            results = list(ddgs.news(q, max_results=3))
            print(f"Query: {q} -> {len(results)} results")
            for r in results:
                print(f" - {r.get('title')}")
            print()

test_queries()
