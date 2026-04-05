import asyncio
import os
import sys

# add current dir to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from services.web_researcher import fetch_personalized_news
from services.groq_service import synthesize_market_trends
from dotenv import load_dotenv

load_dotenv()

async def main():
    target_companies = ["Google"]
    print("Fetching news...")
    raw_news = await fetch_personalized_news(target_companies)
    print(f"Raw news: {raw_news}")
    
    print("Synthesizing...")
    final = await synthesize_market_trends(target_companies, raw_news)
    print(f"Final: {final}")

if __name__ == "__main__":
    asyncio.run(main())
