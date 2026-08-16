# Test suite

`npm test` is the application's single local and CI quality gate. A zero exit code means every required check passed; any non-zero exit code identifies a failed stage in the console output.

The gate runs, in order:

1. TypeScript type checking for application, Electron, and test code.
2. ESLint for application and test code.
3. Unit and contract tests with enforced coverage thresholds.
4. Python tests for database maintenance scripts.
5. The local SQLite provider integration test against a temporary database.

## Layout

- `unit/`: fast Vitest tests, mirroring the `src/` domains.
- `python/`: isolated Python unit tests for maintenance scripts.
- `integration/`: tests that cross process, database, or external-service boundaries.
- `setup.ts`: shared DOM cleanup and mock reset for every Vitest test.

## Useful commands

- `npm test`: required quality gate; use this before merging or releasing.
- `npm run test:unit`: fast Vitest run without coverage reporting.
- `npm run test:watch`: watch unit tests while developing.
- `npm run test:coverage`: unit tests plus coverage thresholds and HTML report.
- `npm run test:python`: database-script unit tests.
- `npm run test:sqlite-provider`: local SQLite integration test.
- `npm run test:electron-sqlite-smoke`: Electron lifecycle smoke test.

The Supabase integration tests in this directory intentionally remain explicit commands because they require a configured live Supabase project and credentials. They must be run in a prepared integration environment through the existing `supabase:test-*` scripts.
