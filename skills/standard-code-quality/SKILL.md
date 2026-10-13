---
name: standard-code-quality
description: Code quality standard covering readability, naming conventions, error handling, DRY without premature abstraction, mandatory linting and formatting per language, code review checks and pull request rules, dependency management, git hygiene, code-level and project-level documentation, and complexity limits such as function length, nesting depth and cyclomatic complexity. Read before writing or refactoring any non-trivial code, naming a function, variable or constant, adding a dependency, setting up linting or formatting, preparing or reviewing a pull request, or writing code comments and docs, and when the user says "clean this up", "refactor", "code review", "is this readable", "set up ESLint", "set up Prettier", "too complex", "this function is too long" or "should I add this library".
---

# Standard 19 - Code Quality Standards

Related skills: `review-build` (the post-build review gate), `requesting-code-review` and
`receiving-code-review` (the review process), `standard-git-workflow` (commit conventions and the
no-unprompted-commit rule), `standard-testing-strategy`, `error-alert-system` (a swallowed error
in a backend path must be reported, not just logged), `systematic-debugging`.

When a project already has an established style and lint configuration, follow it. The numbers
below are defaults for new code, not a reason to mass-reformat existing files.

## Philosophy
Code is read 10x more than it is written. Write for the reader. Write for the maintainer. Write as if the person maintaining your code is a violent psychopath who knows where you live.

## 1. Universal Principles

### Readability
- Code should be self-documenting. If you need a comment to explain WHAT, rename the variable/function.
- Comments explain WHY, not WHAT. The code shows what. Comments show intent.
- Consistent naming: if you call it `user` in one place, do not call it `account` in another.
- One function does one thing. If a function name has "and" in it, split it.
- Maximum function length: 30-40 lines. If longer, extract sub-functions.
- Maximum file length: 300-400 lines. If longer, split into modules.

### Naming Conventions
- Variables: descriptive nouns (`userCount`, `isActive`, `errorMessage`)
- Functions: descriptive verbs (`getUserById`, `validateEmail`, `calculateTotal`)
- Booleans: prefix with `is`, `has`, `can`, `should` (`isValid`, `hasPermission`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT`)
- Avoid abbreviations except universally understood ones (`id`, `url`, `api`)
- Never single-letter variables except loop counters (`i`, `j`) and lambda parameters

### Error Handling
- Handle errors at the appropriate level (not too early, not too late)
- Never swallow exceptions silently (empty catch blocks). In a backend path (webhook, cron, route, job) a catch that only logs is still swallowed: report it to the alert system or mark it as a conscious benign catch
- Provide meaningful error messages that help debugging
- Use custom error types/classes for different error categories
- Fail fast: validate inputs at the boundary, not deep inside logic

### DRY (Do Not Repeat Yourself)
- If you write the same logic 3+ times, extract it into a shared function
- If you copy-paste, you are doing it wrong
- BUT: do not over-abstract. Two similar things are not always the same thing.
- Premature abstraction is worse than duplication

## 2. Linting & Formatting (Mandatory)

### Configuration Per Language
- **JavaScript/TypeScript**: ESLint + Prettier. Configure in `.eslintrc` and `.prettierrc`
- **Python**: Ruff or Flake8 + Black. Configure in `pyproject.toml`
- **PHP**: PHP_CodeSniffer + PHP-CS-Fixer. Configure in `phpcs.xml` or `.php-cs-fixer.php`
- **Java**: Checkstyle + SpotBugs. Configure in build tool (Maven/Gradle)
- **Go**: `gofmt` + `golint` (built-in)
- **Rust**: `rustfmt` + `clippy` (built-in)

### Rules
- Format on save (configure IDE)
- Lint on commit (pre-commit hooks)
- Block merges if linting fails (CI pipeline)
- Team agrees on ONE style. No debates after that.

## 3. Code Review Standards

### What Reviewers Check:
- Does it work? (correctness)
- Is it secure? (injection, auth bypass, data exposure)
- Is it readable? (naming, structure, comments)
- Is it tested? (unit tests for logic, integration tests for flows)
- Is it performant? (N+1 queries, unnecessary loops, memory leaks)
- Is it maintainable? (coupling, complexity, magic numbers)
- Does it follow project conventions?

### Pull Request Rules:
- Small, focused PRs (< 400 lines changed, ideally < 200)
- Clear description of WHAT changed and WHY
- Link to issue/ticket if applicable
- Self-review before requesting review
- All tests passing before review
- Address all review comments before merging

## 4. Dependency Management

- Pin dependency versions (lockfiles: package-lock.json, Pipfile.lock, composer.lock)
- Audit dependencies regularly for vulnerabilities
- Remove unused dependencies
- Prefer well-maintained, widely-used libraries over obscure ones
- Evaluate before adding: "Is this dependency worth the maintenance cost?"
- Keep dependencies up to date (security patches at minimum)

## 5. Git Hygiene

- Commit messages follow conventional format (see the `standard-git-workflow` skill)
- One logical change per commit
- Never commit: secrets, build artifacts, IDE settings, OS files, large binaries
- Use .gitignore aggressively
- Rebase feature branches before merging (clean history). Rebasing changes history, so an agent does it only when the owner explicitly asks
- Delete merged branches

## 6. Documentation Standards

### Code-Level:
- Public APIs and exported functions: document parameters, return values, and exceptions
- Complex algorithms: explain the approach in a comment block above
- Workarounds: explain WHY with a link to the issue/ticket
- Configuration: document every environment variable in .env.example

### Project-Level:
- README.md: what it is, how to set up, how to run, how to test
- API documentation: endpoints, request/response formats, authentication
- Architecture decisions: document significant choices in /docs
- Changelog: track notable changes per version

## 7. Complexity Management

- Cyclomatic complexity per function: target < 10
- Nesting depth: maximum 3-4 levels. Use early returns to flatten.
- File dependencies: minimize. A file should not import from 20 places.
- Circular dependencies: NEVER. Restructure if detected.
- Global state: avoid. Use dependency injection or module patterns.

```
// BAD: deeply nested
if (user) {
    if (user.isActive) {
        if (user.hasPermission('admin')) {
            // do thing
        }
    }
}

// GOOD: early returns
if (!user) return;
if (!user.isActive) return;
if (!user.hasPermission('admin')) return;
// do thing
```

## Implementation Requirement
Every project uses linting, formatting, and follows these standards. Code quality is not negotiable. It is the baseline.
