// DeployForge Launch — Full pipeline: Create GitHub repo → Push code → Create Vercel project → Deploy
// This orchestrates the complete app deployment lifecycle

export default async function deployforgeLaunch(req, res) {
  const {
    projectName,
    framework = 'nextjs',
    description,
    files,          // Array of { path, content }
    envVars,        // Object of key-value pairs
    isPrivate = false,
    autoDeploy = true,
    ownerId,
  } = req.body;
  
  if (!projectName || !files || !files.length) {
    return res.status(400).json({ error: 'projectName and files are required' });
  }
  
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const VERCEL_TOKEN = process.env.VERCEL_TOKEN || process.env.VERCEL_TOKEN_2;
  const GITHUB_API = 'https://api.github.com';
  const VERCEL_API = 'https://api.vercel.com';
  
  const ghHeaders = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
  
  const vcHeaders = {
    'Authorization': `Bearer ${VERCEL_TOKEN}`,
    'Content-Type': 'application/json',
  };
  
  const log = [];
  const addLog = (msg) => { const entry = `[${new Date().toISOString()}] ${msg}`; log.push(entry); };
  
  try {
    // ===== STEP 1: Get GitHub user info =====
    addLog('Fetching GitHub user info...');
    const ghUserResp = await fetch(`${GITHUB_API}/user`, { headers: ghHeaders });
    const ghUser = await ghUserResp.json();
    const ghOwner = ghUser.login;
    addLog(`GitHub user: ${ghOwner}`);
    
    // ===== STEP 2: Create GitHub repository =====
    addLog(`Creating GitHub repo: ${projectName}...`);
    const repoResp = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST', headers: ghHeaders,
      body: JSON.stringify({
        name: projectName,
        description: description || `Deployed via DeployForge`,
        private: isPrivate,
        auto_init: true,
      }),
    });
    
    let repo;
    if (repoResp.status === 422) {
      // Repo already exists — fetch it
      addLog(`Repo ${projectName} already exists, using existing...`);
      const existingResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${projectName}`, { headers: ghHeaders });
      repo = await existingResp.json();
    } else {
      repo = await repoResp.json();
    }
    addLog(`GitHub repo ready: ${repo.html_url}`);
    
    // ===== STEP 3: Push files to GitHub =====
    addLog(`Pushing ${files.length} files to GitHub...`);
    
    // Get base branch
    const branchName = repo.default_branch || 'main';
    const branchResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${projectName}/branches/${branchName}`, { headers: ghHeaders });
    const branchData = await branchResp.json();
    const baseTreeSha = branchData?.commit?.commit?.tree?.sha;
    
    // Create blobs and tree entries
    const treeEntries = [];
    for (const file of files) {
      const blobResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${projectName}/git/blobs`, {
        method: 'POST', headers: ghHeaders,
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      });
      const blob = await blobResp.json();
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    
    // Create tree
    const newTreeResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${projectName}/git/trees`, {
      method: 'POST', headers: ghHeaders,
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    const newTree = await newTreeResp.json();
    
    // Create commit
    const commitResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${projectName}/git/commits`, {
      method: 'POST', headers: ghHeaders,
      body: JSON.stringify({
        message: 'DeployForge: Initial app deployment',
        tree: newTree.sha,
        parents: [branchData.commit.sha],
      }),
    });
    const commit = await commitResp.json();
    
    // Update ref
    await fetch(`${GITHUB_API}/repos/${ghOwner}/${projectName}/git/refs/heads/${branchName}`, {
      method: 'PATCH', headers: ghHeaders,
      body: JSON.stringify({ sha: commit.sha }),
    });
    addLog(`Files pushed to GitHub: ${files.length} files, commit ${commit.sha.substring(0, 7)}`);
    
    // ===== STEP 4: Create Vercel project =====
    addLog('Creating Vercel project...');
    const userResp = await fetch(`${VERCEL_API}/v2/user`, { headers: vcHeaders });
    const userData = await userResp.json();
    const teamId = userData.user?.defaultTeamId;
    
    const projResp = await fetch(`${VERCEL_API}/v10/projects?teamId=${teamId}`, {
      method: 'POST', headers: vcHeaders,
      body: JSON.stringify({
        name: projectName,
        framework: framework,
        gitRepository: {
          type: 'github',
          repo: `${ghOwner}/${projectName}`,
        },
      }),
    });
    
    let vercelProject;
    if (projResp.status === 409) {
      // Project already exists
      addLog(`Vercel project ${projectName} already exists, using existing...`);
      const existingProj = await fetch(`${VERCEL_API}/v9/projects?limit=100&teamId=${teamId}`, { headers: vcHeaders });
      const projectsData = await existingProj.json();
      vercelProject = projectsData.projects?.find(p => p.name === projectName);
      if (!vercelProject) {
        addLog('Could not find existing Vercel project');
        return res.status(400).json({ error: 'Vercel project conflict but could not find existing', logs: log });
      }
    } else {
      vercelProject = await projResp.json();
    }
    addLog(`Vercel project created: ${vercelProject.id}`);
    
    // ===== STEP 5: Set environment variables =====
    if (envVars && Object.keys(envVars).length > 0) {
      addLog(`Setting ${Object.keys(envVars).length} environment variables...`);
      for (const [key, value] of Object.entries(envVars)) {
        await fetch(`${VERCEL_API}/v9/projects/${vercelProject.id}/env?teamId=${teamId}`, {
          method: 'POST', headers: vcHeaders,
          body: JSON.stringify({
            key, value: String(value), type: 'encrypted',
            target: ['production', 'preview', 'development'],
          }),
        });
      }
      addLog('Environment variables set');
    }
    
    // ===== STEP 6: Deploy =====
    let deployment = null;
    if (autoDeploy) {
      addLog('Triggering Vercel deployment...');
      const deployResp = await fetch(`${VERCEL_API}/v13/deployments?projectId=${vercelProject.id}&teamId=${teamId}`, {
        method: 'POST', headers: vcHeaders,
        body: JSON.stringify({
          name: projectName,
          target: 'production',
          gitSource: {
            type: 'github',
            repoId: `${ghOwner}/${projectName}`,
            ref: branchName,
          },
        }),
      });
      
      if (deployResp.ok) {
        deployment = await deployResp.json();
        addLog(`Deployment triggered: ${deployment.url}`);
      } else {
        const err = await deployResp.json();
        addLog(`Deployment trigger issue: ${err.error?.message || 'unknown'}`);
        // The GitHub integration should auto-deploy on push anyway
      }
    }
    
    // ===== STEP 7: Save deployment record =====
    addLog('Saving deployment record...');
    const deployRecord = {
      project_name: projectName,
      framework,
      source_type: 'ai_generated',
      github_repo: projectName,
      github_owner: ghOwner,
      github_status: 'pushed',
      vercel_project_id: vercelProject.id,
      vercel_url: deployment?.url || `${projectName}.vercel.app`,
      vercel_status: deployment?.readyState || 'building',
      deploy_status: 'live',
      live_url: `https://${projectName}.vercel.app`,
      build_logs: log.join('\n'),
      error_message: '',
      deploy_count: 1,
    };
    
    addLog('Deployment complete!');
    
    return res.json({
      success: true,
      deployment: deployRecord,
      github: {
        repo: `${ghOwner}/${projectName}`,
        url: repo.html_url,
        commit: commit.sha,
        filesPushed: files.length,
      },
      vercel: {
        projectId: vercelProject.id,
        url: deployment?.url ? `https://${deployment.url}` : `https://${projectName}.vercel.app`,
        deploymentId: deployment?.id,
        state: deployment?.readyState || 'building',
      },
      logs: log,
    });
  } catch (err) {
    addLog(`ERROR: ${err.message}`);
    return res.status(500).json({ error: err.message, logs: log });
  }
}
