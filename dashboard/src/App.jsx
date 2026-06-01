import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import {
  Eye,
  MousePointerClick,
  TrendingUp,
  DollarSign,
  Activity,
  RefreshCw,
  AlertTriangle,
  Search
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';
const API_SECRET = import.meta.env.VITE_API_SECRET || '';

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1).replace('.', ',')}%`;
}

async function apiGet(path) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'X-API-Secret': API_SECRET
    }
  });

  const json = await response.json();

  if (!response.ok || json.ok === false) {
    throw new Error(json.error || 'Erro ao buscar dados');
  }

  return json;
}

function StatCard({ title, value, subtitle, icon: Icon }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">
        <Icon size={20} />
      </div>
      <div>
        <p className="stat-title">{title}</p>
        <h2>{value}</h2>
        {subtitle && <p className="stat-subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}

function DiagnosisBadge({ value }) {
  const className =
    value === 'View-through forte'
      ? 'badge badge-view'
      : value === 'Click-through forte'
      ? 'badge badge-click'
      : value === 'Misto'
      ? 'badge badge-mixed'
      : value === 'Gasto sem compra'
      ? 'badge badge-danger'
      : 'badge badge-neutral';

  return <span className={className}>{value}</span>;
}

export default function App() {
  const [overview, setOverview] = useState(null);
  const [ads, setAds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  async function loadDashboard() {
    setLoading(true);
    setError('');

    try {
      const [overviewJson, adsJson, campaignsJson] = await Promise.all([
        apiGet('/api/dashboard/overview'),
        apiGet('/api/dashboard/ads?limit=100'),
        apiGet('/api/dashboard/campaigns')
      ]);

      setOverview(overviewJson.data);
      setAds(adsJson.data || []);
      setCampaigns(campaignsJson.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function syncMeta() {
    setSyncing(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/meta/sync-ads`, {
        method: 'POST',
        headers: {
          'X-API-Secret': API_SECRET
        }
      });

      const json = await response.json();

      if (!response.ok || json.ok === false) {
        throw new Error(json.error || 'Erro ao sincronizar Meta');
      }

      await loadDashboard();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const filteredAds = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return ads;

    return ads.filter((ad) =>
      [
        ad.campaign_name,
        ad.adset_name,
        ad.ad_name,
        ad.diagnosis
      ]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(q))
    );
  }, [ads, query]);

  const chartData = useMemo(() => {
    return ads
      .filter((ad) => ad.purchases_total > 0)
      .slice(0, 10)
      .map((ad) => ({
        name: ad.ad_name?.slice(0, 24) || 'Anúncio',
        view: ad.purchases_1d_view,
        click: ad.purchases_7d_click,
        total: ad.purchases_total
      }));
  }, [ads]);

  const pieData = useMemo(() => {
    if (!overview) return [];

    return [
      { name: 'View-through', value: overview.meta_purchases_view || 0 },
      { name: 'Click-through', value: overview.meta_purchases_click || 0 }
    ];
  }, [overview]);

  if (loading) {
    return (
      <div className="page center">
        <div className="loader" />
        <p>Carregando dashboard da Vixoran...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <p className="eyebrow">Vixoran Attribution</p>
          <h1>Dashboard de Performance Meta</h1>
          <p className="description">
            Visão de gasto, compras por clique, compras por visualização e criativos com maior influência.
          </p>
        </div>

        <button className="sync-button" onClick={syncMeta} disabled={syncing}>
          <RefreshCw size={18} className={syncing ? 'spin' : ''} />
          {syncing ? 'Sincronizando...' : 'Sincronizar Meta'}
        </button>
      </header>

      {error && (
        <div className="error-box">
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      {overview && (
        <section className="stats-grid">
          <StatCard
            title="Gasto Meta"
            value={formatCurrency(overview.spend)}
            subtitle={`${formatNumber(overview.impressions)} impressões`}
            icon={DollarSign}
          />
          <StatCard
            title="Compras Meta"
            value={formatNumber(overview.meta_purchases_total)}
            subtitle={`CPA ${formatCurrency(overview.cpa_total)}`}
            icon={TrendingUp}
          />
          <StatCard
            title="Compras View"
            value={formatNumber(overview.meta_purchases_view)}
            subtitle={`${formatPercent(overview.view_share)} das compras`}
            icon={Eye}
          />
          <StatCard
            title="Compras Click"
            value={formatNumber(overview.meta_purchases_click)}
            subtitle={`${formatPercent(overview.click_share)} das compras`}
            icon={MousePointerClick}
          />
          <StatCard
            title="Receita atribuída"
            value={formatCurrency(overview.meta_purchase_value_total)}
            subtitle={`ROAS ${Number(overview.roas_meta || 0).toFixed(2)}`}
            icon={Activity}
          />
        </section>
      )}

      <section className="charts-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Compras por View vs Click</h3>
            <p>Distribuição atribuída pela Meta</p>
          </div>

          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={4}
                >
                  <Cell fill="#2563eb" />
                  <Cell fill="#f97316" />
                </Pie>
                <Tooltip formatter={(value) => formatNumber(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Top anúncios com compras</h3>
            <p>Separação entre view-through e click-through</p>
          </div>

          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="view" name="View" fill="#2563eb" radius={[6, 6, 0, 0]} />
                <Bar dataKey="click" name="Click" fill="#f97316" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header table-header">
          <div>
            <h3>Ranking de anúncios</h3>
            <p>Ordenado por compras view-through, compras totais e gasto.</p>
          </div>

          <div className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar campanha, conjunto, anúncio..."
            />
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Diagnóstico</th>
                <th>Campanha</th>
                <th>Conjunto</th>
                <th>Anúncio</th>
                <th>Gasto</th>
                <th>Compras</th>
                <th>View</th>
                <th>Click</th>
                <th>% View</th>
                <th>CPA</th>
                <th>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {filteredAds.map((ad) => (
                <tr key={`${ad.ad_id}-${ad.date_start}`}>
                  <td>
                    <DiagnosisBadge value={ad.diagnosis} />
                  </td>
                  <td>{ad.campaign_name}</td>
                  <td>{ad.adset_name}</td>
                  <td>{ad.ad_name}</td>
                  <td>{formatCurrency(ad.spend)}</td>
                  <td>{formatNumber(ad.purchases_total)}</td>
                  <td>{formatNumber(ad.purchases_1d_view)}</td>
                  <td>{formatNumber(ad.purchases_7d_click)}</td>
                  <td>{formatPercent(ad.view_share)}</td>
                  <td>{ad.cpa_total ? formatCurrency(ad.cpa_total) : '-'}</td>
                  <td>{ad.roas_meta ? Number(ad.roas_meta).toFixed(2) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Campanhas</h3>
          <p>Resumo agrupado por campanha.</p>
        </div>

        <div className="campaign-grid">
          {campaigns.slice(0, 12).map((campaign) => (
            <div className="campaign-card" key={campaign.campaign_id}>
              <h4>{campaign.campaign_name}</h4>
              <div className="campaign-metrics">
                <span>Gasto: {formatCurrency(campaign.spend)}</span>
                <span>Compras: {formatNumber(campaign.purchases_total)}</span>
                <span>View: {formatNumber(campaign.purchases_1d_view)}</span>
                <span>Click: {formatNumber(campaign.purchases_7d_click)}</span>
                <span>ROAS: {campaign.roas_meta ? Number(campaign.roas_meta).toFixed(2) : '-'}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}