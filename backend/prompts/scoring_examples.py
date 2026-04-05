"""
prompts/scoring_examples.py

Few-shot calibration examples for answer scoring.
Injected into evaluate_answer() prompt to anchor the LLM's scoring scale.
Covers all four round types with strong (9), competent (6) and weak (3) anchors.
"""
from __future__ import annotations

FEW_SHOT_EXAMPLES: dict[str, list[dict]] = {
    "technical": [
        {
            "question": "Explain polymorphism in OOP.",
            "answer": (
                "Polymorphism allows objects of different classes to be treated as objects "
                "of a common superclass. There are two kinds: compile-time polymorphism (method "
                "overloading, resolved at compile time via static dispatch) and runtime polymorphism "
                "(method overriding, resolved via vtable/dynamic dispatch at runtime). This enables "
                "the open/closed principle — you can extend behavior without modifying existing code. "
                "For example, a Shape base class with draw() — Circle and Rectangle each override it. "
                "Code calling shape.draw() doesn't need to know the concrete type."
            ),
            "expected_score": 9,
            "reasoning": (
                "Correct definition, both types explained with mechanisms (static/dynamic dispatch), "
                "connected to design principle (open/closed), concrete example given, shows depth."
            ),
        },
        {
            "question": "Explain polymorphism in OOP.",
            "answer": (
                "Polymorphism means one interface, many implementations. Like, a parent class method "
                "can be overridden in child classes. So when you call the method on a parent reference, "
                "the child's version runs. It's useful for writing flexible code."
            ),
            "expected_score": 6,
            "reasoning": (
                "Core concept correct, runtime polymorphism covered, but misses compile-time, "
                "no design principles, example too vague. Competent but shallow."
            ),
        },
        {
            "question": "Explain polymorphism in OOP.",
            "answer": "Polymorphism is when a class can have multiple forms. I think it's related to inheritance.",
            "expected_score": 3,
            "reasoning": "Confused with inheritance, no mechanism explained, no example.",
        },
    ],
    "hr": [
        {
            "question": "Tell me about a time you had a conflict with a teammate.",
            "answer": (
                "During my final-year project, I disagreed with my teammate about using MongoDB vs "
                "PostgreSQL. I scheduled a focused discussion where we listed functional requirements "
                "and evaluated both options objectively using a scoring matrix. We chose PostgreSQL "
                "for its ACID compliance because our data had complex relationships. The project "
                "shipped on time and the teammate later mentioned the structured approach helped him "
                "think more clearly about data modelling decisions."
            ),
            "expected_score": 9,
            "reasoning": "Clear STAR structure, specific conflict, mature action (scoring matrix), measured outcome, growth mindset shown.",
        },
        {
            "question": "Tell me about a time you had a conflict with a teammate.",
            "answer": (
                "We had a disagreement about the tech stack. I talked to them and we eventually agreed. "
                "The project worked out fine in the end."
            ),
            "expected_score": 5,
            "reasoning": "Situation described but vague, action generic ('talked to them'), no specific outcome, no learnings shared.",
        },
        {
            "question": "Tell me about a time you had a conflict with a teammate.",
            "answer": "I don't really have conflicts. I get along with everyone.",
            "expected_score": 2,
            "reasoning": "Avoids the question, no STAR structure, shows lack of self-awareness or relevant experience.",
        },
    ],
    "dsa": [
        {
            "question": "Find two numbers in an array that sum to a target.",
            "answer": (
                "I'd use a hash map approach. Iterate through the array. For each element x, "
                "calculate complement = target - x and check if it exists in the map. If yes, "
                "return indices. If not, store x with its index. This gives O(n) time and O(n) space. "
                "The naive nested-loop approach is O(n²) which doesn't scale. Edge cases: "
                "duplicates (handle by checking index != current index), empty array, no solution."
            ),
            "expected_score": 9,
            "reasoning": "Optimal O(n) solution, explained mechanism, compared to naive, identified edge cases, clear thought process.",
        },
        {
            "question": "Find two numbers in an array that sum to a target.",
            "answer": (
                "I'd loop through each pair and check if they sum to target. So two nested for loops. "
                "That's O(n²) time."
            ),
            "expected_score": 5,
            "reasoning": "Correct but suboptimal. Identified complexity but didn't improve it. No edge cases.",
        },
    ],
    "system_design": [
        {
            "question": "Design a URL shortener service.",
            "answer": (
                "I'd use a REST API with two endpoints: POST /shorten (takes long URL, returns short code) "
                "and GET /{code} (redirects). For the short code, I'd use base62 encoding of an auto-increment "
                "ID or a hash. Storage: SQL DB (Postgres) for URL mappings with a unique index on short_code. "
                "For scale: add Redis cache with TTL for hot URLs (cache-aside pattern), CDN for static assets, "
                "read replicas for DB. For high write load, switch to distributed ID generation (Twitter Snowflake). "
                "Rate limit the POST endpoint to prevent abuse. Analytics can go to a separate Kafka topic."
            ),
            "expected_score": 9,
            "reasoning": "Complete design: API, storage, caching, scaling, ID generation, rate limiting, analytics separation.",
        },
        {
            "question": "Design a URL shortener service.",
            "answer": (
                "I'd store the URLs in a database and generate a random short string for each. "
                "Use a REST API to expose the endpoints."
            ),
            "expected_score": 4,
            "reasoning": "Correct direction but no specifics on scale, caching, ID uniqueness, collision handling.",
        },
    ],
}


def inject_few_shot_examples(round_type: str, max_examples: int = 2) -> str:
    """
    Returns a formatted block of calibration examples for the given round_type.
    Injects up to `max_examples` examples to keep prompt size reasonable.
    """
    examples = FEW_SHOT_EXAMPLES.get(round_type, FEW_SHOT_EXAMPLES.get("technical", []))
    if not examples:
        return ""

    lines = ["FEW-SHOT CALIBRATION (use these as your scoring reference):"]
    for ex in examples[:max_examples]:
        lines.append(
            f"\nExample (expected score={ex['expected_score']}/10):\n"
            f"Q: {ex['question']}\n"
            f"A: {ex['answer'][:300]}\n"
            f"Why {ex['expected_score']}/10: {ex['reasoning']}"
        )
    lines.append("\nApply this scale consistently to the candidate's answer below.\n")
    return "\n".join(lines)
