# Jules & Google Antigravity Integration Guidelines

This project is configured to integrate with **Jules** (Google's asynchronous AI coding agent at [jules.google](https://jules.google)) and **Google Antigravity (AGY)**.

## Core Rules for Jules AI Agent

1. **Autonomous Issue & PR Resolution**:
   - Jules listens for GitHub issues, feature requests, and pull request reviews.
   - When assigned to an issue or mentioned in a PR, Jules autonomously researches the codebase, creates unit tests, and submits pull requests for review.

2. **Coding Standards & Architectural Alignment**:
   - All code written by Jules or Antigravity agents MUST follow the modular structure defined in `backend/` (Node.js/Express) and `worker/` (PowerShell PSADT).
   - Ensure all API endpoints preserve CORS, Azure Storage integration, and authentication rules defined in `backend/server.js`.

3. **Verification & Testing**:
   - Automated changes MUST include verification steps or updated test cases before merging PRs created by Jules.
