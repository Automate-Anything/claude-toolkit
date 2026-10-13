---
name: standard-clean-urls
description: Standard for clean, extension-free URLs and how to implement them per framework. Covers good versus bad URL examples, Apache .htaccess and Nginx rewrite rules, Express, Next.js, Nuxt, SvelteKit, Django, Flask and Spring Boot routing, clean URLs in links, form actions, redirects and canonical tags, and URL naming best practices. Read before adding a page route, writing a rewrite rule or server config, creating a link, form action or redirect, or naming an API path, and when the user says "remove .php from the URL", "remove .html", "clean URLs", "pretty URLs", "rewrite rule", ".htaccess" or "the URL has a file extension". If a url-structure skill exists in the toolkit, read it for URL hierarchy and information architecture, and use this one for the per-framework implementation.
---

# Standard 05 - Clean URL Structure

Scope: making every URL human-readable and free of file extensions, with the server or router
configuration that achieves it on each stack.

Related skills: if the toolkit contains a `url-structure` skill, it is the authority on URL
hierarchy, slugs and site-wide URL design; this standard supplies the per-framework implementation
and the no-extension rule. `seo` covers canonicals, redirects and migrations in depth.
`standard-api-design` covers API path conventions.

## Mandatory
ALL URLs must be clean, human-readable, and free of file extensions (.php, .html, .jsp, .aspx). Every link, every form action, every redirect.

## 1. Clean URL Examples
```
GOOD:                              BAD:
/about                             /about.php
/services/web-design               /services/web-design.html
/admin/dashboard                   /admin/dashboard.php
/api/v1/users                      /api/v1/users.php
/blog/my-first-post                /blog.php?id=123
/products/blue-sneakers            /product.jsp?sku=12345
```

## 2. Implementation by Framework

### PHP + Apache (.htaccess)
```apache
RewriteEngine On

# Remove .php extension from URLs
RewriteCond %{REQUEST_FILENAME} !-d
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^([^\.]+)$ $1.php [NC,L]

# Redirect .php requests to clean URLs (301)
RewriteCond %{THE_REQUEST} /([^.]+)\.php [NC]
RewriteRule ^ /%1 [NC,L,R=301]

# Remove trailing slashes
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)/$ /$1 [R=301,L]

# Block direct access to sensitive directories
RewriteRule ^(includes|config|logs|cache|vendor)/ - [F,L]
```

### PHP + Nginx
```nginx
location / {
    try_files $uri $uri/ /index.php?$query_string;
}

# Block access to sensitive directories
location ~ ^/(includes|config|logs|cache|vendor) {
    deny all;
}
```

### Node.js / Express
```javascript
// Express handles clean URLs natively via routing
app.get('/about', (req, res) => res.render('about'));
app.get('/services/:service', (req, res) => res.render('service', { service: req.params.service }));
app.get('/api/v1/users', usersController.list);
```

### Next.js / Nuxt / SvelteKit
- File-based routing automatically creates clean URLs
- `/pages/about.tsx` becomes `/about`
- `/pages/blog/[slug].tsx` becomes `/blog/my-post`

### Python / Django
```python
# urls.py - Django URL configuration
urlpatterns = [
    path('about/', views.about, name='about'),
    path('services/<slug:service>/', views.service_detail, name='service-detail'),
    path('api/v1/users/', views.user_list, name='user-list'),
]
```

### Python / Flask
```python
@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/services/<service>')
def service_detail(service):
    return render_template('service.html', service=service)
```

### Java / Spring Boot
```java
@GetMapping("/about")
public String about(Model model) {
    return "about";
}

@GetMapping("/services/{service}")
public String serviceDetail(@PathVariable String service, Model model) {
    return "service-detail";
}
```

## 3. Link Rules (All Frameworks)
```html
<!-- ALWAYS use clean URLs in ALL links -->
<a href="/about">About Us</a>
<a href="/services/web-design">Web Design</a>
<a href="/admin/dashboard">Dashboard</a>

<!-- ALWAYS use clean URLs in forms -->
<form action="/contact/submit" method="POST">
<form action="/api/v1/users" method="POST">

<!-- ALWAYS use clean URLs in redirects -->
<!-- PHP: header('Location: /dashboard'); -->
<!-- Express: res.redirect('/dashboard'); -->
<!-- Django: redirect('dashboard') -->
<!-- Spring: return "redirect:/dashboard"; -->

<!-- ALWAYS use clean URLs in canonical tags -->
<link rel="canonical" href="https://yourdomain.com/about">
```

## 4. URL Best Practices
- Use lowercase only: `/about-us` not `/About-Us`
- Use hyphens for word separation: `/web-design` not `/web_design` or `/webdesign`
- Keep URLs short and descriptive: `/pricing` not `/our-pricing-plans-and-packages`
- Use nouns for resources: `/products/123` not `/getProduct?id=123`
- Version APIs in the URL: `/api/v1/users` not `/api/users?version=1`
- No query parameters for page identity (use path segments instead)
- Implement 301 redirects for changed URLs (never break old links)

## Implementation Requirement
Every URL must be clean. No exceptions. This applies to all links, forms, redirects, canonical tags, and API endpoints.
