# Contributing to Armory Store

Thank you for helping improve Armory Store. Contributions should preserve data integrity, security boundaries, bilingual usability, and the legal-neutral nature of the project.

## Development workflow

1. Fork the repository and create a focused branch from `main`.
2. Install dependencies with `npm ci` and the Python requirements file.
3. Copy `.env.example` to `.env.local`; never commit real credentials or customer data.
4. Make the smallest coherent change and add tests for changed behavior.
5. Run the required checks before opening a pull request:

   ```bash
   npm run typecheck
   npm test
   npm run test:db-scripts
   npm run build
   ```

6. Describe the problem, solution, verification, database impact, and screenshots for visible UI changes.

## Database changes

- Add a new timestamped migration under `supabase/migrations`; never edit a migration that may already be deployed.
- Make migrations transactional and safe to apply once in filename order.
- Treat RLS, grants, and security-definer function search paths as part of every schema review.
- Include rollback/recovery notes for high-risk changes.
- Never run `reset-db --confirm` against shared or production data while developing a pull request.

## Code expectations

- Keep TypeScript strict and avoid unsafe casts at trust boundaries.
- Validate all external input, including files, AI output, IPC messages, and database responses.
- Use decimal-safe money utilities; do not silently recompute historical exchange-rate values.
- Keep business authorization in PostgreSQL/RPC policy, not only in the React interface.
- Update both English and Arabic copy when changing user-facing language.
- Do not include proprietary data, real serial numbers, credentials, or regulated-person records in tests or seeds.

By contributing, you agree that your contribution is licensed under the MIT License.
