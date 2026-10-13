---
name: standard-infrastructure-as-code
description: "Standard 27 of the engineering standards library: infrastructure as code. Covers the core IaC principles (declarative, versioned, idempotent, immutable, environment parity), the tool landscape, Docker (multi-stage Dockerfile, docker-compose, image rules), Kubernetes (deployment manifest, probes, resource limits, namespaces), Terraform (layout, state, modules, rules), secrets in infrastructure, environment parity, and infrastructure testing. Read it BEFORE writing or changing a Dockerfile, a docker-compose file, a Kubernetes manifest, a Terraform module, or any environment provisioning, and when the user says \"Docker\", \"Dockerfile\", \"docker-compose\", \"container\", \"Kubernetes\", \"k8s\", \"Helm\", \"Terraform\", \"IaC\", \"provision\", \"environment parity\", or \"works on my machine\"."
---

# Infrastructure as Code: Docker, Kubernetes, Terraform

> **Agent rule.** `terraform apply`, `kubectl apply`, pushing an image, and similar commands change
> live infrastructure. They are deploys. An agent writes and validates the definitions (plan, lint,
> dry run) and applies them only when the owner explicitly asks.

## PHILOSOPHY
Infrastructure should be versioned, tested, and reviewed just like application code. If it is not in code, it does not exist. Manual server configuration is technical debt that compounds with every deployment.

## 1. CORE PRINCIPLES

### Declarative Over Imperative
Define WHAT the infrastructure should look like, not HOW to build it:
- Describe the desired end state
- Let the tool figure out how to get there
- Idempotent: running the same config twice produces the same result

### Key Principles:
- **Immutable Infrastructure**: Replace, do not patch. Deploy new instances instead of modifying running ones.
- **Version Control Everything**: All infrastructure definitions live in Git
- **Environment Parity**: Dev, staging, and production use the same templates with different parameters
- **Self-Documenting**: The code IS the documentation of your infrastructure
- **Least Privilege**: Every service gets only the permissions it needs

## 2. IaC TOOL LANDSCAPE

| Tool | Type | Best For |
|------|------|----------|
| **Terraform** | Provisioning | Multi-cloud infrastructure (AWS, GCP, Azure, etc.) |
| **Pulumi** | Provisioning | IaC using real programming languages (TypeScript, Python, Go) |
| **CloudFormation** | Provisioning | AWS-specific infrastructure |
| **Ansible** | Configuration | Server configuration management, application deployment |
| **Docker** | Containerization | Application packaging and isolation |
| **Kubernetes** | Orchestration | Container orchestration at scale |
| **Helm** | Templating | Kubernetes package management |
| **Vagrant** | Local Dev | Reproducible development environments |

## 3. CONTAINERIZATION (DOCKER)

### Dockerfile Best Practices

```dockerfile
# 1. Use specific version tags, NEVER "latest"
FROM node:20-alpine AS base

# 2. Set working directory
WORKDIR /app

# 3. Copy dependency files FIRST (layer caching)
COPY package.json package-lock.json ./

# 4. Install dependencies in a separate layer
RUN npm ci --only=production

# 5. Copy application code
COPY . .

# 6. Multi-stage build: build stage
FROM base AS build
RUN npm ci && npm run build

# 7. Multi-stage build: production stage
FROM base AS production
COPY --from=build /app/dist ./dist

# 8. Run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# 9. Expose port (documentation, not enforcement)
EXPOSE 3000

# 10. Use exec form for CMD
CMD ["node", "dist/server.js"]
```

### Docker Rules:
- Use multi-stage builds to minimize image size
- Pin base image versions (never use `latest`)
- Copy dependency files before source code (better layer caching)
- Run as non-root user
- Use `.dockerignore` to exclude unnecessary files
- One process per container
- Use health checks
- Never store secrets in images or Dockerfiles
- Scan images for vulnerabilities (`docker scout`, `trivy`, `grype`)

