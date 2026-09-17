@AGENTS.md

## Build & Test Commands

```bash
# Install dependencies
npm ci

# Build (production)
npm run build:production

# Build (development)
npm run build:test

# Run all tests
npm test

# Run specific test
npm test -- --testPathPattern=<pattern>

# Lint
npm run lint

# Lint with auto-fix
npm run lint:fix

# Check circular dependencies
npm run circular

# Validate OpenAPI spec
npm run api:validate

# Start dev server
npm run start:server
```

## Git Conventions

- Use conventional commits: `type(scope): description`
- Keep commit title under 50 characters
- Put ticket key (e.g., RHCLOUD-XXXXX) in commit body, not title
