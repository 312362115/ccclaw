export interface SkillListing {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloadUrl: string;
  installCount?: number;
}

export interface SkillPackage {
  name: string;
  version: string;
  files: { path: string; content: string }[];
}

export interface SkillSource {
  search(query: string, page?: number): Promise<SkillListing[]>;
  download(id: string): Promise<SkillPackage>;
  getLatestVersion(name: string): Promise<string | null>;
}

// Placeholder implementation for skills.sh marketplace
export class SkillsShSource implements SkillSource {
  private baseUrl: string;

  constructor(baseUrl = 'https://api.skills.sh') {
    this.baseUrl = baseUrl;
  }

  async search(query: string, page = 1): Promise<SkillListing[]> {
    const resp = await fetch(`${this.baseUrl}/skills?q=${encodeURIComponent(query)}&page=${page}`);
    if (!resp.ok) return [];
    return resp.json();
  }

  async download(id: string): Promise<SkillPackage> {
    const resp = await fetch(`${this.baseUrl}/skills/${id}/download`);
    if (!resp.ok) throw new Error(`Failed to download skill ${id}: ${resp.status}`);
    return resp.json();
  }

  async getLatestVersion(name: string): Promise<string | null> {
    const resp = await fetch(`${this.baseUrl}/skills/${name}/latest`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.version ?? null;
  }
}

// GitHub repo source
export class GitHubSource implements SkillSource {
  async search(query: string): Promise<SkillListing[]> {
    // Search GitHub for repos with topic 'ccclaw-skill'
    const resp = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+topic:ccclaw-skill`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.items || []).map((repo: any) => ({
      id: repo.full_name,
      name: repo.name,
      description: repo.description || '',
      version: 'latest',
      author: repo.owner?.login || '',
      downloadUrl: `https://api.github.com/repos/${repo.full_name}/tarball`,
    }));
  }

  async download(id: string): Promise<SkillPackage> {
    // Download repo tarball and extract SKILL.md + scripts
    throw new Error('GitHubSource.download() not yet implemented');
  }

  async getLatestVersion(name: string): Promise<string | null> {
    // Check latest release tag
    const resp = await fetch(`https://api.github.com/repos/${name}/releases/latest`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.tag_name ?? null;
  }
}
