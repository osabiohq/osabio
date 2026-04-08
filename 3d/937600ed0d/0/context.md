# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/san-francisco-v2 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs...

### Prompt 2

This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:
   The user asked to fix failing CI actions, providing 13 attached failure log files. The task is to identify and fix all test failures across unit tests and multiple acceptance test suites.

2. Key Technical Concepts:
   - **SurrealDB SCHEMAFULL tables**: Migration 0088 replaced `rules` array with `reg...

