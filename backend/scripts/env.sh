#!/bin/bash
# Shared environment setup for backend scripts

ENVIRONMENT="${ENVIRONMENT:-development}"

if [[ "${ENVIRONMENT}" == "production" ]]; then
  echo "Starting in production mode..."
  export NODE_ENV="production"
  # DATABASE_URL (Postgres) comes from the environment; env.ts refuses to boot
  # in production without it.
else
  echo "Starting in development mode..."
  export NODE_ENV="development"
fi
