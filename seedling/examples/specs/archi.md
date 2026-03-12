---

## 📋 Architecture & Design Specification — SkillDeck v1 (Excerpt)

| Field | Value |
|-------|-------|
| Project | SkillDeck v1 |
| Document | Architecture & Design Specification |
| Version | 0.1 (Draft) |

---

## 1. Context & Scope

### 1.1 Objective

Define the architectural foundation for SkillDeck v1 — a local-first, reactive, event-driven state machine wrapped in a Tauri desktop shell.

### 1.2 Architectural Constraints

| ID              | Constraint                           | Source              |
| --------------- | ------------------------------------ | ------------------- |
| **REQ-CON-001** | Desktop-only (macOS, Windows, Linux) | Scope decision      |
| **REQ-CON-002** | Tauri 2 framework                    | Technology decision |

### 1.3 Primary Architectural Constraint: IPC Boundary

The **IPC Boundary** between Rust (source of truth) and React (projection) is the defining architectural constraint. The system optimizes for data integrity across this boundary through:

1. **Tiered Streaming** — Ring buffer → 50ms debounced emit → `requestAnimationFrame` render
2. **Non-Blocking Supervision** — MCP process health loop runs independently; approval gate via oneshot channels
3. **Graph-Based Orchestration** — Petgraph DiGraph for workflow DAG execution

---

## 2. Architecture Decision Records (ADRs)

### ADR-001: Three-Layer Architecture

| Aspect           | Details                                                          |
| ---------------- | ---------------------------------------------------------------- |
| **Context**      | Need a local-first desktop app with complex business logic       |
| **Decision**     | Three-layer architecture: Rust core + Tauri shell + React UI     |
| **Consequences** | (+) Clear separation of concerns; (–) IPC serialization overhead |
