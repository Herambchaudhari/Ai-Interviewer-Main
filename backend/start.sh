#!/bin/sh
# Railway injects PORT at runtime. This script runs in shell context
# so the variable always expands correctly regardless of how Railway
# invokes the container entrypoint.
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
