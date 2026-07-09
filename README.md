# DeployForge

Multi-platform deployment engine powering the Harz ecosystem. DeployForge takes an app's source files and ships them straight to GitHub + Vercel (with Render, Netlify, and Railway support available via the sibling FluxDeploy service), tracking every deployment in a central dashboard.

## What it does

1. Creates (or reuses) a GitHub repository for a project
2. Pushes source files via the Git Data API (blobs → tree → commit → ref update)
3. Creates a matching Vercel project linked to that GitHub repo
4. Sets environment variables on the Vercel project
5. Triggers a production deployment
6. Records the full deployment history (status, URLs, logs) for the admin dashboard

## Architecture

DeployForge runs as a set of serverless functions (Deno runtime) rather than a traditional server. Each file below is a standalone HTTP endpoint:

| File | Purpose |
|---|---|
| `deployforgeGitHub.ts` | GitHub operations: createRepo, pushFiles, getRepos, getRepo, deleteRepo, createRelease |
| `deployforgeVercel.ts` | Vercel operations: createProject, deployFiles, deploy, getDeployment, getProjects, getProject, deleteProject, setEnvVars |
| `deployforgeLaunch.ts` | Orchestrates the full pipeline in one call: GitHub repo → push → Vercel project → env vars → deploy |
| `deployforgeAdmin.ts` | Admin dashboard API: list/get/delete deployment tasks, aggregate stats across GitHub + Vercel |

## Usage

### Full one-shot launch

```
POST /deployforgeLaunch
{
  "projectName": "my-app",
  "framework": "nextjs",
  "files": [{ "path": "package.json", "content": "..." }, ...],
  "envVars": { "API_KEY": "..." },
  "isPrivate": false,
  "autoDeploy": true
}
```

### Individual GitHub operations

```
POST /deployforgeGitHub
{ "action": "createRepo", "repoName": "my-app", "description": "...", "isPrivate": false }

POST /deployforgeGitHub
{ "action": "pushFiles", "repoName": "my-app", "files": [{ "path": "index.js", "content": "..." }] }

POST /deployforgeGitHub
{ "action": "getRepos" }

POST /deployforgeGitHub
{ "action": "createRelease", "repoName": "my-app", "tagName": "v1.0.0" }
```

### Individual Vercel operations

```
POST /deployforgeVercel
{ "action": "createProject", "projectName": "my-app", "framework": "nextjs" }

POST /deployforgeVercel
{ "action": "deployFiles", "projectName": "my-app", "files": [{ "path": "index.html", "content": "..." }] }

POST /deployforgeVercel
{ "action": "getProjects" }
```

### Admin dashboard data

```
POST /deployforgeAdmin
{ "action": "list" }

POST /deployforgeAdmin
{ "action": "stats" }
```

## Environment variables

- `GITHUB_TOKEN` (or `GH_TOKEN`) — GitHub personal access token with repo scope
- `VERCEL_TOKEN` (or `VERCEL_TOKEN_2`) — Vercel API token

## Related projects

- FluxDeploy — extends this same pattern to Render, Netlify, and Railway for true multi-platform (5-service) simultaneous deployment
- omega-ai-packager — CLI that packages OMEGA agent projects and ships them through DeployForge

## Author

Rabiu Hamza (github.com/rabiuhamza11)
