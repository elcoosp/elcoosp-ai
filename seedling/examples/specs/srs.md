---

## 📋 Software Requirements Specification — SkillDeck v1 (Excerpt)

| Field | Value |
|-------|-------|
| Project | SkillDeck v1 |
| Document | SRS |
| Version | 0.1 (Draft) |

---

## 3. Functional Requirements

### 3.3 Capability: Conversation Management

**Traceability:** UC-001, UC-002

#### 3.3.1 Conversation Creation & Selection

| ID               | Requirement                                                                                                                                                                                        | Priority |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **REQ-FUNC-001** | When the user creates a new conversation, the system shall create a new Conversation entity with a unique identifier, associate it with the active profile, and set it as the active conversation. | Must     |
| **REQ-FUNC-002** | When the user selects an existing conversation from the sidebar, the system shall load the conversation's messages from the database and display them in the message thread.                       | Must     |

#### 3.3.2 Message Exchange

| ID               | Requirement                                                                                                                                                                                          | Priority |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **REQ-FUNC-010** | When the user sends a message, the system shall persist the message to the database with a unique identifier, associate it with the conversation, and trigger the agent loop to generate a response. | Must     |
| **REQ-FUNC-012** | While the model provider is streaming a response, the system shall display tokens in real-time with a maximum render latency of 100ms per chunk.                                                     | Must     |

---

## 4. Non-Functional Requirements (Excerpt)

| ID               | Requirement                                                                        | Fit Criterion |
| ---------------- | ---------------------------------------------------------------------------------- | ------------- |
| **REQ-PERF-001** | The system shall start and display the main interface within 3 seconds.            | p95 ≤ 3s      |
| **REQ-SEC-001**  | API keys stored exclusively in the OS keychain, never in database or config files. | Zero matches  |
