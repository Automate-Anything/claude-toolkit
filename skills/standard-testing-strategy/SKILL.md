---
name: standard-testing-strategy
description: Testing strategy standard covering the testing pyramid and its 70/20/10 split, what must always be tested, unit test examples for JavaScript, Python, PHP and Java, API testing cases, security testing, performance and load testing, test folder organization, test naming conventions and continuous testing in CI. Read before planning or writing tests for a feature, deciding what level of test a change needs, setting up a test folder or test runner, or touching authentication, authorization, payments, money calculations or data integrity code, and when the user says "add tests", "what should I test", "test plan", "test coverage", "load test", "is this tested" or "set up testing". For the red-green-refactor discipline itself read test-driven-development.
---

# Standard 17 - Testing Strategy

This standard says WHAT to test and at which level. Related skills: `test-driven-development`
(HOW to write tests first), `verification-before-completion` and `review-build` (proving the work
before calling it done), `browser-verification` (real-browser checks),
`standard-security-fortress` (the security checklist the security tests exercise).

## Philosophy
Untested code is broken code you have not discovered yet. Every feature MUST be testable. Every critical path MUST be tested.

## 1. Testing Pyramid

```
         /  E2E  \          <- Few: full user flows (slow, expensive)
        / Integration \      <- Some: components working together
       /    Unit Tests   \   <- Many: individual functions/methods (fast, cheap)
```

- **Unit Tests (70%)**: Test individual functions, methods, classes in isolation
- **Integration Tests (20%)**: Test components working together (API + DB, service + service)
- **End-to-End Tests (10%)**: Test full user workflows through the UI

## 2. What to Test

### ALWAYS Test:
- Authentication flows (login, logout, registration, password reset)
- Authorization (role-based access, permission checks)
- Form validation (valid input, invalid input, edge cases, XSS attempts)
- API endpoints (success responses, error responses, edge cases, rate limiting)
- Database operations (CRUD, constraints, cascades, migrations)
- Payment/financial calculations (precision, rounding, currency)
- Business logic (rules, calculations, state transitions)
- Error handling (graceful failures, user-friendly messages)

### NEVER Skip:
- Security-critical paths
- Money-handling logic
- Data integrity checks
- User input processing

## 3. Testing by Stack

### JavaScript / TypeScript (Jest, Vitest, Mocha)
```javascript
// Unit test example
describe('calculateTotal', () => {
    it('should sum items correctly', () => {
        const items = [{ price: 10 }, { price: 20 }];
        expect(calculateTotal(items)).toBe(30);
    });

    it('should return 0 for empty array', () => {
        expect(calculateTotal([])).toBe(0);
    });

    it('should handle decimal precision', () => {
        const items = [{ price: 0.1 }, { price: 0.2 }];
        expect(calculateTotal(items)).toBeCloseTo(0.3);
    });
});
```

### Python (pytest, unittest)
```python
def test_calculate_total():
    items = [{"price": 10}, {"price": 20}]
    assert calculate_total(items) == 30

def test_calculate_total_empty():
    assert calculate_total([]) == 0
```

### PHP (PHPUnit, Pest)
```php
public function test_calculate_total(): void {
    $items = [['price' => 10], ['price' => 20]];
    $this->assertEquals(30, calculateTotal($items));
}
```

### Java (JUnit, Mockito)
```java
@Test
void shouldCalculateTotal() {
    List<Item> items = List.of(new Item(10), new Item(20));
    assertEquals(30, calculator.calculateTotal(items));
}
```

## 4. API Testing
- Test every endpoint with valid inputs (happy path)
- Test with invalid inputs (missing fields, wrong types, too long, SQL injection attempts)
- Test authentication (with token, without token, expired token, wrong role)
- Test rate limiting (exceed limits, verify 429 response)
- Test pagination (first page, last page, out of range)
- Verify response format matches documented API spec
- Test CORS headers

## 5. Security Testing
- Input validation: test with XSS payloads, SQL injection strings, oversized inputs
- Authentication: test brute force protection, session fixation, token expiry
- Authorization: test accessing resources of other users, privilege escalation
- File uploads: test with wrong extensions, oversized files, malicious content
- CSRF: test form submission without valid token
- Headers: verify all security headers present on responses

## 6. Performance Testing
- Load testing: simulate concurrent users (Artillery, k6, JMeter, Locust)
- Identify bottlenecks: slow queries, memory leaks, blocking operations
- Set performance budgets: response time < 200ms for API, < 3s for page load
- Test under stress: what happens at 10x expected traffic?

## 7. Test Organization
```
tests/
|-- unit/              # Fast, isolated tests
|-- integration/       # Tests requiring database/services
|-- e2e/               # Full browser/UI tests
|-- fixtures/          # Test data and mocks
+-- helpers/           # Test utility functions
```

## 8. Test Naming Convention
- Describe WHAT is being tested and WHAT the expected outcome is
- Pattern: `should_[expected]_when_[condition]` or `test_[action]_[outcome]`
- Examples:
  - `should_return_404_when_user_not_found`
  - `should_reject_login_after_5_failed_attempts`
  - `test_create_user_with_valid_data`

## 9. Continuous Testing
- Run tests automatically on every commit (CI pipeline)
- Block merges if tests fail
- Track test coverage (aim for 80%+ on critical paths)
- Review and update tests when requirements change

## Implementation Requirement
Every feature that handles user data, money, authentication, or security MUST have tests. No exceptions. Tests are not optional. They are part of the feature.

## Additional Rules

- **The default test run works offline.** The suite must pass with no live database and no
  provider keys, using in-memory repositories and mock providers by default, with the real adapter
  selected by environment as a documented seam. Never make the mock path require live
  infrastructure.
- **Keep the in-memory fake honest.** A fake repository mirrors the real one's shape and
  behavior (ordering, pagination, tenant scoping), or the tests prove nothing.
- **Guard invariants with a test.** A rule that must never regress (for example "every tenant
  table has an isolation policy") gets an automated coverage test that fails when a new table or
  route misses it.
- **Money and other financial figures are asserted exactly**, in integer minor units or decimal
  types. Reserve approximate matchers for genuinely floating-point quantities.
- **Report what you ran.** State which tests were run and their result. "Tests should pass" is
  not a result.
