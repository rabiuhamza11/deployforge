// DeployForge Vercel Integration
// Creates projects, deploys apps, and manages Vercel operations

async function handleDeployforgeVercel(req, res) {
  const { action, projectName, repoUrl, repoOwner, repoName, branch, framework, rootDirectory, buildCommand, envVars, deploymentId, projectId } = req.body;
  
  const VERCEL_TOKEN = Deno.env.get('VERCEL_TOKEN_2') || Deno.env.get('VERCEL_TOKEN');
  const VERCEL_API = 'https://api.vercel.com';
  
  if (!VERCEL_TOKEN) {
    return res.status(500).json({ error: 'Vercel token not configured' });
  }
  
  const headers = {
    'Authorization': `Bearer ${VERCEL_TOKEN}`,
    'Content-Type': 'application/json',
  };
  
  // Get team ID
  const userResp = await fetch(`${VERCEL_API}/v2/user`, { headers });
  const userData = await userResp.json();
  const teamId = userData.user?.defaultTeamId;
  
  try {
    switch (action) {
      case 'createProject': {
        // Create a new Vercel project
        const projectBody = {
          name: projectName,
          framework: framework || 'nextjs',
        };
        
        if (repoUrl) {
          projectBody.gitRepository = {
            type: 'github',
            repo: `${repoOwner}/${repoName}`,
          };
        }
        
        if (rootDirectory) projectBody.rootDirectory = rootDirectory;
        if (buildCommand) projectBody.buildCommand = buildCommand;
        
        const projResp = await fetch(`${VERCEL_API}/v10/projects?teamId=${teamId}`, {
          method: 'POST', headers,
          body: JSON.stringify(projectBody),
        });
        
        if (!projResp.ok) {
          const err = await projResp.json();
          return res.status(400).json({ error: err.error?.message || 'Failed to create project', details: err });
        }
        
        const project = await projResp.json();
        
        // Set environment variables if provided
        if (envVars && Object.keys(envVars).length > 0) {
          for (const [key, value] of Object.entries(envVars)) {
            await fetch(`${VERCEL_API}/v9/projects/${project.id}/env?teamId=${teamId}`, {
              method: 'POST', headers,
              body: JSON.stringify({
                key, value: String(value), type: 'encrypted',
                target: ['production', 'preview', 'development'],
              }),
            });
          }
        }
        
        return res.json({
          success: true,
          project: {
            id: project.id,
            name: project.name,
            url: `https://${project.name}.vercel.app`,
          },
        });
      }
      
      case 'deployFiles': {
        // Deploy raw source files directly (no GitHub linking required).
        // Vercel detects the framework from package.json and builds automatically.
        // files: [{ path: 'src/app/page.tsx', content: '...' }, ...]
        if (!req.body.files || !req.body.files.length) {
          return res.status(400).json({ error: 'No files provided' });
        }

        const vercelFiles = req.body.files.map(f => ({
          file: f.path,
          data: f.content,
        }));

        const deployBody = {
          name: projectName,
          files: vercelFiles,
          target: 'production',
          projectSettings: {
            framework: framework === undefined ? null : framework,
          },
        };

        const deployResp = await fetch(`${VERCEL_API}/v13/deployments`, {
          method: 'POST', headers,
          body: JSON.stringify(deployBody),
        });

        const deployment = await deployResp.json();

        if (!deployResp.ok) {
          return res.status(400).json({ error: deployment.error?.message || 'Failed to deploy files', details: deployment });
        }

        return res.json({
          success: true,
          deployment: {
            id: deployment.id,
            url: deployment.url,
            readyState: deployment.readyState,
            inspector: deployment.inspectorUrl,
          },
        });
      }
      
      case 'deploy': {
        // Trigger a deployment for an existing project
        const deployResp = await fetch(`${VERCEL_API}/v13/deployments?projectId=${projectId}&teamId=${teamId}`, {
          method: 'POST', headers,
          body: JSON.stringify({
            name: projectName,
            target: 'production',
            gitSource: repoUrl ? {
              type: 'github',
              repoId: repoUrl,
              ref: branch || 'main',
            } : undefined,
            projectSettings: {
              framework: framework || 'nextjs',
              buildCommand: buildCommand || 'npm run build',
              outputDirectory: '.next',
              installCommand: 'npm install',
            },
          }),
        });
        
        if (!deployResp.ok) {
          const err = await deployResp.json();
          return res.status(400).json({ error: err.error?.message || 'Failed to deploy', details: err });
        }
        
        const deployment = await deployResp.json();
        return res.json({
          success: true,
          deployment: {
            id: deployment.id,
            url: deployment.url,
            readyState: deployment.readyState,
            inspector: deployment.inspectorUrl,
          },
        });
      }
      
      case 'getDeployment': {
        // Check deployment status
        const statusResp = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}?teamId=${teamId}`, { headers });
        if (!statusResp.ok) {
          return res.status(404).json({ error: 'Deployment not found' });
        }
        const deployment = await statusResp.json();
        return res.json({
          success: true,
          deployment: {
            id: deployment.id,
            url: deployment.url,
            readyState: deployment.readyState,
            created: deployment.created,
            meta: deployment.meta,
          },
        });
      }
      
      case 'getProjects': {
        // List all Vercel projects
        const projectsResp = await fetch(`${VERCEL_API}/v9/projects?limit=100&teamId=${teamId}`, { headers });
        const projectsData = await projectsResp.json();
        return res.json({
          success: true,
          projects: (projectsData.projects || []).map(p => ({
            id: p.id,
            name: p.name,
            framework: p.framework,
            url: `https://${p.name}.vercel.app`,
            updatedAt: p.updatedAt,
          })),
        });
      }
      
      case 'getProject': {
        const projResp = await fetch(`${VERCEL_API}/v9/projects/${projectId}?teamId=${teamId}`, { headers });
        if (!projResp.ok) {
          return res.status(404).json({ error: 'Project not found' });
        }
        const project = await projResp.json();
        
        // Get latest deployment
        const deploysResp = await fetch(`${VERCEL_API}/v6/deployments?projectId=${projectId}&limit=1&teamId=${teamId}`, { headers });
        const deploysData = await deploysResp.json();
        const latestDeploy = deploysData.deployments?.[0];
        
        return res.json({
          success: true,
          project: {
            id: project.id,
            name: project.name,
            framework: project.framework,
            url: `https://${project.name}.vercel.app`,
            ready: latestDeploy?.readyState === 'READY',
            latestDeployment: latestDeploy ? {
              id: latestDeploy.id,
              url: latestDeploy.url,
              state: latestDeploy.readyState,
              created: latestDeploy.createdAt,
            } : null,
          },
        });
      }
      
      case 'deleteProject': {
        const delResp = await fetch(`${VERCEL_API}/v9/projects/${projectId}?teamId=${teamId}`, {
          method: 'DELETE', headers,
        });
        if (delResp.status === 200 || delResp.status === 204) {
          return res.json({ success: true, message: 'Project deleted' });
        }
        return res.status(400).json({ error: 'Failed to delete project' });
      }
      
      case 'setEnvVars': {
        // Set environment variables on a project
        if (!envVars || !Object.keys(envVars).length) {
          return res.status(400).json({ error: 'No env vars provided' });
        }
        
        const results = [];
        for (const [key, value] of Object.entries(envVars)) {
          const envResp = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env?teamId=${teamId}`, {
            method: 'POST', headers,
            body: JSON.stringify({
              key, value: String(value), type: 'encrypted',
              target: ['production', 'preview', 'development'],
            }),
          });
          const envData = await envResp.json();
          results.push({ key, success: envResp.ok });
        }
        
        return res.json({ success: true, envVars: results });
      }
      
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  let statusCode = 200;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) {
      return new Response(JSON.stringify(data), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  return await handleDeployforgeVercel({ body }, res);
});
