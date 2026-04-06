import psycopg2
import os

# Password with @ must be url-encoded: %40
db_url = "postgresql://postgres:[SupaBase%402026]@db.krfnzlxribsbntbbgave.supabase.co:5432/postgres"
schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")

try:
    print("Connecting to Supabase PostgreSQL...")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cursor = conn.cursor()

    print(f"Reading schema from {schema_path}")
    with open(schema_path, 'r', encoding='utf-8') as f:
        sql = f.read()

    print("Executing schema...")
    cursor.execute(sql)
    print("Schema applied successfully!")
    
    cursor.close()
    conn.close()
except Exception as e:
    print(f"Error applying schema: {e}")