### Docker Compose for Local Development

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      target: development
    ports:
      - "${APP_PORT:-3000}:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/appdb
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    volumes:
      - db_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: appdb
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d appdb"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  db_data:
```

## 4. CONTAINER ORCHESTRATION (KUBERNETES)

### Core Concepts:
- **Pod**: Smallest deployable unit (one or more containers)
- **Deployment**: Manages pod replicas and rolling updates
- **Service**: Stable network endpoint for pods
- **ConfigMap**: Non-sensitive configuration data
- **Secret**: Sensitive configuration data (encrypted at rest)
- **Ingress**: External access routing (HTTP/HTTPS)
- **Namespace**: Logical isolation within a cluster

### Deployment Example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  labels:
    app: myapp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: app
          image: myregistry/myapp:1.2.3
          ports:
            - containerPort: 3000
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /ready
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: app-secrets
                  key: database-url
```

### Kubernetes Rules:
- Always set resource requests AND limits
- Use liveness AND readiness probes
- Never run containers as root
- Use namespaces to isolate environments
- Store secrets in a secrets manager (not plain Kubernetes Secrets)
- Use network policies to restrict pod-to-pod traffic
- Tag images with specific versions, never `latest`
- Use rolling updates with proper health checks

## 5. INFRASTRUCTURE PROVISIONING (TERRAFORM)

### Project Structure:

```
infrastructure/
  modules/              # Reusable modules
    networking/
    database/
    compute/
  environments/
    dev/
      main.tf
      variables.tf
      terraform.tfvars
    staging/
      main.tf
      variables.tf
      terraform.tfvars
    production/
      main.tf
      variables.tf
      terraform.tfvars
```

### Terraform Rules:
- Use remote state storage (S3, GCS, Azure Blob) with state locking
- Use modules for reusable infrastructure components
- Use variables for environment-specific values
- Use `terraform plan` before every `terraform apply`
- Never modify state files manually
- Pin provider and module versions
- Use workspaces or separate directories per environment
- Tag all resources with environment, project, and owner

## 6. SECRETS IN INFRASTRUCTURE

### NEVER Do This:
- Hardcode secrets in Dockerfiles, Terraform files, or Kubernetes manifests
- Commit secrets to version control
- Pass secrets as build arguments
- Store secrets in environment variables in CI/CD dashboard UIs

### DO This:
- Use a secrets manager (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault)
- Mount secrets as files or inject at runtime
- Rotate secrets automatically
- Audit secret access
- Use short-lived credentials where possible

## 7. ENVIRONMENT PARITY

### Same Template, Different Parameters:

| Aspect | Development | Staging | Production |
|--------|------------|---------|------------|
| Replicas | 1 | 2 | 3+ |
| Database | Local/Docker | Managed (small) | Managed (production-grade) |
| Logging | Debug level | Info level | Warning level |
| Monitoring | Optional | Enabled | Enabled + alerting |
| SSL/TLS | Self-signed | Real cert | Real cert + HSTS |
| Resources | Minimal | Moderate | Right-sized |

### Rules:
- Use the same Docker image across all environments
- Parameterize differences (do not branch)
- Test infrastructure changes in staging before production
- Automate environment provisioning (no manual steps)

## 8. INFRASTRUCTURE TESTING

| Test Type | What It Tests | Tools |
|-----------|--------------|-------|
| **Linting** | Syntax and best practices | `terraform validate`, `hadolint` (Dockerfile), `kubeval` |
| **Unit Tests** | Individual modules | Terratest, Pulumi testing framework |
| **Integration Tests** | Components working together | Terratest, Kitchen-Terraform |
| **Security Scanning** | Misconfigurations | Checkov, tfsec, Trivy, Snyk |
| **Compliance** | Policy enforcement | OPA/Rego, Sentinel, Kyverno |
| **Chaos Testing** | Resilience under failure | Chaos Monkey, Litmus, Gremlin |

### Rules:
- Lint all infrastructure code in CI
- Scan for security misconfigurations before deployment
- Test infrastructure changes in an isolated environment
- Run compliance checks automatically

## IMPLEMENTATION REQUIREMENT
Every deployment is automated. Every environment is reproducible. Every infrastructure change goes through code review. If you cannot rebuild your entire infrastructure from code in under an hour, you have a problem.

## RELATED SKILLS

- `standard-ci-cd-pipeline`: the pipeline that builds and ships these artifacts.
- `standard-config-and-secrets`: environment variables and secret handling.
- `standard-scalability-patterns`: load balancing and auto-scaling design.
- `standard-local-dev-environment`: running the stack locally.
