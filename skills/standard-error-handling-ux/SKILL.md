---
name: standard-error-handling-ux
description: Standard for user-facing error handling and feedback states. Covers custom 404, 403, 500 and 503 pages, development versus production error display, user-friendly success, error, warning and info messages, form validation feedback, mandatory loading states, empty states, offline and timeout handling for network calls with a fetch wrapper sample, and basic server-side error logging rules. Read before building or changing any page, form, data table, list, button that triggers a request, API call from the client, or error page, and when the user says "error message", "error page", "404 page", "loading state", "spinner", "skeleton", "empty state", "form validation", "it shows a raw error", "nothing happens when I click" or "what does the user see when this fails".
---

# Standard 12 - Error Handling and User Experience

Related skills, each the authority on its part:

- `error-alert-system`: how backend failures are captured, deduplicated and alerted. A catch block
  in a backend path that logs but never reports is a silent production bug; see that skill.
- `page-performance`: for React apps it governs loading-state details (prefer stale data over
  skeletons, optimistic updates, never swap the whole page structure on loading). Where it is more
  specific than this standard, follow it.
- `standard-logging-monitoring`: full logging rules. Section 8 below is only the short form.
- `standard-accessibility-wcag`: accessible announcements of errors.
- `standard-api-design`: the error response shape the client receives.

## Philosophy
Users should NEVER see raw errors, stack traces, or cryptic messages.

## 1. Custom Error Pages
- **404 Not Found**: Friendly page with search, navigation links, and "go home" button
- **403 Forbidden**: Explain access denied, provide login link if applicable
- **500 Server Error**: Apologetic message, suggest retry, provide contact info
- **503 Maintenance**: Maintenance message with estimated return time
- All error pages MUST follow the project's design system
- Include site navigation on error pages

## 2. Error Handling by Environment

### Development
- Display detailed errors (stack traces, file paths, query info)
- Enable verbose logging
- Show debug toolbars where available

### Production
- Display friendly, generic error messages to users
- Log full error details server-side
- Never expose: file paths, SQL queries, stack traces, server config, dependency versions

### Implementation Pattern (All Languages):
```
IF environment == development:
    Show detailed error to developer
ELSE:
    Log full error to file/service
    Show friendly message to user
    Return appropriate HTTP status code
```

## 3. User-friendly Messages
- **Success**: Clear confirmation ("Your profile has been updated successfully")
- **Error**: Plain language ("We could not save your changes. Please try again.")
- **Warning**: Inform and suggest ("Your session will expire in 5 minutes")
- **Info**: Helpful context ("Tip: You can drag items to reorder them")
- Use consistent styling from the design system for all message types

## 4. Form Validation Feedback
- Inline validation as user types (debounced, 300ms+)
- Clear error message next to the field with the error
- Highlight invalid fields with border color change
- Show success indicator when field is valid
- Summarize errors at top of form for accessibility
- ALWAYS preserve user input on error (never clear the form)
- Both client-side AND server-side validation (server is the source of truth)

## 5. Loading States (Mandatory)
- Show loading indicator for any operation > 300ms
- **Button loading**: Disable button + show spinner + change text ("Saving...")
- **Page loading**: Skeleton screens preferred over spinners
- **Data tables**: Placeholder rows while loading
- **Infinite scroll**: Loading indicator at bottom of list
- Never leave the user wondering if something is happening

## 6. Empty States
- Friendly icon or illustration
- Clear message explaining the empty state
- Call-to-action to populate the section
- Examples:
  - "No messages yet. Start a conversation."
  - "No results found. Try a different search."
  - "Your cart is empty. Browse products."

## 7. Network Error Handling
```javascript
// Detect offline status
window.addEventListener('offline', () => showNotification('You are offline', 'warning'));
window.addEventListener('online', () => showNotification('Back online', 'success'));

// API call with timeout
async function apiCall(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
            showNotification('Request timed out. Please try again.', 'error');
        } else {
            showNotification('Something went wrong. Please try again.', 'error');
        }
        throw error;
    }
}
```

## 8. Server-side Logging
- Log format: `[TIMESTAMP] [LEVEL] [SOURCE] Message {context}`
- Log ALL errors with: timestamp, severity, message, source location
- Log security events separately (failed logins, permission denials)
- Rotate logs to prevent disk exhaustion (max 10MB per file)
- NEVER log: passwords, tokens, PII, credit card numbers, or sensitive data
- Use structured logging (JSON) for production environments

## Implementation Requirement
Every page, every form, every API call must handle errors gracefully. The user should always know what happened and what to do next.
