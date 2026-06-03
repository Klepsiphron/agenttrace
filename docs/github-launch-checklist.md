# GitHub Repo Creation Checklist

## Pre-Push (Ryan approval required)

### Step 1: Create GitHub repo

- Go to https://github.com/new
- Owner: Klepsiphron
- Name: agenttrace
- Description: "Open source AI agent observability. Trace tokens, tools, latency, and cost. Local dashboard. Zero cloud dependency."
- Public
- Do NOT add README, .gitignore, or license (we have them locally)
- Create repo

### Step 2: Add remote and push

```bash
cd /home/ryano/projects/agenttrace
git remote add origin https://github.com/Klepsiphron/agenttrace.git
git push -u origin main
```

### Step 3: Configure repo settings

- Add topics (from .github/repo-metadata.yml)
- Upload social preview image (1280x640)
- Enable Issues, Discussions, Wiki
- Set website URL (if we have a landing page later)

### Step 4: Verify CI runs

- Go to Actions tab
- Confirm CI workflow passes on GitHub's runners

### Step 5: Create v0.1.0 release

- Tag: v0.1.0
- Title: "AgentTrace v0.1.0 -- Initial Release"
- Description: (from CHANGELOG.md)
- Attach: none (source only)

### Step 6: Post-launch

- Post on Hacker News (Show HN)
- Post on Product Hunt
- Post on relevant subreddits
- Post on X/Twitter
- Monitor issues and PRs for first 48h
