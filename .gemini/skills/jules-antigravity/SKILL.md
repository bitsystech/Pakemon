---
name: jules-antigravity
description: "Integration skill for Google Jules (jules.google) and Google Antigravity (AGY). Use this skill when configuring asynchronous cloud coding agents, GitHub PR automation, or orchestrating Jules with Google Antigravity IDE and CLI."
---

# Google Jules & Antigravity Skill

## Overview

**Jules** ([jules.google](https://jules.google)) is Google's cloud-native asynchronous AI software engineer. Working alongside **Google Antigravity (AGY)**, Jules operates directly on GitHub repositories to autonomously plan, execute, and verify complex coding tasks.

## Key Capabilities

1. **Cloud Execution**:
   - Runs in isolated Linux/Windows execution environments in the cloud.
   - Automatically clones repositories, installs dependencies, and runs test suites.

2. **Antigravity SDK Compatibility**:
   - Understands Antigravity artifacts (`implementation_plan.md`, `walkthrough.md`).
   - Follows rules defined in `.gemini/rules/` and skills in `.gemini/skills/`.

3. **GitHub Integration**:
   - Triggered via GitHub Issues, Pull Request comments, or scheduled cron workflows.
   - Creates clean, well-formatted Pull Requests with detailed walkthroughs.

## Usage & Commands

To trigger Jules on a task:
- Visit **[jules.google](https://jules.google)** and link your repository.
- Tag `@jules` in any GitHub Issue or Pull Request comment with instructions.
