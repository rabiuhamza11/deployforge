// DeployForge Admin Dashboard API
// Returns all deployment tasks, project statuses, and platform stats

export default async function deployforgeAdmin(req, res) {
  const { action, task_id } = req.body;
  
  try {
    // Access DeployTask entity records
    const base44 = (global as any).base44 || {};
    const DeployTask = base44.entities?.DeployTask;
    
    switch (action) {
      case 'list': {
        // Get all deployment tasks
        const tasks = DeployTask 
          ? await DeployTask.list({ limit: 100, sort: '-created_date' })
          : [];
        
        // Get platform stats
        const stats = {
          total: tasks.length,
          live: tasks.filter(t => t.deploy_status === 'live').length,
          building: tasks.filter(t => t.deploy_status === 'vercel_deploying' || t.vercel_status === 'building').length,
          failed: tasks.filter(t => t.deploy_status === 'failed').length,
          github_pushed: tasks.filter(t => t.github_status === 'pushed').length,
        };
        
        return res.json({
          success: true,
          tasks: tasks.map(t => ({
            id: t.id,
            project_name: t.project_name,
            framework: t.framework,
            deploy_status: t.deploy_status,
            github_status: t.github_status,
            vercel_status: t.vercel_status,
            github_repo: t.github_repo,
            github_owner: t.github_owner,
            live_url: t.live_url,
            vercel_url: t.vercel_url,
            vercel_project_id: t.vercel_project_id,
            deploy_count: t.deploy_count,
            created_date: t.created_date,
            error_message: t.error_message,
          })),
          stats,
        });
      }
      
      case 'get': {
        if (!task_id) return res.status(400).json({ error: 'task_id required' });
        const task = DeployTask ? await DeployTask.get(task_id) : null;
        if (!task) return res.status(404).json({ error: 'Task not found' });
        
        return res.json({
          success: true,
          task: {
            id: task.id,
            project_name: task.project_name,
            framework: task.framework,
            source_type: task.source_type,
            source_url: task.source_url,
            deploy_status: task.deploy_status,
            github_status: task.github_status,
            vercel_status: task.vercel_status,
            github_repo: task.github_repo,
            github_owner: task.github_owner,
            vercel_project_id: task.vercel_project_id,
            vercel_url: task.vercel_url,
            live_url: task.live_url,
            deploy_count: task.deploy_count,
            env_vars: task.env_vars,
            config_json: task.config_json,
            build_logs: task.build_logs,
            error_message: task.error_message,
            created_date: task.created_date,
            updated_date: task.updated_date,
          },
        });
      }
      
      case 'delete': {
        if (!task_id) return res.status(400).json({ error: 'task_id required' });
        if (DeployTask) await DeployTask.delete(task_id);
        return res.json({ success: true, message: 'Task deleted' });
      }
      
      case 'stats': {
        const tasks = DeployTask 
          ? await DeployTask.list({ limit: 100 })
          : [];
        
        // GitHub stats
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
        let ghRepos = [];
        if (GITHUB_TOKEN) {
          try {
            const ghResp = await fetch('https://api.github.com/user/repos?sort=updated&per_page=10', {
              headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' },
            });
            const repos = await ghResp.json();
            ghRepos = repos.map(r => ({ name: r.name, url: r.html_url, updated: r.updated_at, language: r.language }));
          } catch {}
        }
        
        // Vercel stats
        const VERCEL_TOKEN = process.env.VERCEL_TOKEN || process.env.VERCEL_TOKEN_2;
        let vcProjects = [];
        if (VERCEL_TOKEN) {
          try {
            const userResp = await fetch('https://api.vercel.com/v2/user', {
              headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` },
            });
            const userData = await userResp.json();
            const teamId = userData.user?.defaultTeamId;
            
            const projResp = await fetch(`https://api.vercel.com/v9/projects?limit=20&teamId=${teamId}`, {
              headers: { 'Authorization': `Bearer ${VERCEL_TOKEN}` },
            });
            const projData = await projResp.json();
            vcProjects = (projData.projects || []).map(p => ({
              name: p.name, id: p.id, framework: p.framework, url: `https://${p.name}.vercel.app`,
            }));
          } catch {}
        }
        
        return res.json({
          success: true,
          stats: {
            total_deployments: tasks.length,
            live: tasks.filter(t => t.deploy_status === 'live').length,
            failed: tasks.filter(t => t.deploy_status === 'failed').length,
          },
          github: { connected: !!GITHUB_TOKEN, repos: ghRepos },
          vercel: { connected: !!VERCEL_TOKEN, projects: vcProjects },
        });
      }
      
      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
