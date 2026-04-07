# Session Context

## User Prompts

### Prompt 1

<system_instruction>
You are working inside Conductor, a Mac app that lets the user run many coding agents in parallel.
Your work should take place in the /Users/marcus/conductor/workspaces/brain-v1/san-francisco-v2 directory (unless otherwise directed), which has been set up for you to work in.
Each workspace has a .context directory (gitignored) where you can save files to collaborate with other agents.
The target branch for this workspace is main. Use this for actions like creating new PRs...

### Prompt 2

Base directory for this skill: /Users/marcus/.claude/skills/nw-discuss

# NW-DISCUSS: Jobs-to-be-Done Analysis, UX Journey Design, and Requirements Gathering

**Wave**: DISCUSS (wave 2 of 6) | **Agent**: Luna (nw-product-owner) | **Command**: `/nw-discuss`

## Overview

Execute DISCUSS wave through Luna's integrated workflow: JTBD analysis|UX journey discovery|emotional arc design|shared artifact tracking|requirements gathering|user story creation|acceptance criteria definition. Luna uncovers...

### Prompt 3

answers to questions:
- Store Rego source inline in policy records
- Expose Rego authoring in the Policy Management UI
- "How to handle the human_veto_required flag — as a Rego output field or keep it as metadata on the policy record?" what makes most sense?
- do not include base policies yet

### Prompt 4

what is "shadow mode"?

### Prompt 5

we're not interested in backwards compatibility

### Prompt 6

Base directory for this skill: /Users/marcus/.claude/skills/nw-design

# NW-DESIGN: Architecture Design

**Wave**: DESIGN (wave 3 of 6) | **Agents**: Morgan (nw-solution-architect) | **Command**: `*design-architecture`

## Overview

Execute DESIGN wave through discovery-driven architecture design. Morgan asks about business drivers and constraints first, then recommends architecture that fits. Analyzes existing codebase, evaluates open-source alternatives, produces C4 diagrams (Mermaid) as ma...

### Prompt 7

Stop hook feedback:
Prompt hook condition was not met: MCP tools for logging decisions, questions, observations, and suggestions are not available in this context. The Brain MCP is not configured or accessible. Available tools are: Agent, Bash, CronCreate, CronDelete, CronList, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, Edit, Glob, Grep, LSP, ListMcpResourcesTool, NotebookEdit, Read, ReadMcpResourceTool, RemoteTrigger, TaskCreate, TaskGet, TaskList, TaskOutput, TaskStop, TaskUp...

### Prompt 8

what do you mean by "Vendor the pre-built WASM artifacts into `vendor/regorus-wasm/` in the repository" ?

### Prompt 9

what do you mean by "Vendor the pre-built WASM artifacts into `vendor/regorus-wasm/` in the repository" ?

### Prompt 10

why not use git submodule?

### Prompt 11

cant we do both?

### Prompt 12

yes

### Prompt 13

Base directory for this skill: /Users/marcus/.claude/skills/nw-distill

# DISTILL Methodology: Acceptance Test Creation

This skill provides the acceptance designer's methodology for creating acceptance tests. The orchestrator controls the overall flow (agent dispatch, review gate, handoff) -- this skill focuses on HOW to create good acceptance tests.

## Acceptance Criteria: Port-to-Port Principle

Every AC MUST name the driving port (entry point) through which the behavior is exercised. Thi...

### Prompt 14

Continue from where you left off.

### Prompt 15

shouldnt we just reuse existing policy tests?

### Prompt 16

proceed and write the DISTILL artifacts documenting this plan

### Prompt 17

create github issue: add helper to the ui that allows the admin to use natural language to explain what policy they want, and then a llm generates the corresponding rego code, endpoint, payloads, etc that they can then verify and test.

### Prompt 18

use stripe charge as example

### Prompt 19

create another issue for rendering the rego source in https://www.npmjs.com/package/@monaco-editor/react

### Prompt 20

"The Rego Playground (play.openpolicyagent.org) provides a specialized editor environment optimized for OPA policies"

/nw-research what they're using and if we can reuse it

### Prompt 21

Base directory for this skill: /Users/marcus/.claude/skills/nw-research

# NW-RESEARCH: Evidence-Driven Knowledge Research

**Wave**: CROSS_WAVE
**Agent**: Nova (nw-researcher)
**Command**: `*research`

## Overview

Systematic evidence-based research with source verification. Cross-wave support providing research-backed insights for any nWave phase using trusted academic|official|industry sources.

Optional `--skill-for={agent-name}` distills research into a practitioner-focused skill file fo...

### Prompt 22

why not use CodeMirror 5?

### Prompt 23

yes

### Prompt 24

create roadmap using /nw-roadmap skill

### Prompt 25

Base directory for this skill: /Users/marcus/.claude/skills/nw-roadmap

# NW-ROADMAP: Goal Planning

**Wave**: CROSS_WAVE
**Agent**: Architect (nw-solution-architect) or domain-appropriate agent

## Overview

Dispatches expert agent to fill a pre-scaffolded YAML roadmap skeleton. CLI tools handle structure; agent handles content.

Output: `docs/feature/{feature-id}/deliver/roadmap.json`

## Usage

```bash
/nw-roadmap @nw-solution-architect "Migrate monolith to microservices"
/nw-roadmap @nw-s...

### Prompt 26

Base directory for this skill: /Users/marcus/.claude/skills/nw-review

# NW-REVIEW: Expert Critique and Quality Assurance

**Wave**: CROSS_WAVE
**Agent**: Dynamic (nw-*-reviewer)

## Overview

Dispatches expert reviewer agent to critique workflow artifacts. Takes base agent name, appends `-reviewer`, invokes with artifact. Reviewer agent owns all review methodology|criteria|output format.

## Review Philosophy: Radical Candor

Every review MUST embody Radical Candor — kind AND clear, specific...

### Prompt 27

commit artfiacts

### Prompt 28

commit everything

