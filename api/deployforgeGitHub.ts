// DeployForge GitHub Integration
// Creates repos, pushes files, and manages GitHub operations

Deno.serve(async (req) => {
  let body = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const { action, repoName, files, owner, description, isPrivate, branch, tagName, releaseName, releaseBody, targetBranch } = body;

  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });

  const GITHUB_TOKEN = Deno.env.get('GITHUB_TOKEN') || Deno.env.get('GH_TOKEN');
  const GITHUB_API = 'https://api.github.com';

  if (!GITHUB_TOKEN) {
    return json({ error: 'GitHub token not configured' }, 500);
  }

  const headers = {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'omega-deployforge-agent',
  };

  try {
    // Get authenticated user
    const userResp = await fetch(`${GITHUB_API}/user`, { headers });
    const user = await userResp.json();
    const ghOwner = owner || user.login;

    switch (action) {
      case 'createRepo': {
        const repoResp = await fetch(`${GITHUB_API}/user/repos`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: repoName,
            description: description || `Deployed via DeployForge`,
            private: isPrivate || false,
            auto_init: true,
          }),
        });

        if (!repoResp.ok) {
          const err = await repoResp.json();
          return json({ error: err.message, details: err }, 400);
        }

        const repo = await repoResp.json();
        return json({
          success: true,
          repo: {
            name: repo.name,
            full_name: repo.full_name,
            url: repo.html_url,
            clone_url: repo.clone_url,
            default_branch: repo.default_branch,
          },
        });
      }

      case 'pushFiles': {
        if (!files || !files.length) {
          return json({ error: 'No files provided' }, 400);
        }

        const branchName = branch || 'main';
        let branchResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/branches/${branchName}`, { headers });

        if (!branchResp.ok) {
          const refsResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/git/refs`, { headers });
          const refs = await refsResp.json();
          const mainRef = refs.find(r => r.ref === 'refs/heads/main' || r.ref === 'refs/heads/master');
          if (!mainRef) {
            return json({ error: 'Could not find base branch' }, 400);
          }
          await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/git/refs`, {
            method: 'POST', headers,
            body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: mainRef.object.sha }),
          });
          branchResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/branches/${branchName}`, { headers });
        }

        const branchData = await branchResp.json();
        const baseTreeSha = branchData?.commit?.commit?.tree?.sha;

        // Create blobs for each file
        const treeEntries = [];
        for (const file of files) {
          const blobResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/git/blobs`, {
            method: 'POST', headers,
            body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
          });
          const blob = await blobResp.json();
          treeEntries.push({
            path: file.path,
            mode: '100644',
            type: 'blob',
            sha: blob.sha,
          });
        }

        const newTreeResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/git/trees`, {
          method: 'POST', headers,
          body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
        });
        const newTree = await newTreeResp.json();

        const commitResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/git/commits`, {
          method: 'POST', headers,
          body: JSON.stringify({
            message: 'DeployForge: Update',
            tree: newTree.sha,
            parents: [branchData.commit.sha],
          }),
        });
        const commit = await commitResp.json();

        await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/git/refs/heads/${branchName}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ sha: commit.sha }),
        });

        return json({
          success: true,
          commit: {
            sha: commit.sha,
            message: commit.message,
            url: commit.html_url,
          },
          filesPushed: files.length,
        });
      }

      case 'getRepos': {
        const reposResp = await fetch(`${GITHUB_API}/user/repos?sort=updated&per_page=100`, { headers });
        const repos = await reposResp.json();
        return json({
          success: true,
          repos: repos.map(r => ({
            name: r.name,
            full_name: r.full_name,
            url: r.html_url,
            clone_url: r.clone_url,
            default_branch: r.default_branch,
            updated_at: r.updated_at,
            language: r.language,
          })),
        });
      }

      case 'getRepo': {
        const repoResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}`, { headers });
        if (!repoResp.ok) {
          return json({ error: 'Repository not found' }, 404);
        }
        const repo = await repoResp.json();
        return json({
          success: true,
          repo: {
            name: repo.name,
            full_name: repo.full_name,
            url: repo.html_url,
            clone_url: repo.clone_url,
            default_branch: repo.default_branch,
            size: repo.size,
            updated_at: repo.updated_at,
          },
        });
      }

      case 'deleteRepo': {
        const delResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}`, {
          method: 'DELETE', headers,
        });
        if (delResp.status === 204) {
          return json({ success: true, message: 'Repository deleted' });
        }
        return json({ error: 'Failed to delete repository' }, 400);
      }

      case 'createRelease': {
        if (!tagName) {
          return json({ error: 'tagName is required' }, 400);
        }
        const releaseResp = await fetch(`${GITHUB_API}/repos/${ghOwner}/${repoName}/releases`, {
          method: 'POST', headers,
          body: JSON.stringify({
            tag_name: tagName,
            target_commitish: targetBranch || 'main',
            name: releaseName || tagName,
            body: releaseBody || '',
            draft: false,
            prerelease: false,
          }),
        });
        if (!releaseResp.ok) {
          const err = await releaseResp.json();
          return json({ error: err.message, details: err }, 400);
        }
        const release = await releaseResp.json();
        return json({
          success: true,
          release: {
            tag_name: release.tag_name,
            name: release.name,
            url: release.html_url,
          },
        });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});
