---
name: standard-git-workflow
description: Git conventions for branch names, Conventional Commits message format, .gitignore essentials, solo and feature-branch workflows and commit hygiene, governed by the standing rule that an agent never commits, pushes or runs history-changing git unless the owner explicitly asks. Read before naming a branch, writing or suggesting a commit message, writing a pull request description, creating or editing a .gitignore, or doing any git operation the owner has asked for, and when the user says "commit this", "push", "what should the commit message be", "create a branch", "open a PR", "set up .gitignore" or "wrap up the session".
---

# Standard 15 - Git Workflow and Version Control

## RULE ZERO: the agent does not commit or push on its own

**An agent never commits, pushes, or runs history-changing or tree-changing git on its own
initiative.** That includes `git commit`, `git push`, `git reset`, `git checkout -- <path>`,
`git restore`, `git stash`, `git clean`, `git rebase`, `git merge`, `git cherry-pick`,
`git branch -D`, amending, and force-pushing. It does these only when the owner explicitly asks
for that action in the current conversation.

- Being asked to change code is permission to EDIT files. It is not permission to commit.
- "Finish the feature" or "wrap up" is not a request to commit. If unsure, ask.
- A request to commit is not a request to push. Do exactly what was asked.
- Read-only git is always fine: `git status`, `git diff`, `git log`, `git show`, `git branch`.
- Everything below describes CONVENTIONS: how branches are named, how commit messages are
  written, and what the owner's workflow looks like. The commands shown are what the owner runs,
  or what the agent runs only after an explicit request.
- Never skip hooks (`--no-verify`) or signing unless the owner explicitly asks.

## 1. Branch Naming

- **main** (or master): production-ready code (always stable)
- **develop**: integration branch for features in progress
- **feature/feature-name**: new features (e.g., `feature/user-registration`)
- **fix/bug-description**: bug fixes (e.g., `fix/login-redirect-loop`)
- **hotfix/issue**: urgent production fixes (e.g., `hotfix/security-patch`)
- **release/version**: release preparation (e.g., `release/1.2.0`)

Use lowercase with hyphens. Keep the name short and descriptive of the change.

## 2. Commit Message Format (Conventional Commits)

```
type(scope): description

Types:
  feat:     New feature
  fix:      Bug fix
  refactor: Code restructuring (no behavior change)
  style:    CSS/formatting changes (no logic change)
  docs:     Documentation only
  chore:    Build/config changes
  db:       Database migration or schema change
  security: Security-related changes
  test:     Adding or updating tests
  perf:     Performance improvements
```

### Examples

```
feat(auth): add user registration with email verification
fix(admin): resolve dashboard chart rendering on mobile
db(users): add phone_number column to users table
style(cards): update card shadow and border radius
docs(api): add API endpoint documentation
security(session): implement session regeneration on login
test(auth): add unit tests for login flow
```

### Rules

- Present tense ("add" not "added")
- Lowercase first word after type
- No period at end
- Max 72 characters for subject line
- Add body (blank line after subject) for complex changes
- One logical change per commit
- Follow any attribution or trailer lines the project or the tool configuration requires

## 3. .gitignore Essentials

```gitignore
# Environment files (contain secrets)
.env
.env.*
!.env.example

# Logs
logs/
*.log

# Cache
cache/
tmp/
temp/
.cache/

# Uploads (user-generated content)
uploads/

# Dependencies
node_modules/
vendor/
__pycache__/
*.pyc
.venv/
venv/
target/
build/
dist/

# IDE files
.vscode/
.idea/
*.swp
*.swo
*.code-workspace

# OS files
.DS_Store
Thumbs.db
desktop.ini

# Backup files
*.bak
*.backup

# Compiled output
*.class
*.o
*.exe
```

Adjust per project: some teams deliberately commit shared editor settings, in which case remove
that entry rather than force-adding files.

## 4. End-of-Session Reminder (the agent reminds, the owner decides)

The original standard asks for a git backup reminder at the end of every working session. Under
Rule Zero this is a REMINDER only:

1. If the session changed files, say so: "There are uncommitted changes. Would you like me to
   commit and push them?"
2. Provide a suggested commit message based on the changes made.
3. Summarize what changed in this session.
4. Then wait. Do not commit or push unless the owner answers yes, and do only what they agreed
   to (commit only, or commit and push).

## 5. Workflow Conventions

These are the sequences the owner follows, or asks the agent to run.

### Simple (solo developer)

1. Pull latest: `git pull origin main`
2. Make changes
3. Stage: `git add <specific files>` (prefer specific files over `git add .` so nothing
   unintended is included)
4. Commit: `git commit -m "type(scope): description"`
5. Push: `git push origin main`

### Feature branch (team)

1. Create branch: `git checkout -b feature/feature-name`
2. Make changes and commit (small, focused commits)
3. Push branch: `git push -u origin feature/feature-name`
4. Create a pull request for review
5. After approval: merge to main
6. Delete the feature branch

When the owner asks for a commit while on the default branch of a team repository, check whether
they want a branch first.

### Pull request description

- What changed and why, in plain language
- Link to the issue or ticket if there is one
- How it was verified (tests run, screens checked)
- Anything the reviewer should look at closely

## 6. Rules

- **NEVER** commit secrets, passwords, API keys, or .env files
- **ALWAYS** check `git status` before a commit is made
- **ALWAYS** review the staged diff before a commit is made (`git diff --staged`)
- **ALWAYS** write meaningful commit messages
- Small, focused commits are better than large ones
- Work should be committed and pushed regularly so it is backed up. The agent's part is to remind
  the owner (section 4), not to do it unprompted.
- Use `.gitignore` to exclude generated files, dependencies, and secrets
- Never commit build artifacts, OS files or large binaries
- If a secret was committed, treat it as compromised: tell the owner and recommend rotating it.
  Rewriting history to remove it is the owner's decision.
- Never use destructive commands (`reset --hard`, `clean -f`, force push, branch deletion) as a
  shortcut around a problem. Explain the problem and ask.

## Related skills

- `finishing-a-development-branch`, `using-git-worktrees`, `requesting-code-review`: process
  skills for branch work, when present in the toolkit.
- `update-github`: repository settings and GitHub API operations.
- `standard-config-and-secrets`: what must stay out of the repository.
- `standard-code-quality`: pull request size and review standards.
