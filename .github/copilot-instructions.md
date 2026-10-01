<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

## Next.js App - Project Overview

- **Framework**: Next.js 16+ with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Linting**: ESLint
- **Build Tool**: Turbopack (for faster development)

## Key Directories

- `app/` - App Router pages and layouts
- `public/` - Static assets
- `components/` - Reusable React components

## Getting Started

- `npm run dev` - Start development server (http://localhost:3000)
- `npm run build` - Build for production
- `npm start` - Start production server

## Configuration Notes

- TypeScript strict mode enabled
- Tailwind CSS with default configuration
- Using import alias `@/*` for cleaner imports

## Quality requirements for assisted changes

- Follow `docs/operations/strict-quality-gate.md` and the versioned `quality/sonar-policy.json`.
- Run `npm run check`, `npm run build`, `npm run audit:strict`, and `npm run sonar` before claiming completion; report any failures accurately.
- Review generated tests independently of the generated implementation. Cover security boundaries and failure paths, including workspace isolation and financial mutation idempotency.
- Verify new APIs and dependency provenance against authoritative documentation. Do not invent packages or methods.
- Do not remove tests, add coverage exclusions, suppress findings, accept issues, or lower thresholds just to pass checks. Changes to the quality policy require an explicit rationale and human review.
- AI review supplements accountable human review. A successful scan does not establish that business behavior is correct.
