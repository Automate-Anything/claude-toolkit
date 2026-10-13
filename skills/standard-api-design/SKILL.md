---
name: standard-api-design
description: Standard for designing HTTP and REST APIs. Covers REST verb and URL conventions, the mandatory JSON success and error response envelope, HTTP status codes, bearer token and API key authentication, CORS configuration, rate limit headers, input validation, URL path versioning with breaking-change rules and a deprecation and sunset lifecycle, endpoint skeletons for Express, Django REST Framework, Spring Boot and PHP, and pagination format. Read before designing any API endpoint, route handler, webhook receiver, response shape or error format, before changing or removing a field in an existing response, before adding pagination, CORS or rate limiting, and when the user says "add an endpoint", "design the API", "what status code", "API versioning", "deprecate this endpoint", "breaking change" or "CORS error".
---

# Standard 13 - API Design Standards

Related skills: `standard-security-fortress` (validation, tokens, rate limiting in depth),
`standard-clean-urls` (URL naming), `query-efficiency` (making list endpoints paginate at the
database, never in application code), `standard-error-handling-ux` (what the user sees when a
call fails), `standard-testing-strategy` (API test cases).

If the project already has an established response envelope, keep it consistent rather than
introducing a second shape; apply the rest of this standard around it.

## 1. REST Conventions
- **GET**: Retrieve resources (no side effects)
- **POST**: Create new resources
- **PUT**: Full update of existing resource
- **PATCH**: Partial update
- **DELETE**: Remove resource
- URL pattern: `/api/v1/{resource}/{id}/{sub-resource}`
- Plural nouns for collections: `/api/v1/users`, `/api/v1/orders`
- Lowercase, hyphens for multi-word: `/api/v1/user-profiles`

## 2. JSON Response Format (Mandatory)
```json
// Success response
{
    "success": true,
    "data": { },
    "message": "Operation completed successfully",
    "meta": {
        "page": 1,
        "per_page": 20,
        "total": 150
    }
}

// Error response
{
    "success": false,
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "Email address is invalid",
        "details": [
            { "field": "email", "message": "Must be a valid email address" }
        ]
    }
}
```

## 3. HTTP Status Codes
- **200**: Success
- **201**: Created (after POST)
- **204**: No Content (successful DELETE)
- **400**: Bad Request (malformed request)
- **401**: Unauthorized (not authenticated)
- **403**: Forbidden (not authorized for this resource)
- **404**: Not Found
- **409**: Conflict (duplicate entry)
- **422**: Unprocessable Entity (validation failed)
- **429**: Too Many Requests (rate limited)
- **500**: Internal Server Error

## 4. Authentication
- Bearer token in `Authorization` header for API calls
- CSRF token for session-based form submissions
- Token format: cryptographically secure random string (minimum 256 bits)
- Token expiration: configurable (default 24 hours for access, longer for refresh)
- Include token refresh mechanism for extended sessions
- Support API key authentication for service-to-service calls

## 5. CORS Configuration
```
Access-Control-Allow-Origin: https://yourdomain.com (or specific origins)
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
```
- Handle preflight (OPTIONS) requests with 204 response
- NEVER use `Access-Control-Allow-Origin: *` with credentials

## 6. Rate Limiting Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1708000000
```

## 7. Input Validation
- Validate ALL inputs server-side (never trust client-side only)
- Return specific field-level errors in response
- Sanitize before processing
- Type checking and bounds checking
- Maximum payload size: 10MB (configurable)

## 8. API Versioning & Lifecycle

### Versioning Strategy:
- URL path versioning: `/api/v1/users` (recommended, most explicit)
- Version from day one. Never have unversioned endpoints.
- Document breaking changes between versions

### What Is a Breaking Change:
| Breaking | Not Breaking |
|----------|-------------|
| Removing a field from response | Adding a new field to response |
| Renaming a field | Adding a new optional query parameter |
| Changing a field's type | Adding a new endpoint |
| Removing an endpoint | Adding a new HTTP method to existing endpoint |
| Changing authentication method | Improving error messages |
| Making an optional parameter required | Adding new enum values (if client handles unknown) |

### Version Lifecycle:

```
v1 ACTIVE    -> v2 released -> v1 DEPRECATED -> v1 SUNSET (removed)
                              (6-12 months)   (after deprecation period)
```

| Phase | Description | Client Action Required |
|-------|-----------|----------------------|
| **Active** | Fully supported, receives bug fixes and security patches | None |
| **Deprecated** | Still functional but no new features. Sunset date announced. | Migrate to new version |
| **Sunset** | Removed. Returns 410 Gone. | Must have migrated |

### Deprecation Rules:
- Announce deprecation at least 6 months before sunset
- Return `Deprecation` header on deprecated endpoints: `Deprecation: true`
- Return `Sunset` header with removal date: `Sunset: Sat, 01 Jan 2027 00:00:00 GMT`
- Include migration guide in documentation
- Log usage of deprecated endpoints to track remaining consumers
- Send direct notification to known API consumers
- Support at least 2 versions simultaneously during transition

### Deprecation Response Headers:
```
Deprecation: true
Sunset: Sat, 01 Jan 2027 00:00:00 GMT
Link: <https://docs.yourdomain.com/api/migration/v1-to-v2>; rel="deprecation"
```

## 9. Endpoint Structure Pattern

### Express (Node.js)
```javascript
router.get('/api/v1/users', authenticate, async (req, res) => {
    try {
        const users = await UserService.list(req.query);
        res.json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
});
```

### Django REST Framework (Python)
```python
class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]
```

### Spring Boot (Java)
```java
@RestController
@RequestMapping("/api/v1/users")
public class UserController {
    @GetMapping
    public ResponseEntity<ApiResponse> listUsers() {
        List<User> users = userService.findAll();
        return ResponseEntity.ok(new ApiResponse(true, users));
    }
}
```

### PHP (Manual)
```php
header('Content-Type: application/json');
$method = $_SERVER['REQUEST_METHOD'];
if (!in_array($method, ['GET', 'POST'])) {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => ['code' => 'METHOD_NOT_ALLOWED']]);
    exit;
}
```

## 10. Pagination
```json
{
    "data": [...],
    "meta": {
        "page": 1,
        "per_page": 20,
        "total": 150,
        "total_pages": 8
    },
    "links": {
        "first": "/api/v1/users?page=1",
        "last": "/api/v1/users?page=8",
        "prev": null,
        "next": "/api/v1/users?page=2"
    }
}
```

## Implementation Requirement
Every API endpoint MUST follow this structure. Consistent responses, proper status codes, and clear error messages are non-negotiable.
