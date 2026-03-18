import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { ContentPageShell } from '../../components/ContentPageShell';
import { Button } from '../../components/ui/Button';

interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  installCount: number;
}

interface SearchResult {
  results: MarketplaceSkill[];
  total: number;
}

export function SkillMarketplace() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SearchResult>({ results: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  const search = useCallback(async (q: string, p: number) => {
    setLoading(true);
    try {
      const res = await api<SearchResult>(
        `/marketplace/search?q=${encodeURIComponent(q)}&page=${p}`,
      );
      setData(res);
    } catch {
      setData({ results: [], total: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    search(query, page);
  }, [page, search]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    search(query, 1);
  };

  const handleInstall = async (skill: MarketplaceSkill) => {
    setInstallingId(skill.id);
    try {
      await api(`/marketplace/${skill.id}/install`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setInstalledIds((prev) => new Set(prev).add(skill.id));
    } catch {
      // 安装失败静默处理
    } finally {
      setInstallingId(null);
    }
  };

  return (
    <ContentPageShell>
      <div className="px-7 pt-7">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[22px] font-bold">Skill 市场</h2>
          <Button variant="ghost" onClick={() => navigate('/skills')}>
            返回技能管理
          </Button>
        </div>
        <p className="text-text-muted text-sm mb-5">
          浏览和安装来自 skills.sh 的社区技能
        </p>

        {/* 搜索栏 */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-6">
          <input
            type="text"
            placeholder="搜索技能..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-line rounded-lg text-sm bg-white focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10"
          />
          <Button type="submit">搜索</Button>
        </form>
      </div>

      <div className="px-7 pb-7 flex-1 overflow-auto">
        {/* 加载中 */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-text-muted text-sm">
            加载中...
          </div>
        )}

        {/* 空状态 */}
        {!loading && data.results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-text-muted">
            <svg className="w-12 h-12 mb-3 opacity-30" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-6 3a1 1 0 112 0 1 1 0 01-2 0zm7-1a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
            </svg>
            <p className="text-sm">暂无技能</p>
            <p className="text-xs mt-1">skills.sh 市场暂不可用或无匹配结果</p>
          </div>
        )}

        {/* 技能卡片网格 */}
        {!loading && data.results.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.results.map((skill) => {
                const installed = installedIds.has(skill.id);
                const installing = installingId === skill.id;
                return (
                  <div
                    key={skill.id}
                    className="border border-line rounded-xl p-4 hover:shadow-md transition-shadow bg-white"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-sm font-semibold text-text-primary truncate">
                        {skill.name}
                      </h3>
                      <span className="text-[11px] text-text-muted ml-2 shrink-0">
                        v{skill.version}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted mb-3 line-clamp-2">
                      {skill.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] text-text-muted">
                        <span>{skill.author}</span>
                        <span className="mx-1.5">·</span>
                        <span>{skill.installCount.toLocaleString()} 次安装</span>
                      </div>
                      <Button
                        size="sm"
                        variant={installed ? 'ghost' : 'primary'}
                        disabled={installed || installing}
                        onClick={() => handleInstall(skill)}
                      >
                        {installed ? '已安装' : installing ? '安装中...' : '安装'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <span className="text-xs text-text-muted">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </ContentPageShell>
  );
}
