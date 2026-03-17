import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkillsShSource, GitHubSource } from './skill-source.js';

describe('SkillsShSource', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('search returns parsed results on success', async () => {
    const mockListings = [
      {
        id: 'skill-1',
        name: 'My Skill',
        description: 'A test skill',
        version: '1.0.0',
        author: 'alice',
        downloadUrl: 'https://api.skills.sh/skills/skill-1/download',
        installCount: 42,
      },
    ];
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockListings,
    } as Response);

    const source = new SkillsShSource();
    const results = await source.search('my skill');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.skills.sh/skills?q=my%20skill&page=1',
    );
    expect(results).toEqual(mockListings);
  });

  it('search returns empty array on error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const source = new SkillsShSource();
    const results = await source.search('broken');

    expect(results).toEqual([]);
  });

  it('search uses provided page parameter', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const source = new SkillsShSource('https://custom.api');
    await source.search('hello', 3);

    expect(fetch).toHaveBeenCalledWith(
      'https://custom.api/skills?q=hello&page=3',
    );
  });

  it('getLatestVersion returns version string on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ version: '2.3.1' }),
    } as Response);

    const source = new SkillsShSource();
    const version = await source.getLatestVersion('my-skill');

    expect(fetch).toHaveBeenCalledWith(
      'https://api.skills.sh/skills/my-skill/latest',
    );
    expect(version).toBe('2.3.1');
  });

  it('getLatestVersion returns null on error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const source = new SkillsShSource();
    const version = await source.getLatestVersion('nonexistent');

    expect(version).toBeNull();
  });

  it('download returns skill package on success', async () => {
    const mockPackage = {
      name: 'skill-1',
      version: '1.0.0',
      files: [{ path: 'SKILL.md', content: '# Skill' }],
    };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockPackage,
    } as Response);

    const source = new SkillsShSource();
    const pkg = await source.download('skill-1');

    expect(pkg).toEqual(mockPackage);
  });

  it('download throws on error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const source = new SkillsShSource();
    await expect(source.download('missing-skill')).rejects.toThrow(
      'Failed to download skill missing-skill: 404',
    );
  });
});

describe('GitHubSource', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('search maps repo data correctly', async () => {
    const mockRepos = {
      items: [
        {
          full_name: 'alice/cool-skill',
          name: 'cool-skill',
          description: 'A cool skill',
          owner: { login: 'alice' },
        },
        {
          full_name: 'bob/another-skill',
          name: 'another-skill',
          description: null,
          owner: { login: 'bob' },
        },
      ],
    };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockRepos,
    } as Response);

    const source = new GitHubSource();
    const results = await source.search('cool');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: 'alice/cool-skill',
      name: 'cool-skill',
      description: 'A cool skill',
      version: 'latest',
      author: 'alice',
      downloadUrl: 'https://api.github.com/repos/alice/cool-skill/tarball',
    });
    expect(results[1]).toMatchObject({
      id: 'bob/another-skill',
      description: '',
      author: 'bob',
    });
  });

  it('search returns empty array on error response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
    } as Response);

    const source = new GitHubSource();
    const results = await source.search('anything');

    expect(results).toEqual([]);
  });

  it('search returns empty array when items is missing', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const source = new GitHubSource();
    const results = await source.search('empty');

    expect(results).toEqual([]);
  });

  it('getLatestVersion returns tag_name on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ tag_name: 'v1.2.3' }),
    } as Response);

    const source = new GitHubSource();
    const version = await source.getLatestVersion('alice/my-skill');

    expect(version).toBe('v1.2.3');
  });

  it('getLatestVersion returns null on error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const source = new GitHubSource();
    const version = await source.getLatestVersion('alice/no-releases');

    expect(version).toBeNull();
  });

  it('download throws not implemented error', async () => {
    const source = new GitHubSource();
    await expect(source.download('alice/some-skill')).rejects.toThrow(
      'GitHubSource.download() not yet implemented',
    );
  });
});
